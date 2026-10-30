package store

import (
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"sync"
	"testing"
	"time"
)

func TestClosedAccountRejectsStaleWrites(t *testing.T) {
	s, _ := walletStore(t)
	u, _ := s.GetUser("owner")
	old := u
	u.AccountStatus = models.AccountStatusDeleted
	u.DeletedAt = ptrDeletionTime()
	if err := s.UpdateUser(old, u); err != nil {
		t.Fatal(err)
	}
	for name, write := range map[string]func() error{
		"profile":   func() error { return s.UpdateUser(old, old) },
		"last seen": func() error { return s.TouchUserLastSeen(old.ID, time.Now()) },
		"load": func() error {
			return s.SaveLoad(models.Load{ID: "late", CustomerID: old.ID, Status: models.LoadStatusPublished})
		},
		"refresh": func() error { return s.SaveRefresh("late", old.ID, time.Hour) },
		"push": func() error {
			return s.SavePushToken(models.PushToken{UserID: old.ID, ExpoPushToken: "ExponentPushToken[late]"})
		},
		"photo": func() error { return s.SavePhoto("late", []byte("personal"), "image/jpeg", old.ID, "") },
	} {
		t.Run(name, func(t *testing.T) {
			if err := write(); err == nil {
				t.Error("closed account write accepted")
			}
		})
	}
}
func ptrDeletionTime() *time.Time { now := time.Now().UTC(); return &now }

// Other closure tests below use the same isolated Redis fixture.

func TestDeletionRequiresFinancialAndComplaintSettlement(t *testing.T) {
	for _, kind := range []string{"balance", "debt", "reserved", "corporate", "commission", "complaint"} {
		t.Run(kind, func(t *testing.T) {
			s, c := walletStore(t)
			switch kind {
			case "balance", "debt", "reserved":
				w := models.DriverWallet{DriverID: "owner"}
				if kind == "balance" {
					w.BalanceCents = 50000
				}
				if kind == "debt" {
					w.BalanceCents = -41000
				}
				if kind == "reserved" {
					w.ReservedCents = 41000
				}
				if err := s.client.Set(s.ctx, driverWalletKey("owner"), mustJSON(w), 0).Err(); err != nil {
					t.Fatal(err)
				}
			case "corporate":
				if _, err := s.AdjustWallet(c, models.WalletTransaction{ID: "seed", AmountCents: 50000}); err != nil {
					t.Fatal(err)
				}
			case "commission":
				if err := s.SaveLoad(models.Load{ID: "old", AssignedDriver: "owner", Status: models.LoadStatusCompleted}); err != nil {
					t.Fatal(err)
				}
				if err := s.client.Set(s.ctx, driverCommissionKey("old"), mustJSON(models.DriverCommission{LoadID: "old", DriverID: "owner", AmountCents: 41000, Status: "reserved"}), 0).Err(); err != nil {
					t.Fatal(err)
				}
			case "complaint":
				if err := s.SaveComplaint(models.MessageComplaint{ID: "open", ReportedUserID: "owner", ReporterID: "other", Status: models.ComplaintStatusOpen}); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.BeginAccountDeletion("owner"); err == nil {
				t.Fatal("unsettled closure accepted")
			}
			u, _ := s.GetUser("owner")
			if u.DeletedAt != nil {
				t.Fatal("rejected deletion changed account")
			}
		})
	}
}

func TestDeletionFenceRaces(t *testing.T) {
	for _, kind := range []string{"load", "offer", "topup", "wallet", "complaint", "complaint_target"} {
		t.Run(kind, func(t *testing.T) {
			for i := 0; i < 12; i++ {
				s, c := walletStore(t)
				if kind == "offer" {
					if err := s.SaveLoad(models.Load{ID: "other-load", CustomerID: "other", Status: models.LoadStatusPublished}); err != nil {
						t.Fatal(err)
					}
				}
				start := make(chan struct{})
				var wg sync.WaitGroup
				wg.Add(2)
				var results [2]error
				go func() { defer wg.Done(); <-start; _, results[0] = s.BeginAccountDeletion("owner") }()
				go func() {
					defer wg.Done()
					<-start
					switch kind {
					case "load":
						results[1] = s.SaveLoad(models.Load{ID: "new", CustomerID: "owner", Status: models.LoadStatusPublished})
					case "offer":
						results[1] = s.SaveOffer(models.Offer{ID: "bid", DriverID: "owner", LoadID: "other-load", AmountTL: 4100, Status: "pending"})
					case "topup":
						results[1] = s.TopupDriverWallet("owner", 50000, "receipt", "admin")
					case "wallet":
						_, results[1] = s.AdjustWallet(c, models.WalletTransaction{ID: "adjust", AmountCents: 50000})
					case "complaint_target":
						results[1] = s.SaveComplaint(models.MessageComplaint{ID: "open", ReporterID: "other", ReportedUserID: "owner", Status: models.ComplaintStatusOpen})
					case "complaint":
						results[1] = s.SaveComplaint(models.MessageComplaint{ID: "open", ReporterID: "owner", Status: models.ComplaintStatusOpen})
					}
				}()
				close(start)
				wg.Wait()
				if results[0] == nil && results[1] == nil {
					t.Fatalf("both closure and %s committed", kind)
				}
				u, _ := s.GetUser("owner")
				if results[0] == nil && u.AccountStatus != models.AccountStatusDeleting {
					t.Fatal("closure fence lost")
				}
				if u.AccountStatus == models.AccountStatusDeleting && results[1] == nil {
					t.Fatal("late mutation committed")
				}
			}
		})
	}
}

func TestDeletingAccountRejectsLateCredentialsAndFiles(t *testing.T) {
	s, _ := walletStore(t)
	u, err := s.BeginAccountDeletion("owner")
	if err != nil {
		t.Fatal(err)
	}
	if u.AccountStatus != models.AccountStatusDeleting {
		t.Fatal("missing fence")
	}
	writes := []func() error{
		func() error {
			return s.SavePasswordResetCode(PasswordResetRecord{UserID: u.ID, Email: u.Email}, time.Minute)
		},
		func() error {
			return s.SavePasswordResetToken("late", PasswordResetTokenRecord{UserID: u.ID}, time.Minute)
		},
		func() error {
			return s.SaveDriverDocument(models.DriverDocument{ID: "late", DriverID: u.ID, Status: "pending", FileURL: "/api/photos/late"})
		},
		func() error {
			return s.SaveVehicle(models.Vehicle{ID: "late", DriverID: u.ID, IsActive: true, LicensePlate: "personal"})
		},
		func() error { return s.SavePhoto("late", []byte("personal"), "image/jpeg", u.ID, "") },
		func() error { return s.ClaimMessageAttachment("late", u.ID, "load") },
		func() error {
			return s.SaveMessage(models.Message{ID: "late", SenderID: u.ID, LoadID: "load", ClientMessageID: "late", Body: "personal"})
		},
	}
	for i, write := range writes {
		if err := write(); err == nil {
			t.Fatalf("late operation %d accepted", i)
		}
	}
	if _, err := s.BeginAccountDeletion(u.ID); err != nil {
		t.Fatalf("interrupted cleanup cannot resume: %v", err)
	}
}

func TestHistoricalRejectedDriverDoesNotBlockActiveJob(t *testing.T) {
	s, _ := walletStore(t)
	if err := s.SaveUser(models.User{ID: "former", Role: models.RoleDriver, Email: "former@example.test", Phone: "123"}); err != nil {
		t.Fatal(err)
	}
	l := models.Load{ID: "selectable", CustomerID: "owner", Status: models.LoadStatusPublished, PaymentApproval: &models.PaymentApproval{DriverID: "former", Status: "rejected"}}
	if err := s.SaveLoad(l); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveOffer(models.Offer{ID: "old", LoadID: l.ID, DriverID: "former", Status: "withdrawn"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.BeginAccountDeletion("former"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveUser(models.User{ID: "new-driver", Role: models.RoleDriver, Email: "new@example.test", Phone: "456"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveOffer(models.Offer{ID: "new", LoadID: l.ID, DriverID: "new-driver", Status: "pending", AmountTL: 4100}); err != nil {
		t.Fatalf("rejected history stranded job: %v", err)
	}
	// Acceptance watches historical offers too; their deleted owners are not current participants.
	if err := s.watchPayment(func(tx *redis.Tx) error {
		_, err := tx.TxPipelined(s.ctx, func(p redis.Pipeliner) error { p.Set(s.ctx, "probe", "ok", 0); return nil })
		return err
	}, "load:"+l.ID, "offer:old", "offer:new"); err != nil {
		t.Fatalf("historical offer owner blocked current selection: %v", err)
	}
}

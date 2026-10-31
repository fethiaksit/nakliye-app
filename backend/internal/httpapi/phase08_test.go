package httpapi

import (
	"encoding/json"
	"fmt"
	"nakliye-api/internal/models"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestDeletionBlocksUnsettledLoads(t *testing.T) {
	for _, status := range []string{models.LoadStatusPaymentApprovalPending, models.LoadStatusDelivered} {
		t.Run(status, func(t *testing.T) {
			h, s := newFlowTestAPI(t)
			c := registerTestUser(t, h, "p08customer", models.RoleCustomer)
			d := registerTestUser(t, h, "p08driver", models.RoleDriver)
			l := acceptStatusTestOffer(t, h, c, d, createPublishedStatusTestLoad(t, h, c, "unfinished"))
			l.Status = status
			if err := s.SaveLoad(l); err != nil {
				t.Fatal(err)
			}
			for _, token := range []string{c.AccessToken, d.AccessToken} {
				r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", token, map[string]any{"password": "GucluSifre123"})
				if r.Code != http.StatusBadRequest {
					t.Fatalf("unsettled %s deletion: %d %s", status, r.Code, r.Body.String())
				}
			}
		})
	}
}

func TestDriverSummaryDoesNotExposeContactOrReviewMetadata(t *testing.T) {
	u := models.User{ID: "driver", Name: "Test", Email: "private@example.test", Phone: "private", Role: models.RoleDriver,
		DriverProfile: models.DriverProfile{VerificationNote: "private", VerifiedBy: "admin", LicensePlate: "private", Rating: 4.5}}
	summary := publicDriverSummary(u)
	b, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "private") || strings.Contains(string(b), "admin") {
		t.Fatalf("private data: %s", b)
	}
	if !strings.Contains(string(b), "4.5") {
		t.Fatal("public rating missing")
	}
}

func TestDeletionChecksBeyondFirstHundredLoads(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "p08page", models.RoleCustomer)
	for i := 0; i < 101; i++ {
		status := models.LoadStatusCompleted
		if i == 0 {
			status = models.LoadStatusPaymentApprovalPending
		}
		if err := s.SaveLoad(models.Load{ID: fmt.Sprintf("page-%d", i), CustomerID: c.User.ID, Status: status, CreatedAt: time.Unix(int64(i), 0)}); err != nil {
			t.Fatal(err)
		}
	}
	r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", c.AccessToken, map[string]any{"password": "GucluSifre123"})
	if r.Code != http.StatusBadRequest {
		t.Fatalf("old unsettled load skipped: %d", r.Code)
	}
}

func TestDeletionRequiresSessionAndDoesNotDeleteOtherAccount(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "p08owner", models.RoleCustomer)
	other := registerTestUser(t, h, "p08other", models.RoleCustomer)
	r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", "", map[string]any{"password": "GucluSifre123"})
	if r.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated deletion: %d", r.Code)
	}
	r = requestJSON(t, h, http.MethodPost, "/api/me/delete-account", c.AccessToken, map[string]any{"password": "GucluSifre123", "userId": other.User.ID})
	if r.Code != http.StatusOK {
		t.Fatalf("own deletion: %d", r.Code)
	}
	u, err := s.GetUser(other.User.ID)
	if err != nil || u.AccountStatus == models.AccountStatusDeleted {
		t.Fatal("other user changed")
	}
	r = requestJSON(t, h, http.MethodGet, "/api/me", c.AccessToken, nil)
	if r.Code != http.StatusUnauthorized {
		t.Fatalf("deleted session remains usable: %d", r.Code)
	}
}

func TestDriverDeletionPreservesPreviouslyArchivedDocument(t *testing.T) {
	h, s := newFlowTestAPI(t)
	d := registerTestUser(t, h, "p08archived", models.RoleDriver, false)
	if err := s.SavePhoto("archived-file", []byte("document"), "image/jpeg", d.User.ID, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveDriverDocument(models.DriverDocument{ID: "archived-doc", DriverID: d.User.ID, Kind: "driver_license", Status: "archived", FileURL: "/api/photos/archived-file"}); err != nil {
		t.Fatal(err)
	}
	r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", d.AccessToken, map[string]any{"password": "GucluSifre123"})
	if r.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", r.Code, r.Body.String())
	}
	wallet, err := s.GetDriverWallet(d.User.ID)
	if err != nil || wallet.BalanceCents != 0 {
		t.Fatalf("wallet changed on closure: %+v %v", wallet, err)
	}
	docs, err := s.ListDriverDocuments(d.User.ID)
	if err != nil || len(docs) != 1 || docs[0].FileURL == "" || docs[0].Status != "archived" {
		t.Fatalf("retained document lost: %+v %v", docs, err)
	}
}

func TestDriverDeletionRequiresOutstandingBidWithdrawal(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "p08bidcust", models.RoleCustomer)
	d := registerTestUser(t, h, "p08biddriver", models.RoleDriver, false)
	load := createPublishedStatusTestLoad(t, h, c, "pending bid")
	offer := models.Offer{ID: "pending-bid", LoadID: load.ID, DriverID: d.User.ID, AmountTL: 4100, Status: "pending", CreatedAt: time.Now()}
	if err := s.SaveOffer(offer); err != nil {
		t.Fatal(err)
	}
	r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", d.AccessToken, map[string]any{"password": "GucluSifre123"})
	if r.Code != http.StatusBadRequest {
		t.Fatalf("live bid deletion: %d", r.Code)
	}
	r = requestJSON(t, h, http.MethodDelete, "/api/offers/"+offer.ID, d.AccessToken, nil)
	if r.Code != http.StatusNoContent {
		t.Fatalf("withdraw: %d %s", r.Code, r.Body.String())
	}
	r = requestJSON(t, h, http.MethodPost, "/api/me/delete-account", d.AccessToken, map[string]any{"password": "GucluSifre123"})
	if r.Code != http.StatusOK {
		t.Fatalf("after withdrawal: %d %s", r.Code, r.Body.String())
	}
}

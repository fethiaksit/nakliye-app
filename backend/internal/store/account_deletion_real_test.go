package store

import (
	"github.com/google/uuid"
	"nakliye-api/internal/models"
	"os"
	"strings"
	"sync"
	"testing"
)

// Accept only this task's new local socket: never a live TCP Redis or volume.
func TestAccountDeletionRealRedis(t *testing.T) {
	url := os.Getenv("ACCOUNT_DELETION_TEST_REDIS_URL")
	if url == "" {
		t.Skip("isolated local Redis URL not supplied")
	}
	if !strings.HasPrefix(url, "unix:///tmp/nakliyego-phase08-") {
		t.Fatal("only isolated task socket permitted")
	}
	s, err := New(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.client.Close() })
	for _, kind := range []string{"load", "offer", "topup", "wallet", "complaint"} {
		t.Run(kind, func(t *testing.T) {
			for i := 0; i < 10; i++ {
				id := uuid.NewString()
				company := models.Company{ID: "co-" + id, OwnerCustomerID: id}
				if err := s.CreateCorporateAccount(models.User{ID: id, Role: models.RoleCustomer, AccountType: models.AccountTypeCorporate, Email: id + "@example.test", Phone: id}, company, models.CorporateWallet{ID: "w-" + id, CompanyID: company.ID}); err != nil {
					t.Fatal(err)
				}
				lid := "load-" + id
				if kind == "offer" {
					if err := s.SaveLoad(models.Load{ID: lid, CustomerID: "other", Status: models.LoadStatusPublished}); err != nil {
						t.Fatal(err)
					}
				}
				var wg sync.WaitGroup
				wg.Add(2)
				start := make(chan struct{})
				var outcomes [2]error
				go func() { defer wg.Done(); <-start; _, outcomes[0] = s.BeginAccountDeletion(id) }()
				go func() {
					defer wg.Done()
					<-start
					switch kind {
					case "load":
						outcomes[1] = s.SaveLoad(models.Load{ID: lid, CustomerID: id, Status: models.LoadStatusPublished})
					case "offer":
						outcomes[1] = s.SaveOffer(models.Offer{ID: "o-" + id, DriverID: id, LoadID: lid, Status: "pending", AmountTL: 4100})
					case "topup":
						outcomes[1] = s.TopupDriverWallet(id, 50000, "receipt", "admin")
					case "wallet":
						_, outcomes[1] = s.AdjustWallet(company, models.WalletTransaction{ID: "adjust-" + id, AmountCents: 50000})
					case "complaint":
						outcomes[1] = s.SaveComplaint(models.MessageComplaint{ID: "complaint-" + id, ReporterID: "other", ReportedUserID: id, Status: models.ComplaintStatusOpen})
					}
				}()
				close(start)
				wg.Wait()
				if outcomes[0] == nil && outcomes[1] == nil {
					t.Fatalf("closure and %s both committed", kind)
				}
				u, err := s.GetUser(id)
				if err != nil {
					t.Fatal(err)
				}
				if outcomes[0] == nil && u.AccountStatus != models.AccountStatusDeleting {
					t.Fatal("fence not persisted")
				}
			}
		})
	}
}

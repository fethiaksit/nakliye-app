package store

import (
	"nakliye-api/internal/models"
	"testing"
)

func TestAccountDeletionLoadsFailsClosed(t *testing.T) {
	for _, value := range []string{"not-json", `{}`} {
		t.Run(value, func(t *testing.T) {
			s, _ := walletStore(t)
			if err := s.SaveLoad(models.Load{ID: "broken", CustomerID: "customer", Status: models.LoadStatusPaymentApprovalPending}); err != nil {
				t.Fatal(err)
			}
			if err := s.client.Set(s.ctx, "load:broken", value, 0).Err(); err != nil {
				t.Fatal(err)
			}
			if _, err := s.AccountDeletionLoads("customer"); err == nil {
				t.Fatal("corrupt load silently skipped")
			}
		})
	}
}

package store

import (
	"encoding/json"
	"errors"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"testing"
	"time"
)

func walletStore(t *testing.T) (*RedisStore, models.Company) {
	t.Helper()
	r := miniredis.RunT(t)
	s, err := New("redis://" + r.Addr())
	if err != nil {
		t.Fatal(err)
	}
	company := models.Company{ID: "co", OwnerCustomerID: "owner"}
	err = s.CreateCorporateAccount(models.User{ID: "owner", Email: "owner@example.com", Phone: "555", Role: models.RoleCustomer, AccountType: models.AccountTypeCorporate}, company, models.CorporateWallet{ID: "w", CompanyID: "co"})
	if err != nil {
		t.Fatal(err)
	}
	return s, company
}
func TestWalletMigrationPreservesLedgerAndPolicy(t *testing.T) {
	s, _ := walletStore(t)
	legacy := `{"id":"old","companyId":"co","walletId":"w","type":"shipment_reward","amountCents":1000,"balanceAfterCents":1500}`
	if err := s.client.Set(s.ctx, "wallet-transaction:old", legacy, 0).Err(); err != nil {
		t.Fatal(err)
	}
	p := models.DefaultWalletPolicy()
	p.DefaultRewardRateBps = 1000
	if err := s.SaveWalletPolicy(p); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := s.MigrateWalletPolicy(); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.GetWalletPolicy()
	if err != nil || got.DefaultRewardRateBps != 1000 {
		t.Fatalf("migration replaced settings %#v %v", got, err)
	}
	tx, err := s.GetWalletTransaction("old")
	if err != nil || tx.Type != "earn" || tx.BalanceBeforeCents != 500 || tx.RewardRateBps != 1000 || tx.CorporateCustomerID != "owner" {
		t.Fatalf("legacy projection %#v %v", tx, err)
	}
	body, _ := s.client.Get(s.ctx, "wallet-transaction:old").Result()
	if body != legacy {
		t.Fatal("legacy ledger was modified")
	}
	if walletUniqueKey("earn", "job") != "wallet-transaction-unique:shipment_reward:job" {
		t.Fatal("historical idempotency broken")
	}
}
func TestWalletConcurrentAdjustments(t *testing.T) {
	s, company := walletStore(t)
	if _, err := s.AdjustWallet(company, models.WalletTransaction{ID: "seed", AmountCents: 10000, Description: "Seed"}); err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 2)
	for _, id := range []string{"a", "b"} {
		go func(id string) {
			var err error
			for i := 0; i < 4; i++ {
				_, err = s.AdjustWallet(company, models.WalletTransaction{ID: id, AmountCents: -8000, Description: "debit"})
				if !errors.Is(err, ErrWalletConflict) {
					break
				}
			}
			results <- err
		}(id)
	}
	successes := 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrWalletBalance) {
			t.Fatal(err)
		}
	}
	wallet, err := s.GetCorporateWallet(company.ID)
	if err != nil || successes != 1 || wallet.BalanceCents != 2000 {
		t.Fatalf("wallet %#v success %d err %v", wallet, successes, err)
	}
	entries, err := s.ListWalletTransactions(wallet.ID)
	if err != nil || len(entries) != 2 {
		t.Fatalf("ledger %d %v", len(entries), err)
	}
	for _, entry := range entries {
		if entry.BalanceAfterCents != entry.BalanceBeforeCents+entry.AmountCents {
			t.Fatalf("ledger mismatch %#v", entry)
		}
	}
}
func TestCancellationCannotBypassConcurrentWalletAllocation(t *testing.T) {
	s, _ := walletStore(t)
	now := time.Now().UTC()
	load := models.Load{ID: "load", CustomerID: "owner", Status: models.LoadStatusDriverSelected}
	if err := s.SaveLoad(load); err != nil {
		t.Fatal(err)
	}
	allocation, _ := json.Marshal(models.LoadWalletAllocation{LoadID: "load", UsedCents: 100, CompanyID: "co", WalletID: "w"})
	if err := s.client.Set(s.ctx, "load-wallet:load", allocation, 0).Err(); err != nil {
		t.Fatal(err)
	}
	load.Status = models.LoadStatusCancelled
	err := s.TransitionLoadStatus(models.LoadStatusDriverSelected, load, models.LoadStatusEvent{ID: "e", LoadID: "load", FromStatus: models.LoadStatusDriverSelected, ToStatus: models.LoadStatusCancelled, ChangedByUserID: "owner", ChangedByRole: "customer", Source: "customer_app", ChangedAt: now})
	if !errors.Is(err, ErrWalletConflict) {
		t.Fatalf("unguarded cancel must retry refund path, got %v", err)
	}
	if _, err = s.client.Get(s.ctx, "load-status-event:e").Result(); !errors.Is(err, redis.Nil) {
		t.Fatalf("event created on failed transition %v", err)
	}
}

package httpapi

import (
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
	"net/http"
	"testing"
)

func configureTenPercentWallet(t *testing.T, s *store.RedisStore) {
	t.Helper()
	p := models.DefaultWalletPolicy()
	p.DefaultRewardRateBps = 1000
	if err := s.SaveWalletPolicy(p); err != nil {
		t.Fatal(err)
	}
}

func TestWalletDefaultRewardAndUsageCap(t *testing.T) {
	h := newAdminTestAPI(t)
	c := registerCorporateTestUser(t, h, "policy_default")
	d := registerTestUser(t, h, "policy_driver", models.RoleDriver)
	completeCorporateLoad(t, h, c, d, corporateAcceptedLoad(t, h, c, d, "İlk iş", 60000))
	if got := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; got != 300000 {
		t.Fatalf("default 5%%: got %d want 300000", got)
	}
	l := corporateAcceptedLoad(t, h, c, d, "İkinci iş", 8000)
	r := requestJSON(t, h, "POST", "/api/corporate/loads/"+l.ID+"/wallet", c.AccessToken, map[string]int64{"amountCents": 200001})
	if r.Code != 400 {
		t.Fatalf("25%% cap: %d %s", r.Code, r.Body.String())
	}
	r = requestJSON(t, h, "POST", "/api/corporate/loads/"+l.ID+"/wallet", c.AccessToken, map[string]int64{"amountCents": 200000})
	if r.Code != 201 {
		t.Fatalf("allowed spend: %d %s", r.Code, r.Body.String())
	}
	completeCorporateLoad(t, h, c, d, l)
	if got := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; got != 130000 {
		t.Fatalf("net reward: got %d", got)
	}
}

func TestWalletTierPromotionAndRateReset(t *testing.T) {
	h := newAdminTestAPI(t)
	admin := adminLoginForTest(t, h)
	c := registerCorporateTestUser(t, h, "tier_customer")
	d := registerTestUser(t, h, "tier_driver", models.RoleDriver)
	p := models.DefaultWalletPolicy()
	one := int64(1)
	volume := int64(2000000)
	p.Tiers[0].MinCompletedJobs = &one
	p.Tiers[1].MinVolumeCents = &volume
	save := func() {
		t.Helper()
		r := requestJSON(t, h, "PUT", "/api/admin/corporate-wallets/settings", admin.AccessToken, p)
		if r.Code != 200 {
			t.Fatal(r.Body.String())
		}
	}
	save()
	first := completeCorporateLoad(t, h, c, d, corporateAcceptedLoad(t, h, c, d, "Başlangıç", 10000))
	second := completeCorporateLoad(t, h, c, d, corporateAcceptedLoad(t, h, c, d, "Bronz", 10000))
	third := completeCorporateLoad(t, h, c, d, corporateAcceptedLoad(t, h, c, d, "Gümüş", 10000))
	w := getWallet(t, h, c.AccessToken)
	for _, c := range []struct {
		id           string
		amount, rate int64
	}{{first.ID, 50000, 500}, {second.ID, 75000, 750}, {third.ID, 100000, 1000}} {
		entry, ok := findWalletTransaction(w.Transactions, c.id, "earn")
		if !ok || entry.AmountCents != c.amount || entry.RewardRateBps != c.rate || entry.BalanceBeforeCents+entry.AmountCents != entry.BalanceAfterCents {
			t.Fatalf("tier reward %#v", entry)
		}
	}
	if r := requestDeliveryCompletion(t, h, third.ID, d.AccessToken, "000000", true); r.Code != 409 {
		t.Fatalf("duplicate completion %d", r.Code)
	}
	path := "/api/admin/corporate-wallets/" + c.User.ID
	for _, rate := range []any{2000, nil} {
		r := requestJSON(t, h, "PATCH", path+"/rate", admin.AccessToken, map[string]any{"rewardRateBps": rate})
		if r.Code != 200 {
			t.Fatal(r.Body.String())
		}
	}
	r := requestJSON(t, h, "GET", path, admin.AccessToken, nil)
	var view struct {
		Summary store.WalletSummary `json:"summary"`
	}
	view = decodeResponse[struct {
		Summary store.WalletSummary `json:"summary"`
	}](t, r)
	if view.Summary.RewardRateBps != 1000 || view.Summary.TotalEarnedCents != 225000 || view.Summary.Tier != "Gümüş" || view.Summary.OverrideRateBps != nil {
		t.Fatalf("summary %#v", view)
	}
	p.MaxUsageBps = 1000
	save()
	load := corporateAcceptedLoad(t, h, c, d, "Düşük kullanım limiti", 8000)
	r = requestJSON(t, h, "POST", "/api/corporate/loads/"+load.ID+"/wallet", c.AccessToken, map[string]int64{"amountCents": 80001})
	if r.Code != 400 {
		t.Fatalf("changed usage cap %d", r.Code)
	}
	r = requestJSON(t, h, "POST", "/api/corporate/loads/"+load.ID+"/wallet", c.AccessToken, map[string]int64{"amountCents": 80000})
	if r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	p.Enabled = false
	save()
	r = requestJSON(t, h, "PATCH", "/api/loads/"+load.ID+"/status", c.AccessToken, map[string]string{"status": "cancelled"})
	if r.Code != 200 {
		t.Fatalf("disabled system refund %d %s", r.Code, r.Body.String())
	}
	if got := getWallet(t, h, c.AccessToken); got.Wallet.BalanceCents != 225000 || len(got.Transactions) != 5 {
		t.Fatalf("refund %#v", got)
	}
}

func TestWalletAdminPolicyAndAdjustments(t *testing.T) {
	h := newAdminTestAPI(t)
	admin := adminLoginForTest(t, h)
	c := registerCorporateTestUser(t, h, "policy_admin")
	d := registerTestUser(t, h, "policy_admin_driver", models.RoleDriver)
	path := "/api/admin/corporate-wallets/settings"
	r := requestJSON(t, h, "GET", path, admin.AccessToken, nil)
	if r.Code != 200 {
		t.Fatalf("settings: %d %s", r.Code, r.Body.String())
	}
	policy := decodeResponse[map[string]any](t, r)
	policy["defaultRewardRateBps"] = 1000
	r = requestJSON(t, h, "PUT", path, admin.AccessToken, policy)
	if r.Code != 200 {
		t.Fatalf("save settings: %d %s", r.Code, r.Body.String())
	}
	for _, rate := range []int{499, 2001} {
		policy["defaultRewardRateBps"] = rate
		if r = requestJSON(t, h, "PUT", path, admin.AccessToken, policy); r.Code != 400 {
			t.Fatalf("invalid rate %d: %d", rate, r.Code)
		}
	}
	base := "/api/admin/corporate-wallets/" + c.User.ID
	if r = requestJSON(t, h, "PATCH", base+"/rate", admin.AccessToken, map[string]any{"rewardRateBps": 1500}); r.Code != 200 {
		t.Fatalf("override %d %s", r.Code, r.Body.String())
	}
	completeCorporateLoad(t, h, c, d, corporateAcceptedLoad(t, h, c, d, "Özel oran", 10000))
	if got := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; got != 150000 {
		t.Fatalf("override reward %d", got)
	}
	adjustment := map[string]any{"idempotencyKey": "adjust-1", "amountCents": -50000, "description": "Düzeltme"}
	for i := 0; i < 2; i++ {
		if r = requestJSON(t, h, "POST", base+"/adjustments", admin.AccessToken, adjustment); r.Code != 200 {
			t.Fatalf("adjustment %d %s", r.Code, r.Body.String())
		}
	}
	w := getWallet(t, h, c.AccessToken)
	if w.Wallet.BalanceCents != 100000 || len(w.Transactions) != 2 {
		t.Fatalf("duplicate adjustment %#v", w)
	}
	adjustment["idempotencyKey"] = "adjust-2"
	adjustment["amountCents"] = -100001
	if r = requestJSON(t, h, "POST", base+"/adjustments", admin.AccessToken, adjustment); r.Code != 400 {
		t.Fatalf("negative balance %d", r.Code)
	}
	individual := registerTestUser(t, h, "policy_individual", models.RoleCustomer)
	if r = requestJSON(t, h, "GET", "/api/admin/corporate-wallets/"+individual.User.ID, admin.AccessToken, nil); r.Code != 403 {
		t.Fatalf("individual %d", r.Code)
	}
	if r = requestJSON(t, h, "GET", path, c.AccessToken, nil); r.Code != http.StatusUnauthorized {
		t.Fatalf("mobile admin access %d", r.Code)
	}
	policy["defaultRewardRateBps"] = 500
	policy["enabled"] = false
	if r = requestJSON(t, h, "PUT", path, admin.AccessToken, policy); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	l := corporateAcceptedLoad(t, h, c, d, "Kapalı sistem", 10000)
	if r = requestJSON(t, h, "POST", "/api/corporate/loads/"+l.ID+"/wallet", c.AccessToken, map[string]int64{"amountCents": 1}); r.Code != 400 {
		t.Fatalf("disabled spend %d", r.Code)
	}
	completeCorporateLoad(t, h, c, d, l)
	if got := getWallet(t, h, c.AccessToken); got.Wallet.BalanceCents != 100000 || len(got.Transactions) != 2 {
		t.Fatalf("disabled earn %#v", got)
	}
}

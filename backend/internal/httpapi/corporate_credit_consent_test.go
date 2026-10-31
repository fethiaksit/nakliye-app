package httpapi

import (
	"fmt"
	"github.com/alicebob/miniredis/v2"
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
	"net/http"
	"os"
	"testing"
)

func TestCorporateCreditConsentSettlement(t *testing.T) {
	h, s := newFlowTestAPI(t)
	configureTenPercentWallet(t, s)
	c := registerCorporateTestUser(t, h, "consent_c")
	d := registerTestUser(t, h, "consent_d", models.RoleDriver)
	completeCorporateLoad(t, h, c, d, corporateAcceptedLoad(t, h, c, d, "Kredi kazan", 10000))
	before := getWallet(t, h, c.AccessToken).Wallet.BalanceCents
	dw, _ := s.GetDriverWallet(d.User.ID)
	l := createPublishedStatusTestLoad(t, h, c, "4100 TL taşıma")
	r := requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/offers", d.AccessToken, map[string]any{"amountTl": 4100})
	if r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	o := decodeResponse[models.Offer](t, r)
	r = requestJSON(t, h, "POST", "/api/offers/"+o.ID+"/accept", c.AccessToken, map[string]any{"amountCents": 50000})
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	selected := decodeResponse[map[string]any](t, r)
	if selected["status"] != "payment_approval_pending" || selected["assignedDriverId"] != nil {
		t.Fatalf("must await unassigned consent: %#v", selected)
	}
	viewResponse := requestJSON(t, h, "GET", "/api/corporate/loads/"+l.ID+"/wallet", c.AccessToken, nil)
	view := decodeResponse[map[string]any](t, viewResponse)
	if view["customerPayableCents"] != float64(360000) {
		t.Errorf("pending wallet view: %#v", view)
	}
	for _, token := range []string{c.AccessToken, d.AccessToken} {
		r := requestJSON(t, h, "GET", "/api/loads/"+l.ID, token, nil)
		view := decodeResponse[models.Load](t, r)
		if r.Code != 200 || view.Status != models.LoadStatusPaymentApprovalPending || view.PaymentApproval == nil || view.PaymentApproval.Status != "pending" {
			t.Fatal("pending detail differs between apps", r.Code, r.Body.String())
		}
	}
	approval := selected["paymentApproval"].(map[string]any)
	if approval["customerPayableCents"] != float64(360000) || approval["creditCents"] != float64(50000) {
		t.Fatal(approval)
	}
	if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != before-50000 {
		t.Fatal(w)
	}
	if r = requestJSON(t, h, "PATCH", "/api/loads/"+l.ID+"/status", d.AccessToken, map[string]any{"status": "driver_en_route"}); r.Code == 200 {
		t.Fatal("started without approval")
	}
	r = requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": approval["id"], "accept": true})
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	approved := decodeResponse[models.Load](t, r)
	if approved.AssignedDriver != d.User.ID || approved.DriverCommissionCents != 41000 {
		t.Fatal(approved)
	}
	for _, token := range []string{c.AccessToken, d.AccessToken} {
		r := requestJSON(t, h, "GET", "/api/loads/"+l.ID, token, nil)
		view := decodeResponse[models.Load](t, r)
		if view.Status != models.LoadStatusDriverSelected || view.PaymentApproval == nil || view.PaymentApproval.Status != "approved" || view.PaymentApproval.CreditCents != 50000 {
			t.Fatal("approved detail differs between apps", r.Code, r.Body.String())
		}
	}
	duplicateApproval := requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": approved.PaymentApproval.ID, "accept": true})
	if duplicateApproval.Code != 409 {
		t.Fatal("approval processed twice", duplicateApproval.Code)
	}
	assertDriverBalance(t, h, d, dw.BalanceCents, 41000)
	completeCorporateLoad(t, h, c, d, approved)
	assertDriverBalance(t, h, d, dw.BalanceCents-41000+50000, 0)
	if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != before-50000+36000 {
		t.Fatal(w)
	}
	entries, err := s.ListDriverWalletTransactions(d.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, e := range entries {
		if e.LoadID == l.ID && e.Type == "CORPORATE_CREDIT_COMPENSATION" {
			count++
			if e.AmountCents != 50000 {
				t.Fatal(e)
			}
		}
	}
	if count != 1 {
		t.Fatal(count)
	}
	requestDeliveryCompletion(t, h, l.ID, d.AccessToken, "000000", true)
	assertDriverBalance(t, h, d, dw.BalanceCents-41000+50000, 0)
}

func corporateOfferedLoad(t *testing.T, h http.Handler, c, d testSession, title string, amount float64) models.Load {
	t.Helper()
	l := createPublishedStatusTestLoad(t, h, c, title)
	r := requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/offers", d.AccessToken, map[string]any{"amountTl": amount})
	if r.Code != 201 {
		t.Fatal(r.Code, r.Body.String())
	}
	return l
}
func pendingOfferID(t *testing.T, h http.Handler, c testSession, l models.Load) string {
	t.Helper()
	r := requestJSON(t, h, "GET", "/api/loads/"+l.ID+"/offers", c.AccessToken, nil)
	offers := decodeResponse[[]struct {
		Offer models.Offer `json:"offer"`
	}](t, r)
	if len(offers) == 0 {
		t.Fatal("missing offer")
	}
	return offers[0].Offer.ID
}
func approveCreditForTest(t *testing.T, h http.Handler, c, d testSession, l models.Load) models.Load {
	t.Helper()
	r := requestJSON(t, h, "GET", "/api/loads/"+l.ID, c.AccessToken, nil)
	stored := decodeResponse[models.Load](t, r)
	if stored.PaymentApproval == nil {
		t.Fatal("missing approval")
	}
	r = requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": stored.PaymentApproval.ID, "accept": true})
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	return decodeResponse[models.Load](t, r)
}

func creditFixture(t *testing.T) (http.Handler, *store.RedisStore, testSession, testSession, models.Load) {
	t.Helper()
	h, s := newFlowTestAPI(t)
	return creditFixtureOn(t, h, s)
}
func creditFixtureOn(t *testing.T, h http.Handler, s *store.RedisStore) (http.Handler, *store.RedisStore, testSession, testSession, models.Load) {
	t.Helper()
	configureTenPercentWallet(t, s)
	c := registerCorporateTestUser(t, h, "credit_fixture_c")
	d := registerTestUser(t, h, "credit_fixture_d", models.RoleDriver)
	completeCorporateLoad(t, h, c, d, corporateAcceptedLoad(t, h, c, d, "Bakiye", 10000))
	l := corporateOfferedLoad(t, h, c, d, "Onay bekleyen iş", 4100)
	r := requestJSON(t, h, "POST", "/api/offers/"+pendingOfferID(t, h, c, l)+"/accept", c.AccessToken, map[string]any{"amountCents": 6000})
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	return h, s, c, d, decodeResponse[models.Load](t, r)
}
func TestCorporateCreditRejectReselectAndAuthorization(t *testing.T) {
	h, s, c, d, l := creditFixture(t)
	before, _ := s.GetDriverWallet(d.User.ID)
	other := registerTestUser(t, h, "credit_other_d", models.RoleDriver)
	path := "/api/loads/" + l.ID + "/payment-approval"
	decision := map[string]any{"selectionId": l.PaymentApproval.ID, "accept": true}
	if r := requestJSON(t, h, "POST", path, d.AccessToken, map[string]any{"selectionId": l.PaymentApproval.ID}); r.Code != 400 {
		t.Fatal("missing explicit decision", r.Code)
	}

	for _, token := range []string{c.AccessToken, other.AccessToken} {
		if r := requestJSON(t, h, "POST", path, token, decision); r.Code != 403 {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	admin := adminLoginForTest(t, h)
	if r := requestJSON(t, h, "PATCH", "/api/admin/loads/"+l.ID+"/status", admin.AccessToken, map[string]any{"status": "driver_selected", "note": "Onayı atla"}); r.Code < 400 {
		t.Fatal("admin bypass")
	}
	if r := requestJSON(t, h, "POST", "/api/corporate/loads/"+l.ID+"/wallet", c.AccessToken, map[string]any{"amountCents": 1}); r.Code != 409 {
		t.Fatal(r.Code)
	}
	// An in-flight offer update must not invalidate the displayed payment terms.
	offer, _ := s.GetOffer(l.PaymentApproval.OfferID)
	offer.AmountTL = 4200
	if err := s.SaveOffer(offer); err == nil {
		t.Error("pending payment offer was mutable")
	}
	decision["accept"] = false
	if r := requestJSON(t, h, "POST", path, d.AccessToken, decision); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 100000 {
		t.Fatal(w)
	}
	assertDriverBalance(t, h, d, before.BalanceCents, 0)
	if r := requestJSON(t, h, "POST", path, d.AccessToken, decision); r.Code != 409 {
		t.Fatal(r.Code)
	}
	r := requestJSON(t, h, "POST", "/api/offers/"+l.PaymentApproval.OfferID+"/accept", c.AccessToken, map[string]any{"amountCents": 5000})
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	next := decodeResponse[models.Load](t, r)
	if next.PaymentApproval.ID == l.PaymentApproval.ID {
		t.Fatal("selection reused")
	}
	decision["accept"] = true
	if r = requestJSON(t, h, "POST", path, d.AccessToken, decision); r.Code != 409 {
		t.Fatal("stale approval", r.Code)
	}
	approved := approveCreditForTest(t, h, c, d, next)
	if approved.PaymentApproval.CreditCents != 5000 || approved.PaymentApproval.DecidedBy != d.User.ID || approved.PaymentApproval.DecidedAt == nil {
		t.Fatal(approved.PaymentApproval)
	}
}
func TestCorporateCreditCancellationRefundsOnce(t *testing.T) {
	for _, approved := range []bool{false, true} {
		t.Run(fmt.Sprint(approved), func(t *testing.T) {
			h, s, c, d, l := creditFixture(t)
			before, _ := s.GetDriverWallet(d.User.ID)
			if approved {
				l = approveCreditForTest(t, h, c, d, l)
			}
			codes := make(chan int, 2)
			for range 2 {
				go func() {
					codes <- requestJSON(t, h, "PATCH", "/api/loads/"+l.ID+"/status", c.AccessToken, map[string]any{"status": "cancelled"}).Code
				}()
			}
			successes := 0
			for range 2 {
				if code := <-codes; code == 200 {
					successes++
				} else if code != 409 {
					t.Fatal(code)
				}
			}
			if successes != 1 {
				t.Fatal(successes)
			}
			if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 100000 {
				t.Fatal(w)
			}
			assertDriverBalance(t, h, d, before.BalanceCents, 0)
			entries, _ := s.ListDriverWalletTransactions(d.User.ID)
			for _, e := range entries {
				if e.LoadID == l.ID && e.Type == models.DriverTransactionCorporateCreditCompensation {
					t.Fatal(e)
				}
			}
		})
	}
}
func TestCorporateCreditConcurrentCompletionAndRetry(t *testing.T) {
	h, s, c, d, l := creditFixture(t)
	l = approveCreditForTest(t, h, c, d, l)
	before, _ := s.GetDriverWallet(d.User.ID)
	advanceLoadToDelivered(t, h, l.ID, d.AccessToken)
	code, _ := deliveryCodeForTest(t, h, l.ID, c.AccessToken)
	results := make(chan int, 4)
	for range 4 {
		go func() { results <- requestDeliveryCompletion(t, h, l.ID, d.AccessToken, code, true).Code }()
	}
	success := 0
	for range 4 {
		if status := <-results; status == 200 {
			success++
		} else if status != 409 {
			t.Fatal(status)
		}
	}
	if success != 1 {
		t.Fatal(success)
	}
	// Discard the first response as with a lost network response, then retry.
	requestDeliveryCompletion(t, h, l.ID, d.AccessToken, code, true)
	assertDriverBalance(t, h, d, before.BalanceCents-41000+6000, 0)
	if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 134400 {
		t.Fatal(w)
	}
	entries, _ := s.ListDriverWalletTransactions(d.User.ID)
	compensation, commission := 0, 0
	for _, e := range entries {
		if e.LoadID != l.ID {
			continue
		}
		if e.Type == models.DriverTransactionCorporateCreditCompensation {
			compensation++
		}
		if e.Type == "COMMISSION" {
			commission++
		}
	}
	if compensation != 1 || commission != 1 {
		t.Fatal(compensation, commission)
	}
}
func TestCorporateCreditCompletionVersusCancellation(t *testing.T) {
	h, s, c, d, l := creditFixture(t)
	l = approveCreditForTest(t, h, c, d, l)
	before, _ := s.GetDriverWallet(d.User.ID)
	advanceLoadToDelivered(t, h, l.ID, d.AccessToken)
	code, _ := deliveryCodeForTest(t, h, l.ID, c.AccessToken)
	results := make(chan int, 2)
	go func() { results <- requestDeliveryCompletion(t, h, l.ID, d.AccessToken, code, true).Code }()
	go func() {
		results <- requestJSON(t, h, "PATCH", "/api/loads/"+l.ID+"/status", c.AccessToken, map[string]any{"status": "cancelled"}).Code
	}()
	successes := 0
	for range 2 {
		status := <-results
		if status == 200 {
			successes++
		} else if status != 409 {
			t.Fatal(status)
		}
	}
	if successes != 1 {
		t.Fatal(successes)
	}
	stored, _ := s.GetLoad(l.ID)
	if stored.Status == models.LoadStatusCompleted {
		assertDriverBalance(t, h, d, before.BalanceCents-41000+6000, 0)
		if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 134400 {
			t.Fatal(w)
		}
	} else if stored.Status == models.LoadStatusCancelled {
		assertDriverBalance(t, h, d, before.BalanceCents, 0)
		if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 100000 {
			t.Fatal(w)
		}
	} else {
		t.Fatal(stored.Status)
	}
}

func TestCorporateCreditRejectedThenCashSelectionClearsTerms(t *testing.T) {
	h, s, c, d, l := creditFixture(t)
	r := requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": l.PaymentApproval.ID, "accept": false})
	if r.Code != 200 {
		t.Fatal(r.Code)
	}
	r = requestJSON(t, h, "POST", "/api/offers/"+l.PaymentApproval.OfferID+"/accept", c.AccessToken, nil)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	accepted := decodeResponse[models.Load](t, r)
	if accepted.PaymentApproval == nil || accepted.PaymentApproval.Status != "pending" || accepted.PaymentApproval.CreditCents != 0 || accepted.PaymentApproval.ID == l.PaymentApproval.ID {
		t.Fatal("cash assignment retained rejected credit terms", accepted.PaymentApproval)
	}
	stored, _ := s.GetLoad(l.ID)
	if stored.PaymentApproval == nil || stored.PaymentApproval.Status != "pending" {
		t.Fatal(stored.PaymentApproval)
	}
	// A cash-only choice of another driver must also discard old rejected terms.
	l2 := corporateOfferedLoad(t, h, c, d, "Yeni seçim", 4100)
	r = requestJSON(t, h, "POST", "/api/offers/"+pendingOfferID(t, h, c, l2)+"/accept", c.AccessToken, map[string]any{"amountCents": 6000})
	pending := decodeResponse[models.Load](t, r)
	r = requestJSON(t, h, "POST", "/api/loads/"+l2.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": pending.PaymentApproval.ID, "accept": false})
	if r.Code != 200 {
		t.Fatal(r.Code)
	}
	other := registerTestUser(t, h, "cash_other_driver", models.RoleDriver)
	r = requestJSON(t, h, "POST", "/api/loads/"+l2.ID+"/offers", other.AccessToken, map[string]any{"amountTl": 5000})
	if r.Code != 201 {
		t.Fatal(r.Code)
	}
	offer := decodeResponse[models.Offer](t, r)
	r = requestJSON(t, h, "POST", "/api/offers/"+offer.ID+"/accept", c.AccessToken, nil)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	otherCash := decodeResponse[models.Load](t, r)
	if otherCash.PaymentApproval == nil || otherCash.PaymentApproval.Status != "pending" || otherCash.PaymentApproval.DriverID != other.User.ID || otherCash.AssignedDriver != "" || otherCash.AgreedPriceTL != 5000 {
		t.Fatal(otherCash)
	}

}

func TestCorporateCreditConcurrentApproveReject(t *testing.T) {
	h, s, c, d, l := creditFixture(t)
	before, _ := s.GetDriverWallet(d.User.ID)
	statuses := make(chan int, 2)
	for _, accept := range []bool{true, false} {
		go func(decision bool) {
			statuses <- requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": l.PaymentApproval.ID, "accept": decision}).Code
		}(accept)
	}
	successes := 0
	for range 2 {
		status := <-statuses
		if status == 200 {
			successes++
		} else if status != 409 {
			t.Fatal(status)
		}
	}
	if successes != 1 {
		t.Fatal(successes)
	}
	stored, _ := s.GetLoad(l.ID)
	switch stored.Status {
	case models.LoadStatusPublished:
		assertDriverBalance(t, h, d, before.BalanceCents, 0)
		if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 100000 {
			t.Fatal(w)
		}
	case models.LoadStatusDriverSelected:
		assertDriverBalance(t, h, d, before.BalanceCents, 41000)
		if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 94000 {
			t.Fatal(w)
		}
	default:
		t.Fatal(stored.Status)
	}
}

func TestCorporateCreditSettlementIndexFailureIsAtomicAndRetryable(t *testing.T) {
	redisServer := miniredis.RunT(t)
	s, err := store.New("redis://" + redisServer.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	api := NewWithOptions(s, Options{Secret: integrationTestSecret, PricePerKM: 50, MaxUploadMB: 1, AdminEmail: adminTestEmail, AdminPassword: adminTestPassword, AdminSecret: adminTestSecret})
	api.maps = stubMaps{}
	h, _, c, d, l := creditFixtureOn(t, api.Routes(), s)
	l = approveCreditForTest(t, h, c, d, l)
	before, _ := s.GetDriverWallet(d.User.ID)
	advanceLoadToDelivered(t, h, l.ID, d.AccessToken)
	code, _ := deliveryCodeForTest(t, h, l.ID, c.AccessToken)
	index := "driver-wallet-transactions:" + d.User.ID
	members, err := redisServer.ZMembers(index)
	if err != nil {
		t.Fatal(err)
	}
	scores := map[string]float64{}
	for _, id := range members {
		score, _ := redisServer.ZScore(index, id)
		scores[id] = score
	}
	redisServer.Del(index)
	redisServer.Set(index, "broken-index")
	failed := requestDeliveryCompletion(t, h, l.ID, d.AccessToken, code, true)
	if failed.Code < 400 {
		t.Fatal("invalid index accepted")
	}
	stored, _ := s.GetLoad(l.ID)
	if stored.Status != models.LoadStatusDelivered || stored.DeliveryVerified {
		t.Fatal(stored.Status, stored.DeliveryVerified)
	}
	wallet, _ := s.GetDriverWallet(d.User.ID)
	if wallet.BalanceCents != before.BalanceCents || wallet.ReservedCents != 41000 {
		t.Fatal(wallet)
	}
	if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 94000 {
		t.Fatal(w)
	}
	if redisServer.Exists("driver-wallet-transaction:" + l.ID + ":" + models.DriverTransactionCorporateCreditCompensation) {
		t.Fatal("partial compensation")
	}
	redisServer.Del(index)
	for id, score := range scores {
		redisServer.ZAdd(index, score, id)
	}
	done := requestDeliveryCompletion(t, h, l.ID, d.AccessToken, code, true)
	if done.Code != 200 {
		t.Fatal(done.Code, done.Body.String())
	}
	assertDriverBalance(t, h, d, before.BalanceCents-41000+6000, 0)
	if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 134400 {
		t.Fatal(w)
	}
}

// Opt-in against a disposable local Redis. Never point this at beta/production data.
func TestCorporateCreditRealRedis(t *testing.T) {
	url := os.Getenv("NAKLIYE_CREDIT_TEST_REDIS_URL")
	if url == "" {
		t.Skip("disposable Redis URL not configured")
	}
	s, err := store.New(url)
	if err != nil {
		t.Fatal(err)
	}
	api := NewWithOptions(s, Options{Secret: integrationTestSecret, PricePerKM: 50, MaxUploadMB: 1, AdminEmail: adminTestEmail, AdminPassword: adminTestPassword, AdminSecret: adminTestSecret})
	api.maps = stubMaps{}
	h, _, c, d, l := creditFixtureOn(t, api.Routes(), s)
	l = approveCreditForTest(t, h, c, d, l)
	before, _ := s.GetDriverWallet(d.User.ID)
	advanceLoadToDelivered(t, h, l.ID, d.AccessToken)
	code, _ := deliveryCodeForTest(t, h, l.ID, c.AccessToken)
	results := make(chan int, 8)
	for range 8 {
		go func() { results <- requestDeliveryCompletion(t, h, l.ID, d.AccessToken, code, true).Code }()
	}
	successes := 0
	for range 8 {
		status := <-results
		if status == 200 {
			successes++
		} else if status != 409 {
			t.Fatal(status)
		}
	}
	if successes != 1 {
		t.Fatal(successes)
	}
	requestDeliveryCompletion(t, h, l.ID, d.AccessToken, code, true)
	assertDriverBalance(t, h, d, before.BalanceCents-41000+6000, 0)
	if w := getWallet(t, h, c.AccessToken).Wallet.BalanceCents; w != 134400 {
		t.Fatal(w)
	}
	stored, _ := s.GetLoad(l.ID)
	if stored.PaymentApproval.CompensationTransactionID == "" {
		t.Fatal("missing settlement marker")
	}
}

func TestCorporateCreditCannotStartWithStaleStatusOrMissingConsent(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprint(missing), func(t *testing.T) {
			h, s, _, d, l := creditFixture(t)
			l.Status = models.LoadStatusDriverSelected
			l.AssignedDriver = d.User.ID
			if missing {
				l.PaymentApproval = nil
			}
			if err := s.SaveLoad(l); err != nil {
				t.Fatal(err)
			}
			r := requestJSON(t, h, "PATCH", "/api/loads/"+l.ID+"/status", d.AccessToken, map[string]any{"status": models.LoadStatusDriverEnRoute})
			if r.Code != 409 {
				t.Fatalf("unapproved credit started: status=%d body=%s", r.Code, r.Body.String())
			}

			alias := requestJSON(t, h, "PATCH", "/api/listings/"+l.ID+"/status", d.AccessToken, map[string]any{"status": models.LoadStatusDriverEnRoute})
			if alias.Code != 409 {
				t.Fatal("listing alias bypassed consent", alias.Code)
			}
			admin := adminLoginForTest(t, h)
			override := requestJSON(t, h, "PATCH", "/api/admin/loads/"+l.ID+"/status", admin.AccessToken, map[string]any{"status": models.LoadStatusDriverEnRoute, "note": "Approval bypass regression"})
			if override.Code != 409 {
				t.Fatal("admin bypassed consent", override.Code)
			}
			stored, _ := s.GetLoad(l.ID)
			if stored.Status != models.LoadStatusDriverSelected {
				t.Fatal(stored.Status)
			}
		})
	}
}

func TestCorporateZeroCreditRequiresConsent(t *testing.T) {
	h, s := newFlowTestAPI(t)
	policy := models.DefaultWalletPolicy()
	policy.Enabled = false
	if err := s.SaveWalletPolicy(policy); err != nil {
		t.Fatal(err)
	}
	c := registerCorporateTestUser(t, h, "zero_consent_c")
	d := registerTestUser(t, h, "zero_consent_d", models.RoleDriver)
	l := corporateOfferedLoad(t, h, c, d, "Sıfır kredi", 4100)
	r := requestJSON(t, h, "POST", "/api/offers/"+pendingOfferID(t, h, c, l)+"/accept", c.AccessToken, nil)
	selected := decodeResponse[models.Load](t, r)
	if r.Code != 200 || selected.Status != models.LoadStatusPaymentApprovalPending || selected.PaymentApproval == nil {
		t.Fatalf("zero credit bypassed consent: %d %s", r.Code, r.Body.String())
	}
	if r = requestJSON(t, h, "PATCH", "/api/loads/"+l.ID+"/status", d.AccessToken, map[string]any{"status": "driver_en_route"}); r.Code < 400 {
		t.Fatal("started without consent")
	}
	approved := approveCreditForTest(t, h, c, d, l)
	completeCorporateLoad(t, h, c, d, approved)
}

func TestCorporateZeroCreditRejectionAndLegacyBypass(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerCorporateTestUser(t, h, "zero_reject_c")
	d := registerTestUser(t, h, "zero_reject_d", models.RoleDriver)
	l := corporateOfferedLoad(t, h, c, d, "Kredisiz ret", 4100)
	offerID := pendingOfferID(t, h, c, l)
	r := requestJSON(t, h, "POST", "/api/offers/"+offerID+"/accept", c.AccessToken, nil)
	selected := decodeResponse[models.Load](t, r)
	r = requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": selected.PaymentApproval.ID, "accept": false})
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	r = requestJSON(t, h, "POST", "/api/offers/"+offerID+"/accept", c.AccessToken, nil)
	next := decodeResponse[models.Load](t, r)
	if next.PaymentApproval == nil || next.PaymentApproval.ID == selected.PaymentApproval.ID {
		t.Fatal("new consent required")
	}
	legacy, _ := s.GetLoad(l.ID)
	legacy.Status = models.LoadStatusDriverSelected
	legacy.AssignedDriver = d.User.ID
	legacy.PaymentApproval = nil
	if err := s.SaveLoad(legacy); err != nil {
		t.Fatal(err)
	}
	r = requestJSON(t, h, "PATCH", "/api/loads/"+l.ID+"/status", d.AccessToken, map[string]any{"status": "driver_en_route"})
	if r.Code != 409 {
		t.Fatal("legacy cash job bypass", r.Code, r.Body.String())
	}
	if wallet := getWallet(t, h, c.AccessToken); wallet.Wallet.BalanceCents != 0 || len(wallet.Transactions) != 0 {
		t.Fatal("zero credit altered ledger", wallet)
	}
}

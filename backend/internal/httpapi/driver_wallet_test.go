package httpapi

import (
	"bytes"
	"io"
	"mime/multipart"
	"nakliye-api/internal/models"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestDriverCannotOfferWithoutCommissionBalance(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	customer := registerTestUser(t, h, "commission_customer", models.RoleCustomer)
	driver := registerTestUser(t, h, "commission_empty_driver", models.RoleDriver)
	load := createPublishedStatusTestLoad(t, h, customer, "Komisyon")
	response := requestJSON(t, h, http.MethodPost, "/api/loads/"+load.ID+"/offers", driver.AccessToken, map[string]any{"amountTl": 10000})
	if response.Code != http.StatusConflict {
		t.Fatalf("empty wallet must block offer: status=%d body=%s", response.Code, response.Body.String())
	}
}

func fundDriver(t *testing.T, h http.Handler, driver testSession, amount int64, reference string) {
	t.Helper()
	admin := adminLoginForTest(t, h)
	r := requestJSON(t, h, http.MethodPost, "/api/admin/drivers/"+driver.User.ID+"/wallet/topups", admin.AccessToken, map[string]any{"amountCents": amount, "reference": reference})
	if r.Code != 200 {
		t.Fatalf("topup %d: %s", r.Code, r.Body.String())
	}
}
func driverWalletForTest(t *testing.T, h http.Handler, d testSession) map[string]any {
	t.Helper()
	r := requestJSON(t, h, http.MethodGet, "/api/driver/wallet", d.AccessToken, nil)
	if r.Code != 200 {
		t.Fatalf("wallet %d: %s", r.Code, r.Body.String())
	}
	return decodeResponse[map[string]any](t, r)
}
func assertDriverBalance(t *testing.T, h http.Handler, d testSession, balance, reserved int64) {
	t.Helper()
	w := driverWalletForTest(t, h, d)["wallet"].(map[string]any)
	if int64(w["balanceCents"].(float64)) != balance || int64(w["reservedCents"].(float64)) != reserved || int64(w["availableCents"].(float64)) != balance-reserved {
		t.Fatalf("unexpected wallet: %#v", w)
	}
}
func TestDriverCommissionLifecycle(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	c := registerTestUser(t, h, "commission_lifecycle_c", models.RoleCustomer)
	d := registerTestUser(t, h, "commission_empty_lifecycle_d", models.RoleDriver)
	fundDriver(t, h, d, 500000, "payment-1")
	fundDriver(t, h, d, 500000, "payment-1") // retry never credits twice
	assertDriverBalance(t, h, d, 500000, 0)
	load := createPublishedStatusTestLoad(t, h, c, "Kesinti")
	offered := requestJSON(t, h, http.MethodPost, "/api/loads/"+load.ID+"/offers", d.AccessToken, map[string]any{"amountTl": 10000})
	if offered.Code != 201 {
		t.Fatalf("offer: %s", offered.Body.String())
	}
	offer := decodeResponse[models.Offer](t, offered)
	assertDriverBalance(t, h, d, 500000, 0)
	accepted := requestJSON(t, h, http.MethodPost, "/api/offers/"+offer.ID+"/accept", c.AccessToken, nil)
	if accepted.Code != 200 {
		t.Fatalf("accept: %s", accepted.Body.String())
	}
	assertDriverBalance(t, h, d, 500000, 100000)
	advanceLoadToDelivered(t, h, load.ID, d.AccessToken)
	assertDriverBalance(t, h, d, 500000, 100000)
	code, _ := deliveryCodeForTest(t, h, load.ID, c.AccessToken)
	done := requestDeliveryCompletion(t, h, load.ID, d.AccessToken, code, true)
	if done.Code != 200 {
		t.Fatalf("complete: %s", done.Body.String())
	}
	assertDriverBalance(t, h, d, 400000, 0)
	requestDeliveryCompletion(t, h, load.ID, d.AccessToken, code, true)
	assertDriverBalance(t, h, d, 400000, 0)
	entries := driverWalletForTest(t, h, d)["transactions"].([]any)
	if len(entries) != 3 {
		t.Fatalf("expected topup, reserve, commission: %#v", entries)
	}
}
func TestDriverCancellationReleasesCommission(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	c := registerTestUser(t, h, "commission_cancel_c", models.RoleCustomer)
	d := registerTestUser(t, h, "commission_empty_cancel_d", models.RoleDriver)
	fundDriver(t, h, d, 100000, "payment-cancel")
	load := acceptOfferAmount(t, h, c, d, createPublishedStatusTestLoad(t, h, c, "İptal"), 10000)
	assertDriverBalance(t, h, d, 100000, 100000)
	r := requestJSON(t, h, http.MethodPatch, "/api/loads/"+load.ID+"/status", c.AccessToken, map[string]any{"status": "cancelled", "reason": "Vazgeçtim"})
	if r.Code != 200 {
		t.Fatalf("cancel: %d %s", r.Code, r.Body.String())
	}
	assertDriverBalance(t, h, d, 100000, 0)
}

func TestDriverConcurrentAcceptsCannotReuseBalance(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "commission_race_c", models.RoleCustomer)
	d := registerTestUser(t, h, "commission_empty_race_d", models.RoleDriver)
	fundDriver(t, h, d, 100000, "payment-race")
	offerIDs := []string{}
	loadIDs := []string{}
	for _, title := range []string{"Birinci", "İkinci"} {
		load := createPublishedStatusTestLoad(t, h, c, title)
		r := requestJSON(t, h, http.MethodPost, "/api/loads/"+load.ID+"/offers", d.AccessToken, map[string]any{"amountTl": 10000})
		if r.Code != 201 {
			t.Fatalf("offer: %s", r.Body.String())
		}
		offerIDs = append(offerIDs, decodeResponse[models.Offer](t, r).ID)
		loadIDs = append(loadIDs, load.ID)
	}
	assertDriverBalance(t, h, d, 100000, 0) // many pending offers hold nothing
	results := make(chan int, 2)
	for _, id := range offerIDs {
		go func(id string) {
			r := requestJSON(t, h, http.MethodPost, "/api/offers/"+id+"/accept", c.AccessToken, nil)
			results <- r.Code
		}(id)
	}
	successes := 0
	for range offerIDs {
		code := <-results
		if code == 200 {
			successes++
		} else if code != 409 {
			t.Fatalf("unexpected accept status %d", code)
		}
	}
	if successes != 1 {
		t.Fatalf("expected exactly one funded job, got %d", successes)
	}
	assertDriverBalance(t, h, d, 100000, 100000)
	assigned := 0
	for _, id := range loadIDs {
		load, err := s.GetLoad(id)
		if err != nil {
			t.Fatal(err)
		}
		if load.AssignedDriver == d.User.ID {
			assigned++
		}
	}
	if assigned != 1 {
		t.Fatalf("assignment was not atomic: %d", assigned)
	}
	entries := driverWalletForTest(t, h, d)["transactions"].([]any)
	if len(entries) != 2 {
		t.Fatalf("losing accept mutated ledger: %#v", entries)
	}
}
func TestDriverWalletEndpointsRejectUnauthorizedCredits(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	c := registerTestUser(t, h, "commission_auth_c", models.RoleCustomer)
	d := registerTestUser(t, h, "commission_empty_auth_d", models.RoleDriver)
	for _, token := range []string{"", c.AccessToken, d.AccessToken} {
		r := requestJSON(t, h, http.MethodPost, "/api/admin/drivers/"+d.User.ID+"/wallet/topups", token, map[string]any{"amountCents": 100000, "reference": "fake-payment"})
		if r.Code == 200 {
			t.Fatalf("non-admin credited wallet")
		}
	}
	r := requestJSON(t, h, http.MethodGet, "/api/driver/wallet", c.AccessToken, nil)
	if r.Code != 403 {
		t.Fatalf("customer read driver wallet: %d", r.Code)
	}
	assertDriverBalance(t, h, d, 0, 0)
}
func TestDriverTopupReferenceCannotChangeAmount(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	d := registerTestUser(t, h, "commission_empty_ref_d", models.RoleDriver)
	fundDriver(t, h, d, 100000, "bank-ref")
	admin := adminLoginForTest(t, h)
	r := requestJSON(t, h, http.MethodPost, "/api/admin/drivers/"+d.User.ID+"/wallet/topups", admin.AccessToken, map[string]any{"amountCents": 200000, "reference": "bank-ref"})
	if r.Code != 409 {
		t.Fatalf("reference was reused with different amount: %d", r.Code)
	}
	assertDriverBalance(t, h, d, 100000, 0)
}
func TestLegacyAcceptedLoadCompletesWithoutRetroactiveCommission(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "commission_legacy_c", models.RoleCustomer)
	d := registerTestUser(t, h, "commission_empty_legacy_d", models.RoleDriver)
	load := createPublishedStatusTestLoad(t, h, c, "Eski iş")
	load.Status = models.LoadStatusDriverSelected
	load.AssignedDriver = d.User.ID
	load.AgreedPriceTL = 10000
	if err := s.SaveLoad(load); err != nil {
		t.Fatal(err)
	}
	verification, err := New(s, integrationTestSecret).newDeliveryVerification(load)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.EnsureDeliveryVerification(verification); err != nil {
		t.Fatal(err)
	}
	completeCorporateLoad(t, h, c, d, load)
	assertDriverBalance(t, h, d, 0, 0)
}

func TestAcceptedLoadCannotBeDeletedWithCommissionReserved(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "commission_delete_c", models.RoleCustomer)
	d := registerTestUser(t, h, "commission_empty_delete_d", models.RoleDriver)
	fundDriver(t, h, d, 100000, "delete-payment")
	load := acceptOfferAmount(t, h, c, d, createPublishedStatusTestLoad(t, h, c, "Silme"), 10000)
	r := requestJSON(t, h, http.MethodDelete, "/api/loads/"+load.ID, c.AccessToken, nil)
	if r.Code != 409 {
		t.Fatalf("active job deletion must be blocked: %d %s", r.Code, r.Body.String())
	}
	stored, err := s.GetLoad(load.ID)
	if err != nil || stored.DeletedAt != nil {
		t.Fatalf("active job hidden: %#v %v", stored, err)
	}
	assertDriverBalance(t, h, d, 100000, 100000)
}

func TestDeletedLoadCannotAcceptPendingOffer(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	c := registerTestUser(t, h, "commission_deleted_c", models.RoleCustomer)
	d := registerTestUser(t, h, "commission_empty_deleted_d", models.RoleDriver)
	fundDriver(t, h, d, 100000, "deleted-payment")
	load := createPublishedStatusTestLoad(t, h, c, "Silinmiş")
	r := requestJSON(t, h, http.MethodPost, "/api/loads/"+load.ID+"/offers", d.AccessToken, map[string]any{"amountTl": 10000})
	if r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	offer := decodeResponse[models.Offer](t, r)
	deleted := requestJSON(t, h, http.MethodDelete, "/api/loads/"+load.ID, c.AccessToken, nil)
	if deleted.Code != 204 {
		t.Fatal(deleted.Body.String())
	}
	r = requestJSON(t, h, http.MethodPost, "/api/offers/"+offer.ID+"/accept", c.AccessToken, nil)
	if r.Code == 200 {
		t.Fatal("deleted job accepted")
	}
	assertDriverBalance(t, h, d, 100000, 0)
}

type delayedPhotoBody struct {
	reader           io.Reader
	started, proceed chan struct{}
	once             sync.Once
}

func (b *delayedPhotoBody) Read(p []byte) (int, error) {
	b.once.Do(func() { close(b.started); <-b.proceed })
	return b.reader.Read(p)
}
func TestPhotoUploadCannotOverwriteAcceptedCommission(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "commission_photo_c", models.RoleCustomer)
	d := registerTestUser(t, h, "commission_empty_photo_d", models.RoleDriver)
	fundDriver(t, h, d, 100000, "photo-payment")
	load := createPublishedStatusTestLoad(t, h, c, "Fotoğraf")
	offered := requestJSON(t, h, http.MethodPost, "/api/loads/"+load.ID+"/offers", d.AccessToken, map[string]any{"amountTl": 10000})
	if offered.Code != 201 {
		t.Fatal(offered.Body.String())
	}
	offer := decodeResponse[models.Offer](t, offered)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("photos", "photo.jpg")
	if err != nil {
		t.Fatal(err)
	}
	part.Write([]byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01})
	writer.Close()
	delayed := &delayedPhotoBody{reader: &body, started: make(chan struct{}), proceed: make(chan struct{})}
	req := httptest.NewRequest(http.MethodPost, "/api/loads/"+load.ID+"/photos", delayed)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)
	done := make(chan struct{})
	response := httptest.NewRecorder()
	go func() { defer close(done); h.ServeHTTP(response, req) }()
	defer func() {
		select {
		case <-delayed.proceed:
		default:
			close(delayed.proceed)
		}
	}()
	select {
	case <-delayed.started:
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not reach body read")
	}
	accepted := requestJSON(t, h, http.MethodPost, "/api/offers/"+offer.ID+"/accept", c.AccessToken, nil)
	if accepted.Code != 200 {
		t.Fatal(accepted.Body.String())
	}
	close(delayed.proceed)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not finish")
	}
	if response.Code != 201 && response.Code != 409 {
		t.Fatalf("upload failed unexpectedly %d %s", response.Code, response.Body.String())
	}
	stored, err := s.GetLoad(load.ID)
	if err != nil || stored.Status != models.LoadStatusDriverSelected || stored.AssignedDriver != d.User.ID || stored.DriverCommissionCents != 100000 {
		t.Fatalf("photo upload overwrote accepted job: %#v %v", stored, err)
	}
	assertDriverBalance(t, h, d, 100000, 100000)
}

func TestAdminDriverWalletAccountsList(t *testing.T) {
	h, _ := newFlowTestAPI(t)
	c := registerTestUser(t, h, "accounts_customer", models.RoleCustomer)
	funded := registerTestUser(t, h, "commission_empty_accounts_funded", models.RoleDriver)
	empty := registerTestUser(t, h, "commission_empty_accounts_zero", models.RoleDriver)
	fundDriver(t, h, funded, 200000, "accounts-payment")
	acceptOfferAmount(t, h, c, funded, createPublishedStatusTestLoad(t, h, c, "Hesap kontrolü"), 10000)
	admin := adminLoginForTest(t, h)
	for _, token := range []string{"", c.AccessToken, funded.AccessToken} {
		r := requestJSON(t, h, http.MethodGet, "/api/admin/driver-wallets", token, nil)
		if r.Code == 200 {
			t.Fatal("non-admin read wallet accounts")
		}
	}
	r := requestJSON(t, h, http.MethodGet, "/api/admin/driver-wallets?limit=1", admin.AccessToken, nil)
	if r.Code != 200 {
		t.Fatalf("wallet list %d: %s", r.Code, r.Body.String())
	}
	var result struct {
		Items []struct {
			Driver map[string]any      `json:"driver"`
			Wallet models.DriverWallet `json:"wallet"`
		} `json:"items"`
		Total int `json:"total"`
	}
	result = decodeResponse[struct {
		Items []struct {
			Driver map[string]any      `json:"driver"`
			Wallet models.DriverWallet `json:"wallet"`
		} `json:"items"`
		Total int `json:"total"`
	}](t, r)
	if result.Total != 2 || len(result.Items) != 1 {
		t.Fatalf("pagination failed: %#v", result)
	}
	r = requestJSON(t, h, http.MethodGet, "/api/admin/driver-wallets?walletStatus=reserved", admin.AccessToken, nil)
	filtered := decodeResponse[map[string]any](t, r)
	items := filtered["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("reserved filter: %#v", filtered)
	}
	item := items[0].(map[string]any)
	wallet := item["wallet"].(map[string]any)
	if wallet["driverId"] != funded.User.ID || wallet["balanceCents"] != float64(200000) || wallet["reservedCents"] != float64(100000) || wallet["availableCents"] != float64(100000) {
		t.Fatalf("incorrect account: %#v", wallet)
	}
	r = requestJSON(t, h, http.MethodGet, "/api/admin/driver-wallets?q="+empty.User.ID, admin.AccessToken, nil)
	searched := decodeResponse[map[string]any](t, r)
	if searched["total"] != float64(1) {
		t.Fatalf("search: %#v", searched)
	}
	r = requestJSON(t, h, http.MethodGet, "/api/admin/driver-wallets?walletStatus=empty", admin.AccessToken, nil)
	if decodeResponse[map[string]any](t, r)["total"] != float64(1) {
		t.Fatal("empty accounts omitted")
	}
}

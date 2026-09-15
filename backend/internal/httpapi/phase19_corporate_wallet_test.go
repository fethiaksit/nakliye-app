package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
)

type walletResponse struct {
	Wallet       models.CorporateWallet     `json:"wallet"`
	Transactions []models.WalletTransaction `json:"transactions"`
}

func registerCorporateTestUser(t *testing.T, handler http.Handler, suffix string) testSession {
	t.Helper()
	response := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]any{
		"name": "Yetkili " + suffix, "email": suffix + "@example.com", "phone": testPhone(suffix),
		"password": "GucluSifre123", "role": models.RoleCustomer,
		"accountType": models.AccountTypeCorporate, "companyName": "Firma " + suffix,
	})
	if response.Code != http.StatusOK {
		t.Fatalf("corporate register status=%d body=%s", response.Code, response.Body.String())
	}
	return decodeResponse[testSession](t, response)
}

func acceptOfferAmount(t *testing.T, handler http.Handler, customer, driver testSession, load models.Load, amountTL float64) models.Load {
	t.Helper()
	offerResponse := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/offers", driver.AccessToken, map[string]any{
		"amountTl": amountTL, "note": "Kurumsal taşıma", "estimatedArrivalMinutes": 30,
	})
	if offerResponse.Code != http.StatusCreated {
		t.Fatalf("offer status=%d body=%s", offerResponse.Code, offerResponse.Body.String())
	}
	offer := decodeResponse[models.Offer](t, offerResponse)
	accepted := requestJSON(t, handler, http.MethodPost, "/api/offers/"+offer.ID+"/accept", customer.AccessToken, nil)
	if accepted.Code != http.StatusOK {
		t.Fatalf("accept status=%d body=%s", accepted.Code, accepted.Body.String())
	}
	return decodeResponse[models.Load](t, accepted)
}

func corporateAcceptedLoad(t *testing.T, handler http.Handler, customer, driver testSession, title string, amountTL float64) models.Load {
	t.Helper()
	return acceptOfferAmount(t, handler, customer, driver, createPublishedStatusTestLoad(t, handler, customer, title), amountTL)
}

func completeCorporateLoad(t *testing.T, handler http.Handler, customer, driver testSession, load models.Load) models.Load {
	t.Helper()
	advanceLoadToDelivered(t, handler, load.ID, driver.AccessToken)
	code, codeResponse := deliveryCodeForTest(t, handler, load.ID, customer.AccessToken)
	if codeResponse.Code != http.StatusOK {
		t.Fatalf("delivery code status=%d body=%s", codeResponse.Code, codeResponse.Body.String())
	}
	completed := requestDeliveryCompletion(t, handler, load.ID, driver.AccessToken, code, true)
	if completed.Code != http.StatusOK {
		t.Fatalf("complete status=%d body=%s", completed.Code, completed.Body.String())
	}
	return decodeResponse[models.Load](t, completed)
}

func getWallet(t *testing.T, handler http.Handler, token string) walletResponse {
	t.Helper()
	response := requestJSON(t, handler, http.MethodGet, "/api/corporate/wallet", token, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("wallet status=%d body=%s", response.Code, response.Body.String())
	}
	return decodeResponse[walletResponse](t, response)
}

func findWalletTransaction(transactions []models.WalletTransaction, loadID, transactionType string) (models.WalletTransaction, bool) {
	for _, transaction := range transactions {
		if transaction.LoadID == loadID && transaction.Type == transactionType {
			return transaction, true
		}
	}
	return models.WalletTransaction{}, false
}

func TestPhaseNineteenCorporateAccountRewardAndFavorites(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	configureTenPercentWallet(t, redisStore)
	corporate := registerCorporateTestUser(t, handler, "corporate_reward")
	otherCorporate := registerCorporateTestUser(t, handler, "corporate_other")
	individual := registerTestUser(t, handler, "corporate_individual", models.RoleCustomer)
	driver := registerTestUser(t, handler, "corporate_driver", models.RoleDriver)

	me := requestJSON(t, handler, http.MethodGet, "/api/me", corporate.AccessToken, nil)
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"accountType":"corporate"`) {
		t.Fatalf("corporate me status=%d body=%s", me.Code, me.Body.String())
	}
	individualMe := requestJSON(t, handler, http.MethodGet, "/api/me", individual.AccessToken, nil)
	if individualMe.Code != http.StatusOK || !strings.Contains(individualMe.Body.String(), `"accountType":"individual"`) {
		t.Fatalf("individual me status=%d body=%s", individualMe.Code, individualMe.Body.String())
	}
	if response := requestJSON(t, handler, http.MethodGet, "/api/corporate/wallet", individual.AccessToken, nil); response.Code != http.StatusForbidden {
		t.Fatalf("individual wallet status=%d body=%s", response.Code, response.Body.String())
	}
	if response := requestJSON(t, handler, http.MethodGet, "/api/corporate/wallet", driver.AccessToken, nil); response.Code != http.StatusForbidden {
		t.Fatalf("driver wallet status=%d body=%s", response.Code, response.Body.String())
	}

	companyUpdate := requestJSON(t, handler, http.MethodPatch, "/api/corporate/company", corporate.AccessToken, map[string]any{
		"name": "Kurumsal Lojistik AŞ", "authorizedPerson": "Ayşe Yetkili", "taxNumber": "1234567890",
		"taxOffice": "Konak", "address": "Konak, İzmir", "phone": "+905551112233", "email": "muhasebe@kurumsal.test",
	})
	if companyUpdate.Code != http.StatusOK || !strings.Contains(companyUpdate.Body.String(), "Kurumsal Lojistik") {
		t.Fatalf("company update status=%d body=%s", companyUpdate.Code, companyUpdate.Body.String())
	}

	load := corporateAcceptedLoad(t, handler, corporate, driver, "On bin liralık taşıma", 10_000)
	if before := getWallet(t, handler, corporate.AccessToken); before.Wallet.BalanceCents != 0 || len(before.Transactions) != 0 {
		t.Fatalf("reward created before completion: %#v", before)
	}
	otherCompanyLoad := requestJSON(t, handler, http.MethodGet, "/api/corporate/loads/"+load.ID+"/wallet", otherCorporate.AccessToken, nil)
	if otherCompanyLoad.Code != http.StatusForbidden {
		t.Fatalf("other company load wallet status=%d body=%s", otherCompanyLoad.Code, otherCompanyLoad.Body.String())
	}
	completed := completeCorporateLoad(t, handler, corporate, driver, load)
	wallet := getWallet(t, handler, corporate.AccessToken)
	if wallet.Wallet.BalanceCents != 100_000 || len(wallet.Transactions) != 1 {
		t.Fatalf("10000 reward wallet=%#v", wallet)
	}
	reward, found := findWalletTransaction(wallet.Transactions, load.ID, models.WalletTransactionShipmentReward)
	if !found || reward.AmountCents != 100_000 || reward.BalanceAfterCents != 100_000 {
		t.Fatalf("reward transaction=%#v found=%v", reward, found)
	}
	repeated := requestDeliveryCompletion(t, handler, load.ID, driver.AccessToken, "000000", true)
	if repeated.Code != http.StatusConflict || len(getWallet(t, handler, corporate.AccessToken).Transactions) != 1 {
		t.Fatalf("repeated completion status=%d body=%s", repeated.Code, repeated.Body.String())
	}
	driverDetail := requestJSON(t, handler, http.MethodGet, "/api/loads/"+completed.ID, driver.AccessToken, nil)
	if driverDetail.Code != http.StatusOK || strings.Contains(driverDetail.Body.String(), "wallet") || strings.Contains(driverDetail.Body.String(), "usedCents") {
		t.Fatalf("driver response leaked wallet status=%d body=%s", driverDetail.Code, driverDetail.Body.String())
	}

	favorite := requestJSON(t, handler, http.MethodPost, "/api/corporate/favorite-drivers", corporate.AccessToken, map[string]string{"driverId": driver.User.ID})
	if favorite.Code != http.StatusCreated {
		t.Fatalf("favorite status=%d body=%s", favorite.Code, favorite.Body.String())
	}
	duplicate := requestJSON(t, handler, http.MethodPost, "/api/corporate/favorite-drivers", corporate.AccessToken, map[string]string{"driverId": driver.User.ID})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate favorite status=%d body=%s", duplicate.Code, duplicate.Body.String())
	}
	otherFavorites := requestJSON(t, handler, http.MethodGet, "/api/corporate/favorite-drivers", otherCorporate.AccessToken, nil)
	if otherFavorites.Code != http.StatusOK || strings.Contains(otherFavorites.Body.String(), driver.User.ID) {
		t.Fatalf("favorite leaked to other company status=%d body=%s", otherFavorites.Code, otherFavorites.Body.String())
	}
	storedCompany, err := redisStore.GetCompanyByUser(corporate.User.ID)
	if err != nil || storedCompany.Name != "Kurumsal Lojistik AŞ" {
		t.Fatalf("stored company=%#v err=%v", storedCompany, err)
	}
	dashboard := requestJSON(t, handler, http.MethodGet, "/api/corporate/dashboard", corporate.AccessToken, nil)
	if dashboard.Code != http.StatusOK || !strings.Contains(dashboard.Body.String(), `"completedThisMonth":1`) || !strings.Contains(dashboard.Body.String(), `"balanceCents":100000`) {
		t.Fatalf("dashboard status=%d body=%s", dashboard.Code, dashboard.Body.String())
	}
}

func TestPhaseNineteenWalletUsageAndCancellationReversal(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	configureTenPercentWallet(t, redisStore)
	corporate := registerCorporateTestUser(t, handler, "corporate_reversal")
	driver := registerTestUser(t, handler, "corporate_reversal_driver", models.RoleDriver)

	completeCorporateLoad(t, handler, corporate, driver, corporateAcceptedLoad(t, handler, corporate, driver, "Kredi kazandıran taşıma", 15_000))
	if balance := getWallet(t, handler, corporate.AccessToken).Wallet.BalanceCents; balance != 150_000 {
		t.Fatalf("seed reward balance=%d", balance)
	}
	load := corporateAcceptedLoad(t, handler, corporate, driver, "Sekiz bin liralık taşıma", 8_000)
	negative := requestJSON(t, handler, http.MethodPost, "/api/corporate/loads/"+load.ID+"/wallet", corporate.AccessToken, map[string]int64{"amountCents": -1})
	if negative.Code != http.StatusBadRequest {
		t.Fatalf("negative usage status=%d body=%s", negative.Code, negative.Body.String())
	}
	overBalance := requestJSON(t, handler, http.MethodPost, "/api/corporate/loads/"+load.ID+"/wallet", corporate.AccessToken, map[string]int64{"amountCents": 150_001})
	if overBalance.Code != http.StatusBadRequest {
		t.Fatalf("over-balance usage status=%d body=%s", overBalance.Code, overBalance.Body.String())
	}
	usage := requestJSON(t, handler, http.MethodPost, "/api/corporate/loads/"+load.ID+"/wallet", corporate.AccessToken, map[string]int64{"amountCents": 150_000})
	if usage.Code != http.StatusCreated || !strings.Contains(usage.Body.String(), `"customerPayableCents":650000`) {
		t.Fatalf("usage status=%d body=%s", usage.Code, usage.Body.String())
	}
	duplicate := requestJSON(t, handler, http.MethodPost, "/api/corporate/loads/"+load.ID+"/wallet", corporate.AccessToken, map[string]int64{"amountCents": 1})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate usage status=%d body=%s", duplicate.Code, duplicate.Body.String())
	}
	if balance := getWallet(t, handler, corporate.AccessToken).Wallet.BalanceCents; balance != 0 {
		t.Fatalf("balance after usage=%d", balance)
	}
	cancelled := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", corporate.AccessToken, map[string]string{"status": models.LoadStatusCancelled})
	if cancelled.Code != http.StatusOK {
		t.Fatalf("cancel status=%d body=%s", cancelled.Code, cancelled.Body.String())
	}
	wallet := getWallet(t, handler, corporate.AccessToken)
	if wallet.Wallet.BalanceCents != 150_000 || len(wallet.Transactions) != 3 {
		t.Fatalf("reversal wallet=%#v", wallet)
	}
	reversal, found := findWalletTransaction(wallet.Transactions, load.ID, models.WalletTransactionReversal)
	if !found || reversal.AmountCents != 150_000 {
		t.Fatalf("reversal=%#v found=%v", reversal, found)
	}
	repeatedCancel := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", corporate.AccessToken, map[string]string{"status": models.LoadStatusCancelled})
	if repeatedCancel.Code != http.StatusConflict || len(getWallet(t, handler, corporate.AccessToken).Transactions) != 3 {
		t.Fatalf("repeated cancel status=%d body=%s", repeatedCancel.Code, repeatedCancel.Body.String())
	}
}

func TestPhaseNineteenRewardUsesNetAmount(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	configureTenPercentWallet(t, redisStore)
	corporate := registerCorporateTestUser(t, handler, "corporate_net")
	driver := registerTestUser(t, handler, "corporate_net_driver", models.RoleDriver)

	completeCorporateLoad(t, handler, corporate, driver, corporateAcceptedLoad(t, handler, corporate, driver, "Yirmi bin liralık taşıma", 20_000))
	load := corporateAcceptedLoad(t, handler, corporate, driver, "Net ödül taşıması", 10_000)
	usage := requestJSON(t, handler, http.MethodPost, "/api/corporate/loads/"+load.ID+"/wallet", corporate.AccessToken, map[string]int64{"amountCents": 200_000})
	if usage.Code != http.StatusCreated {
		t.Fatalf("net usage status=%d body=%s", usage.Code, usage.Body.String())
	}
	completeCorporateLoad(t, handler, corporate, driver, load)
	wallet := getWallet(t, handler, corporate.AccessToken)
	if wallet.Wallet.BalanceCents != 80_000 {
		t.Fatalf("net reward balance=%d transactions=%#v", wallet.Wallet.BalanceCents, wallet.Transactions)
	}
	reward, found := findWalletTransaction(wallet.Transactions, load.ID, models.WalletTransactionShipmentReward)
	if !found || reward.AmountCents != 80_000 {
		t.Fatalf("net reward=%#v found=%v", reward, found)
	}
}

func TestPhaseNineteenConcurrentWalletSpendCannotGoNegative(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	configureTenPercentWallet(t, redisStore)
	corporate := registerCorporateTestUser(t, handler, "corporate_race")
	driver := registerTestUser(t, handler, "corporate_race_driver", models.RoleDriver)
	completeCorporateLoad(t, handler, corporate, driver, corporateAcceptedLoad(t, handler, corporate, driver, "Bakiye oluşturan taşıma", 10_000))
	first := corporateAcceptedLoad(t, handler, corporate, driver, "Eşzamanlı taşıma 1", 5_000)
	second := corporateAcceptedLoad(t, handler, corporate, driver, "Eşzamanlı taşıma 2", 5_000)

	statuses := make(chan int, 2)
	for _, loadID := range []string{first.ID, second.ID} {
		go func(id string) {
			request := httptest.NewRequest(http.MethodPost, "/api/corporate/loads/"+id+"/wallet", strings.NewReader(`{"amountCents":100000}`))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Authorization", "Bearer "+corporate.AccessToken)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			statuses <- response.Code
		}(loadID)
	}
	counts := map[int]int{}
	for range 2 {
		counts[<-statuses]++
	}
	if counts[http.StatusCreated] != 1 || counts[http.StatusBadRequest]+counts[http.StatusConflict] != 1 {
		t.Fatalf("concurrent wallet statuses=%#v", counts)
	}
	wallet := getWallet(t, handler, corporate.AccessToken)
	if wallet.Wallet.BalanceCents != 0 {
		t.Fatalf("concurrent final balance=%d", wallet.Wallet.BalanceCents)
	}
	usageCount := 0
	for _, transaction := range wallet.Transactions {
		if transaction.Type == models.WalletTransactionShipmentUsage {
			usageCount++
		}
	}
	if usageCount != 1 {
		t.Fatalf("concurrent usage count=%d transactions=%#v", usageCount, wallet.Transactions)
	}
	company, err := redisStore.GetCompanyByUser(corporate.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedWallet, err := redisStore.GetCorporateWallet(company.ID)
	if err != nil || storedWallet.BalanceCents < 0 {
		t.Fatalf("stored wallet=%#v err=%v", storedWallet, err)
	}
}

func TestPhaseNineteenAdminCanReadCorporateProfileAndLedger(t *testing.T) {
	redisServer := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + redisServer.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	api := NewWithOptions(redisStore, Options{
		Secret: integrationTestSecret, PricePerKM: 50, MaxUploadMB: 1,
		AdminEmail: "admin@nakliyego.test", AdminPassword: "GucluAdminSifresi123",
		AdminSecret: "phase-19-admin-secret-at-least-32-characters",
	})
	api.maps = stubMaps{}
	handler := api.Routes()
	corporate := registerCorporateTestUser(t, handler, "corporate_admin")
	login := requestJSON(t, handler, http.MethodPost, "/api/admin/auth/login", "", map[string]string{
		"email": "admin@nakliyego.test", "password": "GucluAdminSifresi123",
	})
	if login.Code != http.StatusOK {
		t.Fatalf("admin login status=%d body=%s", login.Code, login.Body.String())
	}
	var adminSession struct {
		AccessToken string `json:"accessToken"`
	}
	adminSession = decodeResponse[struct {
		AccessToken string `json:"accessToken"`
	}](t, login)
	detail := requestJSON(t, handler, http.MethodGet, "/api/admin/users/"+corporate.User.ID, adminSession.AccessToken, nil)
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), `"accountType":"corporate"`) ||
		!strings.Contains(detail.Body.String(), `"company"`) || !strings.Contains(detail.Body.String(), `"wallet"`) || !strings.Contains(detail.Body.String(), `"walletTransactions"`) {
		t.Fatalf("admin corporate detail status=%d body=%s", detail.Code, detail.Body.String())
	}
}

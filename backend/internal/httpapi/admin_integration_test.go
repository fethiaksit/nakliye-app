package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
)

const (
	adminTestEmail    = "operations@example.com"
	adminTestPassword = "AdminTestPassword123!"
	adminTestSecret   = "admin-integration-secret-separate-and-long"
)

type adminTestSession struct {
	AccessToken string `json:"accessToken"`
}

func newAdminTestAPI(t *testing.T) http.Handler {
	handler, _ := newAdminTestAPIWithStore(t)
	return handler
}

func newAdminTestAPIWithStore(t *testing.T) (http.Handler, *store.RedisStore) {
	t.Helper()
	redisServer := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + redisServer.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	api := NewWithOptions(redisStore, Options{
		Secret: integrationTestSecret, PricePerKM: 50, MaxUploadMB: 1,
		AdminEmail: adminTestEmail, AdminPassword: adminTestPassword, AdminSecret: adminTestSecret,
	})
	api.maps = stubMaps{}
	return api.Routes(), redisStore
}

func adminLoginForTest(t *testing.T, handler http.Handler) adminTestSession {
	t.Helper()
	response := requestJSON(t, handler, http.MethodPost, "/api/admin/auth/login", "", map[string]string{
		"email": adminTestEmail, "password": adminTestPassword,
	})
	if response.Code != http.StatusOK {
		t.Fatalf("admin login status=%d body=%s", response.Code, response.Body.String())
	}
	return decodeResponse[adminTestSession](t, response)
}

func TestAdminPanelManagementFlow(t *testing.T) {
	handler := newAdminTestAPI(t)
	customer := registerTestUser(t, handler, "admincustomer", models.RoleCustomer)
	driver := registerTestUser(t, handler, "admindriver", models.RoleDriver)

	wrongLogin := requestJSON(t, handler, http.MethodPost, "/api/admin/auth/login", "", map[string]string{
		"email": adminTestEmail, "password": "wrong-password",
	})
	if wrongLogin.Code != http.StatusUnauthorized {
		t.Fatalf("wrong admin login status=%d", wrongLogin.Code)
	}
	admin := adminLoginForTest(t, handler)

	if response := requestJSON(t, handler, http.MethodGet, "/api/admin/dashboard", customer.AccessToken, nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("mobile token reached admin API status=%d", response.Code)
	}
	if response := requestJSON(t, handler, http.MethodGet, "/api/me", admin.AccessToken, nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("admin token reached mobile API status=%d", response.Code)
	}

	vehicleResponse := requestJSON(t, handler, http.MethodPost, "/api/driver/vehicles", driver.AccessToken, map[string]any{
		"vehicleType": "kamyonet", "brand": "Ford", "model": "Transit", "licensePlate": "35 ADM 01", "capacityKg": 1500,
	})
	if vehicleResponse.Code != http.StatusCreated {
		t.Fatalf("vehicle status=%d body=%s", vehicleResponse.Code, vehicleResponse.Body.String())
	}
	vehicle := decodeResponse[models.Vehicle](t, vehicleResponse)
	if vehicle.VerificationStatus != models.VerificationPending {
		t.Fatalf("new vehicle verification=%q", vehicle.VerificationStatus)
	}

	documentResponse := requestJSON(t, handler, http.MethodPost, "/api/admin/drivers/"+driver.User.ID+"/documents", admin.AccessToken, map[string]string{
		"kind": "driver_license", "title": "Sürücü belgesi", "fileURL": "https://files.example.com/license.jpg",
	})
	if documentResponse.Code != http.StatusCreated {
		t.Fatalf("document status=%d body=%s", documentResponse.Code, documentResponse.Body.String())
	}
	document := decodeResponse[models.DriverDocument](t, documentResponse)

	for name, response := range map[string]*responseRecorderAlias{
		"document": requestJSON(t, handler, http.MethodPatch, "/api/admin/driver-documents/"+document.ID, admin.AccessToken, map[string]string{"status": models.VerificationVerified}),
		"vehicle":  requestJSON(t, handler, http.MethodPatch, "/api/admin/vehicles/"+vehicle.ID+"/verification", admin.AccessToken, map[string]string{"status": models.VerificationVerified}),
		"driver":   requestJSON(t, handler, http.MethodPatch, "/api/admin/drivers/"+driver.User.ID+"/verification", admin.AccessToken, map[string]string{"status": models.VerificationVerified}),
	} {
		if response.Code != http.StatusOK {
			t.Fatalf("verify %s status=%d body=%s", name, response.Code, response.Body.String())
		}
	}

	createdResponse := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, map[string]any{
		"title": "Admin test yükü", "description": "Kontrollü gönderi",
		"pickup":      map[string]any{"address": "Bornova, İzmir", "latitude": 38.46, "longitude": 27.21},
		"delivery":    map[string]any{"address": "Konak, İzmir", "latitude": 38.42, "longitude": 27.13},
		"dimensions":  map[string]any{"lengthCm": 80, "widthCm": 70, "heightCm": 60, "weightKg": 50},
		"urgencyType": "immediate", "cargoType": "ev_esyasi", "vehicleType": "kamyonet",
		"pickupFloor": 0, "deliveryFloor": 1,
	})
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create load status=%d body=%s", createdResponse.Code, createdResponse.Body.String())
	}
	load := decodeResponse[models.Load](t, createdResponse)
	if response := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/publish", customer.AccessToken, nil); response.Code != http.StatusOK {
		t.Fatalf("publish status=%d body=%s", response.Code, response.Body.String())
	}
	offerResponse := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/offers", driver.AccessToken, map[string]any{"amountTl": 2500, "note": "Uygun", "estimatedArrivalMinutes": 30})
	offer := decodeResponse[models.Offer](t, offerResponse)
	if response := requestJSON(t, handler, http.MethodPost, "/api/offers/"+offer.ID+"/accept", customer.AccessToken, nil); response.Code != http.StatusOK {
		t.Fatalf("accept offer status=%d body=%s", response.Code, response.Body.String())
	}
	messageResponse := requestJSON(t, handler, http.MethodPost, "/api/conversations/"+load.ID+"/messages", driver.AccessToken, map[string]string{
		"type": "text", "body": "Şikâyete konu mesaj", "clientMessageId": "admin-complaint-message",
	})
	message := decodeResponse[models.Message](t, messageResponse)
	if invalid := requestJSON(t, handler, http.MethodPost, "/api/messages/"+message.ID+"/complaints", customer.AccessToken, map[string]string{
		"reason": "spam", "description": "Geçersiz neden",
	}); invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid complaint reason status=%d body=%s", invalid.Code, invalid.Body.String())
	}
	complaintResponse := requestJSON(t, handler, http.MethodPost, "/api/messages/"+message.ID+"/complaints", customer.AccessToken, map[string]string{
		"reason": "behavior", "description": "Uygunsuz davranış",
	})
	if complaintResponse.Code != http.StatusCreated {
		t.Fatalf("complaint status=%d body=%s", complaintResponse.Code, complaintResponse.Body.String())
	}
	complaint := decodeResponse[models.MessageComplaint](t, complaintResponse)
	if complaint.Reason != "behavior" || complaint.ReporterID != customer.User.ID || complaint.ReportedUserID != driver.User.ID || complaint.LoadID != load.ID || complaint.ConversationID != load.ID || complaint.MessageID != message.ID {
		t.Fatalf("complaint relations incorrect: %#v", complaint)
	}

	complaints := requestJSON(t, handler, http.MethodGet, "/api/admin/complaints?status=open", admin.AccessToken, nil)
	var complaintsPage struct {
		Items []struct {
			Complaint models.MessageComplaint `json:"complaint"`
		} `json:"items"`
		Total int `json:"total"`
	}
	complaintsPage = decodeResponse[struct {
		Items []struct {
			Complaint models.MessageComplaint `json:"complaint"`
		} `json:"items"`
		Total int `json:"total"`
	}](t, complaints)
	if complaints.Code != http.StatusOK || complaintsPage.Total != 1 || complaintsPage.Items[0].Complaint.ID != complaint.ID {
		t.Fatalf("admin complaints status=%d total=%d body=%s", complaints.Code, complaintsPage.Total, complaints.Body.String())
	}
	if invalid := requestJSON(t, handler, http.MethodPatch, "/api/admin/complaints/"+complaint.ID, admin.AccessToken, map[string]string{"status": "dismissed", "adminNote": "Geçersiz"}); invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid complaint status=%d body=%s", invalid.Code, invalid.Body.String())
	}
	reviewing := requestJSON(t, handler, http.MethodPatch, "/api/admin/complaints/"+complaint.ID, admin.AccessToken, map[string]string{
		"status": models.ComplaintStatusReviewing, "adminNote": "İnceleme başladı",
	})
	if reviewing.Code != http.StatusOK || decodeResponse[struct {
		Complaint models.MessageComplaint `json:"complaint"`
	}](t, reviewing).Complaint.Status != models.ComplaintStatusReviewing {
		t.Fatalf("review complaint status=%d body=%s", reviewing.Code, reviewing.Body.String())
	}
	resolved := requestJSON(t, handler, http.MethodPatch, "/api/admin/complaints/"+complaint.ID, admin.AccessToken, map[string]any{
		"status": models.ComplaintStatusResolved, "adminNote": "İçerik kaldırıldı", "removeMessage": true,
	})
	if resolved.Code != http.StatusOK {
		t.Fatalf("resolve complaint status=%d body=%s", resolved.Code, resolved.Body.String())
	}
	persisted := requestJSON(t, handler, http.MethodGet, "/api/admin/complaints/"+complaint.ID, admin.AccessToken, nil)
	persistedComplaint := decodeResponse[struct {
		Complaint models.MessageComplaint `json:"complaint"`
	}](t, persisted).Complaint
	if persistedComplaint.Status != models.ComplaintStatusResolved || persistedComplaint.ResolutionNote != "İçerik kaldırıldı" {
		t.Fatalf("complaint resolution not persisted: %#v", persistedComplaint)
	}
	rejectedResponse := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/complaints", driver.AccessToken, map[string]string{
		"reason": "safety", "description": "Güvenlik riski",
	})
	rejectedComplaint := decodeResponse[models.MessageComplaint](t, rejectedResponse)
	if rejectedResponse.Code != http.StatusCreated || rejectedComplaint.MessageID != "" || rejectedComplaint.ReportedUserID != customer.User.ID {
		t.Fatalf("load complaint status=%d body=%s", rejectedResponse.Code, rejectedResponse.Body.String())
	}
	rejected := requestJSON(t, handler, http.MethodPatch, "/api/admin/complaints/"+rejectedComplaint.ID, admin.AccessToken, map[string]string{
		"status": models.ComplaintStatusRejected, "adminNote": "Kanıt bulunamadı",
	})
	if rejected.Code != http.StatusOK || decodeResponse[struct {
		Complaint models.MessageComplaint `json:"complaint"`
	}](t, rejected).Complaint.Status != models.ComplaintStatusRejected {
		t.Fatalf("reject complaint status=%d body=%s", rejected.Code, rejected.Body.String())
	}

	loadDetail := requestJSON(t, handler, http.MethodGet, "/api/admin/loads/"+load.ID, admin.AccessToken, nil)
	var detail struct {
		StatusHistory []models.LoadStatusEvent `json:"statusHistory"`
	}
	detail = decodeResponse[struct {
		StatusHistory []models.LoadStatusEvent `json:"statusHistory"`
	}](t, loadDetail)
	if loadDetail.Code != http.StatusOK || len(detail.StatusHistory) < 3 {
		t.Fatalf("load history status=%d events=%d body=%s", loadDetail.Code, len(detail.StatusHistory), loadDetail.Body.String())
	}

	blocked := requestJSON(t, handler, http.MethodPatch, "/api/admin/users/"+customer.User.ID+"/status", admin.AccessToken, map[string]string{
		"status": models.AccountStatusBlocked, "reason": "Güvenlik incelemesi",
	})
	if blocked.Code != http.StatusOK {
		t.Fatalf("block user status=%d body=%s", blocked.Code, blocked.Body.String())
	}
	if response := requestJSON(t, handler, http.MethodGet, "/api/me", customer.AccessToken, nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("blocked token status=%d", response.Code)
	}
	if response := requestJSON(t, handler, http.MethodPatch, "/api/admin/users/"+customer.User.ID+"/status", admin.AccessToken, map[string]string{"status": models.AccountStatusActive}); response.Code != http.StatusOK {
		t.Fatalf("reactivate status=%d body=%s", response.Code, response.Body.String())
	}

	dashboard := requestJSON(t, handler, http.MethodGet, "/api/admin/dashboard", admin.AccessToken, nil)
	var dashboardBody struct {
		Counts map[string]int `json:"counts"`
	}
	dashboardBody = decodeResponse[struct {
		Counts map[string]int `json:"counts"`
	}](t, dashboard)
	if dashboard.Code != http.StatusOK || dashboardBody.Counts["customers"] != 1 || dashboardBody.Counts["verifiedDrivers"] != 1 || dashboardBody.Counts["openComplaints"] != 0 {
		t.Fatalf("dashboard status=%d counts=%#v body=%s", dashboard.Code, dashboardBody.Counts, dashboard.Body.String())
	}
	for _, path := range []string{"/api/admin/users?q=admincustomer", "/api/admin/drivers?verificationStatus=verified", "/api/admin/activity", "/api/admin/stats?days=7"} {
		if response := requestJSON(t, handler, http.MethodGet, path, admin.AccessToken, nil); response.Code != http.StatusOK {
			t.Fatalf("admin path %s status=%d body=%s", path, response.Code, response.Body.String())
		}
	}
}

func TestAdminCorporateAccountManagementFlow(t *testing.T) {
	handler, redisStore := newAdminTestAPIWithStore(t)
	admin := adminLoginForTest(t, handler)

	// Register individual customer, driver, and two corporate customers
	indivCustomer := registerTestUser(t, handler, "indivcust", models.RoleCustomer)
	_ = registerTestUser(t, handler, "testdriver", models.RoleDriver)

	corp1Res := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]string{
		"name": "Ahmet Yılmaz", "email": "ahmet@megalojistik.com", "phone": "05551112233",
		"password": "Password123!", "role": models.RoleCustomer, "accountType": models.AccountTypeCorporate,
		"companyName": "Mega Lojistik A.Ş.",
	})
	if corp1Res.Code != http.StatusOK {
		t.Fatalf("corp1 register status=%d body=%s", corp1Res.Code, corp1Res.Body.String())
	}
	corp1Session := decodeResponse[testSession](t, corp1Res)

	corp2Res := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]string{
		"name": "Mehmet Demir", "email": "mehmet@alfatasima.com", "phone": "05552223344",
		"password": "Password123!", "role": models.RoleCustomer, "accountType": models.AccountTypeCorporate,
		"companyName": "Alfa Taşımacılık Ltd.",
	})
	if corp2Res.Code != http.StatusOK {
		t.Fatalf("corp2 register status=%d body=%s", corp2Res.Code, corp2Res.Body.String())
	}
	corp2Session := decodeResponse[testSession](t, corp2Res)

	// 1. Regular users endpoint MUST exclude corporate accounts by default
	usersRes := requestJSON(t, handler, http.MethodGet, "/api/admin/users", admin.AccessToken, nil)
	if usersRes.Code != http.StatusOK {
		t.Fatalf("list users status=%d body=%s", usersRes.Code, usersRes.Body.String())
	}
	var usersList struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	usersList = decodeResponse[struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}](t, usersRes)
	for _, u := range usersList.Items {
		if u["id"] == corp1Session.User.ID || u["id"] == corp2Session.User.ID {
			t.Fatalf("corporate account %v should not be present in default regular users list", u["id"])
		}
	}
	if len(usersList.Items) < 2 {
		t.Fatalf("expected individual customer and driver in users list, got %d items", len(usersList.Items))
	}
	_ = indivCustomer

	// 2. Corporate applications list with status=pending filter
	pendingAppsRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-applications?status=pending", admin.AccessToken, nil)
	if pendingAppsRes.Code != http.StatusOK {
		t.Fatalf("list pending corporate applications status=%d body=%s", pendingAppsRes.Code, pendingAppsRes.Body.String())
	}
	var pendingApps struct {
		Items []map[string]any `json:"items"`
	}
	pendingApps = decodeResponse[struct {
		Items []map[string]any `json:"items"`
	}](t, pendingAppsRes)
	if len(pendingApps.Items) != 2 {
		t.Fatalf("expected 2 pending corporate applications, got %d", len(pendingApps.Items))
	}

	// 3. Search query filter
	searchAppsRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts?q=Mega", admin.AccessToken, nil)
	var searchApps struct {
		Items []map[string]any `json:"items"`
	}
	searchApps = decodeResponse[struct {
		Items []map[string]any `json:"items"`
	}](t, searchAppsRes)
	if len(searchApps.Items) != 1 || searchApps.Items[0]["user_id"] != corp1Session.User.ID {
		t.Fatalf("expected 1 result for query 'Mega' with user_id=%s, got len=%d item=%#v", corp1Session.User.ID, len(searchApps.Items), searchApps.Items)
	}
	corp1CompanyID := searchApps.Items[0]["id"].(string)

	// 4. Single corporate account detail (by corporate ID, by user ID, and via alias)
	detailRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts/"+corp1CompanyID, admin.AccessToken, nil)
	if detailRes.Code != http.StatusOK {
		t.Fatalf("get single corporate account status=%d body=%s", detailRes.Code, detailRes.Body.String())
	}
	var corp1Detail map[string]any
	corp1Detail = decodeResponse[map[string]any](t, detailRes)
	if corp1Detail["id"] != corp1CompanyID || corp1Detail["user_id"] != corp1Session.User.ID || corp1Detail["company"] == nil {
		t.Fatalf("expected corporate account detail with company, got %#v", corp1Detail)
	}

	detailByUserIDRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-applications/"+corp1Session.User.ID, admin.AccessToken, nil)
	if detailByUserIDRes.Code != http.StatusOK {
		t.Fatalf("get single corporate application by user.ID status=%d body=%s", detailByUserIDRes.Code, detailByUserIDRes.Body.String())
	}

	// 5. Rejection without reason must fail
	rejectNoReason := requestJSON(t, handler, http.MethodPatch, "/api/admin/corporate-accounts/"+corp1CompanyID+"/status", admin.AccessToken, map[string]string{
		"status": models.CorporateStatusRejected,
	})
	if rejectNoReason.Code != http.StatusBadRequest {
		t.Fatalf("rejection without reason should be 400, got status=%d", rejectNoReason.Code)
	}

	// 6. Rejection with reason
	rejectRes := requestJSON(t, handler, http.MethodPatch, "/api/admin/corporate-accounts/"+corp1CompanyID+"/status", admin.AccessToken, map[string]string{
		"status": models.CorporateStatusRejected, "rejectionReason": "Vergi levhası okunamıyor",
	})
	if rejectRes.Code != http.StatusOK {
		t.Fatalf("rejection with reason status=%d body=%s", rejectRes.Code, rejectRes.Body.String())
	}

	// Rejected corporate user must not have access to corporate context
	corp1Dashboard := requestJSON(t, handler, http.MethodGet, "/api/corporate/dashboard", corp1Session.AccessToken, nil)
	if corp1Dashboard.Code != http.StatusForbidden {
		t.Fatalf("rejected corporate user should get 403 on corporate endpoints, got %d", corp1Dashboard.Code)
	}

	// Check /api/me before approval
	corp2MeBefore := requestJSON(t, handler, http.MethodGet, "/api/me", corp2Session.AccessToken, nil)
	if corp2MeBefore.Code != http.StatusOK {
		t.Fatalf("corp2 /api/me before approval status=%d", corp2MeBefore.Code)
	}
	var corp2MeBeforeMap map[string]any
	corp2MeBeforeMap = decodeResponse[map[string]any](t, corp2MeBefore)
	if corp2MeBeforeMap["corporateStatus"] != models.CorporateStatusPending {
		t.Fatalf("expected corp2 /api/me corporateStatus=pending, got %v", corp2MeBeforeMap["corporateStatus"])
	}
	corp2Corporate, ok := corp2MeBeforeMap["corporate"].(map[string]any)
	if !ok || corp2Corporate == nil {
		t.Fatalf("expected corp2 /api/me to have non-nil 'corporate' object, got %#v", corp2MeBeforeMap["corporate"])
	}
	if corp2Corporate["id"] == corp2MeBeforeMap["id"] {
		t.Fatalf("corporateId must not equal userId! got corporate.id=%v user.id=%v", corp2Corporate["id"], corp2MeBeforeMap["id"])
	}
	if corp2Corporate["user_id"] != corp2MeBeforeMap["id"] {
		t.Fatalf("corporate.user_id must equal user.id! got %v vs %v", corp2Corporate["user_id"], corp2MeBeforeMap["id"])
	}

	// Verify individual user has corporate == nil
	indivMe := requestJSON(t, handler, http.MethodGet, "/api/me", indivCustomer.AccessToken, nil)
	indivMeMap := decodeResponse[map[string]any](t, indivMe)
	if indivMeMap["corporate"] != nil {
		t.Fatalf("individual customer must have corporate=nil, got %#v", indivMeMap["corporate"])
	}

	// 7. Approval of corp2 (via /corporate-accounts/{id}/status using corporate ID)
	corp2ListRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts?q=Alfa", admin.AccessToken, nil)
	var corp2List struct {
		Items []map[string]any `json:"items"`
	}
	corp2List = decodeResponse[struct {
		Items []map[string]any `json:"items"`
	}](t, corp2ListRes)
	if len(corp2List.Items) != 1 {
		t.Fatalf("expected 1 item for Alfa, got %d", len(corp2List.Items))
	}
	corp2CompanyID := corp2List.Items[0]["id"].(string)

	approveRes := requestJSON(t, handler, http.MethodPatch, "/api/admin/corporate-accounts/"+corp2CompanyID+"/status", admin.AccessToken, map[string]string{
		"status": models.CorporateStatusApproved,
	})
	if approveRes.Code != http.StatusOK {
		t.Fatalf("approval status=%d body=%s", approveRes.Code, approveRes.Body.String())
	}

	// Check /api/me after approval
	corp2MeAfter := requestJSON(t, handler, http.MethodGet, "/api/me", corp2Session.AccessToken, nil)
	if corp2MeAfter.Code != http.StatusOK {
		t.Fatalf("corp2 /api/me after approval status=%d", corp2MeAfter.Code)
	}
	var corp2MeAfterMap map[string]any
	corp2MeAfterMap = decodeResponse[map[string]any](t, corp2MeAfter)
	if corp2MeAfterMap["corporateStatus"] != models.CorporateStatusApproved {
		t.Fatalf("expected corp2 /api/me corporateStatus=approved, got %v", corp2MeAfterMap["corporateStatus"])
	}
	corp2CorporateAfter, ok := corp2MeAfterMap["corporate"].(map[string]any)
	if !ok || corp2CorporateAfter == nil {
		t.Fatalf("expected corp2 /api/me after approval to have non-nil 'corporate' object")
	}
	if corp2CorporateAfter["status"] != models.CorporateStatusApproved {
		t.Fatalf("expected corporate.status to be approved, got %v", corp2CorporateAfter["status"])
	}
	if corp2CorporateAfter["approved_at"] == nil || corp2CorporateAfter["approved_at"] == "" {
		t.Fatalf("expected corporate.approved_at to be populated after approval, got %v", corp2CorporateAfter["approved_at"])
	}

	// Approved corporate user MUST have access to corporate context
	corp2Dashboard := requestJSON(t, handler, http.MethodGet, "/api/corporate/dashboard", corp2Session.AccessToken, nil)
	if corp2Dashboard.Code != http.StatusOK {
		t.Fatalf("approved corporate user should get 200 on corporate endpoints, got %d body=%s", corp2Dashboard.Code, corp2Dashboard.Body.String())
	}

	// 8. Filters for approved and rejected
	approvedAppsRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts?status=approved", admin.AccessToken, nil)
	var approvedApps struct {
		Items []map[string]any `json:"items"`
	}
	approvedApps = decodeResponse[struct {
		Items []map[string]any `json:"items"`
	}](t, approvedAppsRes)
	if len(approvedApps.Items) != 1 || approvedApps.Items[0]["id"] != corp2CompanyID {
		t.Fatalf("expected 1 approved corporate application with id=%s, got len=%d items=%#v", corp2CompanyID, len(approvedApps.Items), approvedApps.Items)
	}

	rejectedAppsRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts?status=rejected", admin.AccessToken, nil)
	var rejectedApps struct {
		Items []map[string]any `json:"items"`
	}
	rejectedApps = decodeResponse[struct {
		Items []map[string]any `json:"items"`
	}](t, rejectedAppsRes)
	if len(rejectedApps.Items) != 1 || rejectedApps.Items[0]["id"] != corp1CompanyID {
		t.Fatalf("expected 1 rejected corporate application with id=%s, got len=%d items=%#v", corp1CompanyID, len(rejectedApps.Items), rejectedApps.Items)
	}

	// 9. Logout and Relogin verification for corporate user
	logoutRes := requestJSON(t, handler, http.MethodPost, "/api/auth/logout", corp2Session.AccessToken, map[string]string{
		"refreshToken": corp2Session.RefreshToken,
	})
	if logoutRes.Code != http.StatusOK && logoutRes.Code != http.StatusNoContent {
		t.Fatalf("corporate logout status=%d body=%s", logoutRes.Code, logoutRes.Body.String())
	}

	// Refresh with consumed token must fail
	refreshRes := requestJSON(t, handler, http.MethodPost, "/api/auth/refresh", "", map[string]string{
		"refreshToken": corp2Session.RefreshToken,
	})
	if refreshRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on refresh with logged-out token, got %d", refreshRes.Code)
	}

	// Relogin
	loginRes := requestJSON(t, handler, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email": "mehmet@alfatasima.com", "password": "Password123!",
	})
	if loginRes.Code != http.StatusOK {
		t.Fatalf("relogin status=%d body=%s", loginRes.Code, loginRes.Body.String())
	}
	reloginSession := decodeResponse[testSession](t, loginRes)
	corp2MeAfterRelogin := requestJSON(t, handler, http.MethodGet, "/api/me", reloginSession.AccessToken, nil)
	var corp2MeReloginMap map[string]any
	corp2MeReloginMap = decodeResponse[map[string]any](t, corp2MeAfterRelogin)
	if corp2MeReloginMap["corporateStatus"] != models.CorporateStatusApproved {
		t.Fatalf("expected approved status on relogin /api/me, got %v", corp2MeReloginMap["corporateStatus"])
	}

	// 10. Legacy / malformed status recovery test
	// Register user with Turkish legacy status
	legacyUser := models.User{
		ID:              "legacy-user-1",
		Email:           "legacy@example.com",
		Phone:           "05559998877",
		Role:            models.RoleCustomer,
		AccountType:     models.AccountTypeCorporate,
		CorporateStatus: "beklemede",
		CreatedAt:       time.Now().UTC(),
	}
	legacyCompany := models.Company{
		ID:               "legacy-comp-1",
		OwnerCustomerID:  "legacy-user-1",
		Name:             "Legacy Lojistik",
		AuthorizedPerson: "Kemal Bey",
		TaxNumber:        "9988776655",
		Phone:            "05559998877",
		Email:            "legacy@example.com",
		Status:           "onay_bekliyor",
		CreatedAt:        time.Now().UTC(),
	}
	legacyWallet := models.CorporateWallet{
		ID:        "legacy-wallet-1",
		CompanyID: "legacy-comp-1",
		CreatedAt: time.Now().UTC(),
	}
	if err := redisStore.CreateCorporateAccount(legacyUser, legacyCompany, legacyWallet); err != nil {
		t.Fatalf("failed to create legacy corporate account: %v", err)
	}

	// Admin list must find legacy account in pending list
	legacyListRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts?status=pending", admin.AccessToken, nil)
	var legacyList struct {
		Items []map[string]any `json:"items"`
	}
	legacyList = decodeResponse[struct {
		Items []map[string]any `json:"items"`
	}](t, legacyListRes)
	foundLegacy := false
	for _, item := range legacyList.Items {
		if item["id"] == "legacy-comp-1" {
			foundLegacy = true
			if item["status"] != models.CorporateStatusPending {
				t.Fatalf("expected legacy item to be normalized to pending, got %v", item["status"])
			}
		}
	}
	if !foundLegacy {
		t.Fatalf("legacy corporate account was not found in pending list: %#v", legacyList.Items)
	}

	// Admin detail for legacy account must return 200
	legacyDetailRes := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts/legacy-comp-1", admin.AccessToken, nil)
	if legacyDetailRes.Code != http.StatusOK {
		t.Fatalf("get legacy detail status=%d body=%s", legacyDetailRes.Code, legacyDetailRes.Body.String())
	}

	// Admin approves legacy account
	legacyApproveRes := requestJSON(t, handler, http.MethodPatch, "/api/admin/corporate-accounts/legacy-comp-1/status", admin.AccessToken, map[string]string{
		"status": models.CorporateStatusApproved,
	})
	if legacyApproveRes.Code != http.StatusOK {
		t.Fatalf("legacy approve status=%d body=%s", legacyApproveRes.Code, legacyApproveRes.Body.String())
	}
}

func TestAdminCorporateAccountStatusRequiresCorporateIDAndOnlyUpdatesOwner(t *testing.T) {
	handler, redisStore := newAdminTestAPIWithStore(t)
	admin := adminLoginForTest(t, handler)

	registerPending := func(label string) testSession {
		t.Helper()
		response := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]string{
			"name":        "Yetkili " + label,
			"email":       label + "@example.com",
			"phone":       testPhone(label),
			"password":    "GucluSifre123",
			"role":        models.RoleCustomer,
			"accountType": models.AccountTypeCorporate,
			"companyName": "Firma " + label,
		})
		if response.Code != http.StatusOK {
			t.Fatalf("register pending corporate %s status=%d body=%s", label, response.Code, response.Body.String())
		}
		return decodeResponse[testSession](t, response)
	}

	first := registerPending("corporate_id_target")
	second := registerPending("corporate_id_other")
	firstCompany, err := redisStore.GetCompanyByUser(first.User.ID)
	if err != nil {
		t.Fatalf("get first company: %v", err)
	}

	wrongID := requestJSON(t, handler, http.MethodPatch, "/api/admin/corporate-accounts/"+first.User.ID+"/status", admin.AccessToken, map[string]string{
		"status": models.CorporateStatusApproved,
	})
	if wrongID.Code != http.StatusNotFound {
		t.Fatalf("corporate account endpoint accepted user id: status=%d body=%s", wrongID.Code, wrongID.Body.String())
	}

	approved := requestJSON(t, handler, http.MethodPatch, "/api/admin/corporate-accounts/"+firstCompany.ID+"/status", admin.AccessToken, map[string]string{
		"status": models.CorporateStatusApproved,
	})
	if approved.Code != http.StatusOK {
		t.Fatalf("approve by corporate id status=%d body=%s", approved.Code, approved.Body.String())
	}

	storedFirst, err := redisStore.GetUser(first.User.ID)
	if err != nil {
		t.Fatalf("get approved owner: %v", err)
	}
	storedSecond, err := redisStore.GetUser(second.User.ID)
	if err != nil {
		t.Fatalf("get unrelated owner: %v", err)
	}
	if storedFirst.CorporateStatus != models.CorporateStatusApproved {
		t.Fatalf("target status=%q want=%q", storedFirst.CorporateStatus, models.CorporateStatusApproved)
	}
	if storedSecond.CorporateStatus != models.CorporateStatusPending {
		t.Fatalf("unrelated status=%q want=%q", storedSecond.CorporateStatus, models.CorporateStatusPending)
	}
}

func TestAdminCorporateAccountLegacyUserOnlyRecordCanBeOpenedAndApproved(t *testing.T) {
	handler, redisStore := newAdminTestAPIWithStore(t)
	admin := adminLoginForTest(t, handler)
	now := time.Now().UTC()
	legacy := models.User{
		ID:              "legacy-corporate-user-only",
		Name:            "Legacy Firma Yetkilisi",
		Email:           "legacy-user-only@example.com",
		Phone:           "+905559991122",
		Role:            models.RoleCustomer,
		AccountType:     models.AccountTypeCorporate,
		CorporateStatus: models.CorporateStatusPending,
		CreatedAt:       now,
	}
	other := models.User{
		ID:              "legacy-corporate-other",
		Name:            "Diğer Firma Yetkilisi",
		Email:           "legacy-other@example.com",
		Phone:           "+905559991133",
		Role:            models.RoleCustomer,
		AccountType:     models.AccountTypeCorporate,
		CorporateStatus: models.CorporateStatusPending,
		CreatedAt:       now.Add(-time.Minute),
	}
	if err := redisStore.CreateUser(legacy); err != nil {
		t.Fatalf("create legacy corporate user: %v", err)
	}
	if err := redisStore.CreateUser(other); err != nil {
		t.Fatalf("create unrelated legacy corporate user: %v", err)
	}

	listResponse := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts?status=pending", admin.AccessToken, nil)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list legacy corporate accounts status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
	list := decodeResponse[struct {
		Items []map[string]any `json:"items"`
	}](t, listResponse)
	var listed map[string]any
	for _, item := range list.Items {
		if item["userId"] == legacy.ID {
			listed = item
			break
		}
	}
	if listed == nil {
		t.Fatalf("legacy corporate user missing from list: %#v", list.Items)
	}
	if listed["id"] != legacy.ID || listed["corporateId"] != legacy.ID || listed["userId"] != legacy.ID {
		t.Fatalf("legacy list ids id=%v userId=%v corporateId=%v", listed["id"], listed["userId"], listed["corporateId"])
	}

	detail := requestJSON(t, handler, http.MethodGet, "/api/admin/corporate-accounts/"+legacy.ID, admin.AccessToken, nil)
	if detail.Code != http.StatusOK {
		t.Fatalf("legacy detail status=%d body=%s", detail.Code, detail.Body.String())
	}
	approved := requestJSON(t, handler, http.MethodPatch, "/api/admin/corporate-accounts/"+legacy.ID+"/status", admin.AccessToken, map[string]string{
		"status": models.CorporateStatusApproved,
	})
	if approved.Code != http.StatusOK {
		t.Fatalf("approve legacy corporate status=%d body=%s", approved.Code, approved.Body.String())
	}

	storedLegacy, err := redisStore.GetUser(legacy.ID)
	if err != nil {
		t.Fatalf("get approved legacy user: %v", err)
	}
	storedOther, err := redisStore.GetUser(other.ID)
	if err != nil {
		t.Fatalf("get unrelated legacy user: %v", err)
	}
	if storedLegacy.CorporateStatus != models.CorporateStatusApproved {
		t.Fatalf("legacy status=%q want=%q", storedLegacy.CorporateStatus, models.CorporateStatusApproved)
	}
	if storedOther.CorporateStatus != models.CorporateStatusPending {
		t.Fatalf("unrelated legacy status=%q want=%q", storedOther.CorporateStatus, models.CorporateStatusPending)
	}
}

// Alias keeps the response table compact without importing httptest again.
type responseRecorderAlias = httptest.ResponseRecorder

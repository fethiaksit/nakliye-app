package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"nakliye-api/internal/models"
)

func TestRegistrationTermsAndConsent(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)

	// 1a. Rejection when termsAccepted is omitted (nil)
	nilTermsReq := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]any{
		"name":     "Terms Omitted",
		"email":    "terms_omitted@example.com",
		"phone":    "+905551110000",
		"password": "GucluSifre123",
		"role":     models.RoleCustomer,
	})
	if nilTermsReq.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when termsAccepted is omitted, got %d", nilTermsReq.Code)
	}

	// 1b. Rejection when termsAccepted is false
	falseTerms := false
	badReq := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]any{
		"name":          "Terms Reject",
		"email":         "terms_reject@example.com",
		"phone":         "+905551110001",
		"password":      "GucluSifre123",
		"role":          models.RoleCustomer,
		"termsAccepted": &falseTerms,
	})
	if badReq.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when termsAccepted is false, got %d", badReq.Code)
	}

	// 1c. Rejection for driver registration when termsAccepted is omitted
	driverNilTerms := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]any{
		"name":     "Driver Terms Omitted",
		"email":    "driver_terms_omitted@example.com",
		"phone":    "+905551110099",
		"password": "GucluSifre123",
		"role":     models.RoleDriver,
	})
	if driverNilTerms.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when driver registers without termsAccepted, got %d", driverNilTerms.Code)
	}

	// 2. Successful registration with termsAccepted true & marketing consent true
	trueTerms := true
	goodReq := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]any{
		"name":             "Yasal Kullanıcı",
		"email":            "yasal_user@example.com",
		"phone":            "+905551110002",
		"password":         "GucluSifre123",
		"role":             models.RoleCustomer,
		"termsAccepted":    &trueTerms,
		"termsVersion":     "1.0.0",
		"marketingConsent": true,
		"kvkkAcknowledged": true,
	})
	if goodReq.Code != http.StatusOK {
		t.Fatalf("expected 200 on valid registration, got %d: %s", goodReq.Code, goodReq.Body.String())
	}

	registered := decodeResponse[testSession](t, goodReq)
	u, err := redisStore.GetUser(registered.User.ID)
	if err != nil {
		t.Fatalf("failed to retrieve registered user: %v", err)
	}
	if !u.TermsAccepted || u.TermsVersion != "1.0.0" || u.TermsAcceptedAt == nil {
		t.Fatalf("terms not recorded properly: %+v", u)
	}
	if !u.MarketingConsent || u.MarketingConsentAt == nil || !u.KVKKAcknowledged {
		t.Fatalf("consent not recorded properly: %+v", u)
	}

	// 3. Verify me endpoint returns agreement fields
	meRes := requestJSON(t, handler, http.MethodGet, "/api/me", registered.AccessToken, nil)
	if meRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/me, got %d", meRes.Code)
	}
	var meData map[string]any
	if err := jsonDecode(meRes.Body.Bytes(), &meData); err != nil {
		t.Fatal(err)
	}
	if meData["termsAccepted"] != true || meData["termsVersion"] != "1.0.0" || meData["marketingConsent"] != true {
		t.Fatalf("me response missing agreement metadata: %+v", meData)
	}

	// 4. Update agreements endpoint
	revokeMarketing := false
	updRes := requestJSON(t, handler, http.MethodPost, "/api/me/agreements", registered.AccessToken, map[string]any{
		"termsAccepted":    &trueTerms,
		"termsVersion":     "1.0.0",
		"marketingConsent": &revokeMarketing,
	})
	if updRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/me/agreements, got %d: %s", updRes.Code, updRes.Body.String())
	}
	u, _ = redisStore.GetUser(registered.User.ID)
	if u.MarketingConsent != false || u.MarketingConsentAt != nil {
		t.Fatalf("marketing consent not revoked: %+v", u)
	}
}

func TestAccountDeletionFlow(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)

	customer := registerTestUser(t, handler, "deletable_cust", models.RoleCustomer)
	driver := registerTestUser(t, handler, "deletable_driver", models.RoleDriver)

	// 1. Wrong password rejection
	wrongPass := requestJSON(t, handler, http.MethodPost, "/api/me/delete-account", customer.AccessToken, map[string]any{
		"password": "YanlisSifre123",
		"reason":   "Test silme",
	})
	if wrongPass.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for wrong password, got %d", wrongPass.Code)
	}

	// 2. Active load prevents deletion
	load := acceptStatusTestOffer(t, handler, customer, driver, createPublishedStatusTestLoad(t, handler, customer, "Silme engeli yük"))
	_ = load

	custBlocked := requestJSON(t, handler, http.MethodPost, "/api/me/delete-account", customer.AccessToken, map[string]any{
		"password": "GucluSifre123",
		"reason":   "İşi varken silmeye çalıştı",
	})
	if custBlocked.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when customer has active load, got %d: %s", custBlocked.Code, custBlocked.Body.String())
	}

	driverBlocked := requestJSON(t, handler, http.MethodPost, "/api/me/delete-account", driver.AccessToken, map[string]any{
		"password": "GucluSifre123",
		"reason":   "İşi varken silmeye çalıştı",
	})
	if driverBlocked.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when driver has active load, got %d: %s", driverBlocked.Code, driverBlocked.Body.String())
	}

	// 3. User without active load can delete account cleanly
	cleanUser := registerTestUser(t, handler, "clean_delete_user", models.RoleCustomer)
	cleanDelete := requestJSON(t, handler, http.MethodPost, "/api/me/delete-account", cleanUser.AccessToken, map[string]any{
		"password": "GucluSifre123",
		"reason":   "Artık kullanmak istemiyorum",
	})
	if cleanDelete.Code != http.StatusOK {
		t.Fatalf("expected 200 on successful account deletion, got %d: %s", cleanDelete.Code, cleanDelete.Body.String())
	}

	// Verify user is deleted & anonymized in store
	deletedU, err := redisStore.GetUser(cleanUser.User.ID)
	if err != nil {
		t.Fatalf("error fetching deleted user: %v", err)
	}
	if deletedU.AccountStatus != models.AccountStatusDeleted || deletedU.DeletedAt == nil {
		t.Fatalf("user accountStatus not deleted: %+v", deletedU)
	}
	if deletedU.Name != "Silinmiş Kullanıcı" || deletedU.PasswordHash != "" {
		t.Fatalf("user personal data not anonymized: %+v", deletedU)
	}

	// Verify old login is impossible
	loginAttempt := requestJSON(t, handler, http.MethodPost, "/api/auth/login", "", map[string]any{
		"phone":    testPhone("clean_delete_user"),
		"password": "GucluSifre123",
	})
	if loginAttempt.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on login for deleted user, got %d", loginAttempt.Code)
	}

	// 4. Driver account deletion with vehicle and documents
	driverToDelete := registerTestUser(t, handler, "driver_to_delete", models.RoleDriver)
	driverUser, _ := redisStore.GetUser(driverToDelete.User.ID)
	driverUser.DriverProfile.LicensePlate = "35 ABC 123"
	driverUser.DriverProfile.VehicleModel = "Ford Transit"
	driverUser.DriverProfile.ServiceArea = "İzmir"
	_ = redisStore.SaveUser(driverUser)

	vehiclePhotoID := "v-photo-1"
	_ = redisStore.SavePhoto(vehiclePhotoID, []byte("photo-bytes"), "image/jpeg", driverToDelete.User.ID, "")
	_ = redisStore.SaveVehicle(models.Vehicle{
		ID:           "veh-1",
		DriverID:     driverToDelete.User.ID,
		LicensePlate: "35 ABC 123",
		PhotoURL:     "/api/photos/" + vehiclePhotoID,
		IsActive:     true,
	})

	statutoryDocPhotoID := "doc-statutory-1"
	_ = redisStore.SavePhoto(statutoryDocPhotoID, []byte("statutory-doc"), "image/jpeg", driverToDelete.User.ID, "")
	_ = redisStore.SaveDriverDocument(models.DriverDocument{
		ID:       "doc-1",
		DriverID: driverToDelete.User.ID,
		Kind:     "driver_license",
		Status:   "verified",
		FileURL:  "/api/photos/" + statutoryDocPhotoID,
	})

	nonStatutoryDocPhotoID := "doc-nonstatutory-1"
	_ = redisStore.SavePhoto(nonStatutoryDocPhotoID, []byte("non-statutory-doc"), "image/jpeg", driverToDelete.User.ID, "")
	_ = redisStore.SaveDriverDocument(models.DriverDocument{
		ID:       "doc-2",
		DriverID: driverToDelete.User.ID,
		Kind:     "criminal_record",
		Status:   "pending",
		FileURL:  "/api/photos/" + nonStatutoryDocPhotoID,
	})

	driverDeleteRes := requestJSON(t, handler, http.MethodPost, "/api/me/delete-account", driverToDelete.AccessToken, map[string]any{
		"password": "GucluSifre123",
		"reason":   "Mesleği bıraktım",
	})
	if driverDeleteRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on driver account deletion, got %d: %s", driverDeleteRes.Code, driverDeleteRes.Body.String())
	}

	// Verify driver profile fields wiped
	delDriver, _ := redisStore.GetUser(driverToDelete.User.ID)
	if delDriver.DriverProfile.LicensePlate != "" || delDriver.DriverProfile.VehicleModel != "" || delDriver.DriverProfile.ServiceArea != "" {
		t.Fatalf("driver profile not anonymized: %+v", delDriver.DriverProfile)
	}

	// Verify vehicle deactivated, plate anonymized, and vehicle photo deleted
	veh, _ := redisStore.GetVehicle("veh-1")
	if veh.IsActive {
		t.Fatalf("expected vehicle to be deactivated")
	}
	if !strings.HasPrefix(veh.LicensePlate, "SİLİNDİ-") {
		t.Fatalf("expected vehicle plate to be anonymized, got: %s", veh.LicensePlate)
	}
	if _, _, _, _, err := redisStore.GetPhoto(vehiclePhotoID); err == nil {
		t.Fatalf("expected vehicle photo to be deleted from storage")
	}

	// Verify statutory document archived and photo PRESERVED for 3-year statutory audit
	doc1, _ := redisStore.GetDriverDocument("doc-1")
	if doc1.Status != "archived" {
		t.Fatalf("expected verified driver_license to be archived, got %s", doc1.Status)
	}
	if _, _, _, _, err := redisStore.GetPhoto(statutoryDocPhotoID); err != nil {
		t.Fatalf("expected statutory document photo to be retained in storage: %v", err)
	}

	// Verify non-statutory document deleted and photo DELETED from storage
	doc2, _ := redisStore.GetDriverDocument("doc-2")
	if doc2.Status != "deleted" {
		t.Fatalf("expected non-statutory document to be deleted, got %s", doc2.Status)
	}
	if _, _, _, _, err := redisStore.GetPhoto(nonStatutoryDocPhotoID); err == nil {
		t.Fatalf("expected non-statutory document photo to be deleted from storage")
	}
}

func TestPublicAccountDeletionRequest(t *testing.T) {
	handler, _ := newFlowTestAPI(t)

	// Incomplete request
	badReq := requestJSON(t, handler, http.MethodPost, "/api/account-deletion-requests", "", map[string]any{
		"reason":  "Sil",
		"confirm": false,
	})
	if badReq.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unconfirmed deletion request, got %d", badReq.Code)
	}

	// Valid public deletion request
	goodReq := requestJSON(t, handler, http.MethodPost, "/api/account-deletion-requests", "", map[string]any{
		"email":   "harici_talep@example.com",
		"phone":   "+905559998877",
		"reason":  "Google Play harici silme talebi",
		"confirm": true,
	})
	if goodReq.Code != http.StatusOK {
		t.Fatalf("expected 200 on public account deletion request, got %d: %s", goodReq.Code, goodReq.Body.String())
	}
}

func TestAdminAccountDeletionProcess(t *testing.T) {
	handler, redisStore := newAdminTestAPIWithStore(t)
	admin := adminLoginForTest(t, handler)

	targetUser := registerTestUser(t, handler, "admin_del_target", models.RoleCustomer)

	// 1. Submit public deletion request
	reqRes := requestJSON(t, handler, http.MethodPost, "/api/account-deletion-requests", "", map[string]any{
		"email":   "admin_del_target@example.com",
		"phone":   testPhone("admin_del_target"),
		"reason":  "Web üzerinden hesap silme talebi",
		"confirm": true,
	})
	if reqRes.Code != http.StatusOK {
		t.Fatalf("failed to submit public deletion request: %s", reqRes.Body.String())
	}

	// 1a. Authorization check: unauthenticated and customer tokens must be rejected (401)
	unauthRes := requestJSON(t, handler, http.MethodGet, "/api/admin/account-deletion-requests", "", nil)
	if unauthRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated access to admin deletion requests, got %d", unauthRes.Code)
	}
	custTokenRes := requestJSON(t, handler, http.MethodGet, "/api/admin/account-deletion-requests", targetUser.AccessToken, nil)
	if custTokenRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for customer token accessing admin deletion requests, got %d", custTokenRes.Code)
	}

	// 2. Admin lists deletion requests
	listRes := requestJSON(t, handler, http.MethodGet, "/api/admin/account-deletion-requests?status=pending", admin.AccessToken, nil)
	if listRes.Code != http.StatusOK {
		t.Fatalf("admin list deletion requests failed: %d", listRes.Code)
	}
	var listData struct {
		Items []models.AccountDeletionRequest `json:"items"`
	}
	if err := jsonDecode(listRes.Body.Bytes(), &listData); err != nil {
		t.Fatal(err)
	}
	if len(listData.Items) == 0 {
		t.Fatalf("expected at least 1 deletion request in admin list")
	}
	requestID := listData.Items[0].ID

	// 3. Admin approves request and executes account anonymization
	approveRes := requestJSON(t, handler, http.MethodPatch, "/api/admin/account-deletion-requests/"+requestID, admin.AccessToken, map[string]any{
		"action":    "approve",
		"adminNote": "Kullanıcı talebi telefon teyidiyle işleme alındı",
	})
	if approveRes.Code != http.StatusOK {
		t.Fatalf("admin approve deletion failed: %d %s", approveRes.Code, approveRes.Body.String())
	}

	var approvedReq models.AccountDeletionRequest
	if err := jsonDecode(approveRes.Body.Bytes(), &approvedReq); err != nil {
		t.Fatal(err)
	}
	if approvedReq.Status != "completed" || approvedReq.AdminNote == "" || approvedReq.ProcessedBy == "" {
		t.Fatalf("approved request metadata incomplete: %+v", approvedReq)
	}

	// 4. Verify target user is now deleted in store
	deletedUser, err := redisStore.GetUser(targetUser.User.ID)
	if err != nil {
		t.Fatalf("error fetching deleted user: %v", err)
	}
	if deletedUser.AccountStatus != models.AccountStatusDeleted || deletedUser.Name != "Silinmiş Kullanıcı" {
		t.Fatalf("target user was not deleted/anonymized: %+v", deletedUser)
	}

	// 5. Submit another request and reject it
	req2Res := requestJSON(t, handler, http.MethodPost, "/api/account-deletion-requests", "", map[string]any{
		"email":   "other_user@example.com",
		"reason":  "Geçersiz talep",
		"confirm": true,
	})
	if req2Res.Code != http.StatusOK {
		t.Fatalf("failed to submit second request: %s", req2Res.Body.String())
	}
	list2Res := requestJSON(t, handler, http.MethodGet, "/api/admin/account-deletion-requests?status=pending", admin.AccessToken, nil)
	var list2Data struct {
		Items []models.AccountDeletionRequest `json:"items"`
	}
	_ = jsonDecode(list2Res.Body.Bytes(), &list2Data)
	var req2ID string
	for _, it := range list2Data.Items {
		if it.Email == "other_user@example.com" {
			req2ID = it.ID
			break
		}
	}
	if req2ID == "" {
		t.Fatalf("expected to find other_user@example.com in admin list")
	}

	rejectRes := requestJSON(t, handler, http.MethodPatch, "/api/admin/account-deletion-requests/"+req2ID, admin.AccessToken, map[string]any{
		"action":    "reject",
		"adminNote": "Kimlik doğrulanamadı",
	})
	if rejectRes.Code != http.StatusOK {
		t.Fatalf("admin reject deletion failed: %d %s", rejectRes.Code, rejectRes.Body.String())
	}
	var rejectedReq models.AccountDeletionRequest
	_ = jsonDecode(rejectRes.Body.Bytes(), &rejectedReq)
	if rejectedReq.Status != "rejected" {
		t.Fatalf("expected status rejected, got %s", rejectedReq.Status)
	}
}

func jsonDecode(b []byte, target any) error {
	return json.Unmarshal(b, target)
}

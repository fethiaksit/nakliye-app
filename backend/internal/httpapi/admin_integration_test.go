package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

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
	t.Helper()
	redisServer := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + redisServer.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	api := NewWithOptions(redisStore, Options{
		Secret: integrationTestSecret, PricePerKM: 200, MaxUploadMB: 1,
		AdminEmail: adminTestEmail, AdminPassword: adminTestPassword, AdminSecret: adminTestSecret,
	})
	api.maps = stubMaps{}
	return api.Routes()
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
	complaintResponse := requestJSON(t, handler, http.MethodPost, "/api/messages/"+message.ID+"/complaints", customer.AccessToken, map[string]string{
		"reason": "inappropriate", "detail": "Uygunsuz içerik",
	})
	if complaintResponse.Code != http.StatusCreated {
		t.Fatalf("complaint status=%d body=%s", complaintResponse.Code, complaintResponse.Body.String())
	}
	complaint := decodeResponse[models.MessageComplaint](t, complaintResponse)

	complaints := requestJSON(t, handler, http.MethodGet, "/api/admin/complaints?status=open", admin.AccessToken, nil)
	var complaintsPage struct {
		Total int `json:"total"`
	}
	complaintsPage = decodeResponse[struct {
		Total int `json:"total"`
	}](t, complaints)
	if complaints.Code != http.StatusOK || complaintsPage.Total != 1 {
		t.Fatalf("admin complaints status=%d total=%d body=%s", complaints.Code, complaintsPage.Total, complaints.Body.String())
	}
	resolved := requestJSON(t, handler, http.MethodPatch, "/api/admin/complaints/"+complaint.ID, admin.AccessToken, map[string]any{
		"status": models.ComplaintStatusResolved, "resolutionNote": "İçerik kaldırıldı", "removeMessage": true,
	})
	if resolved.Code != http.StatusOK {
		t.Fatalf("resolve complaint status=%d body=%s", resolved.Code, resolved.Body.String())
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

// Alias keeps the response table compact without importing httptest again.
type responseRecorderAlias = httptest.ResponseRecorder

package httpapi

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"nakliye-api/internal/models"
)

func TestAccountCenterOwnedDocumentsAndSupport(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	customer := registerTestUser(t, handler, "accountcustomer", models.RoleCustomer)
	otherCustomer := registerTestUser(t, handler, "accountothercustomer", models.RoleCustomer)
	driver := registerTestUser(t, handler, "accountdriver", models.RoleDriver)
	otherDriver := registerTestUser(t, handler, "accountotherdriver", models.RoleDriver)
	load := acceptStatusTestOffer(t, handler, customer, driver, createPublishedStatusTestLoad(t, handler, customer, "Hesap merkezi işi"))

	storedDriver, err := redisStore.GetUser(driver.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedDriver.DriverProfile.CompletedJobs = 7
	storedDriver.DriverProfile.Rating = 4.8
	storedDriver.DriverProfile.VerificationStatus = models.VerificationVerified
	if err = redisStore.SaveUser(storedDriver); err != nil {
		t.Fatal(err)
	}
	profileUpdate := requestJSON(t, handler, http.MethodPatch, "/api/me", driver.AccessToken, map[string]string{
		"name": "Güncel Şoför", "email": storedDriver.Email, "phone": storedDriver.Phone,
	})
	if profileUpdate.Code != http.StatusOK {
		t.Fatalf("profile update status=%d body=%s", profileUpdate.Code, profileUpdate.Body.String())
	}
	storedDriver, _ = redisStore.GetUser(driver.User.ID)
	if storedDriver.DriverProfile.CompletedJobs != 7 || storedDriver.DriverProfile.Rating != 4.8 || storedDriver.DriverProfile.VerificationStatus != models.VerificationVerified {
		t.Fatalf("personal profile update erased driver data: %#v", storedDriver.DriverProfile)
	}
	trustedUpdate := requestJSON(t, handler, http.MethodPatch, "/api/me", driver.AccessToken, map[string]any{"driverProfile": map[string]any{
		"nearbyLoadNotifications": true, "completedJobs": 999, "rating": 1, "licenseStatus": models.VerificationRejected, "verificationStatus": models.VerificationRejected,
	}})
	if trustedUpdate.Code != http.StatusOK {
		t.Fatalf("driver preference update status=%d body=%s", trustedUpdate.Code, trustedUpdate.Body.String())
	}
	storedDriver, _ = redisStore.GetUser(driver.User.ID)
	if !storedDriver.DriverProfile.NearbyLoadNotifications || storedDriver.DriverProfile.CompletedJobs != 7 || storedDriver.DriverProfile.Rating != 4.8 || storedDriver.DriverProfile.VerificationStatus != models.VerificationVerified || storedDriver.DriverProfile.LicenseStatus != models.VerificationPending {
		t.Fatalf("driver changed trusted profile fields: %#v", storedDriver.DriverProfile)
	}

	now := time.Now().UTC()
	ownedDocument := models.DriverDocument{ID: uuid.NewString(), DriverID: driver.User.ID, Kind: "license", Title: "Sürücü belgesi", FileURL: "/api/photos/document", Status: models.VerificationPending, CreatedAt: now, UpdatedAt: now}
	otherDocument := models.DriverDocument{ID: uuid.NewString(), DriverID: otherDriver.User.ID, Kind: "license", Title: "Başka belge", FileURL: "/api/photos/other", Status: models.VerificationVerified, CreatedAt: now, UpdatedAt: now}
	if err = redisStore.SaveDriverDocument(ownedDocument); err != nil {
		t.Fatal(err)
	}
	if err = redisStore.SaveDriverDocument(otherDocument); err != nil {
		t.Fatal(err)
	}
	documents := requestJSON(t, handler, http.MethodGet, "/api/driver/documents", driver.AccessToken, nil)
	if documents.Code != http.StatusOK {
		t.Fatalf("documents status=%d body=%s", documents.Code, documents.Body.String())
	}
	documentPage := decodeResponse[struct {
		Items []models.DriverDocument `json:"items"`
	}](t, documents)
	if len(documentPage.Items) != 1 || documentPage.Items[0].ID != ownedDocument.ID {
		t.Fatalf("driver documents leaked or missing: %#v", documentPage.Items)
	}
	if forbiddenList := requestJSON(t, handler, http.MethodGet, "/api/driver/documents", customer.AccessToken, nil); forbiddenList.Code != http.StatusForbidden {
		t.Fatalf("customer document list status=%d", forbiddenList.Code)
	}
	if ownDetail := requestJSON(t, handler, http.MethodGet, "/api/driver/documents/"+ownedDocument.ID, driver.AccessToken, nil); ownDetail.Code != http.StatusOK {
		t.Fatalf("own document status=%d body=%s", ownDetail.Code, ownDetail.Body.String())
	}
	if otherDetail := requestJSON(t, handler, http.MethodGet, "/api/driver/documents/"+otherDocument.ID, driver.AccessToken, nil); otherDetail.Code != http.StatusForbidden {
		t.Fatalf("other document status=%d body=%s", otherDetail.Code, otherDetail.Body.String())
	}

	feedback := requestJSON(t, handler, http.MethodPost, "/api/complaints", customer.AccessToken, map[string]string{
		"type": models.SupportTypeFeedback, "subject": "Uygulama önerisi", "description": "Rota özetini faydalı buldum.",
	})
	if feedback.Code != http.StatusCreated {
		t.Fatalf("feedback status=%d body=%s", feedback.Code, feedback.Body.String())
	}
	feedbackBody := decodeResponse[struct {
		Complaint models.MessageComplaint `json:"complaint"`
	}](t, feedback)
	if feedbackBody.Complaint.Type != models.SupportTypeFeedback || feedbackBody.Complaint.ReporterID != "" {
		t.Fatalf("public feedback response incorrect: %#v", feedbackBody.Complaint)
	}

	complaintResponse := requestJSON(t, handler, http.MethodPost, "/api/complaints", customer.AccessToken, map[string]string{
		"type": models.SupportTypeComplaint, "subject": "Teslimat davranışı", "reason": "behavior", "description": "İncelenmesini istiyorum.", "loadId": load.ID,
	})
	if complaintResponse.Code != http.StatusCreated {
		t.Fatalf("complaint status=%d body=%s", complaintResponse.Code, complaintResponse.Body.String())
	}
	complaintBody := decodeResponse[struct {
		Complaint models.MessageComplaint `json:"complaint"`
	}](t, complaintResponse)
	if complaintBody.Complaint.LoadID != load.ID || complaintBody.Complaint.Type != models.SupportTypeComplaint {
		t.Fatalf("complaint relation incorrect: %#v", complaintBody.Complaint)
	}
	if duplicate := requestJSON(t, handler, http.MethodPost, "/api/complaints", customer.AccessToken, map[string]string{
		"type": models.SupportTypeComplaint, "subject": "Tekrar", "reason": "behavior", "description": "Tekrar kayıt", "loadId": load.ID,
	}); duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate complaint status=%d body=%s", duplicate.Code, duplicate.Body.String())
	}
	if unauthorizedLoad := requestJSON(t, handler, http.MethodPost, "/api/complaints", otherCustomer.AccessToken, map[string]string{
		"type": models.SupportTypeComplaint, "subject": "Yetkisiz", "reason": "behavior", "description": "Başka kullanıcının işi", "loadId": load.ID,
	}); unauthorizedLoad.Code != http.StatusForbidden {
		t.Fatalf("other customer complaint status=%d body=%s", unauthorizedLoad.Code, unauthorizedLoad.Body.String())
	}
	driverFeedback := requestJSON(t, handler, http.MethodPost, "/api/complaints", driver.AccessToken, map[string]string{
		"type": models.SupportTypeFeedback, "subject": "Şoför önerisi", "description": "Aktif iş filtresi önerisi", "loadId": load.ID,
	})
	if driverFeedback.Code != http.StatusCreated {
		t.Fatalf("driver feedback status=%d body=%s", driverFeedback.Code, driverFeedback.Body.String())
	}

	complaints, err := redisStore.ListComplaintsByReporter(customer.User.ID)
	if err != nil || len(complaints) != 2 {
		t.Fatalf("stored customer complaints=%d err=%v", len(complaints), err)
	}
	complaint := complaints[0]
	for _, item := range complaints {
		if item.Type == models.SupportTypeComplaint {
			complaint = item
		}
	}
	complaint.Status = models.ComplaintStatusResolved
	complaint.ResolutionNote = "Yalnız adminin görmesi gereken iç not"
	complaint.UpdatedAt = now.Add(time.Minute)
	if err = redisStore.SaveComplaint(complaint); err != nil {
		t.Fatal(err)
	}
	mine := requestJSON(t, handler, http.MethodGet, "/api/complaints/mine", customer.AccessToken, nil)
	if mine.Code != http.StatusOK || strings.Contains(mine.Body.String(), complaint.ResolutionNote) || strings.Contains(mine.Body.String(), "adminNote") {
		t.Fatalf("customer complaint list leaked admin note status=%d body=%s", mine.Code, mine.Body.String())
	}
	detail := requestJSON(t, handler, http.MethodGet, "/api/complaints/"+complaint.ID, customer.AccessToken, nil)
	if detail.Code != http.StatusOK || strings.Contains(detail.Body.String(), complaint.ResolutionNote) {
		t.Fatalf("complaint detail status=%d body=%s", detail.Code, detail.Body.String())
	}
	if otherDetail := requestJSON(t, handler, http.MethodGet, "/api/complaints/"+complaint.ID, otherCustomer.AccessToken, nil); otherDetail.Code != http.StatusForbidden {
		t.Fatalf("other customer complaint detail status=%d", otherDetail.Code)
	}
	allComplaints, err := redisStore.ListComplaints()
	if err != nil || len(allComplaints) != 3 {
		t.Fatalf("admin complaint source count=%d err=%v", len(allComplaints), err)
	}
}

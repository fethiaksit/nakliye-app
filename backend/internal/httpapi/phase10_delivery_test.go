package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"nakliye-api/internal/models"
)

func deliveryCodeForTest(t *testing.T, handler http.Handler, loadID, token string) (string, *httptest.ResponseRecorder) {
	t.Helper()
	response := requestJSON(t, handler, http.MethodGet, "/api/loads/"+loadID+"/delivery-code", token, nil)
	if response.Code != http.StatusOK {
		return "", response
	}
	var body struct {
		DeliveryCode string `json:"deliveryCode"`
	}
	body = decodeResponse[struct {
		DeliveryCode string `json:"deliveryCode"`
	}](t, response)
	return body.DeliveryCode, response
}

func requestDeliveryCompletion(t *testing.T, handler http.Handler, loadID, token, code string, includePhoto bool) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("code", code); err != nil {
		t.Fatal(err)
	}
	if includePhoto {
		part, err := writer.CreateFormFile("photo", "delivery.jpg")
		if err != nil {
			t.Fatal(err)
		}
		jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01}
		if _, err = part.Write(jpeg); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/loads/"+loadID+"/complete-delivery", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func advanceLoadToDelivered(t *testing.T, handler http.Handler, loadID, driverToken string) {
	t.Helper()
	for _, status := range []string{
		models.LoadStatusDriverEnRoute,
		models.LoadStatusAtPickup,
		models.LoadStatusPickedUp,
		models.LoadStatusEnRouteToDelivery,
		models.LoadStatusDelivered,
	} {
		response := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+loadID+"/status", driverToken, map[string]string{"status": status})
		if response.Code != http.StatusOK {
			t.Fatalf("advance to %s status=%d body=%s", status, response.Code, response.Body.String())
		}
	}
}

func TestPhaseTenDeliveryCodeAndPhotoCompletion(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	customer := registerTestUser(t, handler, "deliverycustomer", models.RoleCustomer)
	otherCustomer := registerTestUser(t, handler, "deliveryothercustomer", models.RoleCustomer)
	driver := registerTestUser(t, handler, "deliverydriver", models.RoleDriver)
	otherDriver := registerTestUser(t, handler, "deliveryotherdriver", models.RoleDriver)

	load := acceptStatusTestOffer(t, handler, customer, driver, createPublishedStatusTestLoad(t, handler, customer, "Kodlu teslimat"))
	if load.DeliveryVerified || load.DeliveryPhotoURL != "" || load.DeliveryVerifiedAt != nil {
		t.Fatalf("accepted load contains completed delivery fields: %#v", load)
	}
	code, codeResponse := deliveryCodeForTest(t, handler, load.ID, customer.AccessToken)
	if codeResponse.Code != http.StatusOK || !regexp.MustCompile(`^\d{6}$`).MatchString(code) {
		t.Fatalf("customer code status=%d code=%q body=%s", codeResponse.Code, code, codeResponse.Body.String())
	}
	verification, err := redisStore.GetDeliveryVerification(load.ID)
	if err != nil || verification.CodeHash == "" || verification.CodeCiphertext == "" || verification.Verified {
		t.Fatalf("secure delivery record=%#v err=%v", verification, err)
	}
	if strings.Contains(verification.CodeHash, code) || strings.Contains(verification.CodeCiphertext, code) {
		t.Fatal("delivery code was stored in plaintext")
	}

	driverCode := requestJSON(t, handler, http.MethodGet, "/api/loads/"+load.ID+"/delivery-code", driver.AccessToken, nil)
	if driverCode.Code != http.StatusForbidden {
		t.Fatalf("driver code access status=%d body=%s", driverCode.Code, driverCode.Body.String())
	}
	otherCustomerCode := requestJSON(t, handler, http.MethodGet, "/api/loads/"+load.ID+"/delivery-code", otherCustomer.AccessToken, nil)
	if otherCustomerCode.Code != http.StatusForbidden {
		t.Fatalf("other customer code access status=%d body=%s", otherCustomerCode.Code, otherCustomerCode.Body.String())
	}
	driverDetail := requestJSON(t, handler, http.MethodGet, "/api/loads/"+load.ID, driver.AccessToken, nil)
	if driverDetail.Code != http.StatusOK || strings.Contains(driverDetail.Body.String(), "deliveryCode") || strings.Contains(driverDetail.Body.String(), "codeHash") || strings.Contains(driverDetail.Body.String(), code) {
		t.Fatalf("driver detail leaked code status=%d body=%s", driverDetail.Code, driverDetail.Body.String())
	}

	var otherLoad models.Load
	var otherCode string
	for attempt := 0; attempt < 5 && (otherCode == "" || otherCode == code); attempt++ {
		otherLoad = acceptStatusTestOffer(t, handler, customer, driver, createPublishedStatusTestLoad(t, handler, customer, fmt.Sprintf("Diğer teslimat %d", attempt)))
		otherCode, _ = deliveryCodeForTest(t, handler, otherLoad.ID, customer.AccessToken)
	}
	if otherCode == "" || otherCode == code {
		t.Fatalf("could not obtain a distinct other-load code: first=%q other=%q", code, otherCode)
	}

	advanceLoadToDelivered(t, handler, load.ID, driver.AccessToken)
	wrongCode := code
	if wrongCode[0] == '9' {
		wrongCode = "8" + wrongCode[1:]
	} else {
		wrongCode = "9" + wrongCode[1:]
	}
	cases := []struct {
		name         string
		code         string
		includePhoto bool
	}{
		{name: "wrong code", code: wrongCode, includePhoto: true},
		{name: "blank code", code: "", includePhoto: true},
		{name: "missing photo", code: code, includePhoto: false},
		{name: "other load code", code: otherCode, includePhoto: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response := requestDeliveryCompletion(t, handler, load.ID, driver.AccessToken, testCase.code, testCase.includePhoto)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			stored, getErr := redisStore.GetLoad(load.ID)
			if getErr != nil || stored.Status != models.LoadStatusDelivered || stored.DeliveryVerified {
				t.Fatalf("invalid completion mutated load=%#v err=%v", stored, getErr)
			}
		})
	}

	otherDriverResponse := requestDeliveryCompletion(t, handler, load.ID, otherDriver.AccessToken, code, true)
	if otherDriverResponse.Code != http.StatusForbidden {
		t.Fatalf("other driver status=%d body=%s", otherDriverResponse.Code, otherDriverResponse.Body.String())
	}
	directStatus := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": models.LoadStatusCompleted})
	if directStatus.Code != http.StatusBadRequest {
		t.Fatalf("direct completed bypass status=%d body=%s", directStatus.Code, directStatus.Body.String())
	}

	completedResponse := requestDeliveryCompletion(t, handler, load.ID, driver.AccessToken, code, true)
	if completedResponse.Code != http.StatusOK {
		t.Fatalf("verified completion status=%d body=%s", completedResponse.Code, completedResponse.Body.String())
	}
	completed := decodeResponse[models.Load](t, completedResponse)
	if completed.Status != models.LoadStatusCompleted || !completed.DeliveryVerified || completed.DeliveryVerifiedAt == nil || completed.DeliveryPhotoURL == "" || completed.DeliveryVerificationMethod != models.DeliveryVerificationMethodCodePhoto {
		t.Fatalf("completed delivery fields=%#v", completed)
	}
	verification, err = redisStore.GetDeliveryVerification(load.ID)
	if err != nil || !verification.Verified || verification.VerifiedAt == nil || verification.PhotoURL != completed.DeliveryPhotoURL || verification.CodeHash == "" || verification.CodeCiphertext != "" || verification.VerificationMethod != models.DeliveryVerificationMethodCodePhoto {
		t.Fatalf("completed secure record=%#v err=%v", verification, err)
	}
	photoID := strings.TrimPrefix(completed.DeliveryPhotoURL, "/api/photos/")
	if _, contentType, _, _, photoErr := redisStore.GetPhoto(photoID); photoErr != nil || contentType != "image/jpeg" {
		t.Fatalf("delivery photo contentType=%q err=%v", contentType, photoErr)
	}
	history := statusHistory(t, redisStore, load.ID)
	last := history[len(history)-1]
	if last.ToStatus != models.LoadStatusCompleted || last.ChangedByUserID != driver.User.ID || last.Source != models.LoadStatusSourceDriverApp {
		t.Fatalf("completion history=%#v", last)
	}
	repeated := requestDeliveryCompletion(t, handler, load.ID, driver.AccessToken, code, true)
	if repeated.Code != http.StatusConflict {
		t.Fatalf("repeated completion status=%d body=%s", repeated.Code, repeated.Body.String())
	}
	usedCode := requestJSON(t, handler, http.MethodGet, "/api/loads/"+load.ID+"/delivery-code", customer.AccessToken, nil)
	if usedCode.Code != http.StatusConflict || strings.Contains(usedCode.Body.String(), code) {
		t.Fatalf("used delivery code status=%d body=%s", usedCode.Code, usedCode.Body.String())
	}
	stored, err := redisStore.GetLoad(load.ID)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(stored)
	if strings.Contains(string(body), code) || strings.Contains(string(body), "codeHash") || strings.Contains(string(body), "codeCiphertext") {
		t.Fatalf("load serialization leaked verification secret: %s", body)
	}

	advanceLoadToDelivered(t, handler, otherLoad.ID, driver.AccessToken)
	rateLimitedCode := "9" + otherCode[1:]
	if rateLimitedCode == otherCode {
		rateLimitedCode = "8" + otherCode[1:]
	}
	for attempt := 0; attempt < 11; attempt++ {
		response := requestDeliveryCompletion(t, handler, otherLoad.ID, driver.AccessToken, rateLimitedCode, false)
		expected := http.StatusBadRequest
		if attempt == 10 {
			expected = http.StatusTooManyRequests
		}
		if response.Code != expected {
			t.Fatalf("rate limit attempt=%d status=%d want=%d body=%s", attempt+1, response.Code, expected, response.Body.String())
		}
	}
}

func TestDeliveryCodeRepairsMissingLegacyVerification(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)

	customer := registerTestUser(t, handler, "legacydeliverycustomer", models.RoleCustomer)
	driver := registerTestUser(t, handler, "legacydeliverydriver", models.RoleDriver)

	// Önce normal bir load oluşturarak geçerli yük verisini elde et.
	source := createPublishedStatusTestLoad(t, handler, customer, "Eski teslimat kaydı")

	// Faz 10 öncesindeki eski kabul edilmiş bir işi simüle ediyoruz:
	// load mevcut, şoför atanmış, fakat delivery-verification kaydı hiç yok.
	legacy := source
	legacy.ID = "legacy-" + source.ID
	legacy.Title = "Verification kaydı eksik eski iş"
	legacy.Status = models.LoadStatusDriverSelected
	legacy.AssignedDriver = driver.User.ID
	legacy.DeliveryVerified = false
	legacy.DeliveryVerifiedAt = nil
	legacy.DeliveryPhotoURL = ""
	legacy.DeliveryVerificationMethod = ""

	if err := redisStore.SaveLoad(legacy); err != nil {
		t.Fatalf("legacy load save failed: %v", err)
	}

	// Ön koşul: verification gerçekten bulunmamalı.
	if _, err := redisStore.GetDeliveryVerification(legacy.ID); err == nil {
		t.Fatal("legacy load unexpectedly already has delivery verification")
	}

	// İlk çağrı eksik verification kaydını otomatik oluşturmalı.
	firstCode, firstResponse := deliveryCodeForTest(t, handler, legacy.ID, customer.AccessToken)
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("first delivery code status=%d body=%s", firstResponse.Code, firstResponse.Body.String())
	}
	if !regexp.MustCompile(`^\d{6}$`).MatchString(firstCode) {
		t.Fatalf("invalid generated delivery code: %q", firstCode)
	}

	verification, err := redisStore.GetDeliveryVerification(legacy.ID)
	if err != nil {
		t.Fatalf("repaired verification not stored: %v", err)
	}
	if verification.LoadID != legacy.ID ||
		verification.CustomerID != customer.User.ID ||
		verification.DriverID != driver.User.ID ||
		verification.CodeHash == "" ||
		verification.CodeCiphertext == "" ||
		verification.Verified {
		t.Fatalf("invalid repaired verification: %#v", verification)
	}

	// İkinci çağrı yeni kod üretmemeli; aynı kod dönmeli.
	secondCode, secondResponse := deliveryCodeForTest(t, handler, legacy.ID, customer.AccessToken)
	if secondResponse.Code != http.StatusOK {
		t.Fatalf("second delivery code status=%d body=%s", secondResponse.Code, secondResponse.Body.String())
	}
	if secondCode != firstCode {
		t.Fatalf("delivery code changed between requests: first=%q second=%q", firstCode, secondCode)
	}

	// Gizli değer load JSON'una sızmamalı.
	stored, err := redisStore.GetLoad(legacy.ID)
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(stored)
	if strings.Contains(string(body), firstCode) ||
		strings.Contains(string(body), "codeHash") ||
		strings.Contains(string(body), "codeCiphertext") {
		t.Fatalf("legacy load serialization leaked verification secret: %s", body)
	}
}

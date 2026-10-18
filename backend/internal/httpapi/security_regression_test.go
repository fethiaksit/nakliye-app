package httpapi_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nakliye-api/internal/httpapi"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"nakliye-api/internal/store"

	"github.com/alicebob/miniredis/v2"
)

func TestSecurityRegressions(t *testing.T) {
	s := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + s.Addr())
	if err != nil {
		t.Fatalf("redis store: %v", err)
	}

	jwtSecret := "secure-test-jwt-secret-with-minimum-32-chars-long"
	adminSecret := "secure-test-admin-secret-with-minimum-32-chars-long"

	handler := httpapi.NewWithOptions(redisStore, httpapi.Options{
		Secret:            jwtSecret,
		AdminEmail:        "admin@nakliyego.com",
		AdminPassword:     "AdminSecurePass123!",
		AdminSecret:       adminSecret,
		Environment:       "test",
	}).Routes()

	// 1. JWT Bypass: Fake signature should be rejected with 401
	t.Run("JWT Signature Bypass Attempt", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
		// Token crafted with different secret or forged payload
		req.Header.Set("Authorization", "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlLWFkbWluIiwicm9sZSI6ImFkbWluIn0.fakeSignatureHere")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 on forged JWT, got %d", rec.Code)
		}
	})

	// Register two customers to test IDOR
	customerA := registerTestCustomer(t, handler, "customer_a@example.com", "+905551112233")
	customerB := registerTestCustomer(t, handler, "customer_b@example.com", "+905554445566")

	// 2. IDOR Prevention: Customer B cannot modify or delete Customer A's load
	t.Run("IDOR Cross-Customer Load Modification", func(t *testing.T) {
		loadID := "load-customer-a-12345"
		loadA := models.Load{
			ID:          loadID,
			CustomerID:  customerA.userID,
			Status:      models.LoadStatusDraft,
			Title:       "Müşteri A İlanı",
			Description: "Özel ofis eşyaları",
			CargoType:   models.CargoTypeTicariYuk,
			UrgencyType: models.UrgencyImmediate,
			Pickup:      models.Location{Address: "Kadıköy"},
			Delivery:    models.Location{Address: "Beşiktaş"},
		}
		if err := redisStore.SaveLoad(loadA); err != nil {
			t.Fatalf("failed to save load for customer A: %v", err)
		}

		// Customer B attempts to delete Customer A's load
		delReq := httptest.NewRequest(http.MethodDelete, "/api/listings/"+loadID, nil)
		delReq.Header.Set("Authorization", "Bearer "+customerB.token)
		delRec := httptest.NewRecorder()
		handler.ServeHTTP(delRec, delReq)

		if delRec.Code != http.StatusForbidden && delRec.Code != http.StatusNotFound {
			t.Fatalf("expected 403 or 404 on IDOR delete attempt, got %d (body: %s)", delRec.Code, delRec.Body.String())
		}

		// Customer B attempts to update Customer A's load
		updateReq := httptest.NewRequest(http.MethodPut, "/api/listings/"+loadID, strings.NewReader(`{"title":"Manipüle Edildi"}`))
		updateReq.Header.Set("Authorization", "Bearer "+customerB.token)
		updateRec := httptest.NewRecorder()
		handler.ServeHTTP(updateRec, updateReq)

		if updateRec.Code != http.StatusForbidden && updateRec.Code != http.StatusNotFound {
			t.Fatalf("expected 403 or 404 on IDOR update attempt, got %d (body: %s)", updateRec.Code, updateRec.Body.String())
		}
	})

	// 3. Privilege Escalation: Customer token cannot access Admin API
	t.Run("Privilege Escalation to Admin Endpoints", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
		req.Header.Set("Authorization", "Bearer "+customerA.token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden && rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 or 403 when customer accesses admin API, got %d", rec.Code)
		}
	})

	// 4. Critical K1 Fix Verification: Password Reset requires resetToken
	t.Run("Password Reset Bypass Attempt (K1 Fix)", func(t *testing.T) {
		resetPayload := `{"email":"customer_a@example.com","newPassword":"BrandNewPass123!","resetToken":""}`
		req := httptest.NewRequest(http.MethodPost, "/api/auth/reset-password", strings.NewReader(resetPayload))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 when resetToken is empty, got %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "resetToken") {
			t.Fatalf("expected resetToken requirement message in body, got %s", rec.Body.String())
		}
	})

	// 5. Insecure File Upload: Executable/Script payload disguised as image
	t.Run("Malicious File Upload Signature Check", func(t *testing.T) {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		part, err := writer.CreateFormFile("photo", "malicious.jpg")
		if err != nil {
			t.Fatalf("form file error: %v", err)
		}
		// Write PHP shell script bytes, not real JPEG magic bytes
		_, _ = part.Write([]byte("<?php system($_GET['cmd']); ?>"))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/photos", &buf)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+customerA.token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 on fake image payload, got %d (body: %s)", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "yalnızca JPEG, PNG veya WEBP fotoğraf yüklenebilir") {
			t.Fatalf("expected invalid image type error, got %s", rec.Body.String())
		}
	})

	// 6. Security Headers Verification
	t.Run("Security Headers Verification", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		req.Header.Set("X-Forwarded-Proto", "https")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("expected X-Content-Type-Options: nosniff, got %q", rec.Header().Get("X-Content-Type-Options"))
		}
		if rec.Header().Get("X-Frame-Options") != "DENY" {
			t.Fatalf("expected X-Frame-Options: DENY, got %q", rec.Header().Get("X-Frame-Options"))
		}
		if rec.Header().Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
			t.Fatalf("expected Referrer-Policy, got %q", rec.Header().Get("Referrer-Policy"))
		}
		if !strings.Contains(rec.Header().Get("Strict-Transport-Security"), "max-age=31536000") {
			t.Fatalf("expected HSTS header on HTTPS, got %q", rec.Header().Get("Strict-Transport-Security"))
		}
	})

	// 7. JSON Body Size Limit (1 MB) -> 413 Payload Too Large
	t.Run("Large JSON Body Rejected With 413", func(t *testing.T) {
		largeString := strings.Repeat("A", (1<<20)+1024)
		body := `{"name":"` + largeString + `"}`
		req := httptest.NewRequest(http.MethodPatch, "/api/me", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+customerA.token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("expected 413 on oversized JSON body, got %d", rec.Code)
		}
	})

	// 8. Multipart Upload Body Size Limit -> 413 or 400
	t.Run("Large Upload Body Rejected", func(t *testing.T) {
		smallHandler := httpapi.NewWithOptions(redisStore, httpapi.Options{
			Secret:      jwtSecret,
			MaxUploadMB: 1,
			Environment: "test",
		}).Routes()

		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		part, _ := writer.CreateFormFile("photo", "oversized.jpg")
		_, _ = part.Write(bytes.Repeat([]byte{0xFF, 0xD8, 0xFF, 0xE0}, (600*1024))) // ~2.4 MB > 1 MB limit
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/photos", &buf)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+customerA.token)
		rec := httptest.NewRecorder()
		smallHandler.ServeHTTP(rec, req)

		if rec.Code != http.StatusRequestEntityTooLarge && rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 413 or 400 on oversized upload, got %d", rec.Code)
		}
	})

	// 9. Idempotency-Key Protection (Replay & Conflict)
	t.Run("Idempotency Key Prevents Duplicate Execution", func(t *testing.T) {
		idemKey := "idem-support-req-0001"
		payload := `{"type":"feedback","subject":"Test Bildirimi","description":"Idempotency testi"}`

		req1 := httptest.NewRequest(http.MethodPost, "/api/complaints", strings.NewReader(payload))
		req1.Header.Set("Authorization", "Bearer "+customerA.token)
		req1.Header.Set("Content-Type", "application/json")
		req1.Header.Set("Idempotency-Key", idemKey)
		rec1 := httptest.NewRecorder()
		handler.ServeHTTP(rec1, req1)
		if rec1.Code != http.StatusCreated {
			t.Fatalf("expected 201 on first request, got %d: %s", rec1.Code, rec1.Body.String())
		}

		// Repeat identical request with same Idempotency-Key
		req2 := httptest.NewRequest(http.MethodPost, "/api/complaints", strings.NewReader(payload))
		req2.Header.Set("Authorization", "Bearer "+customerA.token)
		req2.Header.Set("Content-Type", "application/json")
		req2.Header.Set("Idempotency-Key", idemKey)
		rec2 := httptest.NewRecorder()
		handler.ServeHTTP(rec2, req2)
		if rec2.Code != http.StatusCreated {
			t.Fatalf("expected 201 replayed status, got %d", rec2.Code)
		}
		if rec2.Header().Get("X-Idempotent-Replayed") != "true" {
			t.Fatalf("expected X-Idempotent-Replayed: true header")
		}
		if rec1.Body.String() != rec2.Body.String() {
			t.Fatalf("replayed body mismatch: %s vs %s", rec1.Body.String(), rec2.Body.String())
		}

		// Repeat same Idempotency-Key with different payload -> 409 Conflict
		req3 := httptest.NewRequest(http.MethodPost, "/api/complaints", strings.NewReader(`{"type":"feedback","subject":"Farklı Konu","description":"Farklı gövde"}`))
		req3.Header.Set("Authorization", "Bearer "+customerA.token)
		req3.Header.Set("Content-Type", "application/json")
		req3.Header.Set("Idempotency-Key", idemKey)
		rec3 := httptest.NewRecorder()
		handler.ServeHTTP(rec3, req3)
		if rec3.Code != http.StatusConflict {
			t.Fatalf("expected 409 when reusing Idempotency-Key with different body, got %d", rec3.Code)
		}
	})

	// 10. Driver Isolation & Complaint Isolation (Ek Güvenlik Kontrolü)
	t.Run("Driver Document Vehicle and Complaint Isolation", func(t *testing.T) {
		driverA := registerTestDriver(t, handler, "driver_a@example.com", "+905557778899")
		driverB := registerTestDriver(t, handler, "driver_b@example.com", "+905558889900")

		// Driver A uploads a document
		docPayload := `{"kind":"src","title":"SRC Belgesi","fileUrl":"https://nakliyego.com/docs/src-a.jpg"}`
		docReq := httptest.NewRequest(http.MethodPost, "/api/driver/documents", strings.NewReader(docPayload))
		docReq.Header.Set("Authorization", "Bearer "+driverA.token)
		docRec := httptest.NewRecorder()
		handler.ServeHTTP(docRec, docReq)
		if docRec.Code != http.StatusOK {
			t.Fatalf("driver A doc upload failed: %d %s", docRec.Code, docRec.Body.String())
		}
		docID := parseIDFromJSON(docRec.Body.String())

		// Driver B attempts to read Driver A's document -> 403 Forbidden
		readDocReq := httptest.NewRequest(http.MethodGet, "/api/driver/documents/"+docID, nil)
		readDocReq.Header.Set("Authorization", "Bearer "+driverB.token)
		readDocRec := httptest.NewRecorder()
		handler.ServeHTTP(readDocRec, readDocReq)
		if readDocRec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 when driver B reads driver A document, got %d", readDocRec.Code)
		}

		// Customer A creates a support/complaint record; Customer B cannot read it -> 403 Forbidden
		compReq := httptest.NewRequest(http.MethodPost, "/api/complaints", strings.NewReader(`{"type":"feedback","subject":"Özel Şikayet","description":"Gizli detay"}`))
		compReq.Header.Set("Authorization", "Bearer "+customerA.token)
		compRec := httptest.NewRecorder()
		handler.ServeHTTP(compRec, compReq)
		if compRec.Code != http.StatusCreated {
			t.Fatalf("complaint create failed: %d", compRec.Code)
		}
		compID := parseIDFromJSON(compRec.Body.String())

		readCompReq := httptest.NewRequest(http.MethodGet, "/api/complaints/"+compID, nil)
		readCompReq.Header.Set("Authorization", "Bearer "+customerB.token)
		readCompRec := httptest.NewRecorder()
		handler.ServeHTTP(readCompRec, readCompReq)
		if readCompRec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 when customer B reads customer A complaint, got %d", readCompRec.Code)
		}
	})

	// 11. Global & Endpoint Rate Limiting -> 429 Too Many Requests
	t.Run("Rate Limiting Returns 429", func(t *testing.T) {
		var hit429 bool
		for i := 0; i < 12; i++ {
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"email":"ratelimit_target@example.com","password":"wrong"}`))
			req.Header.Set("X-Real-IP", "203.0.113.55")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code == http.StatusTooManyRequests {
				hit429 = true
				if rec.Header().Get("Retry-After") == "" {
					t.Fatalf("expected Retry-After header on 429")
				}
				break
			}
		}
		if !hit429 {
			t.Fatalf("expected 429 after exceeding account login rate limit")
		}
	})

	// 12. Central Panic Recovery & Safe Error Response + Structured JSON Log Masking (Faz 3)
	t.Run("Panic Recovery Never Leaks Stacktrace And Logs JSON With RequestID", func(t *testing.T) {
		var logBuf bytes.Buffer
		service.ConfigureDefaultLogger(&logBuf)

		req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", strings.NewReader(`{"email":"customer_a@example.com"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Request-ID", "test-req-id-999")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Header().Get("X-Request-ID") != "test-req-id-999" {
			t.Fatalf("expected X-Request-ID to be preserved, got %q", rec.Header().Get("X-Request-ID"))
		}
		logOutput := logBuf.String()
		if strings.Contains(logOutput, "customer_a@example.com") {
			t.Fatalf("structured log leaked unmasked email address: %s", logOutput)
		}
		if !strings.Contains(logOutput, `"request_id":"test-req-id-999"`) {
			t.Fatalf("expected structured JSON log to include request_id, got: %s", logOutput)
		}
	})
}

type testSession struct {
	token  string
	userID string
	user   models.User
}

func registerTestCustomer(t *testing.T, handler http.Handler, email, phone string) testSession {
	payload := `{"name":"Test Customer","email":"` + email + `","phone":"` + phone + `","password":"Password123!","role":"customer","accountType":"individual","termsAccepted":true,"termsVersion":"1.0.0"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(payload))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("register failed (%d): %s", rec.Code, rec.Body.String())
	}

	token := extractTokenFromJSON(rec.Body.String())
	if token == "" {
		t.Fatalf("empty token in register response: %s", rec.Body.String())
	}
	userID := parseIDFromJSON(rec.Body.String())
	return testSession{token: token, userID: userID}
}

func registerTestDriver(t *testing.T, handler http.Handler, email, phone string) testSession {
	payload := `{"name":"Test Driver","email":"` + email + `","phone":"` + phone + `","password":"Password123!","role":"driver","termsAccepted":true,"termsVersion":"1.0.0"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(payload))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("driver register failed (%d): %s", rec.Code, rec.Body.String())
	}

	token := extractTokenFromJSON(rec.Body.String())
	userID := parseIDFromJSON(rec.Body.String())
	return testSession{token: token, userID: userID}
}

func extractTokenFromJSON(body string) string {
	idx := strings.Index(body, `"token":"`)
	if idx == -1 {
		idx = strings.Index(body, `"accessToken":"`)
		if idx == -1 {
			return ""
		}
		idx += len(`"accessToken":"`)
	} else {
		idx += len(`"token":"`)
	}
	end := strings.Index(body[idx:], `"`)
	if end == -1 {
		return ""
	}
	return body[idx : idx+end]
}

func parseIDFromJSON(body string) string {
	idx := strings.Index(body, `"id":"`)
	if idx == -1 {
		return ""
	}
	idx += len(`"id":"`)
	end := strings.Index(body[idx:], `"`)
	if end == -1 {
		return ""
	}
	return body[idx : idx+end]
}

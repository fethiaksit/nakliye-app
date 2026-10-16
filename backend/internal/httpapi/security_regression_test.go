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

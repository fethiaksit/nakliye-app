package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"nakliye-api/internal/store"
)

func setupTestAPI(t *testing.T) (*API, *store.RedisStore, *service.MockEmailSender, *miniredis.Miniredis) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	s, err := store.New("redis://" + mr.Addr() + "/0")
	if err != nil {
		t.Fatalf("failed to connect to miniredis: %v", err)
	}
	mockEmail := service.NewMockEmailSender()
	api := NewWithOptions(s, Options{
		Secret:      "test-secret-with-at-least-32-chars-long!",
		EmailSender: mockEmail,
	})
	return api, s, mockEmail, mr
}

func createTestUser(t *testing.T, s *store.RedisStore, email, phone, role, password string) models.User {
	hash, err := hashPassword(password)
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	u := models.User{
		ID:            uuid.NewString(),
		Name:          "Test User",
		Email:         email,
		Phone:         phone,
		Role:          role,
		PasswordHash:  hash,
		AccountStatus: models.AccountStatusActive,
		CreatedAt:     time.Now().UTC(),
	}
	if err := s.CreateUser(u); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	return u
}

func TestForgotPassword_ValidUser(t *testing.T) {
	api, s, mockEmail, mr := setupTestAPI(t)
	defer mr.Close()

	email := "customer@example.com"
	createTestUser(t, s, email, "+905551112233", models.RoleCustomer, "EskiSifre123")

	payload, _ := json.Marshal(map[string]string{
		"email": email,
		"role":  "customer",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	api.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var res map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to parse json response: %v", err)
	}
	if res["success"] != true {
		t.Errorf("expected success true, got %v", res["success"])
	}
	if res["message"] != genericPasswordResetMessage {
		t.Errorf("expected generic message, got %v", res["message"])
	}

	if mockEmail.TotalSent() != 1 {
		t.Fatalf("expected 1 email sent, got %d", mockEmail.TotalSent())
	}

	code := mockEmail.LastSentCode(email)
	if len(code) != 6 {
		t.Fatalf("expected 6-digit code, got %s", code)
	}

	// Kodun Redis'te düz metin değil, hashlenmiş olarak saklandığını doğrula
	record, err := s.GetPasswordResetCode(email)
	if err != nil || record == nil {
		t.Fatalf("expected reset code record in store, got %v, err=%v", record, err)
	}
	if record.HashedCode == code {
		t.Fatalf("code must not be stored in plain text!")
	}
}

func TestForgotPassword_NonExistentEmail(t *testing.T) {
	api, _, mockEmail, mr := setupTestAPI(t)
	defer mr.Close()

	payload, _ := json.Marshal(map[string]string{
		"email": "nonexistent@example.com",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	api.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var res map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res["message"] != genericPasswordResetMessage {
		t.Errorf("expected generic message to avoid email enumeration, got %v", res["message"])
	}

	if mockEmail.TotalSent() != 0 {
		t.Fatalf("expected 0 emails sent for non-existent user, got %d", mockEmail.TotalSent())
	}
}

func TestForgotPassword_DriverAndCustomerSeparation(t *testing.T) {
	api, s, mockEmail, mr := setupTestAPI(t)
	defer mr.Close()

	email := "driver@example.com"
	createTestUser(t, s, email, "+905559998877", models.RoleDriver, "DriverPass123")

	// Şoför hesabı için müşteri uygulamasından kod istendiğinde
	payload, _ := json.Marshal(map[string]string{
		"email": email,
		"role":  "customer", // Rol uyumsuz
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	api.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var res map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res["message"] != genericPasswordResetMessage {
		t.Errorf("expected generic message, got %v", res["message"])
	}

	// Rol eşleşmediği için e-posta gönderilmemeli
	if mockEmail.TotalSent() != 0 {
		t.Fatalf("expected 0 email sent when role mismatches, got %d", mockEmail.TotalSent())
	}

	// Kendi rolüyle istendiğinde gönderilmeli
	payload2, _ := json.Marshal(map[string]string{
		"email": email,
		"role":  "driver",
	})
	req2 := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload2))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	api.Routes().ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w2.Code)
	}
	if mockEmail.TotalSent() != 1 {
		t.Fatalf("expected 1 email sent when driver role matches, got %d", mockEmail.TotalSent())
	}
}

func TestForgotPassword_RateLimitExceeded(t *testing.T) {
	api, s, _, mr := setupTestAPI(t)
	defer mr.Close()

	email := "ratelimit@example.com"
	createTestUser(t, s, email, "+905551234567", models.RoleCustomer, "Pass12345")

	for i := 0; i < 3; i++ {
		payload, _ := json.Marshal(map[string]string{"email": email})
		req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		api.Routes().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 on attempt %d, got %d", i+1, w.Code)
		}
	}

	// 4. deneme limit aşımı olmalı
	payload, _ := json.Marshal(map[string]string{"email": email})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	api.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVerifyResetCode_Flow(t *testing.T) {
	api, s, mockEmail, mr := setupTestAPI(t)
	defer mr.Close()

	email := "flow@example.com"
	createTestUser(t, s, email, "+905553334455", models.RoleCustomer, "OldSecret1")

	// 1. Kod iste
	payload, _ := json.Marshal(map[string]string{"email": email})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	api.Routes().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("forgot password failed: %d", w.Code)
	}

	code := mockEmail.LastSentCode(email)

	// 2. Yanlış kod dene
	wrongPayload, _ := json.Marshal(map[string]string{"email": email, "code": "000000"})
	reqWrong := httptest.NewRequest(http.MethodPost, "/api/auth/verify-reset-code", bytes.NewReader(wrongPayload))
	reqWrong.Header.Set("Content-Type", "application/json")
	wWrong := httptest.NewRecorder()
	api.Routes().ServeHTTP(wWrong, reqWrong)
	if wWrong.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on wrong code, got %d: %s", wWrong.Code, wWrong.Body.String())
	}

	// 3. Doğru kod ile doğrula
	correctPayload, _ := json.Marshal(map[string]string{"email": email, "code": code})
	reqCorrect := httptest.NewRequest(http.MethodPost, "/api/auth/verify-reset-code", bytes.NewReader(correctPayload))
	reqCorrect.Header.Set("Content-Type", "application/json")
	wCorrect := httptest.NewRecorder()
	api.Routes().ServeHTTP(wCorrect, reqCorrect)
	if wCorrect.Code != http.StatusOK {
		t.Fatalf("expected 200 on correct code, got %d: %s", wCorrect.Code, wCorrect.Body.String())
	}

	var verifyRes map[string]any
	_ = json.Unmarshal(wCorrect.Body.Bytes(), &verifyRes)
	resetToken, ok := verifyRes["resetToken"].(string)
	if !ok || resetToken == "" {
		t.Fatalf("expected non-empty resetToken in response")
	}

	// 4. Aynı kodu tekrar doğrulama denemesi (tek kullanımlık olmalı)
	reqReplay := httptest.NewRequest(http.MethodPost, "/api/auth/verify-reset-code", bytes.NewReader(correctPayload))
	reqReplay.Header.Set("Content-Type", "application/json")
	wReplay := httptest.NewRecorder()
	api.Routes().ServeHTTP(wReplay, reqReplay)
	if wReplay.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on code replay, got %d", wReplay.Code)
	}
}

func TestVerifyResetCode_MaxAttempts(t *testing.T) {
	api, s, _, mr := setupTestAPI(t)
	defer mr.Close()

	email := "maxattempts@example.com"
	createTestUser(t, s, email, "+905556667788", models.RoleCustomer, "OldSecret1")

	// Kod oluştur
	payload, _ := json.Marshal(map[string]string{"email": email})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	api.Routes().ServeHTTP(w, req)

	// 5 kez yanlış kod gir
	for i := 0; i < 5; i++ {
		wrongPayload, _ := json.Marshal(map[string]string{"email": email, "code": "999999"})
		reqWrong := httptest.NewRequest(http.MethodPost, "/api/auth/verify-reset-code", bytes.NewReader(wrongPayload))
		reqWrong.Header.Set("Content-Type", "application/json")
		wWrong := httptest.NewRecorder()
		api.Routes().ServeHTTP(wWrong, reqWrong)
		if wWrong.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 on wrong code attempt %d, got %d", i+1, wWrong.Code)
		}
	}

	// 5 denemeden sonra kod veritabanından silinmiş olmalı
	rec, err := s.GetPasswordResetCode(email)
	if err != nil || rec != nil {
		t.Fatalf("expected code to be revoked after max attempts, got %v", rec)
	}
}

func TestResetPassword_SuccessAndSessionRevocation(t *testing.T) {
	api, s, mockEmail, mr := setupTestAPI(t)
	defer mr.Close()

	email := "fullcycle@example.com"
	phone := "+905558889900"
	u := createTestUser(t, s, email, phone, models.RoleCustomer, "EskiSifre123")

	// Önceden oluşturulmuş bir refresh token kaydet
	oldRefresh := "old-refresh-token-session"
	if err := s.SaveRefresh(oldRefresh, u.ID, 30*24*time.Hour); err != nil {
		t.Fatalf("SaveRefresh failed: %v", err)
	}

	// 1. forgot-password
	payload, _ := json.Marshal(map[string]string{"email": email})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	api.Routes().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("forgot-password status %d", w.Code)
	}

	code := mockEmail.LastSentCode(email)

	// 2. verify-reset-code
	verifyPayload, _ := json.Marshal(map[string]string{"email": email, "code": code})
	reqVerify := httptest.NewRequest(http.MethodPost, "/api/auth/verify-reset-code", bytes.NewReader(verifyPayload))
	reqVerify.Header.Set("Content-Type", "application/json")
	wVerify := httptest.NewRecorder()
	api.Routes().ServeHTTP(wVerify, reqVerify)
	if wVerify.Code != http.StatusOK {
		t.Fatalf("verify-reset-code status %d", wVerify.Code)
	}

	var verifyRes map[string]any
	_ = json.Unmarshal(wVerify.Body.Bytes(), &verifyRes)
	resetToken := verifyRes["resetToken"].(string)

	// 3. reset-password
	newPassword := "YepyeniGucluSifre2026"
	resetPayload, _ := json.Marshal(map[string]string{
		"email":       email,
		"resetToken":  resetToken,
		"newPassword": newPassword,
	})
	reqReset := httptest.NewRequest(http.MethodPost, "/api/auth/reset-password", bytes.NewReader(resetPayload))
	reqReset.Header.Set("Content-Type", "application/json")
	wReset := httptest.NewRecorder()
	api.Routes().ServeHTTP(wReset, reqReset)
	if wReset.Code != http.StatusOK {
		t.Fatalf("reset-password status %d: %s", wReset.Code, wReset.Body.String())
	}

	// 4. Eski şifreyle giriş başarısız olmalı
	loginOldPayload, _ := json.Marshal(map[string]string{
		"phone":    phone,
		"password": "EskiSifre123",
	})
	reqLoginOld := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginOldPayload))
	reqLoginOld.Header.Set("Content-Type", "application/json")
	wLoginOld := httptest.NewRecorder()
	api.Routes().ServeHTTP(wLoginOld, reqLoginOld)
	if wLoginOld.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with old password, got %d", wLoginOld.Code)
	}

	// 5. Yeni şifreyle giriş başarılı olmalı
	loginNewPayload, _ := json.Marshal(map[string]string{
		"phone":    phone,
		"password": newPassword,
	})
	reqLoginNew := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginNewPayload))
	reqLoginNew.Header.Set("Content-Type", "application/json")
	wLoginNew := httptest.NewRecorder()
	api.Routes().ServeHTTP(wLoginNew, reqLoginNew)
	if wLoginNew.Code != http.StatusOK {
		t.Fatalf("expected 200 with new password, got %d: %s", wLoginNew.Code, wLoginNew.Body.String())
	}

	// 6. Eski refresh token iptal edilmiş olmalı
	consumedOld, err := s.ConsumeRefresh(oldRefresh)
	if err == nil || consumedOld != "" {
		t.Fatalf("expected previous session to be revoked, got %s", consumedOld)
	}

	// 7. Reset token tekrar kullanılamaz olmalı
	reqResetReplay := httptest.NewRequest(http.MethodPost, "/api/auth/reset-password", bytes.NewReader(resetPayload))
	reqResetReplay.Header.Set("Content-Type", "application/json")
	wResetReplay := httptest.NewRecorder()
	api.Routes().ServeHTTP(wResetReplay, reqResetReplay)
	if wResetReplay.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when reusing resetToken, got %d", wResetReplay.Code)
	}
}

func TestForgotPassword_ResendAPIError_Graceful(t *testing.T) {
	api, s, mockEmail, mr := setupTestAPI(t)
	defer mr.Close()

	email := "api_error@example.com"
	createTestUser(t, s, email, "+905557778899", models.RoleCustomer, "Secret123")

	mockEmail.ShouldFail = true
	mockEmail.FailMessage = "Resend API connection timed out"

	payload, _ := json.Marshal(map[string]string{"email": email})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	api.Routes().ServeHTTP(w, req)

	// API hatası olduğunda kullanıcıya teknik hata ayrıntısı verilmemeli, genel yanıt verilmeli
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 generic response on email failure, got %d", w.Code)
	}
	var res map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res["message"] != genericPasswordResetMessage {
		t.Fatalf("expected generic message, got %v", res["message"])
	}
}

package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestCORSAllowedOrigins(t *testing.T) {
	os.Setenv("CORS_ALLOWED_ORIGINS", "https://custom-admin.example.com,*.custom-portal.org")
	defer os.Unsetenv("CORS_ALLOWED_ORIGINS")

	allowedCases := []string{
		"http://localhost:3000",
		"http://localhost:3001",
		"http://127.0.0.1:3000",
		"http://127.0.0.1:3001",
		"https://beta-admin-18-157-76-136.sslip.io",
		"https://beta-api-18-157-76-136.sslip.io",
		"https://18-157-76-136.sslip.io",
		"https://admin.nakliyego.com",
		"https://beta-admin.nakliyego.com",
		"https://nakliyego.com",
		"https://custom-admin.example.com",
		"https://sub.custom-portal.org",
	}

	for _, origin := range allowedCases {
		if !isAllowedOrigin(origin) {
			t.Errorf("expected origin %q to be allowed, but was rejected", origin)
		}
	}

	disallowedCases := []string{
		"",
		"https://evil.com",
		"http://nakliyego.com", // Plain HTTP not allowed for remote domain
		"http://beta-admin-18-157-76-136.sslip.io",
		"https://evil-18-157-76-136.sslip.io.attacker.com",
		"javascript:alert(1)",
		"://invalid-url",
	}

	for _, origin := range disallowedCases {
		if isAllowedOrigin(origin) {
			t.Errorf("expected origin %q to be disallowed, but was allowed", origin)
		}
	}
}

func TestCORSMiddlewareBehavior(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	handler := cors(dummyHandler)

	// Case 1: Allowed origin preflight OPTIONS
	req := httptest.NewRequest("OPTIONS", "/api/admin/dashboard", nil)
	req.Header.Set("Origin", "https://beta-admin-18-157-76-136.sslip.io")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for allowed preflight, got %d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "https://beta-admin-18-157-76-136.sslip.io" {
		t.Errorf("unexpected allow-origin: %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
	if rec.Header().Get("Access-Control-Allow-Origin") == "*" {
		t.Errorf("wildcard CORS detected! Must reflect exact origin")
	}

	// Case 2: Disallowed origin preflight OPTIONS
	reqDisallowed := httptest.NewRequest("OPTIONS", "/api/admin/dashboard", nil)
	reqDisallowed.Header.Set("Origin", "https://attacker.com")
	recDisallowed := httptest.NewRecorder()
	handler.ServeHTTP(recDisallowed, reqDisallowed)

	if recDisallowed.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for disallowed preflight, got %d", recDisallowed.Code)
	}
	if recDisallowed.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("disallowed origin received allow-origin header: %q", recDisallowed.Header().Get("Access-Control-Allow-Origin"))
	}

	// Case 3: Request without Origin (e.g. mobile app, curl)
	reqNoOrigin := httptest.NewRequest("GET", "/api/health", nil)
	recNoOrigin := httptest.NewRecorder()
	handler.ServeHTTP(recNoOrigin, reqNoOrigin)

	if recNoOrigin.Code != http.StatusOK {
		t.Fatalf("expected 200 for request without origin, got %d", recNoOrigin.Code)
	}
	if recNoOrigin.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("unexpected allow-origin for request without origin: %q", recNoOrigin.Header().Get("Access-Control-Allow-Origin"))
	}
}

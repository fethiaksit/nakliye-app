package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nakliye-api/internal/httpapi"
	"nakliye-api/internal/store"

	"github.com/alicebob/miniredis/v2"
)

func TestMaintenanceModeMiddleware(t *testing.T) {
	s := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + s.Addr())
	if err != nil {
		t.Fatalf("redis store: %v", err)
	}

	handler := httpapi.NewWithOptions(redisStore, httpapi.Options{
		Secret:          "test-jwt-secret-with-minimum-32-chars-long",
		AdminEmail:      "admin@nakliyego.com",
		AdminPassword:   "AdminSecurePass123!",
		AdminSecret:     "test-admin-secret-with-minimum-32-chars-long",
		MaintenanceMode: true,
	}).Routes()

	// 1. Normal API call should return 503 Service Unavailable with MAINTENANCE_MODE
	req := httptest.NewRequest(http.MethodGet, "/api/listings", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 during maintenance, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "MAINTENANCE_MODE") {
		t.Fatalf("expected MAINTENANCE_MODE error code, got %s", rec.Body.String())
	}

	// 2. Health check should still return 200 OK
	healthReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	healthRec := httptest.NewRecorder()
	handler.ServeHTTP(healthRec, healthReq)

	if healthRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on health check during maintenance, got %d", healthRec.Code)
	}

	// 3. Admin routes should bypass maintenance mode (e.g., admin login returns 401 on bad credentials, not 503)
	adminReq := httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", strings.NewReader(`{"email":"wrong@admin.com","password":"bad"}`))
	adminRec := httptest.NewRecorder()
	handler.ServeHTTP(adminRec, adminReq)

	if adminRec.Code == http.StatusServiceUnavailable && strings.Contains(adminRec.Body.String(), "MAINTENANCE_MODE") {
		t.Fatalf("admin endpoints should not be blocked by maintenance mode, got 503 MAINTENANCE_MODE")
	}
	if adminRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthorized on bad credentials, got %d (body: %s)", adminRec.Code, adminRec.Body.String())
	}
}

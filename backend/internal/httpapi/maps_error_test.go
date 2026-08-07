package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nakliye-api/internal/service"
)

func TestWriteRouteErrorNormalizesProviderPermissionFailure(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeRouteError(recorder, &service.GoogleMapsError{Operation: "places", HTTPStatus: http.StatusForbidden, Reason: "PERMISSION_DENIED", Message: "provider detail"}, "places")
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", recorder.Code)
	}
	var response struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Error.Code != "GOOGLE_MAPS_PERMISSION_DENIED" || response.Error.Message != "Adres önerileri alınamadı." {
		t.Fatalf("unexpected response: %#v", response.Error)
	}
}

func TestMapsAvailableReportsMissingConfigurationWithoutCallingProvider(t *testing.T) {
	api := &API{mapsKeyIssue: "GOOGLE_MAPS_SERVER_API_KEY tanımlı değil"}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/maps/places/autocomplete?input=Bornova", nil)
	if api.mapsAvailable(recorder, request, "places") {
		t.Fatal("missing server key must stop the request before a provider call")
	}
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestMapCalculateRouteReportsMissingServerKeyBeforeProviderCall(t *testing.T) {
	api := &API{mapsKeyIssue: "GOOGLE_MAPS_SERVER_API_KEY tanımlı değil"}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/maps/routes/calculate", strings.NewReader(`{"pickup":{"latitude":38.4621,"longitude":27.2177},"dropoff":{"latitude":38.4237,"longitude":27.1428}}`))
	request = request.WithContext(context.WithValue(request.Context(), userKey, principal{ID: "customer-1", Role: "customer"}))
	api.mapCalculateRoute(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "GOOGLE_MAPS_NOT_CONFIGURED") {
		t.Fatalf("unexpected body: %s", recorder.Body.String())
	}
}

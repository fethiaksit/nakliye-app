package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nakliye-api/internal/models"
)

func TestGoogleMapsClientNormalizesGoogleResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Goog-Api-Key") != "test-server-key" {
			t.Fatal("Google API key header was not sent")
		}
		switch r.URL.Path {
		case "/v1/places:autocomplete":
			if r.Method != http.MethodPost {
				t.Fatalf("autocomplete method = %s", r.Method)
			}
			if r.Header.Get("X-Goog-FieldMask") != "suggestions.placePrediction.placeId,suggestions.placePrediction.place,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text" {
				t.Fatal("autocomplete field mask missing or incomplete")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["input"] != "Bornova İzmir" || body["sessionToken"] != "session-1" {
				t.Fatalf("unexpected autocomplete body: %#v", body)
			}
			_, _ = w.Write([]byte(`{"suggestions":[{"placePrediction":{"placeId":"place-1","text":{"text":"Bornova, İzmir"},"structuredFormat":{"mainText":{"text":"Bornova"},"secondaryText":{"text":"İzmir"}}}}]}`))
		case "/v1/places/place-1":
			if r.Header.Get("X-Goog-FieldMask") != "id,formattedAddress,location" {
				t.Fatal("place details field mask missing")
			}
			_, _ = w.Write([]byte(`{"id":"place-1","formattedAddress":"Bornova, İzmir","location":{"latitude":38.4622,"longitude":27.2174}}`))
		case "/maps/api/geocode/json":
			if r.URL.Query().Get("key") != "test-server-key" {
				t.Fatal("geocoding key query was not sent")
			}
			_, _ = w.Write([]byte(`{"status":"OK","results":[{"formatted_address":"Bornova, İzmir","place_id":"place-1"}]}`))
		case "/directions/v2:computeRoutes":
			if r.Header.Get("X-Goog-FieldMask") != "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline" {
				t.Fatal("routes field mask missing")
			}
			_, _ = w.Write([]byte("{\"routes\":[{\"distanceMeters\":18420,\"duration\":\"1920s\",\"polyline\":{\"encodedPolyline\":\"_p~iF~ps|U_ulLnnqC_mqNvxq`@\"}}]}"))
		default:
			t.Fatalf("unexpected Google endpoint: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := NewGoogleMapsClientWithURLs("test-server-key", 200, server.URL, server.URL, server.URL, server.Client())
	items, err := client.Autocomplete(context.Background(), "Bornova İzmir", "session-1")
	if err != nil || len(items) != 1 || items[0].PlaceID != "place-1" {
		t.Fatalf("autocomplete = %#v, %v", items, err)
	}
	details, err := client.PlaceDetails(context.Background(), "place-1", "session-1")
	if err != nil || details.Coordinate.Latitude != 38.4622 {
		t.Fatalf("details = %#v, %v", details, err)
	}
	reverse, err := client.Reverse(context.Background(), models.Coordinate{Latitude: 38.4622, Longitude: 27.2174})
	if err != nil || reverse.FormattedAddress != "Bornova, İzmir" {
		t.Fatalf("reverse = %#v, %v", reverse, err)
	}
	route, err := client.Calculate(context.Background(), models.Coordinate{Latitude: 38.4622, Longitude: 27.2174}, models.Coordinate{Latitude: 38.49, Longitude: 27.06})
	if err != nil {
		t.Fatal(err)
	}
	if route.DistanceMeters != 18420 || route.DurationSeconds != 1920 || route.EstimatedPriceTL != 3684 || route.RouteProvider != "google" || len(route.RouteCoordinates) != 3 {
		t.Fatalf("unexpected normalized route: %#v", route)
	}
}

func TestGoogleMapsClientDoesNotOperateWithoutServerKey(t *testing.T) {
	client := NewGoogleMapsClient("", DefaultPricePerKM)
	_, err := client.Autocomplete(context.Background(), "Bornova", "session")
	if !strings.Contains(err.Error(), ErrGoogleMapsNotConfigured.Error()) {
		t.Fatalf("expected a configuration error, got %v", err)
	}
}

func TestGoogleMapsClientReturnsSafeProviderDiagnostics(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"status":"PERMISSION_DENIED","message":"API key is not allowed"}}`))
	}))
	defer server.Close()

	client := NewGoogleMapsClientWithURLs("test-server-key", DefaultPricePerKM, server.URL, server.URL, server.URL, server.Client())
	_, err := client.Autocomplete(WithRequestID(context.Background(), "request-123"), "Bornova", "session")
	var googleErr *GoogleMapsError
	if !errors.As(err, &googleErr) {
		t.Fatalf("expected GoogleMapsError, got %T: %v", err, err)
	}
	if googleErr.Operation != "places" || googleErr.HTTPStatus != http.StatusForbidden || googleErr.Reason != "PERMISSION_DENIED" {
		t.Fatalf("unexpected provider error: %#v", googleErr)
	}
	if strings.Contains(err.Error(), "test-server-key") {
		t.Fatalf("provider error leaked an API key: %v", err)
	}
}

func TestSafeGoogleMessageRedactsGoogleKey(t *testing.T) {
	message := safeGoogleMessage("Google rejected key AIzaabcdefghijklmnopqrstuvwxyz1234567890-_- because it is restricted")
	if strings.Contains(message, "AIza") || !strings.Contains(message, "[REDACTED]") {
		t.Fatalf("message was not redacted: %q", message)
	}
}

package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"nakliye-api/internal/store"
)

type pricingMapsStub struct{}

func (pricingMapsStub) Autocomplete(context.Context, string, string, *models.Coordinate) ([]service.PlaceSuggestion, error) {
	return nil, nil
}

func (pricingMapsStub) PlaceDetails(context.Context, string, string) (service.SearchResult, error) {
	return service.SearchResult{}, nil
}

func (pricingMapsStub) Reverse(_ context.Context, coordinate models.Coordinate) (service.SearchResult, error) {
	return service.SearchResult{FormattedAddress: "Test", Coordinate: coordinate}, nil
}

func (pricingMapsStub) Calculate(_ context.Context, _, _ models.Coordinate) (service.RouteResult, error) {
	// Deliberately expose the old 200 TL/km-shaped provider estimate. The API
	// must ignore it and calculate from the central pricing config.
	return service.RouteResult{DistanceMeters: 45_000, DistanceKM: 45, DurationSeconds: 3600, DurationMinutes: 60, PricePerKM: 200, EstimatedPriceTL: 10_500, Currency: "TRY", EncodedPolyline: "encoded", RouteProvider: "test"}, nil
}

func newPricingTestAPI(t *testing.T) http.Handler {
	t.Helper()
	redisServer := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + redisServer.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	api := NewWithOptions(redisStore, Options{Secret: integrationTestSecret, Pricing: service.DefaultPricingConfig(), MaxUploadMB: 1})
	api.maps = pricingMapsStub{}
	return api.Routes()
}

func TestCreateLoadUsesCentralPricingInsteadOfProviderOrClientPrice(t *testing.T) {
	handler := newPricingTestAPI(t)
	customer := registerTestUser(t, handler, "pricingcustomer", models.RoleCustomer)
	location, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Fatal(err)
	}
	scheduledAt := time.Date(time.Now().In(location).Year(), time.Now().In(location).Month(), time.Now().In(location).Day()+1, 12, 0, 0, 0, location).UTC()
	response := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, map[string]any{
		"title": "Merkezi fiyat testi", "description": "Fiyat motoru testi",
		"pickup":      map[string]any{"address": "Bornova", "latitude": 38.46, "longitude": 27.21},
		"delivery":    map[string]any{"address": "Konak", "latitude": 38.42, "longitude": 27.13},
		"dimensions":  map[string]any{"lengthCm": 80, "widthCm": 60, "heightCm": 50, "weightKg": 40},
		"urgencyType": "scheduled", "scheduledAt": scheduledAt,
		"cargoType": "ev_esyasi", "vehicleType": "kamyonet", "pickupFloor": 0, "deliveryFloor": 0,
		"pickupElevatorAvailable": true, "deliveryElevatorAvailable": true, "helperNeeded": false,
		"pricePerKm": 1, "basePriceTl": 1, "finalPrice": 1,
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body.String())
	}
	load := decodeResponse[models.Load](t, response)
	if load.BasePriceTL != 3750 || load.AgreedPriceTL != 3750 || load.PricePerKM != 50 || load.Pricing == nil || load.Pricing.FinalPrice != 3750 {
		t.Fatalf("central pricing was not used: %#v", load)
	}
	if load.Pricing.DistanceFee != 2250 || load.Pricing.BaseDriverFee != 1500 || load.Pricing.LoadLevel != string(service.LoadLevelNormal) {
		t.Fatalf("unexpected pricing breakdown: %#v", load.Pricing)
	}
	routeResponse := requestJSON(t, handler, http.MethodPost, "/api/maps/routes/calculate", customer.AccessToken, map[string]any{
		"pickup":  map[string]float64{"latitude": 38.46, "longitude": 27.21},
		"dropoff": map[string]float64{"latitude": 38.42, "longitude": 27.13},
	})
	var routeBody struct {
		Data struct {
			PricePerKM     float64 `json:"price_per_km"`
			EstimatedPrice float64 `json:"estimated_price"`
		} `json:"data"`
	}
	if routeResponse.Code != http.StatusOK || json.NewDecoder(routeResponse.Body).Decode(&routeBody) != nil || routeBody.Data.PricePerKM != 50 || routeBody.Data.EstimatedPrice != 3750 {
		t.Fatalf("route preview used stale pricing: status=%d body=%s", routeResponse.Code, routeResponse.Body.String())
	}
}

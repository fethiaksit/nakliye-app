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

func (pricingMapsStub) Calculate(_ context.Context, _, _ models.Coordinate, _ ...models.Coordinate) (service.RouteResult, error) {
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
	payload := map[string]any{
		"title": "Merkezi fiyat testi", "description": "Fiyat motoru testi",
		"pickup":      map[string]any{"address": "Bornova", "latitude": 38.46, "longitude": 27.21},
		"delivery":    map[string]any{"address": "Konak", "latitude": 38.42, "longitude": 27.13},
		"dimensions":  map[string]any{"lengthCm": 80, "widthCm": 60, "heightCm": 50, "weightKg": 40},
		"urgencyType": "scheduled", "scheduledAt": scheduledAt,
		"cargoType": "ev_esyasi", "vehicleType": "kamyonet", "pickupFloor": 0, "deliveryFloor": 0,
		"pickupElevatorAvailable": true, "deliveryElevatorAvailable": true, "helperNeeded": false,
		"pricePerKm": 1, "basePriceTl": 1, "finalPrice": 1,
	}
	preview := requestJSON(t, handler, http.MethodPost, "/api/pricing/estimate", customer.AccessToken, payload)
	if preview.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", preview.Code, preview.Body.String())
	}
	estimate := decodeResponse[models.PricingSnapshot](t, preview)
	response := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, payload)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body.String())
	}
	load := decodeResponse[models.Load](t, response)
	if estimate.RecommendedPrice != load.Pricing.RecommendedPrice {
		t.Fatalf("preview %v differs from listing %v", estimate, load.Pricing)
	}
	if load.BasePriceTL != 4500 || load.AgreedPriceTL != 0 || load.PricePerKM != 60 || load.Pricing == nil || load.Pricing.FinalPrice != 4500 {
		t.Fatalf("central pricing was not used: %#v", load)
	}
	if load.Pricing.DistanceFee != 2400 || load.Pricing.BaseDriverFee != 2100 || load.Pricing.LoadLevel != string(service.LoadLevelNormal) {
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
	if routeResponse.Code != http.StatusOK || json.NewDecoder(routeResponse.Body).Decode(&routeBody) != nil || routeBody.Data.PricePerKM != 35 || routeBody.Data.EstimatedPrice != 2650 {
		t.Fatalf("route preview used stale pricing: status=%d body=%s", routeResponse.Code, routeResponse.Body.String())
	}
}

func TestCityPreviewIsReadOnlyAndPersistsEffectiveVehicle(t *testing.T) {
	handler := newPricingTestAPI(t)
	customer := registerTestUser(t, handler, "citycapacity", models.RoleCustomer)
	driver := registerTestUser(t, handler, "citydriver", models.RoleDriver)
	scheduled := time.Now().Add(48 * time.Hour).UTC().Truncate(24 * time.Hour).Add(9 * time.Hour)
	payload := map[string]any{"title": "Ağır yük", "description": "Toplam yük", "pickup": map[string]any{"address": "A", "latitude": 38.46, "longitude": 27.21}, "delivery": map[string]any{"address": "B", "latitude": 38.42, "longitude": 27.13}, "urgencyType": "scheduled", "scheduledAt": scheduled, "cargoType": "ticari_yuk", "vehicleType": "minivan", "dimensions": map[string]any{"weightKg": 2000, "volumeM3": 12}}
	preview := requestJSON(t, handler, http.MethodPost, "/api/pricing/estimate", customer.AccessToken, payload)
	if preview.Code != http.StatusOK {
		t.Fatalf("preview %d %s", preview.Code, preview.Body.String())
	}
	estimate := decodeResponse[models.PricingSnapshot](t, preview)
	if estimate.VehicleType != models.VehicleTypeKamyonet || estimate.RecommendedPrice != 4850 {
		t.Fatalf("wrong capacity price: %#v", estimate)
	}
	mine := requestJSON(t, handler, http.MethodGet, "/api/loads/mine", customer.AccessToken, nil)
	if got := decodeResponse[struct {
		Total int `json:"total"`
	}](t, mine); got.Total != 0 {
		t.Fatalf("preview created draft: %#v", got)
	}
	created := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, payload)
	if created.Code != http.StatusCreated {
		t.Fatalf("create %d %s", created.Code, created.Body.String())
	}
	load := decodeResponse[models.Load](t, created)
	if load.VehicleType != models.VehicleTypeKamyonet || load.Dimensions.VolumeM3 != 12 {
		t.Fatalf("driver gets wrong vehicle or volume: %#v", load)
	}
	published := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/publish", customer.AccessToken, nil)
	if published.Code != http.StatusOK {
		t.Fatalf("publish %d", published.Code)
	}
	jobs := requestJSON(t, handler, http.MethodGet, "/api/drivers/jobs/nearby?vehicleType=kamyonet", driver.AccessToken, nil)
	if got := decodeResponse[struct {
		Total int `json:"total"`
	}](t, jobs); got.Total != 1 {
		t.Fatalf("suitable driver filter missed load: %s", jobs.Body.String())
	}
	offerResponse := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/offers", driver.AccessToken, map[string]any{"amountTl": 7200, "estimatedArrivalMinutes": 30})
	if offerResponse.Code != http.StatusCreated {
		t.Fatalf("outside-band offer %d %s", offerResponse.Code, offerResponse.Body.String())
	}
	offer := decodeResponse[models.Offer](t, offerResponse)
	accepted := requestJSON(t, handler, http.MethodPost, "/api/offers/"+offer.ID+"/accept", customer.AccessToken, nil)
	if accepted.Code != http.StatusOK {
		t.Fatalf("accept %d %s", accepted.Code, accepted.Body.String())
	}
	detail := requestJSON(t, handler, http.MethodGet, "/api/loads/"+load.ID, customer.AccessToken, nil)
	agreed := decodeResponse[models.Load](t, detail)
	if agreed.AgreedPriceTL != 7200 || agreed.Pricing.RecommendedPrice != 4850 {
		t.Fatalf("offer wasn't independent of reference: %#v", agreed)
	}
}

func TestSimpleCargoCanBeEstimatedCreatedAndPublishedWithoutCustomerVolume(t *testing.T) {
	handler := newPricingTestAPI(t)
	customer := registerTestUser(t, handler, "simplecargo", models.RoleCustomer)
	scheduled := time.Now().Add(48 * time.Hour).UTC().Truncate(24 * time.Hour).Add(9 * time.Hour)
	for _, tc := range []struct {
		name, cargo    string
		details        map[string]any
		volume, weight float64
		manual         bool
	}{
		{"items", "mobilya", map[string]any{"items": []any{map[string]any{"name": "Kanepe", "count": 2}, map[string]any{"name": "Sandalye", "count": 4}}}, 5.2, 192, false},
		{"unsure", "diger", map[string]any{"loadSize": "unknown"}, 1, 50, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.details["capacityInput"] = "simple-v1"
			tc.details["capacityQuoteRequired"] = !tc.manual
			payload := map[string]any{"title": "Basit yük bilgileri", "description": "Eşyaları taşıma", "pickup": map[string]any{"address": "A", "latitude": 38.46, "longitude": 27.21}, "delivery": map[string]any{"address": "B", "latitude": 38.42, "longitude": 27.13}, "urgencyType": "scheduled", "scheduledAt": scheduled, "cargoType": tc.cargo, "cargoTypeNote": "Koli", "vehicleType": "farketmez", "cargoDetails": tc.details, "dimensions": map[string]any{"weightKg": 0, "volumeM3": .1}}
			preview := requestJSON(t, handler, http.MethodPost, "/api/pricing/estimate", customer.AccessToken, payload)
			if preview.Code != http.StatusOK {
				t.Fatalf("preview %d %s", preview.Code, preview.Body.String())
			}
			estimate := decodeResponse[models.PricingSnapshot](t, preview)
			created := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, payload)
			if created.Code != http.StatusCreated {
				t.Fatalf("create %d %s", created.Code, created.Body.String())
			}
			load := decodeResponse[models.Load](t, created)
			if load.Dimensions.VolumeM3 != tc.volume || load.Dimensions.WeightKG != tc.weight || load.Pricing.ManualQuoteRequired != tc.manual || estimate.RecommendedPrice != load.Pricing.RecommendedPrice {
				t.Fatalf("wrong inferred capacity/price: %#v / %#v", load, estimate)
			}
			if tc.manual && load.Pricing.RecommendedPrice != 0 {
				t.Fatal("unknown capacity invented a price")
			}
			if !tc.manual && (load.VehicleType != models.VehicleTypePanelvan || estimate.RecommendedPrice != 3400) {
				t.Fatalf("wrong item price %#v", estimate)
			}
			published := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/publish", customer.AccessToken, nil)
			if published.Code != http.StatusOK {
				t.Fatalf("publish %d %s", published.Code, published.Body.String())
			}
		})
	}
}

func TestSimpleCargoRejectsInvalidItemCounts(t *testing.T) {
	req := loadRequest{CargoType: models.CargoTypeMobilya, CargoDetails: map[string]any{"capacityInput": "simple-v1", "items": []any{map[string]any{"name": "Kanepe", "count": -1.0}}}}
	normalizeLoadRequest(&req)
	if err := validLoad(req, time.Now()); err == nil || err.Error() != "eşya adedi 1 ile 1000 arasında tam sayı olmalıdır" {
		t.Fatalf("wrong validation: %v", err)
	}
}

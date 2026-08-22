package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"nakliye-api/internal/store"
)

const integrationTestSecret = "integration-test-secret-at-least-32-characters"

type stubMaps struct{}

func (stubMaps) Autocomplete(context.Context, string, string, *models.Coordinate) ([]service.PlaceSuggestion, error) {
	return []service.PlaceSuggestion{{PlaceID: "place-1", FormattedAddress: "İzmir"}}, nil
}

func (stubMaps) PlaceDetails(context.Context, string, string) (service.SearchResult, error) {
	return service.SearchResult{PlaceID: "place-1", FormattedAddress: "İzmir", Coordinate: models.Coordinate{Latitude: 38.42, Longitude: 27.14}}, nil
}

func (stubMaps) Reverse(_ context.Context, coordinate models.Coordinate) (service.SearchResult, error) {
	return service.SearchResult{FormattedAddress: "İzmir", Coordinate: coordinate}, nil
}

func (stubMaps) Calculate(_ context.Context, pickup, dropoff models.Coordinate) (service.RouteResult, error) {
	return service.RouteResult{
		DistanceMeters: 18000, DistanceKM: 18, DurationSeconds: 1800, DurationMinutes: 30,
		PricePerKM: 200, EstimatedPriceTL: 3600, Currency: "TRY", EncodedPolyline: "encoded",
		RouteProvider: "test", RouteCoordinates: []models.Coordinate{pickup, dropoff},
	}, nil
}

type testSession struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	User         struct {
		ID   string `json:"id"`
		Role string `json:"role"`
	} `json:"user"`
}

func newFlowTestAPI(t *testing.T) (http.Handler, *store.RedisStore) {
	t.Helper()
	redisServer := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + redisServer.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	api := NewWithOptions(redisStore, Options{Secret: integrationTestSecret, PricePerKM: 200, MaxUploadMB: 1})
	api.maps = stubMaps{}
	return api.Routes(), redisStore
}

func requestJSON(t *testing.T, handler http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	request := httptest.NewRequest(method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func decodeResponse[T any](t *testing.T, recorder *httptest.ResponseRecorder) T {
	t.Helper()
	var response T
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode status=%d body=%q: %v", recorder.Code, recorder.Body.String(), err)
	}
	return response
}

func registerTestUser(t *testing.T, handler http.Handler, suffix, role string) testSession {
	t.Helper()
	recorder := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]any{
		"name": "Test " + suffix, "email": suffix + "@example.com", "phone": testPhone(suffix),
		"password": "GucluSifre123", "role": role,
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("register %s status=%d body=%s", role, recorder.Code, recorder.Body.String())
	}
	return decodeResponse[testSession](t, recorder)
}

func testPhone(suffix string) string {
	phoneSuffix := 0
	for _, character := range []byte(suffix) {
		phoneSuffix = (phoneSuffix*31 + int(character)) % 10_000_000
	}
	return "+90555" + fmt.Sprintf("%07d", phoneSuffix)
}

func TestPhaseZeroCoreFlow(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)

	privilegedRegistration := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]any{
		"name": "Unauthorized Admin", "email": "admin@example.com", "phone": "+905551110000",
		"password": "GucluSifre123", "role": models.RoleAdmin,
	})
	if privilegedRegistration.Code != http.StatusBadRequest {
		t.Fatalf("public privileged registration status=%d body=%s", privilegedRegistration.Code, privilegedRegistration.Body.String())
	}

	customer := registerTestUser(t, handler, "customer1", models.RoleCustomer)
	driver := registerTestUser(t, handler, "driver00001", models.RoleDriver)
	otherCustomer := registerTestUser(t, handler, "customer2", models.RoleCustomer)
	duplicateAccount := requestJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]any{
		"name": "Duplicate", "email": "customer1@example.com", "phone": testPhone("customer1"),
		"password": "GucluSifre123", "role": models.RoleCustomer,
	})
	if duplicateAccount.Code != http.StatusConflict {
		t.Fatalf("duplicate account status=%d body=%s", duplicateAccount.Code, duplicateAccount.Body.String())
	}

	invalidLogin := requestJSON(t, handler, http.MethodPost, "/api/auth/login", "", map[string]string{"phone": "+905550000909", "password": "yanlis"})
	if invalidLogin.Code != http.StatusUnauthorized || invalidLogin.Header().Get("X-Request-ID") == "" {
		t.Fatalf("invalid login status=%d request-id=%q", invalidLogin.Code, invalidLogin.Header().Get("X-Request-ID"))
	}
	var normalizedError struct {
		Success bool `json:"success"`
		Error   struct {
			Code string `json:"code"`
		} `json:"error"`
		RequestID string `json:"requestId"`
	}
	normalizedError = decodeResponse[typeofNormalizedError](t, invalidLogin)
	if normalizedError.Success || normalizedError.Error.Code != "UNAUTHORIZED" || normalizedError.RequestID == "" {
		t.Fatalf("unexpected normalized error: %#v", normalizedError)
	}

	login := requestJSON(t, handler, http.MethodPost, "/api/auth/login", "", map[string]string{"phone": "+905559999999", "password": "GucluSifre123"})
	if login.Code != http.StatusUnauthorized {
		t.Fatalf("unknown account login status=%d", login.Code)
	}
	validLogin := requestJSON(t, handler, http.MethodPost, "/api/auth/login", "", map[string]string{"email": "customer1@example.com", "password": "GucluSifre123"})
	if validLogin.Code != http.StatusOK || decodeResponse[testSession](t, validLogin).User.Role != models.RoleCustomer {
		t.Fatalf("customer login status=%d body=%s", validLogin.Code, validLogin.Body.String())
	}
	validDriverLogin := requestJSON(t, handler, http.MethodPost, "/api/auth/login", "", map[string]string{"email": "driver00001@example.com", "password": "GucluSifre123"})
	if validDriverLogin.Code != http.StatusOK || decodeResponse[testSession](t, validDriverLogin).User.Role != models.RoleDriver {
		t.Fatalf("driver login status=%d body=%s", validDriverLogin.Code, validDriverLogin.Body.String())
	}

	createdLoads := make([]models.Load, 0, 3)
	for index := 0; index < 3; index++ {
		created := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, map[string]any{
			"title": fmt.Sprintf("Yük %d", index+1), "description": "Kırılabilir",
			"pickup":      map[string]any{"address": "Bornova, İzmir", "latitude": 38.46, "longitude": 27.21, "placeId": "origin-place", "city": "İzmir", "district": "Bornova", "province": "İzmir", "postalCode": "35030", "country": "Türkiye", "countryCode": "TR"},
			"delivery":    map[string]any{"address": "Konak, İzmir", "latitude": 38.42, "longitude": 27.13, "placeId": "destination-place", "city": "İzmir", "district": "Konak", "province": "İzmir", "country": "Türkiye", "countryCode": "TR"},
			"dimensions":  map[string]any{"lengthCm": 120, "widthCm": 80, "heightCm": 100, "weightKg": 100},
			"urgencyType": "immediate", "cargoType": "ev_esyasi", "vehicleType": "kamyonet",
			"pickupFloor": 2, "deliveryFloor": 0, "pickupElevatorAvailable": true, "deliveryElevatorAvailable": false,
			"helperNeeded": false, "helperCount": 0,
		})
		if created.Code != http.StatusCreated {
			t.Fatalf("create load status=%d body=%s", created.Code, created.Body.String())
		}
		load := decodeResponse[models.Load](t, created)
		if load.Pickup.PlaceID != "origin-place" || load.Pickup.District != "Bornova" || load.Delivery.PlaceID != "destination-place" || load.Delivery.District != "Konak" {
			t.Fatalf("normalized locations were not persisted independently: pickup=%#v delivery=%#v", load.Pickup, load.Delivery)
		}
		createdLoads = append(createdLoads, load)
		published := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/publish", customer.AccessToken, nil)
		if published.Code != http.StatusOK || decodeResponse[models.Load](t, published).Status != models.LoadStatusPublished {
			t.Fatalf("publish load status=%d body=%s", published.Code, published.Body.String())
		}
	}

	draft := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, map[string]any{
		"title": "Gizli taslak", "description": "Paketlenmiş yük", "pickup": map[string]any{"address": "A", "latitude": 38.46, "longitude": 27.21},
		"delivery": map[string]any{"address": "B", "latitude": 38.42, "longitude": 27.13}, "dimensions": map[string]any{"lengthCm": 30, "widthCm": 30, "heightCm": 30, "weightKg": 10},
		"urgencyType": "today", "cargoType": "ticari_yuk", "vehicleType": "farketmez", "pickupFloor": 0, "deliveryFloor": 1,
	})
	draftLoad := decodeResponse[models.Load](t, draft)
	forbiddenDraft := requestJSON(t, handler, http.MethodGet, "/api/loads/"+draftLoad.ID, driver.AccessToken, nil)
	if forbiddenDraft.Code != http.StatusForbidden {
		t.Fatalf("driver read customer draft status=%d", forbiddenDraft.Code)
	}

	mine := requestJSON(t, handler, http.MethodGet, "/api/loads/mine?limit=100", customer.AccessToken, nil)
	var mineResponse struct {
		Items []models.Load `json:"items"`
		Total int           `json:"total"`
	}
	mineResponse = decodeResponse[struct {
		Items []models.Load `json:"items"`
		Total int           `json:"total"`
	}](t, mine)
	if mine.Code != http.StatusOK || mineResponse.Total != 4 || len(mineResponse.Items) != 4 {
		t.Fatalf("mine total=%d items=%d", mineResponse.Total, len(mineResponse.Items))
	}

	jobs := requestJSON(t, handler, http.MethodGet, "/api/drivers/jobs/nearby?limit=100", driver.AccessToken, nil)
	var jobsResponse struct {
		Items []models.Load `json:"items"`
		Total int           `json:"total"`
	}
	jobsResponse = decodeResponse[struct {
		Items []models.Load `json:"items"`
		Total int           `json:"total"`
	}](t, jobs)
	if jobs.Code != http.StatusOK || jobsResponse.Total != 3 || len(jobsResponse.Items) != 3 {
		t.Fatalf("driver jobs total=%d items=%d body=%s", jobsResponse.Total, len(jobsResponse.Items), jobs.Body.String())
	}
	loadDetail := requestJSON(t, handler, http.MethodGet, "/api/loads/"+createdLoads[0].ID, driver.AccessToken, nil)
	driverLoad := decodeResponse[models.Load](t, loadDetail)
	if loadDetail.Code != http.StatusOK || driverLoad.ID != createdLoads[0].ID {
		t.Fatalf("load detail status=%d", loadDetail.Code)
	}
	if driverLoad.Pickup.Address != "Bornova, İzmir" || driverLoad.Delivery.Address != "Konak, İzmir" || driverLoad.Pickup.PlaceID != "origin-place" || driverLoad.Delivery.PlaceID != "destination-place" {
		t.Fatalf("driver did not receive persisted Google addresses: pickup=%#v delivery=%#v", driverLoad.Pickup, driverLoad.Delivery)
	}

	offerResponse := requestJSON(t, handler, http.MethodPost, "/api/loads/"+createdLoads[0].ID+"/offers", driver.AccessToken, map[string]any{"amountTl": 3400, "note": "Bugün taşıyabilirim", "estimatedArrivalMinutes": 45})
	if offerResponse.Code != http.StatusCreated {
		t.Fatalf("create offer status=%d body=%s", offerResponse.Code, offerResponse.Body.String())
	}
	offer := decodeResponse[models.Offer](t, offerResponse)
	accepted := requestJSON(t, handler, http.MethodPost, "/api/offers/"+offer.ID+"/accept", customer.AccessToken, nil)
	if accepted.Code != http.StatusOK || decodeResponse[models.Load](t, accepted).AssignedDriver != driver.User.ID {
		t.Fatalf("accept offer status=%d body=%s", accepted.Code, accepted.Body.String())
	}

	sent := requestJSON(t, handler, http.MethodPost, "/api/conversations/"+createdLoads[0].ID+"/messages", driver.AccessToken, map[string]string{"type": "text", "body": "Merhaba, yük hazır mı? 🚚", "clientMessageId": "integration-message-1"})
	sentMessage := decodeResponse[models.Message](t, sent)
	if sent.Code != http.StatusCreated || sentMessage.Body == "" {
		t.Fatalf("send message status=%d body=%s", sent.Code, sent.Body.String())
	}
	duplicate := requestJSON(t, handler, http.MethodPost, "/api/conversations/"+createdLoads[0].ID+"/messages", driver.AccessToken, map[string]string{"type": "text", "body": "Merhaba, yük hazır mı? 🚚", "clientMessageId": "integration-message-1"})
	if duplicate.Code != http.StatusOK || decodeResponse[models.Message](t, duplicate).ID != sentMessage.ID {
		t.Fatal("message idempotency failed")
	}
	emptyMessage := requestJSON(t, handler, http.MethodPost, "/api/conversations/"+createdLoads[0].ID+"/messages", customer.AccessToken, map[string]string{"type": "text", "body": "   "})
	if emptyMessage.Code != http.StatusBadRequest {
		t.Fatalf("empty message status=%d", emptyMessage.Code)
	}
	overlongMessage := requestJSON(t, handler, http.MethodPost, "/api/conversations/"+createdLoads[0].ID+"/messages", customer.AccessToken, map[string]string{"type": "text", "body": strings.Repeat("a", 2001)})
	if overlongMessage.Code != http.StatusBadRequest {
		t.Fatalf("overlong message status=%d", overlongMessage.Code)
	}

	conversationList := requestJSON(t, handler, http.MethodGet, "/api/conversations", customer.AccessToken, nil)
	var conversationResponse struct {
		Items []models.Conversation `json:"items"`
	}
	conversationResponse = decodeResponse[struct {
		Items []models.Conversation `json:"items"`
	}](t, conversationList)
	if len(conversationResponse.Items) != 1 || conversationResponse.Items[0].LoadID != createdLoads[0].ID {
		t.Fatalf("conversation list=%#v", conversationResponse.Items)
	}
	messages := requestJSON(t, handler, http.MethodGet, "/api/conversations/"+createdLoads[0].ID+"/messages", customer.AccessToken, nil)
	var messagesResponse struct {
		Items []models.Message `json:"items"`
	}
	messagesResponse = decodeResponse[struct {
		Items []models.Message `json:"items"`
	}](t, messages)
	if len(messagesResponse.Items) < 3 {
		t.Fatalf("persisted messages=%d body=%s", len(messagesResponse.Items), messages.Body.String())
	}
	unauthorizedConversation := requestJSON(t, handler, http.MethodGet, "/api/conversations/"+createdLoads[0].ID+"/messages", otherCustomer.AccessToken, nil)
	if unauthorizedConversation.Code != http.StatusForbidden {
		t.Fatalf("unauthorized conversation status=%d", unauthorizedConversation.Code)
	}

	// A fresh handler over the same Redis store simulates an API restart: data
	// and tokens remain valid because no flow state is held in process memory.
	restartedAPI := NewWithOptions(redisStore, Options{Secret: integrationTestSecret, PricePerKM: 200, MaxUploadMB: 1})
	restartedAPI.maps = stubMaps{}
	restartedMessages := requestJSON(t, restartedAPI.Routes(), http.MethodGet, "/api/conversations/"+createdLoads[0].ID+"/messages", driver.AccessToken, nil)
	if restartedMessages.Code != http.StatusOK {
		t.Fatalf("messages after API restart status=%d body=%s", restartedMessages.Code, restartedMessages.Body.String())
	}
}

func TestStructuredListingTimingOperationsAndFilters(t *testing.T) {
	handler, _ := newFlowTestAPI(t)
	customer := registerTestUser(t, handler, "phase1customer", models.RoleCustomer)
	driver := registerTestUser(t, handler, "phase1driver", models.RoleDriver)

	basePayload := func(title string) map[string]any {
		return map[string]any{
			"title": title, "description": "Ambalajlı ve taşımaya hazır yük.",
			"pickup":     map[string]any{"address": "Bornova, İzmir", "latitude": 38.46, "longitude": 27.21},
			"delivery":   map[string]any{"address": "Konak, İzmir", "latitude": 38.42, "longitude": 27.13},
			"dimensions": map[string]any{"lengthCm": 80, "widthCm": 75, "heightCm": 190, "weightKg": 95},
			"cargoType":  "beyaz_esya", "vehicleType": "kapali_kasa",
			"pickupFloor": 3, "deliveryFloor": 1,
			"pickupElevatorAvailable": true, "deliveryElevatorAvailable": false,
			"helperNeeded": true, "helperCount": 2,
		}
	}

	invalidScheduled := basePayload("Eksik planlı ilan")
	invalidScheduled["urgencyType"] = "scheduled"
	invalidResponse := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, invalidScheduled)
	if invalidResponse.Code != http.StatusBadRequest {
		t.Fatalf("planned listing without scheduledAt status=%d body=%s", invalidResponse.Code, invalidResponse.Body.String())
	}

	createdByUrgency := make(map[models.UrgencyType]models.Load)
	for _, urgency := range []models.UrgencyType{models.UrgencyImmediate, models.UrgencyToday, models.UrgencyScheduled} {
		payload := basePayload("Zaman seçimi " + string(urgency))
		payload["urgencyType"] = urgency
		if urgency == models.UrgencyScheduled {
			payload["scheduledAt"] = time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339)
		}
		createdResponse := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, payload)
		if createdResponse.Code != http.StatusCreated {
			t.Fatalf("create %s listing status=%d body=%s", urgency, createdResponse.Code, createdResponse.Body.String())
		}
		created := decodeResponse[models.Load](t, createdResponse)
		if created.UrgencyType != urgency || created.CargoType != models.CargoTypeWhiteGoods || created.VehicleType != models.VehicleTypeClosedBody {
			t.Fatalf("structured fields not persisted: %#v", created)
		}
		if urgency == models.UrgencyScheduled && created.ScheduledAt == nil {
			t.Fatal("planned listing lost scheduledAt")
		}
		if urgency != models.UrgencyScheduled && created.ScheduledAt != nil {
			t.Fatalf("urgent listing unexpectedly has scheduledAt: %v", created.ScheduledAt)
		}
		published := requestJSON(t, handler, http.MethodPost, "/api/loads/"+created.ID+"/publish", customer.AccessToken, nil)
		if published.Code != http.StatusOK {
			t.Fatalf("publish %s listing status=%d body=%s", urgency, published.Code, published.Body.String())
		}
		createdByUrgency[urgency] = created
	}

	filterPath := "/api/drivers/jobs/nearby?urgencyType=scheduled&cargoType=beyaz_esya&vehicleType=kapali_kasa&helperNeeded=true&pickupElevatorAvailable=true&deliveryElevatorAvailable=false&scheduledFrom=" + url.QueryEscape(time.Now().UTC().Format(time.RFC3339))
	filteredResponse := requestJSON(t, handler, http.MethodGet, filterPath, driver.AccessToken, nil)
	var filtered struct {
		Items []models.Load `json:"items"`
		Total int           `json:"total"`
	}
	filtered = decodeResponse[struct {
		Items []models.Load `json:"items"`
		Total int           `json:"total"`
	}](t, filteredResponse)
	if filteredResponse.Code != http.StatusOK || filtered.Total != 1 || len(filtered.Items) != 1 {
		t.Fatalf("structured filter total=%d items=%d body=%s", filtered.Total, len(filtered.Items), filteredResponse.Body.String())
	}

	planned := createdByUrgency[models.UrgencyScheduled]
	detailResponse := requestJSON(t, handler, http.MethodGet, "/api/loads/"+planned.ID, driver.AccessToken, nil)
	detail := decodeResponse[models.Load](t, detailResponse)
	if detailResponse.Code != http.StatusOK || detail.PickupFloor == nil || *detail.PickupFloor != 3 || detail.DeliveryFloor == nil || *detail.DeliveryFloor != 1 || !detail.PickupElevatorAvailable || detail.DeliveryElevatorAvailable || !detail.HelperNeeded || detail.HelperCount != 2 {
		t.Fatalf("driver operational detail incomplete: %#v", detail)
	}
}

type typeofNormalizedError struct {
	Success bool `json:"success"`
	Error   struct {
		Code string `json:"code"`
	} `json:"error"`
	RequestID string `json:"requestId"`
}

package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
)

func createPublishedStatusTestLoad(t *testing.T, handler http.Handler, customer testSession, title string) models.Load {
	t.Helper()
	created := requestJSON(t, handler, http.MethodPost, "/api/loads", customer.AccessToken, map[string]any{
		"title": title, "description": "Faz 5 durum testi",
		"pickup":      map[string]any{"address": "Bornova, İzmir", "latitude": 38.46, "longitude": 27.21},
		"delivery":    map[string]any{"address": "Konak, İzmir", "latitude": 38.42, "longitude": 27.13},
		"dimensions":  map[string]any{"lengthCm": 80, "widthCm": 60, "heightCm": 50, "weightKg": 40},
		"urgencyType": "immediate", "cargoType": "ticari_yuk", "vehicleType": "kamyonet",
		"pickupFloor": 0, "deliveryFloor": 0,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create load status=%d body=%s", created.Code, created.Body.String())
	}
	load := decodeResponse[models.Load](t, created)
	published := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/publish", customer.AccessToken, nil)
	if published.Code != http.StatusOK {
		t.Fatalf("publish load status=%d body=%s", published.Code, published.Body.String())
	}
	return decodeResponse[models.Load](t, published)
}

func acceptStatusTestOffer(t *testing.T, handler http.Handler, customer, driver testSession, load models.Load) models.Load {
	t.Helper()
	offerResponse := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/offers", driver.AccessToken, map[string]any{
		"amountTl": 3100, "note": "Faz 5", "estimatedArrivalMinutes": 30,
	})
	if offerResponse.Code != http.StatusCreated {
		t.Fatalf("create offer status=%d body=%s", offerResponse.Code, offerResponse.Body.String())
	}
	// Offers are separate data and must not mutate the operational state.
	detail := requestJSON(t, handler, http.MethodGet, "/api/loads/"+load.ID, customer.AccessToken, nil)
	if current := decodeResponse[models.Load](t, detail); current.Status != models.LoadStatusPublished {
		t.Fatalf("offer changed operational status to %q", current.Status)
	}
	offer := decodeResponse[models.Offer](t, offerResponse)
	accepted := requestJSON(t, handler, http.MethodPost, "/api/offers/"+offer.ID+"/accept", customer.AccessToken, nil)
	if accepted.Code != http.StatusOK {
		t.Fatalf("accept offer status=%d body=%s", accepted.Code, accepted.Body.String())
	}
	return decodeResponse[models.Load](t, accepted)
}

func statusHistory(t *testing.T, redisStore *store.RedisStore, loadID string) []models.LoadStatusEvent {
	t.Helper()
	history, err := redisStore.ListLoadStatusHistory(loadID)
	if err != nil {
		t.Fatal(err)
	}
	return history
}

func TestPhaseFiveOperationalStatusFlow(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	customer := registerTestUser(t, handler, "statuscustomer", models.RoleCustomer)
	otherCustomer := registerTestUser(t, handler, "statusothercustomer", models.RoleCustomer)
	driver := registerTestUser(t, handler, "statusdriver", models.RoleDriver)
	otherDriver := registerTestUser(t, handler, "statusotherdriver", models.RoleDriver)

	load := createPublishedStatusTestLoad(t, handler, customer, "Durum zinciri")
	load = acceptStatusTestOffer(t, handler, customer, driver, load)
	if load.Status != models.LoadStatusDriverSelected || load.AssignedDriver != driver.User.ID {
		t.Fatalf("accepted load=%#v", load)
	}
	history := statusHistory(t, redisStore, load.ID)
	if len(history) != 3 {
		t.Fatalf("history after acceptance=%d want 3", len(history))
	}
	acceptance := history[len(history)-1]
	if acceptance.FromStatus != models.LoadStatusPublished || acceptance.ToStatus != models.LoadStatusDriverSelected ||
		acceptance.Source != models.LoadStatusSourceOfferAcceptance || acceptance.ChangedByUserID != customer.User.ID ||
		acceptance.ChangedByRole != models.RoleCustomer || acceptance.ChangedAt.IsZero() {
		t.Fatalf("acceptance history incomplete: %#v", acceptance)
	}

	beforeUnauthorized := len(history)
	unauthorizedDriver := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", otherDriver.AccessToken, map[string]string{"status": models.LoadStatusDriverEnRoute})
	if unauthorizedDriver.Code != http.StatusForbidden {
		t.Fatalf("unassigned driver status=%d body=%s", unauthorizedDriver.Code, unauthorizedDriver.Body.String())
	}
	unauthorizedCustomer := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", otherCustomer.AccessToken, map[string]string{"status": models.LoadStatusCancelled})
	if unauthorizedCustomer.Code != http.StatusForbidden {
		t.Fatalf("other customer status=%d body=%s", unauthorizedCustomer.Code, unauthorizedCustomer.Body.String())
	}
	if got := len(statusHistory(t, redisStore, load.ID)); got != beforeUnauthorized {
		t.Fatalf("unauthorized requests created history: %d -> %d", beforeUnauthorized, got)
	}

	jump := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": models.LoadStatusDelivered})
	if jump.Code != http.StatusConflict {
		t.Fatalf("status jump=%d body=%s", jump.Code, jump.Body.String())
	}
	duplicate := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": models.LoadStatusDriverSelected})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("same status=%d body=%s", duplicate.Code, duplicate.Body.String())
	}
	if got := len(statusHistory(t, redisStore, load.ID)); got != beforeUnauthorized {
		t.Fatalf("invalid requests created history: %d -> %d", beforeUnauthorized, got)
	}

	chain := []string{
		models.LoadStatusDriverEnRoute,
		models.LoadStatusAtPickup,
		models.LoadStatusPickedUp,
		models.LoadStatusEnRouteToDelivery,
		models.LoadStatusDelivered,
	}
	for index, next := range chain {
		if next == models.LoadStatusPickedUp {
			skip := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": models.LoadStatusCompleted})
			if skip.Code != http.StatusBadRequest {
				t.Fatalf("picked-up skip precondition status=%d body=%s", skip.Code, skip.Body.String())
			}
		}
		response := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": next})
		if response.Code != http.StatusOK {
			t.Fatalf("chain[%d] %s status=%d body=%s", index, next, response.Code, response.Body.String())
		}
		updated := decodeResponse[models.Load](t, response)
		if updated.Status != next {
			t.Fatalf("chain[%d] got=%q want=%q", index, updated.Status, next)
		}
	}

	deliveredHistory := statusHistory(t, redisStore, load.ID)
	if len(deliveredHistory) != beforeUnauthorized+len(chain) {
		t.Fatalf("delivered history=%d want %d", len(deliveredHistory), beforeUnauthorized+len(chain))
	}
	for index, event := range deliveredHistory {
		if event.ID == "" || event.LoadID != load.ID || event.ToStatus == "" || event.ChangedAt.IsZero() || event.ChangedByRole == "" || event.Source == "" {
			t.Fatalf("history[%d] incomplete: %#v", index, event)
		}
		if index > 0 && event.ChangedAt.Before(deliveredHistory[index-1].ChangedAt) {
			t.Fatalf("history not chronological at %d: %#v", index, deliveredHistory)
		}
	}
	terminal := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": models.LoadStatusDelivered})
	if terminal.Code != http.StatusConflict {
		t.Fatalf("completed terminal status=%d body=%s", terminal.Code, terminal.Body.String())
	}
	repeatedCompleted := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": models.LoadStatusCompleted})
	if repeatedCompleted.Code != http.StatusBadRequest || len(statusHistory(t, redisStore, load.ID)) != len(deliveredHistory) {
		t.Fatalf("repeated completed status=%d history=%d", repeatedCompleted.Code, len(statusHistory(t, redisStore, load.ID)))
	}
}

func TestPhaseFiveCancelledTerminalAndLegacyRecords(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	customer := registerTestUser(t, handler, "statuslegacycustomer", models.RoleCustomer)

	cancelledLoad := createPublishedStatusTestLoad(t, handler, customer, "İptal terminali")
	cancelled := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+cancelledLoad.ID+"/status", customer.AccessToken, map[string]string{"status": models.LoadStatusCancelled})
	if cancelled.Code != http.StatusOK || decodeResponse[models.Load](t, cancelled).Status != models.LoadStatusCancelled {
		t.Fatalf("cancel status=%d body=%s", cancelled.Code, cancelled.Body.String())
	}
	historyCount := len(statusHistory(t, redisStore, cancelledLoad.ID))
	repeated := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+cancelledLoad.ID+"/status", customer.AccessToken, map[string]string{"status": models.LoadStatusCancelled})
	if repeated.Code != http.StatusConflict || len(statusHistory(t, redisStore, cancelledLoad.ID)) != historyCount {
		t.Fatalf("cancelled terminal status=%d history=%d", repeated.Code, len(statusHistory(t, redisStore, cancelledLoad.ID)))
	}

	for legacy, canonical := range map[string]string{
		models.LoadStatusOpenLegacy:     models.LoadStatusPublished,
		models.LoadStatusOffersReceived: models.LoadStatusPublished,
		models.LoadStatusInTransit:      models.LoadStatusEnRouteToDelivery,
	} {
		legacyLoad := models.Load{
			ID: "legacy-" + legacy, CustomerID: customer.User.ID, Title: "Legacy " + legacy,
			Status: legacy, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
		}
		if err := redisStore.SaveLoad(legacyLoad); err != nil {
			t.Fatal(err)
		}
		response := requestJSON(t, handler, http.MethodGet, "/api/loads/"+legacyLoad.ID, customer.AccessToken, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("legacy %s status=%d body=%s", legacy, response.Code, response.Body.String())
		}
		if got := decodeResponse[models.Load](t, response).Status; got != canonical {
			t.Fatalf("legacy %s normalized=%s want=%s", legacy, got, canonical)
		}
		if history := statusHistory(t, redisStore, legacyLoad.ID); len(history) != 0 {
			t.Fatalf("legacy %s received invented history: %#v", legacy, history)
		}
	}
}

func TestPhaseFiveConcurrentTransitionCreatesOneHistoryEvent(t *testing.T) {
	handler, redisStore := newFlowTestAPI(t)
	customer := registerTestUser(t, handler, "statusracecustomer", models.RoleCustomer)
	driver := registerTestUser(t, handler, "statusracedriver", models.RoleDriver)
	load := acceptStatusTestOffer(t, handler, customer, driver, createPublishedStatusTestLoad(t, handler, customer, "Eşzamanlı geçiş"))
	before := len(statusHistory(t, redisStore, load.ID))

	statusCodes := make(chan int, 2)
	for range 2 {
		go func() {
			request := httptest.NewRequest(http.MethodPatch, "/api/loads/"+load.ID+"/status", strings.NewReader(`{"status":"driver_en_route"}`))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Authorization", "Bearer "+driver.AccessToken)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			statusCodes <- response.Code
		}()
	}
	counts := map[int]int{}
	for range 2 {
		counts[<-statusCodes]++
	}
	if counts[http.StatusOK] != 1 || counts[http.StatusConflict] != 1 {
		t.Fatalf("concurrent transition status counts=%#v", counts)
	}
	stored, err := redisStore.GetLoad(load.ID)
	if err != nil || stored.Status != models.LoadStatusDriverEnRoute {
		t.Fatalf("stored concurrent result=%#v err=%v", stored, err)
	}
	if after := len(statusHistory(t, redisStore, load.ID)); after != before+1 {
		t.Fatalf("concurrent history %d -> %d", before, after)
	}
}

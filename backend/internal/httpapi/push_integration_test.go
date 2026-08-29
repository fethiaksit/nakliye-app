package httpapi

import (
	"net/http"
	"sync"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
)

type pushEvent struct {
	userID string
	title  string
	data   map[string]string
}

type fakePushSender struct {
	mu     sync.Mutex
	events []pushEvent
}

func (f *fakePushSender) Send(userID, title, _ string, data map[string]string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, pushEvent{userID: userID, title: title, data: data})
	return nil
}

func (f *fakePushSender) take() []pushEvent {
	f.mu.Lock()
	defer f.mu.Unlock()
	events := append([]pushEvent(nil), f.events...)
	f.events = nil
	return events
}

func requirePush(t *testing.T, events []pushEvent, userID, title, eventType, loadID string) pushEvent {
	t.Helper()
	for _, event := range events {
		if event.userID == userID && event.title == title && event.data["type"] == eventType && event.data["loadId"] == loadID {
			return event
		}
	}
	t.Fatalf("push not found user=%s title=%q type=%s load=%s events=%#v", userID, title, eventType, loadID, events)
	return pushEvent{}
}

func TestPushCriticalFlow(t *testing.T) {
	redisServer := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + redisServer.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	sender := &fakePushSender{}
	api := NewWithOptions(redisStore, Options{Secret: integrationTestSecret, PricePerKM: 200, MaxUploadMB: 1, PushSender: sender})
	api.maps = stubMaps{}
	handler := api.Routes()
	customer := registerTestUser(t, handler, "pushcustomer", models.RoleCustomer)
	driver := registerTestUser(t, handler, "pushdriver", models.RoleDriver)

	token := "ExponentPushToken[push-critical-test]"
	for index := 0; index < 2; index++ {
		response := requestJSON(t, handler, http.MethodPost, "/api/push/token", customer.AccessToken, map[string]any{"token": token, "platform": "ios", "userId": driver.User.ID})
		if response.Code != http.StatusCreated {
			t.Fatalf("register token status=%d body=%s", response.Code, response.Body.String())
		}
		registered := decodeResponse[models.PushToken](t, response)
		if registered.UserID != customer.User.ID {
			t.Fatalf("token registered for body userId=%s", registered.UserID)
		}
	}
	tokens, err := redisStore.ListPushTokens(customer.User.ID)
	if err != nil || len(tokens) != 1 {
		t.Fatalf("duplicate token count=%d err=%v", len(tokens), err)
	}

	withoutPreference := createPublishedStatusTestLoad(t, handler, customer, "Bildirim kapalı")
	if events := sender.take(); len(events) != 0 {
		t.Fatalf("nearby preference false sent events=%#v", events)
	}
	_ = withoutPreference
	preference := requestJSON(t, handler, http.MethodPatch, "/api/me", driver.AccessToken, map[string]any{"driverProfile": map[string]any{"nearbyLoadNotifications": true}})
	if preference.Code != http.StatusOK {
		t.Fatalf("enable nearby notifications status=%d body=%s", preference.Code, preference.Body.String())
	}

	load := createPublishedStatusTestLoad(t, handler, customer, "Bildirim açık")
	requirePush(t, sender.take(), driver.User.ID, "Yakınınızda yeni nakliye", "nearby_load", load.ID)

	offerResponse := requestJSON(t, handler, http.MethodPost, "/api/loads/"+load.ID+"/offers", driver.AccessToken, map[string]any{"amountTl": 3200, "note": "Uygun", "estimatedArrivalMinutes": 30})
	if offerResponse.Code != http.StatusCreated {
		t.Fatalf("create offer status=%d body=%s", offerResponse.Code, offerResponse.Body.String())
	}
	offer := decodeResponse[models.Offer](t, offerResponse)
	requirePush(t, sender.take(), customer.User.ID, "Yeni teklif", "offer", load.ID)

	accepted := requestJSON(t, handler, http.MethodPost, "/api/offers/"+offer.ID+"/accept", customer.AccessToken, nil)
	if accepted.Code != http.StatusOK {
		t.Fatalf("accept offer status=%d body=%s", accepted.Code, accepted.Body.String())
	}
	requirePush(t, sender.take(), driver.User.ID, "Teklifiniz kabul edildi", "driver_selected", load.ID)

	message := requestJSON(t, handler, http.MethodPost, "/api/conversations/"+load.ID+"/messages", driver.AccessToken, map[string]string{"type": "text", "body": "Yola çıkıyorum", "clientMessageId": "push-message-1"})
	if message.Code != http.StatusCreated {
		t.Fatalf("send message status=%d body=%s", message.Code, message.Body.String())
	}
	messagePush := requirePush(t, sender.take(), customer.User.ID, "Yeni mesaj", "message", load.ID)
	if messagePush.data["conversationId"] != load.ID || messagePush.data["screen"] != "conversation" {
		t.Fatalf("message payload=%#v", messagePush.data)
	}
	duplicate := requestJSON(t, handler, http.MethodPost, "/api/conversations/"+load.ID+"/messages", driver.AccessToken, map[string]string{"type": "text", "body": "Yola çıkıyorum", "clientMessageId": "push-message-1"})
	if duplicate.Code != http.StatusOK || len(sender.take()) != 0 {
		t.Fatal("duplicate message sent a push")
	}

	statusTitles := map[string]string{
		models.LoadStatusDriverEnRoute: "Şoför yola çıktı",
		models.LoadStatusAtPickup:      "Şoför yükleme noktasında",
		models.LoadStatusPickedUp:      "Yükünüz alındı",
		models.LoadStatusDelivered:     "Yük teslim edildi",
	}
	for _, status := range []string{models.LoadStatusDriverEnRoute, models.LoadStatusAtPickup, models.LoadStatusPickedUp, models.LoadStatusEnRouteToDelivery, models.LoadStatusDelivered} {
		response := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": status})
		if response.Code != http.StatusOK {
			t.Fatalf("status %s code=%d body=%s", status, response.Code, response.Body.String())
		}
		events := sender.take()
		if title := statusTitles[status]; title != "" {
			event := requirePush(t, events, customer.User.ID, title, "load_status", load.ID)
			if event.data["status"] != status || event.data["screen"] != "load" {
				t.Fatalf("status payload=%#v", event.data)
			}
		} else if len(events) != 0 {
			t.Fatalf("unexpected status push=%#v", events)
		}
	}
	completed := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+load.ID+"/status", driver.AccessToken, map[string]string{"status": models.LoadStatusCompleted})
	if completed.Code != http.StatusOK {
		t.Fatalf("complete status=%d body=%s", completed.Code, completed.Body.String())
	}
	completionEvents := sender.take()
	requirePush(t, completionEvents, customer.User.ID, "Nakliye tamamlandı", "load_status", load.ID)
	requirePush(t, completionEvents, driver.User.ID, "Nakliye tamamlandı", "load_status", load.ID)

	cancelLoad := createPublishedStatusTestLoad(t, handler, customer, "İptal bildirimi")
	sender.take()
	cancelLoad = acceptStatusTestOffer(t, handler, customer, driver, cancelLoad)
	sender.take()
	cancelled := requestJSON(t, handler, http.MethodPatch, "/api/loads/"+cancelLoad.ID+"/status", customer.AccessToken, map[string]string{"status": models.LoadStatusCancelled})
	if cancelled.Code != http.StatusOK {
		t.Fatalf("cancel status=%d body=%s", cancelled.Code, cancelled.Body.String())
	}
	requirePush(t, sender.take(), driver.User.ID, "Nakliye iptal edildi", "load_status", cancelLoad.ID)
}

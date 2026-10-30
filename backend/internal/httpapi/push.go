package httpapi

import (
	"log"
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type PushSender interface {
	Send(userID, title, body string, data map[string]string) error
}

func (a *API) sendPush(userID, title, body string, data map[string]string) {
	if userID == "" || a.push == nil {
		return
	}
	if eventID := data["eventId"]; eventID != "" {
		first, err := a.store.MarkPushOnce(userID + ":" + eventID)
		if err != nil || !first {
			if err != nil {
				log.Printf("push event claim failed: %v", err)
			}
			return
		}
	}
	if err := a.push.Send(userID, title, body, data); err != nil {
		log.Printf("push notification failed user=%s type=%s: %v", userID, data["type"], err)
	}
}

func validExpoPushToken(value string) bool {
	return (strings.HasPrefix(value, "ExponentPushToken[") || strings.HasPrefix(value, "ExpoPushToken[")) && strings.HasSuffix(value, "]") && !strings.ContainsAny(value, " \t\r\n")
}

func (a *API) registerPushToken(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Token     string `json:"token"`
		Platform  string `json:"platform"`
		ProjectID string `json:"projectId"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Token = strings.TrimSpace(request.Token)
	request.Platform = strings.ToLower(strings.TrimSpace(request.Platform))
	if !validExpoPushToken(request.Token) || (request.Platform != "ios" && request.Platform != "android") {
		badRequest(w, "geçerli Expo push token ve platform zorunludur")
		return
	}
	token := models.PushToken{ProjectID: request.ProjectID, UserID: current(r).ID, ExpoPushToken: request.Token, Platform: request.Platform, UpdatedAt: time.Now().UTC()}
	if err := a.store.SavePushToken(token); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusCreated, token)
}

func (a *API) deletePushToken(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Token = strings.TrimSpace(request.Token)
	if !validExpoPushToken(request.Token) {
		badRequest(w, "geçerli Expo push token zorunludur")
		return
	}
	if err := a.store.DeletePushToken(current(r).ID, request.Token); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func shortPushPreview(message models.Message) string {
	preview := strings.TrimSpace(message.Body)
	if preview == "" {
		preview = map[string]string{"image": "Fotoğraf", "location": "Konum", "load": "İlan bilgisi"}[message.Type]
	}
	if preview == "" {
		preview = "Mesaj"
	}
	if utf8.RuneCountInString(preview) > 80 {
		preview = string([]rune(preview)[:80]) + "…"
	}
	return preview
}

func (a *API) pushLoadStatus(load models.Load, actorID string) {
	title := map[string]string{
		models.LoadStatusDriverEnRoute: "Şoför yola çıktı",
		models.LoadStatusAtPickup:      "Şoför yükleme noktasında",
		models.LoadStatusPickedUp:      "Yükünüz alındı",
		models.LoadStatusDelivered:     "Yük teslim edildi",
		models.LoadStatusCompleted:     "Nakliye tamamlandı",
		models.LoadStatusCancelled:     "Nakliye iptal edildi",
	}[load.Status]
	if title == "" {
		return
	}
	data := map[string]string{"type": "load_status", "status": load.Status, "loadId": load.ID, "screen": "load", "eventId": "status:" + load.ID + ":" + load.Status + ":" + load.UpdatedAt.UTC().Format(time.RFC3339Nano)}
	if load.Status == models.LoadStatusCompleted {
		a.sendPush(load.CustomerID, title, title, data)
		a.sendPush(load.AssignedDriver, title, title, data)
		return
	}
	if load.Status == models.LoadStatusCancelled {
		recipientID := load.CustomerID
		if actorID == load.CustomerID {
			recipientID = load.AssignedDriver
		}
		a.sendPush(recipientID, title, title, data)
		return
	}
	a.sendPush(load.CustomerID, title, title, data)
}

func (a *API) pushNearbyLoad(load models.Load) {
	users, err := a.store.ListAllUsers()
	if err != nil {
		log.Printf("nearby push users could not be listed: %v", err)
		return
	}
	for _, user := range users {
		if user.Role != models.RoleDriver || !user.DriverProfile.NearbyLoadNotifications {
			continue
		}
		visible, _, listErr := a.store.ListDriverLoads(user.ID, store.LoadFilter{}, 0, 0)
		if listErr != nil {
			log.Printf("nearby push visibility failed driver=%s: %v", user.ID, listErr)
			continue
		}
		matches := false
		for _, candidate := range visible {
			if candidate.ID == load.ID {
				matches = true
				break
			}
		}
		if !matches {
			continue
		}
		first, markErr := a.store.MarkPushOnce("nearby:" + load.ID + ":" + user.ID)
		if markErr != nil || !first {
			if markErr != nil {
				log.Printf("nearby push dedupe failed driver=%s load=%s: %v", user.ID, load.ID, markErr)
			}
			continue
		}
		a.sendPush(user.ID, "Yakınınızda yeni nakliye", "Yeni bir nakliye ilanı yayınlandı.", map[string]string{"type": "nearby_load", "loadId": load.ID, "screen": "load"})
	}
}

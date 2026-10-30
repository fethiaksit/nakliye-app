package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
)

type pushRoundTrip func(*http.Request) (*http.Response, error)

func (f pushRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestExpoPushTicketCleansInvalidTokenWithoutSkippingOtherTickets(t *testing.T) {
	_, s := newFlowTestAPI(t)
	for _, token := range []string{"ExpoPushToken[bad]", "ExpoPushToken[good]"} {
		if err := s.SavePushToken(models.PushToken{UserID: "driver", ExpoPushToken: token, Platform: "ios", UpdatedAt: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	sender := &expoPushSender{store: s, client: &http.Client{Transport: pushRoundTrip(func(r *http.Request) (*http.Response, error) {
		var messages []map[string]any
		if err := json.NewDecoder(r.Body).Decode(&messages); err != nil {
			t.Fatal(err)
		}
		tickets := make([]map[string]any, len(messages))
		for i, m := range messages {
			if m["to"] == "ExpoPushToken[bad]" {
				tickets[i] = map[string]any{"status": "error", "message": "unregistered", "details": map[string]string{"error": "DeviceNotRegistered"}}
			} else {
				tickets[i] = map[string]any{"status": "ok", "id": "receipt-good"}
			}
		}
		body, _ := json.Marshal(map[string]any{"data": tickets})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(body)))}, nil
	})}}
	_ = sender.Send("driver", "Title", "Body", map[string]string{"screen": "load", "loadId": "load"})
	tokens, err := s.ListPushTokens("driver")
	if err != nil || len(tokens) != 1 || tokens[0].ExpoPushToken != "ExpoPushToken[good]" {
		t.Fatalf("invalid token retained: %#v %v", tokens, err)
	}
}

func TestCorporatePaymentPushBothDecisions(t *testing.T) {
	for _, accept := range []bool{true, false} {
		t.Run(map[bool]string{true: "accept", false: "reject"}[accept], func(t *testing.T) {
			h, s := newFlowTestAPI(t)
			// Recover the API with the same store so the real HTTP flow uses a recorder.
			sender := &fakePushSender{}
			a := NewWithOptions(s, Options{AdminEmail: adminTestEmail, AdminPassword: adminTestPassword, AdminSecret: adminTestSecret, Secret: integrationTestSecret, PricePerKM: 50, MaxUploadMB: 1, PushSender: sender})
			a.maps = stubMaps{}
			h = a.Routes()
			c := registerCorporateTestUser(t, h, "push_consent_c")
			d := registerTestUser(t, h, "push_consent_d", models.RoleDriver)
			l := corporateOfferedLoad(t, h, c, d, "Ödeme bildirimi", 4100)
			sender.take()
			r := requestJSON(t, h, "POST", "/api/offers/"+pendingOfferID(t, h, c, l)+"/accept", c.AccessToken, nil)
			pending := decodeResponse[models.Load](t, r)
			requirePush(t, sender.take(), d.User.ID, "Kurumsal nakliye — ödeme onayı", "payment_approval_pending", l.ID)
			r = requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": pending.PaymentApproval.ID, "accept": accept})
			if r.Code != 200 {
				t.Fatal(r.Code, r.Body.String())
			}
			events := sender.take()
			typ, title := "payment_approval_rejected", "Şoför ödeme şeklini reddetti"
			if accept {
				typ, title = "payment_approval_approved", "Şoför ödeme şeklini onayladı"
			}
			requirePush(t, events, c.User.ID, title, typ, l.ID)
			r = requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": pending.PaymentApproval.ID, "accept": accept})
			if r.Code != 409 || len(sender.take()) != 0 {
				t.Fatal("duplicate decision notified again", r.Code)
			}
		})
	}
}

func TestExpoReceiptsSurviveSenderRestartAndCleanOnlyStaleRegistration(t *testing.T) {
	_, s := newFlowTestAPI(t)
	now := time.Now().UTC()
	token := models.PushToken{UserID: "driver", ExpoPushToken: "ExpoPushToken[receipt]", Platform: "ios", UpdatedAt: now}
	if err := s.SavePushToken(token); err != nil {
		t.Fatal(err)
	}
	calls := 0
	transport := pushRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		body := `{"data":[{"status":"ok","id":"ticket-1"}]}`
		if strings.HasSuffix(r.URL.Path, "getReceipts") {
			body = `{"data":{"ticket-1":{"status":"error","details":{"error":"DeviceNotRegistered"}}}}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	sender := &expoPushSender{store: s, client: &http.Client{Transport: transport}}
	if err := sender.Send("driver", "title", "body", nil); err != nil {
		t.Fatal(err)
	}
	if err := sender.CheckReceipts(now); err != nil || calls != 1 {
		t.Fatal("checked before receipt was due", calls, err)
	}
	// A new sender has no in-memory ticket state; the queued record must persist.
	restarted := &expoPushSender{store: s, client: &http.Client{Transport: transport}}
	if err := restarted.CheckReceipts(now.Add(16 * time.Minute)); err == nil {
		t.Fatal("receipt error not reported")
	}
	tokens, _ := s.ListPushTokens("driver")
	if len(tokens) != 0 {
		t.Fatal("invalid registration retained")
	}
	if records, err := s.DuePushReceipts(now.Add(time.Hour)); err != nil || len(records) != 0 {
		t.Fatal("receipt not removed", records, err)
	}
	// An old receipt must not remove a registration transferred to another account.
	if err := s.SavePushReceipt(store.PushReceipt{ID: "ticket-1", Token: token, CreatedAt: now, NextCheckAt: now}); err != nil {
		t.Fatal(err)
	}
	token.UserID = "new-owner"
	token.UpdatedAt = now.Add(time.Second)
	if err := s.SavePushToken(token); err != nil {
		t.Fatal(err)
	}
	_ = restarted.CheckReceipts(now.Add(time.Minute))
	tokens, _ = s.ListPushTokens("new-owner")
	if len(tokens) != 1 {
		t.Fatal("late receipt deleted new owner")
	}
	if err := s.RevokeAllUserPushTokens("driver"); err != nil {
		t.Fatal(err)
	}
	tokens, _ = s.ListPushTokens("new-owner")
	if len(tokens) != 1 {
		t.Fatal("old logout deleted new owner")
	}
}

func TestExpoMissingReceiptRetriesWithoutResendingAndCredentialErrorRetainsToken(t *testing.T) {
	_, s := newFlowTestAPI(t)
	now := time.Now().UTC()
	token := models.PushToken{UserID: "driver", ExpoPushToken: "ExpoPushToken[credentials]", Platform: "ios", UpdatedAt: now}
	if err := s.SavePushToken(token); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePushReceipt(store.PushReceipt{ID: "ticket-2", Token: token, CreatedAt: now, NextCheckAt: now}); err != nil {
		t.Fatal(err)
	}
	calls := 0
	sender := &expoPushSender{store: s, client: &http.Client{Transport: pushRoundTrip(func(r *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(r.URL.Path, "getReceipts") {
			t.Fatal("receipt retry resent notification")
		}
		calls++
		body := `{"data":{}}`
		if calls == 2 {
			body = `{"data":{"ticket-2":{"status":"error","details":{"error":"InvalidCredentials"}}}}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}}
	if err := sender.CheckReceipts(now); err != nil {
		t.Fatal(err)
	}
	due, _ := s.DuePushReceipts(now)
	if len(due) != 0 {
		t.Fatal("missing receipt not delayed")
	}
	due, _ = s.DuePushReceipts(now.Add(16 * time.Minute))
	if len(due) != 1 {
		t.Fatal("missing receipt lost")
	}
	if err := sender.CheckReceipts(now.Add(16 * time.Minute)); err == nil || !strings.Contains(err.Error(), "InvalidCredentials") {
		t.Fatal("credential failure hidden", err)
	}
	tokens, _ := s.ListPushTokens("driver")
	if len(tokens) != 1 {
		t.Fatal("credential error removed valid token")
	}
}

func TestExpoBatchesByProjectAndHandlesHTTPFailures(t *testing.T) {
	_, s := newFlowTestAPI(t)
	for i := 0; i < 102; i++ {
		project := "project-a"
		if i == 101 {
			project = "project-b"
		}
		token := models.PushToken{UserID: "customer", ExpoPushToken: fmt.Sprintf("ExpoPushToken[%d]", i), ProjectID: project, Platform: "ios", UpdatedAt: time.Now()}
		if err := s.SavePushToken(token); err != nil {
			t.Fatal(err)
		}
	}
	calls, total := 0, 0
	sender := &expoPushSender{store: s, client: &http.Client{Transport: pushRoundTrip(func(r *http.Request) (*http.Response, error) {
		var messages []map[string]any
		if err := json.NewDecoder(r.Body).Decode(&messages); err != nil {
			t.Fatal(err)
		}
		if len(messages) > 100 {
			t.Fatal("oversized Expo batch")
		}
		calls++
		total += len(messages)
		hasOther := false
		for _, m := range messages {
			if m["to"] == "ExpoPushToken[101]" {
				hasOther = true
			}
		}
		if hasOther && len(messages) != 1 {
			t.Fatal("mixed EAS projects")
		}
		return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader(`unavailable`))}, nil
	})}}
	if err := sender.Send("customer", "title", "body", nil); err == nil {
		t.Fatal("HTTP failure hidden")
	}
	if calls != 3 || total != 102 {
		t.Fatal("batching lost tokens", calls, total)
	}
}

func TestPushEventDeduplicationIsPerRecipient(t *testing.T) {
	_, s := newFlowTestAPI(t)
	sender := &fakePushSender{}
	a := NewWithOptions(s, Options{Secret: integrationTestSecret, PushSender: sender})
	data := map[string]string{"eventId": "event-1", "screen": "load", "loadId": "load"}
	a.sendPush("driver", "title", "body", data)
	a.sendPush("driver", "title", "body", data)
	a.sendPush("customer", "title", "body", data)
	if events := sender.take(); len(events) != 2 {
		t.Fatal("duplicate or missing recipient", events)
	}
}

type brokenPushSender struct{}

func (brokenPushSender) Send(string, string, string, map[string]string) error {
	return errors.New("Expo unavailable")
}
func TestPushFailureCannotApproveOrBlockPaymentDecision(t *testing.T) {
	_, s := newFlowTestAPI(t)
	a := NewWithOptions(s, Options{AdminEmail: adminTestEmail, AdminPassword: adminTestPassword, AdminSecret: adminTestSecret, Secret: integrationTestSecret, PricePerKM: 50, MaxUploadMB: 1, PushSender: brokenPushSender{}})
	a.maps = stubMaps{}
	h := a.Routes()
	c := registerCorporateTestUser(t, h, "push_offline_c")
	d := registerTestUser(t, h, "push_offline_d", models.RoleDriver)
	l := corporateOfferedLoad(t, h, c, d, "Expo kapalı", 4100)
	r := requestJSON(t, h, "POST", "/api/offers/"+pendingOfferID(t, h, c, l)+"/accept", c.AccessToken, nil)
	if r.Code != 200 {
		t.Fatal("push failure blocked selection", r.Code)
	}
	pending := decodeResponse[models.Load](t, r)
	if pending.Status != "payment_approval_pending" || pending.AssignedDriver != "" {
		t.Fatal("push replaced consent", pending)
	}
	r = requestJSON(t, h, "PATCH", "/api/loads/"+l.ID+"/status", d.AccessToken, map[string]any{"status": "driver_en_route"})
	if r.Code != 403 && r.Code != 409 {
		t.Fatal("failed push bypassed approval", r.Code)
	}
	r = requestJSON(t, h, "POST", "/api/loads/"+l.ID+"/payment-approval", d.AccessToken, map[string]any{"selectionId": pending.PaymentApproval.ID, "accept": true})
	if r.Code != 200 {
		t.Fatal("push failure blocked approval", r.Code)
	}
}

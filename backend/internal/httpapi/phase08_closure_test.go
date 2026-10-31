package httpapi

import (
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
	"net/http"
	"testing"
	"time"
)

func TestDeletedTokenCannotReadRetainedPhoto(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "closure-photo", models.RoleCustomer)
	if err := s.SaveLoad(models.Load{ID: "historical", CustomerID: c.User.ID, Status: models.LoadStatusCompleted, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePhoto("retained", []byte("proof"), "image/jpeg", c.User.ID, "historical"); err != nil {
		t.Fatal(err)
	}
	r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", c.AccessToken, map[string]any{"password": "GucluSifre123"})
	if r.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", r.Code, r.Body.String())
	}
	r = requestJSON(t, h, http.MethodGet, "/api/photos/retained", c.AccessToken, nil)
	if r.Code != http.StatusUnauthorized {
		t.Fatalf("deleted token reads retained file: %d", r.Code)
	}
}

func TestClosureRemovesTransientPersonalDataAndCredentials(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "closure-cleanup", models.RoleCustomer)
	other := registerTestUser(t, h, "closure-other", models.RoleCustomer)
	old, _ := s.GetUser(c.User.ID)
	for _, p := range []struct{ id, owner, load string }{{"orphan", c.User.ID, ""}, {"other", other.User.ID, ""}, {"history", c.User.ID, "history-load"}, {"message-file", c.User.ID, ""}} {
		if err := s.SavePhoto(p.id, []byte("fixture"), "image/jpeg", p.owner, p.load); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.ClaimMessageAttachment("message-file", c.User.ID, "history-load"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveLoad(models.Load{ID: "history-load", CustomerID: c.User.ID, Status: models.LoadStatusCompleted}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveMessage(models.Message{ID: "history-message", LoadID: "history-load", SenderID: c.User.ID, Body: "retained evidence"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePushToken(models.PushToken{UserID: c.User.ID, ExpoPushToken: "ExponentPushToken[closure]"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePasswordResetCode(store.PasswordResetRecord{UserID: c.User.ID, Email: old.Email}, time.Hour); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePasswordResetToken("reset", store.PasswordResetTokenRecord{UserID: c.User.ID, Email: old.Email}, time.Hour); err != nil {
		t.Fatal(err)
	}
	r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", c.AccessToken, map[string]any{"password": "GucluSifre123", "reason": "optional private reason"})
	if r.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", r.Code, r.Body.String())
	}
	if _, _, _, _, err := s.GetPhoto("orphan"); err == nil {
		t.Fatal("orphan upload remains")
	}
	for _, id := range []string{"other", "history", "message-file"} {
		if _, _, _, _, err := s.GetPhoto(id); err != nil {
			t.Fatalf("protected/unrelated file removed: %s", id)
		}
	}
	u, _ := s.GetUser(c.User.ID)
	if u.Email == old.Email || u.Phone == old.Phone || u.PasswordHash != "" || u.DeleteReason != "" {
		t.Fatal("unnecessary primary identity remains")
	}
	if _, err := s.GetUserByEmail(old.Email); err == nil {
		t.Fatal("old email index remains")
	}
	if _, err := s.GetUserByPhone(old.Phone); err == nil {
		t.Fatal("old phone index remains")
	}
	if tokens, err := s.ListPushTokens(c.User.ID); err != nil || len(tokens) != 0 {
		t.Fatal("push connection remains")
	}
	if _, err := s.ConsumeRefresh(c.RefreshToken); err == nil {
		t.Fatal("refresh credential remains")
	}
	if code, err := s.GetPasswordResetCode(old.Email); err != nil || code != nil {
		t.Fatal("reset code remains")
	}
	if token, err := s.ConsumePasswordResetToken("reset"); err != nil || token != nil {
		t.Fatal("reset token remains")
	}
	if _, err := s.GetMessage("history-message"); err != nil {
		t.Fatal("historical message lost")
	}
	for _, path := range []string{"/api/me", "/api/photos/history?token=" + c.AccessToken} {
		r = requestJSON(t, h, http.MethodGet, path, c.AccessToken, nil)
		if r.Code != http.StatusUnauthorized {
			t.Fatalf("closed access %s: %d", path, r.Code)
		}
	}
	r = requestJSON(t, h, http.MethodPost, "/api/auth/refresh", "", map[string]any{"refreshToken": c.RefreshToken})
	if r.Code != http.StatusUnauthorized {
		t.Fatalf("closed refresh: %d", r.Code)
	}
}

func TestDeletionBlocksPositiveWalletWithoutLosingFunds(t *testing.T) {
	h, s := newFlowTestAPI(t)
	d := registerTestUser(t, h, "closure-funded", models.RoleDriver)
	before, _ := s.GetDriverWallet(d.User.ID)
	r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", d.AccessToken, map[string]any{"password": "GucluSifre123"})
	if r.Code != http.StatusBadRequest {
		t.Fatalf("funded deletion: %d", r.Code)
	}
	after, _ := s.GetDriverWallet(d.User.ID)
	if before != after {
		t.Fatal("funds changed on rejected deletion")
	}
	r = requestJSON(t, h, http.MethodGet, "/api/me", d.AccessToken, nil)
	if r.Code != http.StatusOK {
		t.Fatal("rejected deletion revoked access")
	}
}

func TestWithdrawnDeletedBidderDoesNotBlockAnotherDriver(t *testing.T) {
	h, s := newFlowTestAPI(t)
	c := registerTestUser(t, h, "closure-selector", models.RoleCustomer)
	former := registerTestUser(t, h, "closure-former", models.RoleDriver, false)
	next := registerTestUser(t, h, "closure-next", models.RoleDriver)
	l := createPublishedStatusTestLoad(t, h, c, "historical bidder")
	if err := s.SaveOffer(models.Offer{ID: "former-bid", LoadID: l.ID, DriverID: former.User.ID, Status: "withdrawn", AmountTL: 4100}); err != nil {
		t.Fatal(err)
	}
	r := requestJSON(t, h, http.MethodPost, "/api/me/delete-account", former.AccessToken, map[string]any{"password": "GucluSifre123"})
	if r.Code != http.StatusOK {
		t.Fatalf("former closure: %d %s", r.Code, r.Body.String())
	}
	if err := s.SaveOffer(models.Offer{ID: "next-bid", LoadID: l.ID, DriverID: next.User.ID, Status: "pending", AmountTL: 4100}); err != nil {
		t.Fatal(err)
	}
	r = requestJSON(t, h, http.MethodPost, "/api/offers/next-bid/accept", c.AccessToken, nil)
	if r.Code != http.StatusOK {
		t.Fatalf("historical bidder stranded selection: %d %s", r.Code, r.Body.String())
	}
	wallet, err := s.GetDriverWallet(next.User.ID)
	if err != nil || wallet.ReservedCents != 41000 {
		t.Fatalf("current driver commission: %+v %v", wallet, err)
	}
}

package store

import (
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

func newTestStore(t *testing.T) (*RedisStore, *miniredis.Miniredis) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	s, err := New("redis://" + mr.Addr() + "/0")
	if err != nil {
		t.Fatalf("failed to connect to miniredis: %v", err)
	}
	return s, mr
}

func TestPasswordResetStoreRoundTrip(t *testing.T) {
	s, mr := newTestStore(t)
	defer mr.Close()

	email := "test@example.com"
	rec := PasswordResetRecord{
		UserID:     "user-1",
		Email:      email,
		HashedCode: "hashed123",
		Role:       "customer",
		CreatedAt:  time.Now().UTC(),
		ExpiresAt:  time.Now().UTC().Add(5 * time.Minute),
	}

	if err := s.SavePasswordResetCode(rec, 5*time.Minute); err != nil {
		t.Fatalf("SavePasswordResetCode failed: %v", err)
	}

	got, err := s.GetPasswordResetCode(email)
	if err != nil || got == nil {
		t.Fatalf("GetPasswordResetCode failed: got=%v, err=%v", got, err)
	}
	if got.HashedCode != "hashed123" || got.UserID != "user-1" {
		t.Fatalf("unexpected record: %+v", got)
	}

	attempts, err := s.IncrementResetAttempts(email)
	if err != nil || attempts != 1 {
		t.Fatalf("IncrementResetAttempts failed: attempts=%d, err=%v", attempts, err)
	}

	attempts, err = s.IncrementResetAttempts(email)
	if err != nil || attempts != 2 {
		t.Fatalf("IncrementResetAttempts second call failed: attempts=%d, err=%v", attempts, err)
	}

	if err := s.DeletePasswordResetCode(email); err != nil {
		t.Fatalf("DeletePasswordResetCode failed: %v", err)
	}

	deleted, err := s.GetPasswordResetCode(email)
	if err != nil || deleted != nil {
		t.Fatalf("expected nil after delete, got=%v, err=%v", deleted, err)
	}
}

func TestPasswordResetTokenConsume(t *testing.T) {
	s, mr := newTestStore(t)
	defer mr.Close()

	token := "reset-token-xyz"
	rec := PasswordResetTokenRecord{
		UserID:    "user-99",
		Email:     "user99@example.com",
		CreatedAt: time.Now().UTC(),
	}

	if err := s.SavePasswordResetToken(token, rec, 10*time.Minute); err != nil {
		t.Fatalf("SavePasswordResetToken failed: %v", err)
	}

	consumed, err := s.ConsumePasswordResetToken(token)
	if err != nil || consumed == nil {
		t.Fatalf("ConsumePasswordResetToken failed: got=%v, err=%v", consumed, err)
	}
	if consumed.UserID != "user-99" || consumed.Email != "user99@example.com" {
		t.Fatalf("unexpected consumed token: %+v", consumed)
	}

	consumedAgain, err := s.ConsumePasswordResetToken(token)
	if err != nil || consumedAgain != nil {
		t.Fatalf("expected nil on second consume, got=%v, err=%v", consumedAgain, err)
	}
}

func TestRevokeAllUserSessions(t *testing.T) {
	s, mr := newTestStore(t)
	defer mr.Close()

	userID := "user-sessions"
	token1 := "tok-1"
	token2 := "tok-2"

	if err := s.SaveRefresh(token1, userID, 24*time.Hour); err != nil {
		t.Fatalf("SaveRefresh failed: %v", err)
	}
	if err := s.SaveRefresh(token2, userID, 24*time.Hour); err != nil {
		t.Fatalf("SaveRefresh failed: %v", err)
	}

	if err := s.RevokeAllUserSessions(userID); err != nil {
		t.Fatalf("RevokeAllUserSessions failed: %v", err)
	}

	consumed1, err := s.ConsumeRefresh(token1)
	if err == nil || consumed1 != "" {
		t.Fatalf("expected token1 to be revoked, got %s", consumed1)
	}
	consumed2, err := s.ConsumeRefresh(token2)
	if err == nil || consumed2 != "" {
		t.Fatalf("expected token2 to be revoked, got %s", consumed2)
	}
}

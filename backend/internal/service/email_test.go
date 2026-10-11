package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResendClientSuccess(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-api-key" {
			t.Errorf("expected Bearer test-api-key, got %s", r.Header.Get("Authorization"))
		}
		var req resendRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}
		if req.To[0] != "user@example.com" {
			t.Errorf("expected user@example.com, got %s", req.To[0])
		}
		if req.From != "onboarding@resend.dev" {
			t.Errorf("expected onboarding@resend.dev, got %s", req.From)
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "resend-msg-123"})
	}))
	defer ts.Close()

	client := NewResendClient("test-api-key", "onboarding@resend.dev", ts.URL)
	err := client.SendPasswordResetCode(context.Background(), "user@example.com", "654321")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestResendClientErrorResponse(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"statusCode": 422,
			"name":       "validation_error",
			"message":    "Invalid to field",
		})
	}))
	defer ts.Close()

	client := NewResendClient("test-api-key", "onboarding@resend.dev", ts.URL)
	err := client.SendPasswordResetCode(context.Background(), "invalid@example.com", "123456")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestMockEmailSender(t *testing.T) {
	mock := NewMockEmailSender()
	err := mock.SendPasswordResetCode(context.Background(), "test@test.com", "112233")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mock.TotalSent() != 1 {
		t.Errorf("expected 1 sent, got %d", mock.TotalSent())
	}
	if mock.LastSentCode("test@test.com") != "112233" {
		t.Errorf("expected 112233, got %s", mock.LastSentCode("test@test.com"))
	}
}

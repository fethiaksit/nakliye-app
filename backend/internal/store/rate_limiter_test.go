package store

import (
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

func TestAllowRateLimit_SlidingWindow(t *testing.T) {
	r := miniredis.RunT(t)
	s, err := New("redis://" + r.Addr())
	if err != nil {
		t.Fatal(err)
	}

	key := "test_ip:192.168.1.1"
	limit := 3
	window := 10 * time.Second

	// 1st request
	allowed, rem, retryAfter, err := s.AllowRateLimit(key, limit, window)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !allowed || rem != 2 || retryAfter != 0 {
		t.Fatalf("expected allowed=true, rem=2, retryAfter=0; got %v, %d, %d", allowed, rem, retryAfter)
	}

	// 2nd request
	allowed, rem, retryAfter, err = s.AllowRateLimit(key, limit, window)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !allowed || rem != 1 {
		t.Fatalf("expected allowed=true, rem=1; got %v, %d", allowed, rem)
	}

	// 3rd request (limit reached)
	allowed, rem, retryAfter, err = s.AllowRateLimit(key, limit, window)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !allowed || rem != 0 {
		t.Fatalf("expected allowed=true, rem=0; got %v, %d", allowed, rem)
	}

	// 4th request (should be rejected with 429 Retry-After)
	allowed, rem, retryAfter, err = s.AllowRateLimit(key, limit, window)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if allowed {
		t.Fatalf("expected allowed=false; got true")
	}
	if rem != 0 {
		t.Fatalf("expected rem=0; got %d", rem)
	}
	if retryAfter <= 0 {
		t.Fatalf("expected retryAfter > 0; got %d", retryAfter)
	}

	// Advance time past the window
	r.FastForward(11 * time.Second)

	// 5th request (new window, should be allowed)
	allowed, rem, retryAfter, err = s.AllowRateLimit(key, limit, window)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !allowed || rem != 2 {
		t.Fatalf("expected allowed=true, rem=2 after window expiry; got %v, %d", allowed, rem)
	}
}

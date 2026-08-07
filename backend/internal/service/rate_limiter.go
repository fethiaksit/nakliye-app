package service

import (
	"sync"
	"time"
)

type rateLimitEntry struct {
	started time.Time
	count   int
}

// FixedWindowLimiter protects public-provider-backed endpoints from accidental
// request storms while keeping the policy local to this small API service.
type FixedWindowLimiter struct {
	mu      sync.Mutex
	entries map[string]rateLimitEntry
	limit   int
	window  time.Duration
}

func NewFixedWindowLimiter(limit int, window time.Duration) *FixedWindowLimiter {
	return &FixedWindowLimiter{entries: make(map[string]rateLimitEntry), limit: limit, window: window}
}

func (l *FixedWindowLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	entry := l.entries[key]
	if entry.started.IsZero() || now.Sub(entry.started) >= l.window {
		l.entries[key] = rateLimitEntry{started: now, count: 1}
		return true
	}
	if entry.count >= l.limit {
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
}

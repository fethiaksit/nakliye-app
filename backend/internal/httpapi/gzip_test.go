package httpapi

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGzipMiddleware(t *testing.T) {
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"message":"` + strings.Repeat("hello world ", 50) + `"}`))
	})

	wrapped := gzipMiddleware(testHandler)

	t.Run("Compresses when Accept-Encoding gzip is present", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/listings", nil)
		req.Header.Set("Accept-Encoding", "gzip, deflate")
		rec := httptest.NewRecorder()

		wrapped.ServeHTTP(rec, req)

		if rec.Header().Get("Content-Encoding") != "gzip" {
			t.Fatalf("expected Content-Encoding gzip, got %q", rec.Header().Get("Content-Encoding"))
		}

		gzReader, err := gzip.NewReader(rec.Body)
		if err != nil {
			t.Fatalf("failed to create gzip reader: %v", err)
		}
		defer gzReader.Close()

		decompressed, err := io.ReadAll(gzReader)
		if err != nil {
			t.Fatalf("failed to decompress body: %v", err)
		}

		if !strings.Contains(string(decompressed), "hello world") {
			t.Fatalf("decompressed body missing expected content")
		}
	})

	t.Run("Does not compress when Accept-Encoding is missing", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/listings", nil)
		rec := httptest.NewRecorder()

		wrapped.ServeHTTP(rec, req)

		if rec.Header().Get("Content-Encoding") == "gzip" {
			t.Fatalf("expected no gzip encoding when Accept-Encoding is omitted")
		}
	})

	t.Run("Skips compression on sensitive auth endpoints (BREACH protection)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		rec := httptest.NewRecorder()

		wrapped.ServeHTTP(rec, req)

		if rec.Header().Get("Content-Encoding") == "gzip" {
			t.Fatalf("expected auth endpoints to skip gzip compression")
		}
	})

	t.Run("Skips compression on media photos", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/photos/photo-123", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		rec := httptest.NewRecorder()

		wrapped.ServeHTTP(rec, req)

		if rec.Header().Get("Content-Encoding") == "gzip" {
			t.Fatalf("expected photos to skip gzip compression")
		}
	})
}

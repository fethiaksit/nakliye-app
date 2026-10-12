package httpapi

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

var gzipWriterPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.DefaultCompression)
		return w
	},
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gzWriter *gzip.Writer
	wroteGz  bool
}

func (w *gzipResponseWriter) WriteHeader(code int) {
	if !w.wroteGz {
		w.Header().Del("Content-Length")
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		w.ResponseWriter.WriteHeader(code)
		w.wroteGz = true
	}
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	if !w.wroteGz {
		w.WriteHeader(http.StatusOK)
	}
	return w.gzWriter.Write(b)
}

// gzipMiddleware compresses large non-binary, non-auth responses to reduce mobile bandwidth.
// Skips:
// - Clients that do not accept gzip
// - Sensitive authentication endpoints (to prevent side-channel / BREACH attacks)
// - Binary media streams (photos, which are already compressed JPEG/WebP)
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		path := r.URL.Path
		// Skip authentication endpoints to protect sensitive tokens against BREACH compression analysis
		if strings.HasPrefix(path, "/api/auth/") || strings.HasPrefix(path, "/api/admin/auth/") {
			next.ServeHTTP(w, r)
			return
		}

		// Skip media streams that are already compressed binaries
		if strings.HasPrefix(path, "/api/photos/") {
			next.ServeHTTP(w, r)
			return
		}

		gz := gzipWriterPool.Get().(*gzip.Writer)
		defer gzipWriterPool.Put(gz)

		gz.Reset(w)
		defer gz.Close()

		gzw := &gzipResponseWriter{
			ResponseWriter: w,
			gzWriter:       gz,
		}

		next.ServeHTTP(gzw, r)
	})
}

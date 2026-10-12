package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// SentryClient sends crash and error reports directly to the Sentry HTTP ingest API.
// It requires zero external dependencies, making it safe and clean for the Go backend.
type SentryClient struct {
	dsn         string
	environment string
	release     string
	apiURL      string
	authHeader  string
	httpClient  *http.Client
	sampleRate  float64
	mu          sync.RWMutex
}

type SentryEvent struct {
	EventID     string                 `json:"event_id"`
	Timestamp   string                 `json:"timestamp"`
	Level       string                 `json:"level"`
	Platform    string                 `json:"platform"`
	Logger      string                 `json:"logger,omitempty"`
	Environment string                 `json:"environment"`
	Release     string                 `json:"release,omitempty"`
	ServerName  string                 `json:"server_name,omitempty"`
	Message     *SentryMessage         `json:"message,omitempty"`
	Exception   *SentryExceptionList   `json:"exception,omitempty"`
	Tags        map[string]string      `json:"tags,omitempty"`
	Extra       map[string]any         `json:"extra,omitempty"`
	Request     *SentryRequest         `json:"request,omitempty"`
	User        *SentryUser            `json:"user,omitempty"`
}

type SentryMessage struct {
	Formatted string `json:"formatted"`
}

type SentryExceptionList struct {
	Values []SentryException `json:"values"`
}

type SentryException struct {
	Type       string           `json:"type"`
	Value      string           `json:"value"`
	Stacktrace *SentryStacktrace `json:"stacktrace,omitempty"`
}

type SentryStacktrace struct {
	Frames []SentryFrame `json:"frames"`
}

type SentryFrame struct {
	Function string `json:"function"`
	Filename string `json:"filename,omitempty"`
	Lineno   int    `json:"lineno,omitempty"`
}

type SentryRequest struct {
	URL         string            `json:"url"`
	Method      string            `json:"method"`
	Headers     map[string]string `json:"headers,omitempty"`
	QueryString string            `json:"query_string,omitempty"`
}

type SentryUser struct {
	ID string `json:"id,omitempty"`
}

func NewSentryClient(dsn, environment, release string) *SentryClient {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return &SentryClient{}
	}

	apiURL, authHeader, err := parseSentryDSN(dsn)
	if err != nil {
		log.Printf("[SENTRY CONFIG ERROR] Invalid DSN: %v", err)
		return &SentryClient{}
	}

	if environment == "" {
		environment = "development"
	}

	return &SentryClient{
		dsn:         dsn,
		environment: environment,
		release:     release,
		apiURL:      apiURL,
		authHeader:  authHeader,
		sampleRate:  1.0,
		httpClient: &http.Client{
			Timeout: 4 * time.Second,
		},
	}
}

func (s *SentryClient) Enabled() bool {
	return s != nil && s.dsn != "" && s.apiURL != ""
}

func parseSentryDSN(dsn string) (string, string, error) {
	// Format: https://<key>@<host>/<project_id> or https://<key>:<secret>@<host>/<project_id>
	if !strings.HasPrefix(dsn, "http://") && !strings.HasPrefix(dsn, "https://") {
		return "", "", fmt.Errorf("dsn must start with http:// or https://")
	}

	protoEnd := strings.Index(dsn, "://")
	proto := dsn[:protoEnd]
	rest := dsn[protoEnd+3:]

	atIdx := strings.Index(rest, "@")
	if atIdx == -1 {
		return "", "", fmt.Errorf("missing @ in dsn")
	}

	keySecret := rest[:atIdx]
	hostProject := rest[atIdx+1:]

	key := keySecret
	if colIdx := strings.Index(keySecret, ":"); colIdx != -1 {
		key = keySecret[:colIdx]
	}

	lastSlash := strings.LastIndex(hostProject, "/")
	if lastSlash == -1 {
		return "", "", fmt.Errorf("missing project id in dsn")
	}

	host := hostProject[:lastSlash]
	projectID := hostProject[lastSlash+1:]

	apiURL := fmt.Sprintf("%s://%s/api/%s/store/", proto, host, projectID)
	authHeader := fmt.Sprintf("Sentry sentry_version=7, sentry_client=nakliye-sentry/1.0, sentry_key=%s", key)

	return apiURL, authHeader, nil
}

// CaptureError sends an error event to Sentry with sensitive data filtered.
func (s *SentryClient) CaptureError(ctx context.Context, err error, req *http.Request, tags map[string]string, extra map[string]any) {
	if !s.Enabled() || err == nil {
		return
	}

	event := s.buildEvent("error", err.Error(), req, tags, extra)
	event.Exception = &SentryExceptionList{
		Values: []SentryException{
			{
				Type:  "Error",
				Value: err.Error(),
			},
		},
	}

	go s.send(event)
}

// CapturePanic captures an unhandled panic and sends it as a fatal event to Sentry.
func (s *SentryClient) CapturePanic(ctx context.Context, recovered any, req *http.Request, stackFrames []SentryFrame) {
	if !s.Enabled() || recovered == nil {
		return
	}

	msg := fmt.Sprintf("panic: %v", recovered)
	event := s.buildEvent("fatal", msg, req, nil, nil)
	event.Exception = &SentryExceptionList{
		Values: []SentryException{
			{
				Type:       "Panic",
				Value:      msg,
				Stacktrace: &SentryStacktrace{Frames: stackFrames},
			},
		},
	}

	// Send synchronously on panic before process dies or request ends
	s.send(event)
}

func (s *SentryClient) buildEvent(level, message string, req *http.Request, tags map[string]string, extra map[string]any) SentryEvent {
	now := time.Now().UTC().Format(time.RFC3339)

	sanitizedTags := make(map[string]string)
	for k, v := range tags {
		sanitizedTags[k] = sanitizeSensitive(v)
	}

	sanitizedExtra := make(map[string]any)
	for k, v := range extra {
		sanitizedExtra[k] = v
	}

	event := SentryEvent{
		Timestamp:   now,
		Level:       level,
		Platform:    "go",
		Environment: s.environment,
		Release:     s.release,
		Message:     &SentryMessage{Formatted: message},
		Tags:        sanitizedTags,
		Extra:       sanitizedExtra,
	}

	if req != nil {
		headers := make(map[string]string)
		for k, v := range req.Header {
			lowerK := strings.ToLower(k)
			// SENSITIVE DATA FILTERING: strip authorization, tokens, passwords, cookies
			if lowerK == "authorization" || lowerK == "cookie" || lowerK == "set-cookie" || strings.Contains(lowerK, "secret") {
				headers[k] = "[REDACTED]"
			} else {
				headers[k] = strings.Join(v, ", ")
			}
		}

		cleanQuery := req.URL.Query()
		if cleanQuery.Has("token") {
			cleanQuery.Set("token", "[REDACTED]")
		}

		event.Request = &SentryRequest{
			URL:         req.URL.Path,
			Method:      req.Method,
			Headers:     headers,
			QueryString: cleanQuery.Encode(),
		}
	}

	return event
}

func sanitizeSensitive(val string) string {
	if len(val) > 32 && (strings.HasPrefix(val, "eyJ") || strings.Contains(val, "AIza")) {
		return "[REDACTED]"
	}
	return val
}

func (s *SentryClient) send(event SentryEvent) {
	body, err := json.Marshal(event)
	if err != nil {
		return
	}

	req, err := http.NewRequest(http.MethodPost, s.apiURL, strings.NewReader(string(body)))
	if err != nil {
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Sentry-Auth", s.authHeader)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		log.Printf("[SENTRY SEND ERROR] %v", err)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
}

package service

import (
	"io"
	"log/slog"
	"os"
	"regexp"
	"strings"
)

var (
	emailPattern  = regexp.MustCompile(`([a-zA-Z0-9._%+\-]+)@([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})`)
	phonePattern  = regexp.MustCompile(`(\+?90|0)?(5\d{2})[\s\-]?(\d{3})[\s\-]?(\d{2})[\s\-]?(\d{2})`)
	jwtPattern    = regexp.MustCompile(`eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`)
	bearerPattern = regexp.MustCompile(`(?i)Bearer\s+[A-Za-z0-9._\-+/=]+`)
	apiKeyPattern = regexp.MustCompile(`(AIza[0-9A-Za-z\-_]{20,}|re_[0-9A-Za-z_]{10,})`)
	kvSecretRegex = regexp.MustCompile(`(?i)(password|passwd|secret|token|otp|reset_code|verification_code|api_key|apikey|authorization)=([^\s"&',]+)`)
)

// NewStructuredLogger creates a JSON slog.Logger that automatically masks
// sensitive keys (password, token, otp, secret, api_key, authorization) and
// PII (email, phone) in both attribute keys and string values.
func NewStructuredLogger(w io.Writer) *slog.Logger {
	if w == nil {
		w = os.Stdout
	}
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level:       slog.LevelInfo,
		ReplaceAttr: sanitizeSlogAttr,
	})
	return slog.New(handler)
}

// ConfigureDefaultLogger sets the global slog default (which also bridges standard `log.Printf` output into JSON).
func ConfigureDefaultLogger(w io.Writer) *slog.Logger {
	logger := NewStructuredLogger(w)
	slog.SetDefault(logger)
	return logger
}

func sanitizeSlogAttr(_ []string, a slog.Attr) slog.Attr {
	keyLower := strings.ToLower(a.Key)
	if isSensitiveKey(keyLower) {
		return slog.String(a.Key, "[REDACTED]")
	}
	if keyLower == "email" || strings.HasSuffix(keyLower, "_email") {
		return slog.String(a.Key, MaskEmail(a.Value.String()))
	}
	if keyLower == "phone" || strings.HasSuffix(keyLower, "_phone") {
		return slog.String(a.Key, MaskPhone(a.Value.String()))
	}
	if a.Value.Kind() == slog.KindString {
		return slog.String(a.Key, SanitizeLogString(a.Value.String()))
	}
	return a
}

func isSensitiveKey(k string) bool {
	for _, s := range []string{
		"password",
		"passwd",
		"secret",
		"token",
		"otp",
		"reset_code",
		"resetcode",
		"delivery_code",
		"deliverycode",
		"apikey",
		"api_key",
		"authorization",
		"cookie",
	} {
		if k == s || strings.Contains(k, s) {
			return true
		}
	}
	return false
}

// MaskEmail masks an email address, preserving only the first character and domain (e.g. "a***@example.com").
func MaskEmail(email string) string {
	email = strings.TrimSpace(email)
	at := strings.Index(email, "@")
	if at <= 0 || at == len(email)-1 {
		return "[REDACTED_EMAIL]"
	}
	local := email[:at]
	domain := email[at+1:]
	if len(local) <= 1 {
		return "*@" + domain
	}
	return local[:1] + "***@" + domain
}

// MaskPhone masks a phone number, preserving only the last 2 digits (e.g. "+905*********45").
func MaskPhone(phone string) string {
	trimmed := strings.TrimSpace(phone)
	if len(trimmed) < 4 {
		return "[REDACTED_PHONE]"
	}
	return trimmed[:3] + "*******" + trimmed[len(trimmed)-2:]
}

// SanitizeLogString scrubs inline tokens, API keys, passwords, emails, and phone numbers from free-form log strings.
func SanitizeLogString(s string) string {
	if s == "" {
		return s
	}
	s = bearerPattern.ReplaceAllString(s, "Bearer [REDACTED]")
	s = jwtPattern.ReplaceAllString(s, "[REDACTED_JWT]")
	s = apiKeyPattern.ReplaceAllString(s, "[REDACTED_API_KEY]")
	s = kvSecretRegex.ReplaceAllString(s, "$1=[REDACTED]")
	s = emailPattern.ReplaceAllStringFunc(s, MaskEmail)
	s = phonePattern.ReplaceAllStringFunc(s, MaskPhone)
	return s
}

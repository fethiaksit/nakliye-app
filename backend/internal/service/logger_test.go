package service

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestStructuredLoggerMasksSensitiveAttributesAndPII(t *testing.T) {
	var buf bytes.Buffer
	logger := NewStructuredLogger(&buf)

	logger.Info("auth_attempt",
		"request_id", "req-12345",
		"email", "fethi.aksit@nakliyego.com",
		"phone", "+905551234567",
		"password", "SuperSecretPassword123!",
		"token", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
		"otp", "849201",
		"api_key", "re_1234567890abcdef",
		"detail", "failed for user fethi@example.com with Bearer secret-token-value and password=mySecretPassword",
	)

	raw := buf.String()
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatalf("expected valid JSON log line, got error %v: %s", err, raw)
	}

	if parsed["request_id"] != "req-12345" {
		t.Fatalf("expected request_id req-12345, got %v", parsed["request_id"])
	}

	for _, forbidden := range []string{
		"SuperSecretPassword123!",
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
		"849201",
		"re_1234567890abcdef",
		"fethi.aksit@nakliyego.com",
		"+905551234567",
		"fethi@example.com",
		"secret-token-value",
		"mySecretPassword",
	} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("structured log leaked sensitive value %q in output: %s", forbidden, raw)
		}
	}

	if parsed["password"] != "[REDACTED]" || parsed["token"] != "[REDACTED]" || parsed["otp"] != "[REDACTED]" || parsed["api_key"] != "[REDACTED]" {
		t.Fatalf("expected sensitive keys to be [REDACTED], got: %#v", parsed)
	}
}

package config

import "testing"

func TestGoogleMapsServerAPIKeyValidation(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantKey string
		wantErr bool
	}{
		{name: "missing", wantErr: true},
		{name: "leading whitespace", raw: " key", wantErr: true},
		{name: "quoted", raw: "'key'", wantErr: true},
		{name: "valid", raw: "google-server-test-key", wantKey: "google-server-test-key"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			key, errText := googleMapsServerAPIKey(test.raw)
			if (errText != "") != test.wantErr || key != test.wantKey {
				t.Fatalf("googleMapsServerAPIKey(%q) = (%q, %q)", test.raw, key, errText)
			}
		})
	}
}

func TestValidateRequiresStrongRuntimeConfiguration(t *testing.T) {
	valid := Config{RedisURL: "redis://localhost:6379/0", Port: "8080", JWTSecret: "a-secret-that-is-at-least-32-characters", Environment: "development"}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid config failed: %v", err)
	}
	for name, mutate := range map[string]func(*Config){
		"missing JWT secret": func(config *Config) { config.JWTSecret = "" },
		"invalid port":       func(config *Config) { config.Port = "70000" },
		"invalid environment": func(config *Config) {
			config.Environment = "prodution"
		},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			mutate(&config)
			if err := config.Validate(); err == nil {
				t.Fatal("expected a configuration error")
			}
		})
	}
}

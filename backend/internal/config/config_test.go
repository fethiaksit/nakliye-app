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

func TestValidateKeepsAdminCredentialsInSeparateSecurityDomain(t *testing.T) {
	validArgon2Hash := "$argon2id$v=19$m=65536,t=3,p=2$MDEyMzQ1Njc4OWFiY2RlZg$MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"
	base := Config{
		RedisURL:       "redis://localhost:6379/0",
		Port:           "8080",
		JWTSecret:      "mobile-secret-that-is-at-least-32-characters",
		Environment:    "production",
		AdminEmail:     "operations@example.com",
		AdminPassword:  "a-strong-admin-password",
		AdminJWTSecret: "separate-admin-secret-that-is-at-least-32",
	}
	if err := base.Validate(); err != nil {
		t.Fatalf("valid admin config failed: %v", err)
	}

	hashConfig := base
	hashConfig.AdminPassword = ""
	hashConfig.AdminPasswordHash = validArgon2Hash
	if err := hashConfig.Validate(); err != nil {
		t.Fatalf("valid admin hash config failed: %v", err)
	}

	for name, mutate := range map[string]func(*Config){
		"missing admin in production": func(config *Config) {
			config.AdminEmail = ""
			config.AdminPassword = ""
			config.AdminJWTSecret = ""
		},
		"missing admin email in production": func(config *Config) {
			config.AdminEmail = ""
		},
		"missing admin jwt secret in production": func(config *Config) {
			config.AdminJWTSecret = ""
		},
		"missing admin password and hash in production": func(config *Config) {
			config.AdminPassword = ""
			config.AdminPasswordHash = ""
		},
		"partial credentials": func(config *Config) {
			config.AdminPassword = ""
			config.AdminJWTSecret = ""
		},
		"invalid admin email format": func(config *Config) {
			config.AdminEmail = "invalid@"
		},
		"invalid admin email without domain dot": func(config *Config) {
			config.AdminEmail = "admin@localhost"
		},
		"shared JWT secret": func(config *Config) {
			config.AdminJWTSecret = config.JWTSecret
		},
		"short admin JWT secret": func(config *Config) {
			config.AdminJWTSecret = "short-admin-secret"
		},
		"short password": func(config *Config) {
			config.AdminPassword = "short"
		},
		"whitespace padded short password": func(config *Config) {
			config.AdminPassword = "   short    "
		},
		"password equal to admin email": func(config *Config) {
			config.AdminPassword = config.AdminEmail
		},
		"placeholder admin password in production": func(config *Config) {
			config.AdminPassword = "changeme-admin-password"
		},
		"invalid argon2id prefix": func(config *Config) {
			config.AdminPassword = ""
			config.AdminPasswordHash = "$bcrypt$invalid"
		},
		"malformed argon2id structure": func(config *Config) {
			config.AdminPassword = ""
			config.AdminPasswordHash = "$argon2id$invalid-format"
		},
		"argon2id zero parameters": func(config *Config) {
			config.AdminPassword = ""
			config.AdminPasswordHash = "$argon2id$v=19$m=0,t=0,p=0$MDEyMzQ1Njc4OWFiY2RlZg$MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"
		},
		"argon2id invalid base64 salt": func(config *Config) {
			config.AdminPassword = ""
			config.AdminPasswordHash = "$argon2id$v=19$m=65536,t=3,p=2$not-valid-base64!!!$MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"
		},
		"placeholder JWT secret in production": func(config *Config) {
			config.JWTSecret = "replace-with-at-least-32-random-characters"
		},
		"placeholder Admin JWT secret in production": func(config *Config) {
			config.AdminJWTSecret = "replace-with-at-least-32-random-characters-admin"
		},
		"invalid redis url scheme": func(config *Config) {
			config.RedisURL = "http://localhost:6379/0"
		},
		"test environment sharing db 0": func(config *Config) {
			config.Environment = "test"
			config.RedisURL = "redis://localhost:6379/0"
		},
	} {
		t.Run(name, func(t *testing.T) {
			config := base
			mutate(&config)
			if err := config.Validate(); err == nil {
				t.Fatalf("expected configuration error for %s", name)
			}
		})
	}
}

func TestSafeSummaryNeverExposesSecrets(t *testing.T) {
	cfg := Config{
		Environment:            "production",
		RedisURL:               "rediss://default:super-secret-redis-pass@redis.internal:6379/0",
		Port:                   "8080",
		JWTSecret:              "prod-jwt-secret-key-at-least-32-chars",
		AdminEmail:             "admin@nakliyego.com",
		AdminPassword:          "super-secret-admin-pass",
		AdminPasswordHash:      "$argon2id$v=19$m=65536,t=3,p=2$MDEyMzQ1Njc4OWFiY2RlZg$MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY",
		AdminJWTSecret:         "prod-admin-jwt-secret-key-32-chars",
		GoogleMapsServerAPIKey: "AIzaSySecretMapsKey",
		ResendAPIKey:           "re_secret_resend_key",
		SentryDSN:              "https://secret@sentry.io/1",
	}
	summary := cfg.SafeSummary()
	if summary["admin_configured"] != true {
		t.Fatalf("expected admin_configured=true, got %v", summary["admin_configured"])
	}
	for k, v := range summary {
		if str, ok := v.(string); ok {
			for _, forbidden := range []string{
				cfg.JWTSecret,
				cfg.AdminPassword,
				cfg.AdminPasswordHash,
				cfg.AdminJWTSecret,
				cfg.GoogleMapsServerAPIKey,
				cfg.ResendAPIKey,
				cfg.SentryDSN,
				"super-secret-redis-pass",
			} {
				if str == forbidden {
					t.Fatalf("SafeSummary leaked secret in key %q", k)
				}
			}
		}
	}
}

func TestCityTariffsIgnoreObsoleteGlobalOverrides(t *testing.T) {
	t.Setenv("BASE_DRIVER_FEE", "9999")
	t.Setenv("PRICE_PER_KM", "999")
	t.Setenv("MINIVAN_BASE_FEE", "")
	t.Setenv("MINIVAN_PRICE_PER_KM", "")
	if got := Load().Pricing; got.BaseDriverFee != 1250 || got.PricePerKM != 35 {
		t.Fatalf("old overrides changed new tariffs: %#v", got)
	}
	t.Setenv("MINIVAN_BASE_FEE", "1350")
	t.Setenv("PANELVAN_PRICE_PER_KM", "48")
	got := Load().Pricing
	if got.BaseDriverFee != 1350 || got.VehicleTariffs["panelvan"].PerKM != 48 {
		t.Fatalf("vehicle overrides ignored: %#v", got)
	}
}

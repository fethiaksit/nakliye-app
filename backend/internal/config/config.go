package config

import (
	"errors"
	"fmt"
	"math"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"os"
	"strconv"
	"strings"
)

const DefaultPricePerKM = service.DefaultPricePerKM

type Config struct {
	RedisURL, Port, JWTSecret, LANHost string
	Environment                        string
	GoogleMapsServerAPIKey             string
	MapsKeyError                       string
	Pricing                            service.PricingConfig
	// PricePerKM remains available for older command callers; Pricing is the
	// canonical source used by the API.
	PricePerKM        float64
	MaxUploadMB       int
	AdminEmail        string
	AdminPassword     string
	AdminPasswordHash string
	AdminJWTSecret    string
	ResendAPIKey      string
	ResendFromEmail   string
	ResendAPIURL      string
	SentryDSN         string
	AppVersion        string
	MaintenanceMode   bool
}

func Load() Config {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if environment != "" {
		loadDotEnv(".env." + environment)
	}
	loadDotEnv(".env")
	if environment == "" {
		environment = strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	}
	if environment == "" {
		environment = "development"
	}
	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" && (environment == "development" || environment == "test") {
		if environment == "test" {
			redisURL = "redis://localhost:6379/1"
		} else {
			redisURL = "redis://localhost:6379/0"
		}
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	pricing := service.DefaultPricingConfig()
	// Old global keys intentionally no longer override the city tariff.
	for _, entry := range []struct {
		vehicle models.VehicleType
		prefix  string
	}{
		{models.VehicleTypeMinivan, "MINIVAN"}, {models.VehicleTypePanelvan, "PANELVAN"}, {models.VehicleTypeKamyonet, "KAMYONET"}, {models.VehicleTypeKamyon, "KAMYON"},
	} {
		tariff := pricing.VehicleTariffs[entry.vehicle]
		for key, target := range map[string]*float64{entry.prefix + "_BASE_FEE": &tariff.BaseFee, entry.prefix + "_PRICE_PER_KM": &tariff.PerKM} {
			if value, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv(key)), 64); err == nil && value > 0 && !math.IsInf(value, 0) && !math.IsNaN(value) {
				*target = value
			}
		}
		pricing.VehicleTariffs[entry.vehicle] = tariff
	}
	pricing.BaseDriverFee = pricing.VehicleTariffs[models.VehicleTypeMinivan].BaseFee
	pricing.PricePerKM = pricing.VehicleTariffs[models.VehicleTypeMinivan].PerKM
	lanHost := os.Getenv("LAN_HOST")
	maxUploadMB := 10
	if rawMaxUpload := strings.TrimSpace(os.Getenv("MAX_UPLOAD_MB")); rawMaxUpload != "" {
		if parsed, err := strconv.Atoi(rawMaxUpload); err == nil && parsed > 0 && parsed <= 50 {
			maxUploadMB = parsed
		}
	}
	serverMapsKeyRaw := os.Getenv("GOOGLE_MAPS_SERVER_API_KEY")
	if serverMapsKeyRaw == "" {
		serverMapsKeyRaw = os.Getenv("GOOGLE_MAPS_API_KEY")
	}
	serverMapsKey, mapsKeyError := googleMapsServerAPIKey(serverMapsKeyRaw)
	return Config{
		RedisURL:               redisURL,
		Port:                   port,
		JWTSecret:              secret,
		LANHost:                lanHost,
		GoogleMapsServerAPIKey: serverMapsKey,
		MapsKeyError:           mapsKeyError,
		Pricing:                pricing,
		PricePerKM:             pricing.PricePerKM,
		MaxUploadMB:            maxUploadMB,
		Environment:            environment,
		AdminEmail:             strings.ToLower(strings.TrimSpace(os.Getenv("ADMIN_EMAIL"))),
		AdminPassword:          os.Getenv("ADMIN_PASSWORD"),
		AdminPasswordHash:      strings.TrimSpace(os.Getenv("ADMIN_PASSWORD_HASH")),
		AdminJWTSecret:         strings.TrimSpace(os.Getenv("ADMIN_JWT_SECRET")),
		ResendAPIKey:           strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		ResendFromEmail:        resendFromEmail(),
		ResendAPIURL:           resendAPIURL(),
		SentryDSN:              strings.TrimSpace(os.Getenv("SENTRY_DSN")),
		AppVersion:             strings.TrimSpace(os.Getenv("APP_VERSION")),
		MaintenanceMode:        strings.EqualFold(strings.TrimSpace(os.Getenv("MAINTENANCE_MODE")), "true"),
	}
}

func resendFromEmail() string {
	from := strings.TrimSpace(os.Getenv("RESEND_FROM_EMAIL"))
	if from == "" {
		return "onboarding@resend.dev"
	}
	return from
}

func resendAPIURL() string {
	url := strings.TrimSpace(os.Getenv("RESEND_API_URL"))
	if url == "" {
		return "https://api.resend.com/emails"
	}
	return url
}

func isPlaceholderSecret(val string) bool {
	lower := strings.ToLower(strings.TrimSpace(val))
	for _, bad := range []string{
		"replace-with",
		"changeme",
		"change-me",
		"your-secret",
		"example-secret",
		"default-secret",
		"nakliyego-dev-secret",
	} {
		if strings.Contains(lower, bad) {
			return true
		}
	}
	return false
}

func (c Config) Validate() error {
	switch c.Environment {
	case "development", "test", "staging", "production":
	default:
		return errors.New("APP_ENV development, test, staging veya production olmalıdır")
	}
	if c.RedisURL == "" {
		return errors.New("REDIS_URL tanımlı değil")
	}
	if !strings.HasPrefix(c.RedisURL, "redis://") && !strings.HasPrefix(c.RedisURL, "rediss://") {
		return errors.New("REDIS_URL redis:// veya rediss:// ile başlamalıdır")
	}
	port, err := strconv.Atoi(c.Port)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("PORT 1-65535 arasında geçerli bir sayı olmalıdır")
	}
	if len(c.JWTSecret) < 32 {
		return errors.New("JWT_SECRET en az 32 karakter olmalıdır")
	}
	isProdOrStaging := c.Environment == "production" || c.Environment == "staging"
	if isProdOrStaging && isPlaceholderSecret(c.JWTSecret) {
		return errors.New("Production/staging ortamında varsayılan veya örnek JWT_SECRET kullanılamaz")
	}
	adminConfigured := c.AdminEmail != "" || c.AdminPassword != "" || c.AdminPasswordHash != "" || c.AdminJWTSecret != ""
	if isProdOrStaging && !adminConfigured {
		return errors.New("Production/staging ortamında ADMIN_EMAIL, ADMIN_JWT_SECRET ve ADMIN_PASSWORD_HASH (veya ADMIN_PASSWORD) zorunludur")
	}
	if adminConfigured {
		if !strings.Contains(c.AdminEmail, "@") {
			return errors.New("ADMIN_EMAIL geçerli bir e-posta olmalıdır")
		}
		if c.AdminPassword == "" && c.AdminPasswordHash == "" {
			return errors.New("ADMIN_PASSWORD veya ADMIN_PASSWORD_HASH tanımlanmalıdır")
		}
		if c.AdminPassword != "" && len(c.AdminPassword) < 12 {
			return errors.New("ADMIN_PASSWORD en az 12 karakter olmalıdır")
		}
		if c.AdminPasswordHash != "" && !strings.HasPrefix(c.AdminPasswordHash, "$argon2id$") {
			return errors.New("ADMIN_PASSWORD_HASH geçerli Argon2id biçiminde olmalıdır")
		}
		if len(c.AdminJWTSecret) < 32 || c.AdminJWTSecret == c.JWTSecret {
			return errors.New("ADMIN_JWT_SECRET mobil JWT_SECRET değerinden farklı ve en az 32 karakter olmalıdır")
		}
		if isProdOrStaging && isPlaceholderSecret(c.AdminJWTSecret) {
			return errors.New("Production/staging ortamında varsayılan veya örnek ADMIN_JWT_SECRET kullanılamaz")
		}
	}
	if c.Environment == "test" && strings.HasSuffix(c.RedisURL, "/0") {
		return errors.New("Test ortamı development/production veritabanı (/0) ile aynı REDIS_URL indeksini kullanamaz")
	}
	return nil
}

// SafeSummary returns a non-sensitive configuration map suitable for structured startup logging.
// Secrets, passwords, tokens, and raw connection credentials are never included.
func (c Config) SafeSummary() map[string]any {
	return map[string]any{
		"environment":          c.Environment,
		"port":                 c.Port,
		"max_upload_mb":        c.MaxUploadMB,
		"maintenance_mode":     c.MaintenanceMode,
		"app_version":          c.AppVersion,
		"maps_key_configured":  c.GoogleMapsServerAPIKey != "" && c.MapsKeyError == "",
		"admin_configured":     c.AdminEmail != "" && c.AdminJWTSecret != "",
		"resend_configured":    c.ResendAPIKey != "",
		"sentry_configured":    c.SentryDSN != "",
		"jwt_configured":       len(c.JWTSecret) >= 32,
		"redis_tls":            strings.HasPrefix(c.RedisURL, "rediss://"),
	}
}

func googleMapsServerAPIKey(raw string) (string, string) {
	if raw == "" {
		return "", "GOOGLE_MAPS_SERVER_API_KEY tanımlı değil"
	}
	if raw != strings.TrimSpace(raw) {
		return "", "GOOGLE_MAPS_SERVER_API_KEY başında veya sonunda boşluk içeriyor"
	}
	if strings.HasPrefix(raw, "'") || strings.HasPrefix(raw, "\"") || strings.HasSuffix(raw, "'") || strings.HasSuffix(raw, "\"") {
		return "", "GOOGLE_MAPS_SERVER_API_KEY tırnak işareti içermemelidir"
	}
	return raw, ""
}

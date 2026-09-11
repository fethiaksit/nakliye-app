package config

import (
	"errors"
	"fmt"
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
}

func Load() Config {
	loadDotEnv(".env")
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if environment == "" {
		environment = "development"
	}
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379/0"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	pricing := service.DefaultPricingConfig()
	if rawBase := strings.TrimSpace(os.Getenv("BASE_DRIVER_FEE")); rawBase != "" {
		if parsed, err := strconv.ParseFloat(rawBase, 64); err == nil && parsed > 0 {
			pricing.BaseDriverFee = parsed
		}
	}
	if rawPrice := strings.TrimSpace(os.Getenv("PRICE_PER_KM")); rawPrice != "" {
		if parsed, err := strconv.ParseFloat(rawPrice, 64); err == nil && parsed > 0 {
			pricing.PricePerKM = parsed
		}
	}
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
	}
}

func (c Config) Validate() error {
	if c.RedisURL == "" {
		return errors.New("REDIS_URL tanımlı değil")
	}
	port, err := strconv.Atoi(c.Port)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("PORT 1-65535 arasında geçerli bir sayı olmalıdır")
	}
	if len(c.JWTSecret) < 32 {
		return errors.New("JWT_SECRET en az 32 karakter olmalıdır")
	}
	adminConfigured := c.AdminEmail != "" || c.AdminPassword != "" || c.AdminPasswordHash != "" || c.AdminJWTSecret != ""
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
	}
	switch c.Environment {
	case "development", "test", "staging", "production":
		return nil
	default:
		return errors.New("APP_ENV development, test, staging veya production olmalıdır")
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

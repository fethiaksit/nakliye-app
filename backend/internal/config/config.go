package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"net/mail"
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
		"example-password",
		"default-password",
	} {
		if strings.Contains(lower, bad) {
			return true
		}
	}
	return false
}

func isValidAdminEmail(raw string) bool {
	email := strings.TrimSpace(raw)
	if email == "" || strings.ContainsAny(email, " \t\r\n") {
		return false
	}
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		return false
	}
	at := strings.LastIndexByte(email, '@')
	if at <= 0 || at == len(email)-1 {
		return false
	}
	domain := email[at+1:]
	if !strings.Contains(domain, ".") || strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") {
		return false
	}
	return true
}

func isValidArgon2idHash(raw string) bool {
	encoded := strings.TrimSpace(raw)
	if encoded == "" {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory, iterations uint32
	var parallelism uint8
	if n, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil || n != 3 {
		return false
	}
	if parts[3] != fmt.Sprintf("m=%d,t=%d,p=%d", memory, iterations, parallelism) {
		return false
	}
	if memory == 0 || iterations == 0 || parallelism == 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 8 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) < 16 {
		return false
	}
	return true
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
	jwtSecret := strings.TrimSpace(c.JWTSecret)
	if len(jwtSecret) < 32 {
		return errors.New("JWT_SECRET en az 32 karakter olmalıdır")
	}
	isProdOrStaging := c.Environment == "production" || c.Environment == "staging"
	if isProdOrStaging && isPlaceholderSecret(jwtSecret) {
		return errors.New("Production/staging ortamında varsayılan veya örnek JWT_SECRET kullanılamaz")
	}
	adminEmail := strings.TrimSpace(c.AdminEmail)
	adminPassword := strings.TrimSpace(c.AdminPassword)
	adminPasswordHash := strings.TrimSpace(c.AdminPasswordHash)
	adminJWTSecret := strings.TrimSpace(c.AdminJWTSecret)
	adminConfigured := adminEmail != "" || adminPassword != "" || adminPasswordHash != "" || adminJWTSecret != ""
	if isProdOrStaging {
		if adminEmail == "" || adminJWTSecret == "" || (adminPassword == "" && adminPasswordHash == "") {
			return errors.New("Production/staging ortamında ADMIN_EMAIL, ADMIN_JWT_SECRET ve ADMIN_PASSWORD_HASH (veya ADMIN_PASSWORD) zorunludur")
		}
	}
	if isProdOrStaging || adminConfigured {
		if !isValidAdminEmail(adminEmail) {
			return errors.New("ADMIN_EMAIL geçerli bir e-posta olmalıdır")
		}
		if isProdOrStaging && isPlaceholderSecret(adminEmail) {
			return errors.New("Production/staging ortamında varsayılan veya örnek ADMIN_EMAIL kullanılamaz")
		}
		if adminPassword == "" && adminPasswordHash == "" {
			return errors.New("ADMIN_PASSWORD veya ADMIN_PASSWORD_HASH tanımlanmalıdır")
		}
		if c.AdminPassword != "" || adminPassword != "" {
			if len(adminPassword) < 12 {
				return errors.New("ADMIN_PASSWORD en az 12 karakter olmalıdır")
			}
			if strings.EqualFold(adminPassword, adminEmail) {
				return errors.New("ADMIN_PASSWORD ADMIN_EMAIL ile aynı olamaz")
			}
			if isProdOrStaging && isPlaceholderSecret(adminPassword) {
				return errors.New("Production/staging ortamında varsayılan veya örnek ADMIN_PASSWORD kullanılamaz")
			}
		}
		if c.AdminPasswordHash != "" || adminPasswordHash != "" {
			if !isValidArgon2idHash(adminPasswordHash) {
				return errors.New("ADMIN_PASSWORD_HASH geçerli Argon2id biçiminde olmalıdır")
			}
		}
		if len(adminJWTSecret) < 32 || adminJWTSecret == jwtSecret {
			return errors.New("ADMIN_JWT_SECRET mobil JWT_SECRET değerinden farklı ve en az 32 karakter olmalıdır")
		}
		if isProdOrStaging && isPlaceholderSecret(adminJWTSecret) {
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
		"environment":         c.Environment,
		"port":                c.Port,
		"max_upload_mb":       c.MaxUploadMB,
		"maintenance_mode":    c.MaintenanceMode,
		"app_version":         c.AppVersion,
		"maps_key_configured": c.GoogleMapsServerAPIKey != "" && c.MapsKeyError == "",
		"admin_configured": strings.TrimSpace(c.AdminEmail) != "" &&
			len(strings.TrimSpace(c.AdminJWTSecret)) >= 32 &&
			(strings.TrimSpace(c.AdminPassword) != "" || strings.TrimSpace(c.AdminPasswordHash) != ""),
		"resend_configured": c.ResendAPIKey != "",
		"sentry_configured": c.SentryDSN != "",
		"jwt_configured":    len(strings.TrimSpace(c.JWTSecret)) >= 32,
		"redis_tls":         strings.HasPrefix(c.RedisURL, "rediss://"),
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

package config

import (
	"nakliye-api/internal/service"
	"os"
	"strconv"
	"strings"
)

const DefaultPricePerKM = service.DefaultPricePerKM

type Config struct {
	RedisURL, Port, JWTSecret, LANHost string
	GoogleMapsServerAPIKey             string
	GoogleMapsServerKeyError           string
	PricePerKM                         float64
	MaxUploadMB                        int
}

func Load() Config {
	loadDotEnv(".env")
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379/0"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "change-this-development-secret"
	}
	pricePerKM := DefaultPricePerKM
	if rawPrice := strings.TrimSpace(os.Getenv("PRICE_PER_KM")); rawPrice != "" {
		if parsed, err := strconv.ParseFloat(rawPrice, 64); err == nil && parsed > 0 {
			pricePerKM = parsed
		}
	}
	lanHost := os.Getenv("LAN_HOST")
	maxUploadMB := 10
	if rawMaxUpload := strings.TrimSpace(os.Getenv("MAX_UPLOAD_MB")); rawMaxUpload != "" {
		if parsed, err := strconv.Atoi(rawMaxUpload); err == nil && parsed > 0 && parsed <= 50 {
			maxUploadMB = parsed
		}
	}
	// GOOGLE_MAPS_API_KEY is the documented server variable. Keep the older,
	// more explicit spelling as a compatible alias for existing local setups.
	serverMapsKeyRaw := os.Getenv("GOOGLE_MAPS_API_KEY")
	if serverMapsKeyRaw == "" {
		serverMapsKeyRaw = os.Getenv("GOOGLE_MAPS_SERVER_API_KEY")
	}
	serverMapsKey, serverMapsKeyError := mapsServerKey(serverMapsKeyRaw)
	return Config{
		RedisURL:                 redisURL,
		Port:                     port,
		JWTSecret:                secret,
		LANHost:                  lanHost,
		GoogleMapsServerAPIKey:   serverMapsKey,
		GoogleMapsServerKeyError: serverMapsKeyError,
		PricePerKM:               pricePerKM,
		MaxUploadMB:              maxUploadMB,
	}
}

func mapsServerKey(raw string) (string, string) {
	if raw == "" {
		return "", "GOOGLE_MAPS_API_KEY tanımlı değil"
	}
	if raw != strings.TrimSpace(raw) {
		return "", "GOOGLE_MAPS_API_KEY başında veya sonunda boşluk içeriyor"
	}
	if strings.HasPrefix(raw, "'") || strings.HasPrefix(raw, "\"") || strings.HasSuffix(raw, "'") || strings.HasSuffix(raw, "\"") {
		return "", "GOOGLE_MAPS_API_KEY tırnak işareti içermemelidir"
	}
	return raw, ""
}

// MaskSecret is intentionally safe for development diagnostics: it never
// returns enough data to reconstruct a credential.
func MaskSecret(value string) string {
	if len(value) < 4 {
		return "****"
	}
	return "****" + value[len(value)-4:]
}

package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"nakliye-api/internal/models"
)

const maxRouteDistanceMeters = 3_000_000

var (
	ErrInvalidCoordinates      = errors.New("geçersiz koordinat")
	ErrSameCoordinates         = errors.New("başlangıç ve varış aynı olamaz")
	ErrRouteNotFound           = errors.New("bu iki konum arasında araç rotası bulunamadı")
	ErrPlaceNotFound           = errors.New("bu adres için sonuç bulunamadı")
	ErrProviderUnavailable     = errors.New("harita servisi şu anda kullanılamıyor")
	ErrGoogleMapsNotConfigured = errors.New("google maps servis anahtarı yapılandırılmamış")
	ErrGoogleMapsQuotaExceeded = errors.New("harita servisi kullanım sınırına ulaştı")
)

type mapsContextKey string

const requestIDContextKey mapsContextKey = "maps-request-id"

// WithRequestID lets the HTTP layer correlate a redacted Google diagnostic
// with one inbound API request without propagating a user token or API key.
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDContextKey, requestID)
}

func RequestID(ctx context.Context) string {
	value, _ := ctx.Value(requestIDContextKey).(string)
	return value
}

// GoogleMapsError retains provider diagnostics for server logs and normalized
// API responses. It never contains the API key, request URL or credentials.
type GoogleMapsError struct {
	Operation  string
	HTTPStatus int
	Reason     string
	Message    string
	Elapsed    time.Duration
}

func (e *GoogleMapsError) Error() string {
	if e == nil {
		return "google maps request failed"
	}
	return fmt.Sprintf("google maps %s failed: status=%d reason=%s", e.Operation, e.HTTPStatus, e.Reason)
}

type RouteResult struct {
	DistanceMeters   int                 `json:"distanceMeters"`
	DistanceKM       float64             `json:"distanceKm"`
	DurationSeconds  int                 `json:"durationSeconds"`
	DurationMinutes  float64             `json:"durationMinutes"`
	PricePerKM       float64             `json:"pricePerKm"`
	EstimatedPriceTL float64             `json:"estimatedPrice"`
	Currency         string              `json:"currency"`
	EncodedPolyline  string              `json:"encodedPolyline"`
	RouteProvider    string              `json:"routeProvider"`
	RouteCoordinates []models.Coordinate `json:"routeCoordinates"`
}

// SearchResult is the normalized location payload shared by autocomplete,
// place-details and reverse-geocoding consumers. The server API key never
// appears in this type or any HTTP response.
type SearchResult struct {
	PlaceID          string            `json:"placeId,omitempty"`
	FormattedAddress string            `json:"formattedAddress"`
	Coordinate       models.Coordinate `json:"coordinate"`
}

type PlaceSuggestion struct {
	PlaceID          string `json:"place_id"`
	FormattedAddress string `json:"formatted_address"`
	PrimaryText      string `json:"primary_text,omitempty"`
	SecondaryText    string `json:"secondary_text,omitempty"`
}

type cacheEntry struct {
	value   any
	expires time.Time
}

// GoogleMapsClient is deliberately server-side only. It talks to the three
// Google Maps Platform REST APIs using the server key and returns compact,
// application-owned objects rather than provider responses.
type GoogleMapsClient struct {
	apiKey       string
	pricePerKM   float64
	placesURL    string
	geocodingURL string
	routesURL    string
	client       *http.Client
	cacheMu      sync.Mutex
	cache        map[string]cacheEntry
}

func NewGoogleMapsClient(apiKey string, pricePerKM float64) *GoogleMapsClient {
	return NewGoogleMapsClientWithURLs(
		apiKey,
		pricePerKM,
		"https://places.googleapis.com",
		"https://maps.googleapis.com",
		"https://routes.googleapis.com",
		nil,
	)
}

// NewGoogleMapsClientWithURLs keeps the provider client testable without
// issuing external Google calls. Production should use NewGoogleMapsClient.
func NewGoogleMapsClientWithURLs(apiKey string, pricePerKM float64, placesURL, geocodingURL, routesURL string, client *http.Client) *GoogleMapsClient {
	if pricePerKM <= 0 {
		pricePerKM = DefaultPricePerKM
	}
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	return &GoogleMapsClient{
		apiKey:       strings.TrimSpace(apiKey),
		pricePerKM:   pricePerKM,
		placesURL:    strings.TrimRight(placesURL, "/"),
		geocodingURL: strings.TrimRight(geocodingURL, "/"),
		routesURL:    strings.TrimRight(routesURL, "/"),
		client:       client,
		cache:        make(map[string]cacheEntry),
	}
}

func ValidCoordinate(coordinate models.Coordinate) bool {
	return !math.IsNaN(coordinate.Latitude) && !math.IsInf(coordinate.Latitude, 0) &&
		!math.IsNaN(coordinate.Longitude) && !math.IsInf(coordinate.Longitude, 0) &&
		coordinate.Latitude >= -90 && coordinate.Latitude <= 90 &&
		coordinate.Longitude >= -180 && coordinate.Longitude <= 180
}

func (c *GoogleMapsClient) configured() error {
	if c == nil || c.apiKey == "" {
		return ErrGoogleMapsNotConfigured
	}
	return nil
}

func (c *GoogleMapsClient) cached(key string) (any, bool) {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()
	entry, found := c.cache[key]
	if !found || time.Now().After(entry.expires) {
		if found {
			delete(c.cache, key)
		}
		return nil, false
	}
	return entry.value, true
}

func (c *GoogleMapsClient) cacheValue(key string, value any, ttl time.Duration) {
	c.cacheMu.Lock()
	c.cache[key] = cacheEntry{value: value, expires: time.Now().Add(ttl)}
	c.cacheMu.Unlock()
}

func normalizedKey(parts ...string) string {
	return strings.ToLower(strings.Join(parts, "|"))
}

func (c *GoogleMapsClient) Autocomplete(ctx context.Context, input, sessionToken string) ([]PlaceSuggestion, error) {
	if err := c.configured(); err != nil {
		return nil, err
	}
	input = strings.TrimSpace(input)
	if len([]rune(input)) < 2 {
		return nil, errors.New("arama metni en az 2 karakter olmalıdır")
	}
	cacheKey := normalizedKey("autocomplete", input)
	if cached, ok := c.cached(cacheKey); ok {
		return cached.([]PlaceSuggestion), nil
	}

	payload := map[string]any{
		"input":               input,
		"languageCode":        "tr",
		"regionCode":          "TR",
		"includedRegionCodes": []string{"tr"},
	}
	if strings.TrimSpace(sessionToken) != "" {
		payload["sessionToken"] = strings.TrimSpace(sessionToken)
	}
	var response struct {
		Suggestions []struct {
			PlacePrediction struct {
				PlaceID string `json:"placeId"`
				Place   string `json:"place"`
				Text    struct {
					Text string `json:"text"`
				} `json:"text"`
				StructuredFormat struct {
					MainText struct {
						Text string `json:"text"`
					} `json:"mainText"`
					SecondaryText struct {
						Text string `json:"text"`
					} `json:"secondaryText"`
				} `json:"structuredFormat"`
			} `json:"placePrediction"`
		} `json:"suggestions"`
	}
	fieldMask := "suggestions.placePrediction.placeId,suggestions.placePrediction.place,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text"
	if err := c.doJSON(ctx, http.MethodPost, c.placesURL+"/v1/places:autocomplete", payload, fieldMask, &response); err != nil {
		return nil, err
	}
	items := make([]PlaceSuggestion, 0, len(response.Suggestions))
	for _, suggestion := range response.Suggestions {
		prediction := suggestion.PlacePrediction
		id := strings.TrimSpace(prediction.PlaceID)
		if id == "" && prediction.Place != "" {
			id = strings.TrimPrefix(prediction.Place, "places/")
		}
		address := strings.TrimSpace(prediction.Text.Text)
		if id == "" || address == "" {
			continue
		}
		items = append(items, PlaceSuggestion{
			PlaceID:          id,
			FormattedAddress: address,
			PrimaryText:      strings.TrimSpace(prediction.StructuredFormat.MainText.Text),
			SecondaryText:    strings.TrimSpace(prediction.StructuredFormat.SecondaryText.Text),
		})
	}
	// A short cache suppresses repeated autocomplete requests while still
	// preserving a provider session for billing and relevance.
	c.cacheValue(cacheKey, items, time.Minute)
	return items, nil
}

func (c *GoogleMapsClient) PlaceDetails(ctx context.Context, placeID, sessionToken string) (SearchResult, error) {
	if err := c.configured(); err != nil {
		return SearchResult{}, err
	}
	placeID = strings.TrimSpace(placeID)
	if placeID == "" || len(placeID) > 300 {
		return SearchResult{}, ErrPlaceNotFound
	}
	cacheKey := normalizedKey("details", placeID)
	if cached, ok := c.cached(cacheKey); ok {
		return cached.(SearchResult), nil
	}
	endpoint := c.placesURL + "/v1/places/" + url.PathEscape(placeID) + "?languageCode=tr"
	if sessionToken = strings.TrimSpace(sessionToken); sessionToken != "" {
		endpoint += "&sessionToken=" + url.QueryEscape(sessionToken)
	}
	var response struct {
		ID               string `json:"id"`
		FormattedAddress string `json:"formattedAddress"`
		Location         struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"location"`
	}
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, "id,formattedAddress,location", &response); err != nil {
		return SearchResult{}, err
	}
	result := SearchResult{
		PlaceID:          firstNonEmpty(response.ID, placeID),
		FormattedAddress: strings.TrimSpace(response.FormattedAddress),
		Coordinate:       models.Coordinate{Latitude: response.Location.Latitude, Longitude: response.Location.Longitude},
	}
	if result.FormattedAddress == "" || !ValidCoordinate(result.Coordinate) {
		return SearchResult{}, ErrPlaceNotFound
	}
	c.cacheValue(cacheKey, result, 24*time.Hour)
	return result, nil
}

func (c *GoogleMapsClient) Reverse(ctx context.Context, coordinate models.Coordinate) (SearchResult, error) {
	if err := c.configured(); err != nil {
		return SearchResult{}, err
	}
	if !ValidCoordinate(coordinate) {
		return SearchResult{}, ErrInvalidCoordinates
	}
	cacheKey := normalizedKey("reverse", coordinateKey(coordinate))
	if cached, ok := c.cached(cacheKey); ok {
		return cached.(SearchResult), nil
	}
	endpoint := fmt.Sprintf("%s/maps/api/geocode/json?latlng=%.7f,%.7f&language=tr&region=tr&key=%s", c.geocodingURL, coordinate.Latitude, coordinate.Longitude, url.QueryEscape(c.apiKey))
	var response struct {
		Status  string `json:"status"`
		Results []struct {
			FormattedAddress string `json:"formatted_address"`
			PlaceID          string `json:"place_id"`
		} `json:"results"`
		ErrorMessage string `json:"error_message"`
	}
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, "", &response); err != nil {
		return SearchResult{}, err
	}
	if response.Status == "ZERO_RESULTS" || len(response.Results) == 0 {
		return SearchResult{}, ErrPlaceNotFound
	}
	if response.Status != "OK" {
		return SearchResult{}, c.providerError(ctx, "geocoding", http.StatusOK, response.Status, response.ErrorMessage, 0)
	}
	result := SearchResult{
		PlaceID:          response.Results[0].PlaceID,
		FormattedAddress: strings.TrimSpace(response.Results[0].FormattedAddress),
		Coordinate:       coordinate,
	}
	if result.FormattedAddress == "" {
		return SearchResult{}, ErrPlaceNotFound
	}
	c.cacheValue(cacheKey, result, 24*time.Hour)
	return result, nil
}

func (c *GoogleMapsClient) Calculate(ctx context.Context, pickup, dropoff models.Coordinate) (RouteResult, error) {
	if err := c.configured(); err != nil {
		return RouteResult{}, err
	}
	if !ValidCoordinate(pickup) || !ValidCoordinate(dropoff) {
		return RouteResult{}, ErrInvalidCoordinates
	}
	if sameCoordinates(pickup, dropoff) {
		return RouteResult{}, ErrSameCoordinates
	}
	cacheKey := normalizedKey("route", coordinateKey(pickup), coordinateKey(dropoff))
	if cached, ok := c.cached(cacheKey); ok {
		return cached.(RouteResult), nil
	}
	payload := map[string]any{
		"origin":            routeWaypoint(pickup),
		"destination":       routeWaypoint(dropoff),
		"travelMode":        "DRIVE",
		"routingPreference": "TRAFFIC_AWARE",
		"languageCode":      "tr-TR",
		"units":             "METRIC",
	}
	var response struct {
		Routes []struct {
			DistanceMeters int    `json:"distanceMeters"`
			Duration       string `json:"duration"`
			Polyline       struct {
				EncodedPolyline string `json:"encodedPolyline"`
			} `json:"polyline"`
		} `json:"routes"`
	}
	fieldMask := "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
	if err := c.doJSON(ctx, http.MethodPost, c.routesURL+"/directions/v2:computeRoutes", payload, fieldMask, &response); err != nil {
		return RouteResult{}, err
	}
	if len(response.Routes) == 0 {
		return RouteResult{}, ErrRouteNotFound
	}
	route := response.Routes[0]
	durationSeconds, err := parseGoogleDuration(route.Duration)
	if err != nil || route.DistanceMeters <= 0 || route.DistanceMeters > maxRouteDistanceMeters || durationSeconds <= 0 || route.Polyline.EncodedPolyline == "" {
		return RouteResult{}, ErrRouteNotFound
	}
	coordinates, err := DecodeGooglePolyline(route.Polyline.EncodedPolyline)
	if err != nil || len(coordinates) < 2 {
		return RouteResult{}, ErrRouteNotFound
	}
	result := RouteResult{
		DistanceMeters:   route.DistanceMeters,
		DistanceKM:       math.Round(float64(route.DistanceMeters)/10) / 100,
		DurationSeconds:  durationSeconds,
		DurationMinutes:  math.Round(float64(durationSeconds)/6) / 10,
		PricePerKM:       c.pricePerKM,
		EstimatedPriceTL: Price(route.DistanceMeters, c.pricePerKM),
		Currency:         "TRY",
		EncodedPolyline:  route.Polyline.EncodedPolyline,
		RouteProvider:    "google",
		RouteCoordinates: coordinates,
	}
	c.cacheValue(cacheKey, result, 5*time.Minute)
	return result, nil
}

func routeWaypoint(coordinate models.Coordinate) map[string]any {
	return map[string]any{"location": map[string]any{"latLng": map[string]float64{"latitude": coordinate.Latitude, "longitude": coordinate.Longitude}}}
}

func (c *GoogleMapsClient) doJSON(ctx context.Context, method, endpoint string, body any, fieldMask string, target any) error {
	started := time.Now()
	operation := googleOperation(endpoint)
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return ErrProviderUnavailable
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return ErrProviderUnavailable
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if fieldMask != "" {
		req.Header.Set("X-Goog-FieldMask", fieldMask)
	}
	response, err := c.client.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return c.providerError(ctx, operation, 0, "NETWORK_ERROR", "Google Maps ağına ulaşılamadı", time.Since(started))
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		reason, message := googleErrorDetails(body, response.StatusCode)
		return c.providerError(ctx, operation, response.StatusCode, reason, message, time.Since(started))
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(target); err != nil {
		return c.providerError(ctx, operation, response.StatusCode, "INVALID_RESPONSE", "Google Maps geçersiz bir yanıt döndürdü", time.Since(started))
	}
	return nil
}

func (c *GoogleMapsClient) providerError(ctx context.Context, operation string, status int, reason, message string, elapsed time.Duration) error {
	if reason == "" {
		reason = "UNKNOWN"
	}
	if message == "" {
		message = "Google Maps isteği başarısız oldu"
	}
	if mapsDiagnosticLoggingEnabled() {
		log.Printf("[GOOGLE %s] request_id=%s status=%d reason=%s message=%q elapsed_ms=%d", strings.ToUpper(operation), RequestID(ctx), status, reason, safeGoogleMessage(message), elapsed.Milliseconds())
	} else {
		log.Printf("[GOOGLE %s] request_id=%s status=%d reason=%s elapsed_ms=%d", strings.ToUpper(operation), RequestID(ctx), status, reason, elapsed.Milliseconds())
	}
	return &GoogleMapsError{Operation: operation, HTTPStatus: status, Reason: reason, Message: message, Elapsed: elapsed}
}

func mapsDiagnosticLoggingEnabled() bool {
	return strings.ToLower(os.Getenv("APP_ENV")) != "production" && strings.ToLower(os.Getenv("GO_ENV")) != "production"
}

func safeGoogleMessage(message string) string {
	message = strings.Join(strings.Fields(message), " ")
	for {
		start := strings.Index(message, "AIza")
		if start < 0 {
			break
		}
		end := start + len("AIza")
		for end < len(message) {
			character := message[end]
			if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '_' || character == '-' {
				end++
				continue
			}
			break
		}
		message = message[:start] + "[REDACTED]" + message[end:]
	}
	if len(message) > 300 {
		return message[:300] + "…"
	}
	return message
}

func googleErrorDetails(body []byte, status int) (string, string) {
	var payload struct {
		Error struct {
			Status  string `json:"status"`
			Message string `json:"message"`
		} `json:"error"`
		Status       string `json:"status"`
		ErrorMessage string `json:"error_message"`
	}
	if json.Unmarshal(body, &payload) == nil {
		reason := firstNonEmpty(payload.Error.Status, payload.Status)
		message := firstNonEmpty(payload.Error.Message, payload.ErrorMessage)
		if reason != "" || message != "" {
			return reason, message
		}
	}
	switch status {
	case http.StatusUnauthorized:
		return "UNAUTHENTICATED", "Google API anahtarı doğrulanamadı"
	case http.StatusForbidden:
		return "PERMISSION_DENIED", "Google API anahtarı veya API izni reddedildi"
	case http.StatusTooManyRequests:
		return "RESOURCE_EXHAUSTED", "Google Maps kotası aşıldı"
	default:
		return "UPSTREAM_ERROR", "Google Maps isteği başarısız oldu"
	}
}

func googleOperation(endpoint string) string {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "unknown"
	}
	switch {
	case strings.Contains(parsed.Path, "places:autocomplete"):
		return "places"
	case strings.Contains(parsed.Path, "/v1/places/"):
		return "places"
	case strings.Contains(parsed.Path, "geocode"):
		return "geocoding"
	case strings.Contains(parsed.Path, "computeRoutes"):
		return "routes"
	default:
		return "unknown"
	}
}

func coordinateKey(coordinate models.Coordinate) string {
	return strconv.FormatFloat(coordinate.Latitude, 'f', 6, 64) + "," + strconv.FormatFloat(coordinate.Longitude, 'f', 6, 64)
}

func sameCoordinates(first, second models.Coordinate) bool {
	return math.Abs(first.Latitude-second.Latitude) < 0.000001 && math.Abs(first.Longitude-second.Longitude) < 0.000001
}

func firstNonEmpty(first, fallback string) string {
	if strings.TrimSpace(first) != "" {
		return first
	}
	return fallback
}

func parseGoogleDuration(value string) (int, error) {
	value = strings.TrimSuffix(strings.TrimSpace(value), "s")
	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil || seconds <= 0 || seconds > 7*24*60*60 {
		return 0, errors.New("invalid google duration")
	}
	return int(math.Round(seconds)), nil
}

// DecodeGooglePolyline decodes the compact format returned by Google Routes.
// Keeping it here means the persisted load can be rendered by both apps without
// a second routing call or a third-party polyline package.
func DecodeGooglePolyline(encoded string) ([]models.Coordinate, error) {
	coordinates := make([]models.Coordinate, 0, 64)
	var latitude, longitude int
	for index := 0; index < len(encoded); {
		latDelta, next, ok := decodePolylineValue(encoded, index)
		if !ok {
			return nil, errors.New("invalid google polyline")
		}
		lngDelta, nextAfterLng, ok := decodePolylineValue(encoded, next)
		if !ok {
			return nil, errors.New("invalid google polyline")
		}
		index = nextAfterLng
		latitude += latDelta
		longitude += lngDelta
		coordinate := models.Coordinate{Latitude: float64(latitude) / 1e5, Longitude: float64(longitude) / 1e5}
		if !ValidCoordinate(coordinate) {
			return nil, errors.New("invalid google polyline coordinate")
		}
		coordinates = append(coordinates, coordinate)
	}
	return coordinates, nil
}

func decodePolylineValue(encoded string, index int) (int, int, bool) {
	var result, shift int
	for index < len(encoded) {
		value := int(encoded[index]) - 63
		index++
		if value < 0 {
			return 0, index, false
		}
		result |= (value & 0x1f) << shift
		shift += 5
		if shift > 30 {
			return 0, index, false
		}
		if value < 0x20 {
			if result&1 != 0 {
				return ^(result >> 1), index, true
			}
			return result >> 1, index, true
		}
	}
	return 0, index, false
}

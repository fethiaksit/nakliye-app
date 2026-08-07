package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
	"io"
	"log"
	"mime/multipart"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"nakliye-api/internal/store"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type API struct {
	store          *store.RedisStore
	secret         []byte
	maps           *service.GoogleMapsClient
	mapsKeyIssue   string
	locationRate   *service.FixedWindowLimiter
	maxUploadBytes int64
}
type principal struct{ ID, Role string }
type contextKey string

const userKey contextKey = "user"

type Options struct {
	Secret                   string
	GoogleMapsServerAPIKey   string
	GoogleMapsServerKeyError string
	PricePerKM               float64
	MaxUploadMB              int
}

func New(s *store.RedisStore, secret ...string) *API {
	value := "change-this-development-secret"
	if len(secret) > 0 {
		value = secret[0]
	}
	return NewWithOptions(s, Options{
		Secret:      value,
		PricePerKM:  service.DefaultPricePerKM,
		MaxUploadMB: 10,
	})
}

func NewWithOptions(s *store.RedisStore, options Options) *API {
	if options.Secret == "" {
		options.Secret = "change-this-development-secret"
	}
	if options.PricePerKM <= 0 {
		options.PricePerKM = service.DefaultPricePerKM
	}
	if options.MaxUploadMB <= 0 || options.MaxUploadMB > 50 {
		options.MaxUploadMB = 10
	}
	return &API{
		store:          s,
		secret:         []byte(options.Secret),
		maps:           service.NewGoogleMapsClient(options.GoogleMapsServerAPIKey, options.PricePerKM),
		mapsKeyIssue:   options.GoogleMapsServerKeyError,
		locationRate:   service.NewFixedWindowLimiter(60, time.Minute),
		maxUploadBytes: int64(options.MaxUploadMB) << 20,
	}
}
func (a *API) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("POST /api/auth/register", a.register)
	mux.HandleFunc("POST /api/auth/login", a.login)
	mux.HandleFunc("POST /api/auth/refresh", a.refresh)
	mux.HandleFunc("POST /api/auth/logout", a.logout)
	mux.HandleFunc("POST /api/auth/password-reset", a.passwordReset)
	mux.Handle("GET /api/me", a.auth(http.HandlerFunc(a.me)))
	mux.Handle("PATCH /api/me", a.auth(http.HandlerFunc(a.updateMe)))
	mux.Handle("PATCH /api/me/password", a.auth(http.HandlerFunc(a.updatePassword)))
	mux.HandleFunc("GET /api/photos/{id}", a.photo)
	mux.Handle("GET /api/maps/places/autocomplete", a.auth(http.HandlerFunc(a.mapAutocomplete)))
	mux.Handle("GET /api/maps/places/{placeId}", a.auth(http.HandlerFunc(a.mapPlaceDetails)))
	mux.Handle("POST /api/maps/reverse-geocode", a.auth(http.HandlerFunc(a.mapReverseGeocode)))
	mux.Handle("POST /api/maps/routes/calculate", a.auth(http.HandlerFunc(a.mapCalculateRoute)))
	// Backward-compatible application aliases. They now call only the Google
	// Maps service; no Nominatim or OSRM traffic remains in the project.
	mux.Handle("GET /api/locations/search", a.auth(http.HandlerFunc(a.searchLocations)))
	mux.Handle("GET /api/locations/reverse", a.auth(http.HandlerFunc(a.reverseLocation)))
	mux.Handle("POST /api/routes/calculate", a.auth(http.HandlerFunc(a.calculateRoute)))
	mux.Handle("GET /api/loads", a.auth(http.HandlerFunc(a.loads)))
	mux.Handle("GET /api/loads/mine", a.auth(http.HandlerFunc(a.myLoads)))
	mux.Handle("POST /api/loads", a.auth(http.HandlerFunc(a.createLoad)))
	mux.Handle("GET /api/loads/{id}", a.auth(http.HandlerFunc(a.load)))
	mux.Handle("PUT /api/loads/{id}", a.auth(http.HandlerFunc(a.updateLoad)))
	mux.Handle("PATCH /api/loads/{id}/status", a.auth(http.HandlerFunc(a.updateStatus)))
	mux.Handle("DELETE /api/loads/{id}", a.auth(http.HandlerFunc(a.deleteLoad)))
	mux.Handle("POST /api/loads/{id}/publish", a.auth(http.HandlerFunc(a.publish)))
	mux.Handle("POST /api/loads/{id}/photos", a.auth(http.HandlerFunc(a.uploadLoadPhotos)))
	mux.Handle("DELETE /api/loads/{id}/photos/{photoID}", a.auth(http.HandlerFunc(a.deleteLoadPhoto)))
	mux.Handle("POST /api/loads/{id}/offers", a.auth(http.HandlerFunc(a.createOffer)))
	mux.Handle("GET /api/loads/{id}/offers", a.auth(http.HandlerFunc(a.offers)))
	mux.Handle("POST /api/offers/{id}/accept", a.auth(http.HandlerFunc(a.acceptOffer)))
	mux.Handle("PATCH /api/offers/{id}", a.auth(http.HandlerFunc(a.updateOffer)))
	mux.Handle("DELETE /api/offers/{id}", a.auth(http.HandlerFunc(a.withdrawOffer)))
	mux.Handle("GET /api/loads/{id}/messages", a.auth(http.HandlerFunc(a.messages)))
	mux.Handle("POST /api/loads/{id}/messages", a.auth(http.HandlerFunc(a.sendMessage)))
	mux.Handle("POST /api/photos", a.auth(http.HandlerFunc(a.uploadPhoto)))
	mux.Handle("GET /api/conversations", a.auth(http.HandlerFunc(a.conversations)))
	mux.Handle("GET /api/conversations/{id}", a.auth(http.HandlerFunc(a.conversation)))
	mux.Handle("GET /api/conversations/{id}/messages", a.auth(http.HandlerFunc(a.messages)))
	mux.Handle("POST /api/conversations/{id}/messages", a.auth(http.HandlerFunc(a.sendMessage)))
	mux.Handle("POST /api/conversations/{id}/read", a.auth(http.HandlerFunc(a.readConversation)))
	mux.Handle("POST /api/conversations/{id}/attachments", a.auth(http.HandlerFunc(a.uploadConversationAttachment)))
	mux.Handle("DELETE /api/messages/{id}", a.auth(http.HandlerFunc(a.deleteMessage)))
	mux.Handle("GET /api/listings", a.auth(http.HandlerFunc(a.loads)))
	mux.Handle("POST /api/listings", a.auth(http.HandlerFunc(a.createLoad)))
	mux.Handle("GET /api/listings/{id}", a.auth(http.HandlerFunc(a.load)))
	mux.Handle("PUT /api/listings/{id}", a.auth(http.HandlerFunc(a.updateLoad)))
	mux.Handle("PATCH /api/listings/{id}/status", a.auth(http.HandlerFunc(a.updateStatus)))
	mux.Handle("DELETE /api/listings/{id}", a.auth(http.HandlerFunc(a.deleteLoad)))
	mux.Handle("POST /api/listings/{id}/publish", a.auth(http.HandlerFunc(a.publish)))
	mux.Handle("GET /api/drivers/jobs/nearby", a.auth(http.HandlerFunc(a.nearbyLoads)))
	mux.Handle("POST /api/drivers/jobs/{id}/offers", a.auth(http.HandlerFunc(a.createOffer)))
	mux.Handle("PATCH /api/drivers/jobs/{id}/offers/me", a.auth(http.HandlerFunc(a.withdrawOwnOffer)))
	mux.Handle("GET /api/drivers/offers", a.auth(http.HandlerFunc(a.driverOffers)))
	return requestID(logging(cors(mux)))
}
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Ping(); err != nil {
		jsonResponse(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable", "service": "nakliye-api", "storage": "redis", "error": "veri deposuna ulaşılamıyor"})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok", "service": "nakliye-api", "storage": "redis"})
}
func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var req struct{ Name, Email, Phone, Password, Role string }
	if !decode(w, r, &req) {
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Phone = normalizePhone(req.Phone)
	if req.Name == "" || !strings.Contains(req.Email, "@") || !validTurkishPhone(req.Phone) || len(req.Password) < 8 || (req.Role != "customer" && req.Role != "driver") {
		badRequest(w, "ad, geçerli e-posta ve telefon, en az 8 karakter şifre ve rol zorunludur")
		return
	}
	if _, e := a.store.GetUserByEmail(req.Email); e == nil {
		conflict(w, "bu e-posta zaten kayıtlı")
		return
	}
	if _, e := a.store.GetUserByPhone(req.Phone); e == nil {
		conflict(w, "bu telefon numarası zaten kayıtlı")
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		serverError(w, err)
		return
	}
	u := models.User{ID: uuid.NewString(), Name: req.Name, Email: req.Email, Phone: req.Phone, Role: req.Role, PasswordHash: hash, CreatedAt: time.Now().UTC()}
	if e := a.store.SaveUser(u); e != nil {
		serverError(w, e)
		return
	}
	a.session(w, u)
}
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var req struct{ Email, Phone, Password string }
	if !decode(w, r, &req) {
		return
	}
	var u models.User
	var e error
	if strings.TrimSpace(req.Email) != "" {
		u, e = a.store.GetUserByEmail(strings.TrimSpace(strings.ToLower(req.Email)))
	} else {
		u, e = a.store.GetUserByPhone(normalizePhone(req.Phone))
	}
	if e != nil || !verifyPassword(u.PasswordHash, req.Password) {
		unauthorized(w, "e-posta veya şifre hatalı")
		return
	}
	a.session(w, u)
}
func normalizePhone(value string) string {
	value = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(value)
	if strings.HasPrefix(value, "0") {
		value = "+90" + strings.TrimPrefix(value, "0")
	}
	if strings.HasPrefix(value, "90") {
		value = "+" + value
	}
	return value
}
func validTurkishPhone(value string) bool {
	if len(value) != 13 || !strings.HasPrefix(value, "+905") {
		return false
	}
	for _, char := range value[1:] {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}
func (a *API) session(w http.ResponseWriter, u models.User) {
	access, e := a.sign(u, 15*time.Minute)
	if e != nil {
		serverError(w, e)
		return
	}
	refresh := uuid.NewString()
	if e = a.store.SaveRefresh(refresh, u.ID, 30*24*time.Hour); e != nil {
		serverError(w, e)
		return
	}
	jsonResponse(w, 200, map[string]any{"accessToken": access, "refreshToken": refresh, "user": publicUser(u)})
}
func (a *API) refresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !decode(w, r, &req) {
		return
	}
	id, e := a.store.ConsumeRefresh(req.RefreshToken)
	if e != nil {
		unauthorized(w, "oturum süresi doldu")
		return
	}
	u, e := a.store.GetUser(id)
	if e != nil {
		unauthorized(w, "kullanıcı bulunamadı")
		return
	}
	a.session(w, u)
}
func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !decode(w, r, &req) {
		return
	}
	_, _ = a.store.ConsumeRefresh(req.RefreshToken)
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) passwordReset(w http.ResponseWriter, r *http.Request) {
	var req struct{ Email string }
	if !decode(w, r, &req) {
		return
	}
	_, _ = a.store.GetUserByEmail(req.Email)
	jsonResponse(w, 202, map[string]string{"message": "Hesap varsa şifre sıfırlama talimatları gönderildi."})
}
func (a *API) me(w http.ResponseWriter, r *http.Request) {
	u, err := a.store.GetUser(current(r).ID)
	if err != nil {
		notFound(w)
		return
	}
	jsonResponse(w, http.StatusOK, publicUser(u))
}
func (a *API) updateMe(w http.ResponseWriter, r *http.Request) {
	principal := current(r)
	user, err := a.store.GetUser(principal.ID)
	if err != nil {
		notFound(w)
		return
	}
	var req struct {
		Name          string               `json:"name"`
		Email         string               `json:"email"`
		Phone         string               `json:"phone"`
		DriverProfile models.DriverProfile `json:"driverProfile"`
	}
	if !decode(w, r, &req) {
		return
	}
	updated := user
	if strings.TrimSpace(req.Name) != "" {
		updated.Name = strings.TrimSpace(req.Name)
	}
	if strings.TrimSpace(req.Email) != "" {
		updated.Email = strings.TrimSpace(strings.ToLower(req.Email))
	}
	if strings.TrimSpace(req.Phone) != "" {
		updated.Phone = normalizePhone(req.Phone)
	}
	if updated.Name == "" || !strings.Contains(updated.Email, "@") || !validTurkishPhone(updated.Phone) {
		badRequest(w, "ad, geçerli e-posta ve telefon zorunludur")
		return
	}
	if existing, getErr := a.store.GetUserByEmail(updated.Email); getErr == nil && existing.ID != user.ID {
		conflict(w, "bu e-posta zaten kayıtlı")
		return
	}
	if existing, getErr := a.store.GetUserByPhone(updated.Phone); getErr == nil && existing.ID != user.ID {
		conflict(w, "bu telefon numarası zaten kayıtlı")
		return
	}
	if principal.Role == "driver" {
		if req.DriverProfile.CapacityKG < 0 || req.DriverProfile.Rating < 0 || req.DriverProfile.Rating > 5 {
			badRequest(w, "şoför profil bilgileri geçersiz")
			return
		}
		updated.DriverProfile = req.DriverProfile
		updated.DriverProfile.CompletedJobs = user.DriverProfile.CompletedJobs
		updated.DriverProfile.Rating = user.DriverProfile.Rating
	}
	if err = a.store.UpdateUser(user, updated); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, publicUser(updated))
}
func (a *API) updatePassword(w http.ResponseWriter, r *http.Request) {
	user, err := a.store.GetUser(current(r).ID)
	if err != nil {
		notFound(w)
		return
	}
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !verifyPassword(user.PasswordHash, req.CurrentPassword) {
		unauthorized(w, "mevcut şifre hatalı")
		return
	}
	if len(req.NewPassword) < 8 {
		badRequest(w, "yeni şifre en az 8 karakter olmalıdır")
		return
	}
	user.PasswordHash, err = hashPassword(req.NewPassword)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = a.store.SaveUser(user); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) loads(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role == "driver" {
		a.driverLoads(w, r)
		return
	}
	q := r.URL.Query()
	offset, _ := strconv.Atoi(q.Get("offset"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	ls, total, e := a.store.ListLoads(p.ID, "", q.Get("status"), q.Get("q"), offset, limit)
	if e != nil {
		serverError(w, e)
		return
	}
	jsonResponse(w, 200, map[string]any{"items": a.withOfferSummary(ls), "total": total, "offset": offset, "limit": limit})
}
func (a *API) myLoads(w http.ResponseWriter, r *http.Request) {
	if current(r).Role != "customer" {
		forbidden(w)
		return
	}
	a.loads(w, r)
}
func isOfferableStatus(status string) bool {
	return status == "published" || status == "offers_received" || status == "open"
}
func (a *API) driverLoads(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != "driver" {
		forbidden(w)
		return
	}
	q := r.URL.Query()
	offset, _ := strconv.Atoi(q.Get("offset"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	all, _, err := a.store.ListLoads("", "", "", q.Get("q"), 0, 500)
	if err != nil {
		serverError(w, err)
		return
	}
	items := make([]models.Load, 0, len(all))
	for _, load := range all {
		if isOfferableStatus(load.Status) || load.AssignedDriver == p.ID {
			items = append(items, load)
		}
	}
	total := len(items)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": a.withOfferSummary(items[offset:end]), "total": total, "offset": offset, "limit": limit})
}
func (a *API) withOfferSummary(loads []models.Load) []models.Load {
	for index := range loads {
		offers, err := a.store.ListOffers(loads[index].ID, "")
		if err != nil {
			continue
		}
		loads[index].OfferCount = len(offers)
		if len(offers) > 0 {
			loads[index].LastOfferTL = offers[0].AmountTL
		}
	}
	return loads
}
func (a *API) nearbyLoads(w http.ResponseWriter, r *http.Request) {
	a.driverLoads(w, r)
}

func (a *API) searchLocations(w http.ResponseWriter, r *http.Request) {
	if !a.mapsAvailable(w, r, "places") {
		return
	}
	if !a.allowLocationRequest(w, r) {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) < 2 {
		badRequest(w, "arama metni en az 2 karakter olmalıdır")
		return
	}
	results, err := a.maps.Autocomplete(r.Context(), query, r.URL.Query().Get("session_token"))
	if err != nil {
		writeRouteError(w, err, "places")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": results})
}

func (a *API) reverseLocation(w http.ResponseWriter, r *http.Request) {
	if !a.mapsAvailable(w, r, "geocoding") {
		return
	}
	if !a.allowLocationRequest(w, r) {
		return
	}
	latitude, latitudeErr := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	longitude, longitudeErr := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if latitudeErr != nil || longitudeErr != nil {
		badRequest(w, "geçerli enlem ve boylam zorunludur")
		return
	}
	result, err := a.maps.Reverse(r.Context(), models.Coordinate{Latitude: latitude, Longitude: longitude})
	if err != nil {
		writeRouteError(w, err, "geocoding")
		return
	}
	jsonResponse(w, http.StatusOK, result)
}

func (a *API) calculateRoute(w http.ResponseWriter, r *http.Request) {
	if !a.mapsAvailable(w, r, "routes") {
		return
	}
	if !a.allowLocationRequest(w, r) {
		return
	}
	var request struct {
		Pickup  models.Coordinate `json:"pickup"`
		Dropoff models.Coordinate `json:"dropoff"`
	}
	if !decode(w, r, &request) {
		return
	}
	route, err := a.maps.Calculate(r.Context(), request.Pickup, request.Dropoff)
	if err != nil {
		writeRouteError(w, err, "routes")
		return
	}
	jsonResponse(w, http.StatusOK, route)
}

func (a *API) allowLocationRequest(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || host == "" {
		host = r.RemoteAddr
	}
	key := host
	if authenticated := current(r); authenticated.ID != "" {
		key = authenticated.ID + ":" + host
	}
	if a.locationRate.Allow(key) {
		return true
	}
	w.Header().Set("Retry-After", "60")
	jsonResponse(w, http.StatusTooManyRequests, map[string]string{"error": "çok fazla konum isteği gönderildi; lütfen kısa süre sonra tekrar deneyin"})
	return false
}

func mapsMessage(operation string) string {
	switch operation {
	case "places":
		return "Adres önerileri alınamadı."
	case "geocoding":
		return "Seçilen konumun açık adresi alınamadı."
	default:
		return "Bu iki konum arasındaki rota hesaplanamadı."
	}
}

func mapsErrorResponse(w http.ResponseWriter, status int, code, message string) {
	jsonResponse(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func (a *API) mapsAvailable(w http.ResponseWriter, r *http.Request, operation string) bool {
	if a.mapsKeyIssue == "" {
		return true
	}
	log.Printf("[GOOGLE %s] request_id=%s status=0 reason=CONFIGURATION message=%q elapsed_ms=0", strings.ToUpper(operation), service.RequestID(r.Context()), a.mapsKeyIssue)
	mapsErrorResponse(w, http.StatusServiceUnavailable, "GOOGLE_MAPS_NOT_CONFIGURED", mapsMessage(operation))
	return false
}

func writeRouteError(w http.ResponseWriter, err error, operations ...string) {
	operation := "routes"
	if len(operations) > 0 {
		operation = operations[0]
	}
	switch {
	case errors.Is(err, service.ErrInvalidCoordinates), errors.Is(err, service.ErrSameCoordinates):
		badRequest(w, err.Error())
	case errors.Is(err, service.ErrRouteNotFound):
		mapsErrorResponse(w, http.StatusUnprocessableEntity, "GOOGLE_ROUTES_NOT_FOUND", mapsMessage("routes"))
	case errors.Is(err, service.ErrPlaceNotFound):
		message := mapsMessage(operation)
		if operation == "geocoding" {
			message = "Bu konum için açık adres bulunamadı."
		}
		mapsErrorResponse(w, http.StatusUnprocessableEntity, "GOOGLE_MAPS_ZERO_RESULTS", message)
	case errors.Is(err, service.ErrGoogleMapsNotConfigured):
		log.Printf("google maps configuration error: %v", err)
		mapsErrorResponse(w, http.StatusServiceUnavailable, "GOOGLE_MAPS_NOT_CONFIGURED", mapsMessage(operation))
	case errors.Is(err, service.ErrGoogleMapsQuotaExceeded):
		mapsErrorResponse(w, http.StatusTooManyRequests, "GOOGLE_MAPS_RESOURCE_EXHAUSTED", mapsMessage(operation))
	case errors.Is(err, context.DeadlineExceeded):
		mapsErrorResponse(w, http.StatusGatewayTimeout, "GOOGLE_MAPS_TIMEOUT", mapsMessage(operation))
	default:
		var googleErr *service.GoogleMapsError
		if errors.As(err, &googleErr) {
			code := "GOOGLE_MAPS_UPSTREAM_ERROR"
			status := http.StatusBadGateway
			reason := strings.ToUpper(googleErr.Reason)
			if googleErr.HTTPStatus == http.StatusUnauthorized || googleErr.HTTPStatus == http.StatusForbidden || strings.Contains(reason, "PERMISSION") || strings.Contains(reason, "API_KEY") || strings.Contains(reason, "BILLING") {
				code, status = "GOOGLE_MAPS_PERMISSION_DENIED", http.StatusServiceUnavailable
			} else if googleErr.HTTPStatus == http.StatusTooManyRequests || strings.Contains(reason, "RESOURCE_EXHAUSTED") || strings.Contains(reason, "QUOTA") {
				code, status = "GOOGLE_MAPS_RESOURCE_EXHAUSTED", http.StatusTooManyRequests
			} else if googleErr.HTTPStatus == 0 {
				code, status = "GOOGLE_MAPS_NETWORK_ERROR", http.StatusServiceUnavailable
			}
			mapsErrorResponse(w, status, code, mapsMessage(operation))
			return
		}
		log.Printf("google maps request failed: %v", err)
		mapsErrorResponse(w, http.StatusServiceUnavailable, "GOOGLE_MAPS_UPSTREAM_ERROR", mapsMessage(operation))
	}
}

// New Google Maps API endpoints return a stable data envelope. The legacy
// aliases above retain their old shape so already-released mobile clients do
// not break during rollout.
func (a *API) mapAutocomplete(w http.ResponseWriter, r *http.Request) {
	if !a.mapsAvailable(w, r, "places") {
		return
	}
	if !a.allowLocationRequest(w, r) {
		return
	}
	input := strings.TrimSpace(r.URL.Query().Get("input"))
	if len([]rune(input)) < 2 {
		badRequest(w, "arama metni en az 2 karakter olmalıdır")
		return
	}
	items, err := a.maps.Autocomplete(r.Context(), input, r.URL.Query().Get("session_token"))
	if err != nil {
		writeRouteError(w, err, "places")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"data": map[string]any{"items": items}})
}

func (a *API) mapPlaceDetails(w http.ResponseWriter, r *http.Request) {
	if !a.mapsAvailable(w, r, "places") {
		return
	}
	if !a.allowLocationRequest(w, r) {
		return
	}
	result, err := a.maps.PlaceDetails(r.Context(), r.PathValue("placeId"), r.URL.Query().Get("session_token"))
	if err != nil {
		writeRouteError(w, err, "places")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"data": result})
}

func (a *API) mapReverseGeocode(w http.ResponseWriter, r *http.Request) {
	if !a.mapsAvailable(w, r, "geocoding") {
		return
	}
	if !a.allowLocationRequest(w, r) {
		return
	}
	var request models.Coordinate
	if !decode(w, r, &request) {
		return
	}
	result, err := a.maps.Reverse(r.Context(), request)
	if err != nil {
		writeRouteError(w, err, "geocoding")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"data": result})
}

type mapRouteResponse struct {
	DistanceMeters  int     `json:"distance_meters"`
	DistanceKM      float64 `json:"distance_km"`
	DurationSeconds int     `json:"duration_seconds"`
	DurationMinutes float64 `json:"duration_minutes"`
	PricePerKM      float64 `json:"price_per_km"`
	EstimatedPrice  float64 `json:"estimated_price"`
	Currency        string  `json:"currency"`
	EncodedPolyline string  `json:"encoded_polyline"`
}

func mapRoute(route service.RouteResult) mapRouteResponse {
	return mapRouteResponse{
		DistanceMeters: route.DistanceMeters, DistanceKM: route.DistanceKM,
		DurationSeconds: route.DurationSeconds, DurationMinutes: route.DurationMinutes,
		PricePerKM: route.PricePerKM, EstimatedPrice: route.EstimatedPriceTL,
		Currency: route.Currency, EncodedPolyline: route.EncodedPolyline,
	}
}

func (a *API) mapCalculateRoute(w http.ResponseWriter, r *http.Request) {
	if !a.mapsAvailable(w, r, "routes") {
		return
	}
	if !a.allowLocationRequest(w, r) {
		return
	}
	var request struct {
		Pickup  models.Coordinate `json:"pickup"`
		Dropoff models.Coordinate `json:"dropoff"`
	}
	if !decode(w, r, &request) {
		return
	}
	route, err := a.maps.Calculate(r.Context(), request.Pickup, request.Dropoff)
	if err != nil {
		writeRouteError(w, err, "routes")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"data": mapRoute(route)})
}

type loadRequest struct {
	Title, Description string
	PhotoURLs          []string          `json:"photoUrls"`
	Dimensions         models.Dimensions `json:"dimensions"`
	Pickup             models.Location   `json:"pickup"`
	Delivery           models.Location   `json:"delivery"`
}

func validLoad(req loadRequest) error {
	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Pickup.Address) == "" || strings.TrimSpace(req.Delivery.Address) == "" {
		return errors.New("başlık, çıkış ve varış zorunludur")
	}
	if !service.ValidCoordinate(models.Coordinate{Latitude: req.Pickup.Latitude, Longitude: req.Pickup.Longitude}) || !service.ValidCoordinate(models.Coordinate{Latitude: req.Delivery.Latitude, Longitude: req.Delivery.Longitude}) {
		return service.ErrInvalidCoordinates
	}
	if req.Dimensions.WeightKG <= 0 {
		return errors.New("ağırlık sıfırdan büyük olmalıdır")
	}
	return nil
}
func (a *API) createLoad(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != "customer" {
		forbidden(w)
		return
	}
	var req loadRequest
	if !decode(w, r, &req) {
		return
	}
	if e := validLoad(req); e != nil {
		badRequest(w, e.Error())
		return
	}
	l, e := a.newLoad(r.Context(), p.ID, req, "draft")
	if e != nil {
		writeRouteError(w, e)
		return
	}
	if e = a.store.SaveLoad(l); e != nil {
		serverError(w, e)
		return
	}
	jsonResponse(w, 201, l)
}
func (a *API) newLoad(ctx context.Context, customerID string, req loadRequest, status string) (models.Load, error) {
	route, e := a.maps.Calculate(ctx,
		models.Coordinate{Latitude: req.Pickup.Latitude, Longitude: req.Pickup.Longitude},
		models.Coordinate{Latitude: req.Delivery.Latitude, Longitude: req.Delivery.Longitude},
	)
	if e != nil {
		return models.Load{}, e
	}
	now := time.Now().UTC()
	return models.Load{
		ID:                   uuid.NewString(),
		CustomerID:           customerID,
		Title:                req.Title,
		Description:          req.Description,
		PhotoURLs:            req.PhotoURLs,
		Dimensions:           req.Dimensions,
		Pickup:               req.Pickup,
		Delivery:             req.Delivery,
		RouteDistanceMeters:  route.DistanceMeters,
		RouteDurationSeconds: route.DurationSeconds,
		PricePerKM:           route.PricePerKM,
		RouteEncodedPolyline: route.EncodedPolyline,
		RouteProvider:        route.RouteProvider,
		RouteCoordinates:     route.RouteCoordinates,
		EstimatedKM:          route.DistanceKM,
		BasePriceTL:          route.EstimatedPriceTL,
		AgreedPriceTL:        route.EstimatedPriceTL,
		Status:               status,
		CreatedAt:            now,
		UpdatedAt:            now,
	}, nil
}
func (a *API) getOwnedLoad(w http.ResponseWriter, r *http.Request) (models.Load, bool) {
	l, e := a.store.GetLoad(r.PathValue("id"))
	if e != nil || l.DeletedAt != nil {
		notFound(w)
		return l, false
	}
	p := current(r)
	if p.Role == "customer" && l.CustomerID != p.ID {
		forbidden(w)
		return l, false
	}
	return l, true
}
func (a *API) load(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	p := current(r)
	if p.Role == "driver" && l.AssignedDriver != "" && l.AssignedDriver != p.ID {
		forbidden(w)
		return
	}
	jsonResponse(w, 200, l)
}
func (a *API) updateLoad(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	if current(r).Role != "customer" || l.Status != "draft" {
		badRequest(w, "yalnızca taslak ilan güncellenebilir")
		return
	}
	var req loadRequest
	if !decode(w, r, &req) {
		return
	}
	if e := validLoad(req); e != nil {
		badRequest(w, e.Error())
		return
	}
	updated, e := a.newLoad(r.Context(), l.CustomerID, req, "draft")
	if e != nil {
		writeRouteError(w, e)
		return
	}
	updated.ID = l.ID
	updated.CreatedAt = l.CreatedAt
	if e = a.store.SaveLoad(updated); e != nil {
		serverError(w, e)
		return
	}
	jsonResponse(w, 200, updated)
}
func (a *API) publish(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	if current(r).Role != "customer" || l.Status != "draft" {
		badRequest(w, "yalnızca taslak ilan yayınlanabilir")
		return
	}
	l.Status = "published"
	l.UpdatedAt = time.Now().UTC()
	if e := a.store.SaveLoad(l); e != nil {
		serverError(w, e)
		return
	}
	jsonResponse(w, 200, l)
}
func (a *API) updateStatus(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	var req struct{ Status string }
	if !decode(w, r, &req) {
		return
	}
	allowed := map[string]bool{"cancelled": true, "in_transit": true, "completed": true}
	if !allowed[req.Status] {
		badRequest(w, "geçersiz durum")
		return
	}
	if current(r).Role == "customer" && req.Status != "cancelled" {
		forbidden(w)
		return
	}
	if current(r).Role == "driver" && (l.AssignedDriver != current(r).ID || (req.Status == "in_transit" && l.Status != "driver_selected")) {
		forbidden(w)
		return
	}
	l.Status = req.Status
	l.UpdatedAt = time.Now().UTC()
	if e := a.store.SaveLoad(l); e != nil {
		serverError(w, e)
		return
	}
	if l.AssignedDriver != "" {
		if e := a.store.SaveConversation(a.conversationRecord(l)); e != nil {
			log.Printf("conversation update after load status: %v", e)
		}
		statusText := map[string]string{
			"cancelled":  "İlan iptal edildi.",
			"in_transit": "Nakliye işlemi başladı.",
			"completed":  "Nakliye tamamlandı.",
		}[l.Status]
		if statusText != "" {
			a.addSystemMessage(l, statusText)
		}
	}
	jsonResponse(w, 200, l)
}
func (a *API) deleteLoad(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	if current(r).Role != "customer" {
		forbidden(w)
		return
	}
	now := time.Now().UTC()
	l.DeletedAt = &now
	l.UpdatedAt = now
	if e := a.store.SaveLoad(l); e != nil {
		serverError(w, e)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) createOffer(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != "driver" {
		forbidden(w)
		return
	}
	l, e := a.store.GetLoad(r.PathValue("id"))
	if e != nil || !isOfferableStatus(l.Status) {
		badRequest(w, "ilan teklif almaya uygun değil")
		return
	}
	var req struct {
		AmountTL                float64 `json:"amountTl"`
		Note                    string  `json:"note"`
		EstimatedArrivalMinutes int     `json:"estimatedArrivalMinutes"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.AmountTL <= 0 || req.EstimatedArrivalMinutes < 0 || req.EstimatedArrivalMinutes > 7*24*60 {
		badRequest(w, "teklif tutarı zorunludur")
		return
	}
	now := time.Now().UTC()
	o, findErr := a.store.FindOfferByLoadDriver(l.ID, p.ID)
	if findErr == nil {
		if o.Status != "pending" {
			badRequest(w, "bu ilan için kapatılmış teklif tekrar değiştirilemez")
			return
		}
		o.AmountTL, o.Note, o.EstimatedArrivalMinutes, o.UpdatedAt = req.AmountTL, strings.TrimSpace(req.Note), req.EstimatedArrivalMinutes, now
		if e = a.store.SaveOffer(o); e != nil {
			serverError(w, e)
			return
		}
		jsonResponse(w, http.StatusOK, o)
		return
	}
	o = models.Offer{ID: uuid.NewString(), LoadID: l.ID, DriverID: p.ID, AmountTL: req.AmountTL, Note: strings.TrimSpace(req.Note), EstimatedArrivalMinutes: req.EstimatedArrivalMinutes, Status: "pending", CreatedAt: now, UpdatedAt: now}
	if e = a.store.SaveOffer(o); e != nil {
		serverError(w, e)
		return
	}
	if l.Status == "published" || l.Status == "open" {
		l.Status, l.UpdatedAt = "offers_received", now
		if e = a.store.SaveLoad(l); e != nil {
			serverError(w, e)
			return
		}
	}
	jsonResponse(w, 201, o)
}
func (a *API) offers(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	l, e := a.store.GetLoad(r.PathValue("id"))
	if e != nil {
		notFound(w)
		return
	}
	if p.Role == "customer" && l.CustomerID != p.ID {
		forbidden(w)
		return
	}
	if p.Role == "driver" {
		forbidden(w)
		return
	}
	os, e := a.store.ListOffers(l.ID, "")
	if e != nil {
		serverError(w, e)
		return
	}
	jsonResponse(w, 200, a.offerViews(os))
}
func (a *API) offerViews(offers []models.Offer) []map[string]any {
	views := make([]map[string]any, 0, len(offers))
	for _, offer := range offers {
		view := map[string]any{"offer": offer}
		if driver, err := a.store.GetUser(offer.DriverID); err == nil {
			view["driver"] = publicUser(driver)
		}
		views = append(views, view)
	}
	return views
}
func (a *API) acceptOffer(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	o, e := a.store.GetOffer(r.PathValue("id"))
	if e != nil || o.Status != "pending" {
		badRequest(w, "teklif bulunamadı veya kapalı")
		return
	}
	l, e := a.store.GetLoad(o.LoadID)
	if e != nil || l.CustomerID != p.ID || p.Role != "customer" {
		forbidden(w)
		return
	}
	l.Status = "driver_selected"
	l.AssignedDriver = o.DriverID
	l.AgreedPriceTL = o.AmountTL
	l.UpdatedAt = time.Now().UTC()
	o.Status = "accepted"
	o.UpdatedAt = l.UpdatedAt
	allOffers, e := a.store.ListOffers(l.ID, "")
	if e != nil {
		serverError(w, e)
		return
	}
	conversation := a.conversationRecord(l)
	if e = a.store.AcceptOffer(l, o, allOffers, conversation); e != nil {
		serverError(w, e)
		return
	}
	a.addOfferMessage(l, o)
	a.addSystemMessage(l, "Teklif kabul edildi.")
	jsonResponse(w, 200, l)
}
func (a *API) updateOffer(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != "driver" {
		forbidden(w)
		return
	}
	offer, err := a.store.GetOffer(r.PathValue("id"))
	if err != nil || offer.DriverID != p.ID || offer.Status != "pending" {
		forbidden(w)
		return
	}
	var req struct {
		AmountTL                float64 `json:"amountTl"`
		Note                    string  `json:"note"`
		EstimatedArrivalMinutes int     `json:"estimatedArrivalMinutes"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.AmountTL <= 0 || req.EstimatedArrivalMinutes < 0 || req.EstimatedArrivalMinutes > 7*24*60 {
		badRequest(w, "geçerli bir teklif fiyatı ve varış süresi girin")
		return
	}
	offer.AmountTL, offer.Note, offer.EstimatedArrivalMinutes, offer.UpdatedAt = req.AmountTL, strings.TrimSpace(req.Note), req.EstimatedArrivalMinutes, time.Now().UTC()
	if err = a.store.SaveOffer(offer); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, offer)
}
func (a *API) driverOffers(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != "driver" {
		forbidden(w)
		return
	}
	items, err := a.store.ListOffers("", p.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	status := r.URL.Query().Get("status")
	response := make([]map[string]any, 0, len(items))
	for _, offer := range items {
		if status != "" && offer.Status != status {
			continue
		}
		load, loadErr := a.store.GetLoad(offer.LoadID)
		if loadErr != nil || load.DeletedAt != nil {
			continue
		}
		response = append(response, map[string]any{"offer": offer, "load": load})
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": response})
}
func (a *API) withdrawOffer(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	o, e := a.store.GetOffer(r.PathValue("id"))
	if e != nil || o.DriverID != p.ID || o.Status != "pending" {
		forbidden(w)
		return
	}
	o.Status = "withdrawn"
	o.UpdatedAt = time.Now().UTC()
	if e = a.store.SaveOffer(o); e != nil {
		serverError(w, e)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) withdrawOwnOffer(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != "driver" {
		forbidden(w)
		return
	}
	o, err := a.store.FindPendingOffer(r.PathValue("id"), p.ID)
	if err != nil {
		notFound(w)
		return
	}
	o.Status = "withdrawn"
	o.UpdatedAt = time.Now().UTC()
	if err = a.store.SaveOffer(o); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) messages(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getMessageLoad(w, r)
	if !ok {
		return
	}
	p := current(r)
	if err := a.store.MarkMessagesDelivered(l.ID, p.ID, time.Now().UTC()); err != nil {
		serverError(w, err)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, nextCursor, hasMore, err := a.store.MessagesPage(l.ID, r.URL.Query().Get("cursor"), limit)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"items":      a.messageViews(l.ID, items),
		"nextCursor": nextCursor,
		"hasMore":    hasMore,
	})
}

func (a *API) conversation(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getMessageLoad(w, r)
	if !ok {
		return
	}
	view, err := a.conversationView(l, current(r))
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"conversation": view, "load": l})
}

func (a *API) conversations(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	var customerID, driverID string
	if p.Role == "customer" {
		customerID = p.ID
	} else {
		driverID = p.ID
	}
	loads, _, err := a.store.ListLoads(customerID, driverID, "", "", 0, 100)
	if err != nil {
		serverError(w, err)
		return
	}
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	filter := r.URL.Query().Get("filter")
	items := make([]models.Conversation, 0, len(loads))
	totalUnread := 0
	for _, load := range loads {
		if load.AssignedDriver == "" {
			continue
		}
		view, viewErr := a.conversationView(load, p)
		if viewErr != nil {
			serverError(w, viewErr)
			return
		}
		searchText := strings.ToLower(view.OtherParty.Name + " " + view.PickupAddress + " " + view.DeliveryAddress)
		if query != "" && !strings.Contains(searchText, query) {
			continue
		}
		if filter == "unread" && view.UnreadCount == 0 {
			continue
		}
		if filter == "active" && load.Status != "driver_selected" && load.Status != "in_transit" {
			continue
		}
		if filter == "completed" && load.Status != "completed" {
			continue
		}
		items = append(items, view)
		totalUnread += view.UnreadCount
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	jsonResponse(w, http.StatusOK, map[string]any{"items": items, "unreadCount": totalUnread})
}

func (a *API) readConversation(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getMessageLoad(w, r)
	if !ok {
		return
	}
	var request struct {
		MessageIDs []string `json:"messageIds"`
	}
	if !decode(w, r, &request) {
		return
	}
	if len(request.MessageIDs) > 100 {
		badRequest(w, "tek istekte en fazla 100 mesaj okunabilir")
		return
	}
	if _, err := a.store.MarkMessageIDsRead(l.ID, current(r).ID, request.MessageIDs, time.Now().UTC()); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) getMessageLoad(w http.ResponseWriter, r *http.Request) (models.Load, bool) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return l, false
	}
	if !a.canAccessMessageLoad(l, current(r)) {
		forbidden(w)
		return l, false
	}
	return l, true
}

func (a *API) canAccessMessageLoad(l models.Load, p principal) bool {
	return l.DeletedAt == nil && l.AssignedDriver != "" && ((p.Role == "customer" && l.CustomerID == p.ID) || (p.Role == "driver" && l.AssignedDriver == p.ID))
}

func (a *API) conversationRecord(l models.Load) models.Conversation {
	return models.Conversation{
		ID: l.ID, LoadID: l.ID, CustomerID: l.CustomerID, DriverID: l.AssignedDriver,
		LoadTitle: l.Title, PickupAddress: l.Pickup.Address, DeliveryAddress: l.Delivery.Address,
		LoadStatus: l.Status, EstimatedKM: l.EstimatedKM, EstimatedPriceTL: l.AgreedPriceTL, UpdatedAt: l.UpdatedAt,
	}
}

func (a *API) conversationView(l models.Load, p principal) (models.Conversation, error) {
	if err := a.store.MarkMessagesDelivered(l.ID, p.ID, time.Now().UTC()); err != nil {
		return models.Conversation{}, err
	}
	conversation := a.conversationRecord(l)
	otherID := l.AssignedDriver
	if p.Role == "driver" {
		otherID = l.CustomerID
	}
	conversation.OtherParty = models.ConversationMember{ID: otherID, Name: "Karşı taraf"}
	if other, err := a.store.GetUser(otherID); err == nil {
		conversation.OtherParty = models.ConversationMember{ID: other.ID, Name: other.Name, Role: other.Role, LastSeenAt: other.LastSeenAt}
	}
	messages, err := a.store.Messages(l.ID)
	if err != nil {
		return models.Conversation{}, err
	}
	if len(messages) > 0 {
		last := messages[len(messages)-1]
		conversation.LastMessage = messagePreview(last)
		conversation.LastMessageType = last.Type
		conversation.LastMessageAt = last.CreatedAt
		conversation.UpdatedAt = last.CreatedAt
	}
	conversation.UnreadCount, err = a.store.UnreadMessageCount(l.ID, p.ID)
	return conversation, err
}

func messagePreview(message models.Message) string {
	if message.DeletedAt != nil {
		return "Bu mesaj silindi."
	}
	switch message.Type {
	case "image":
		return "Fotoğraf gönderdi"
	case "location":
		return "Konum paylaştı"
	case "offer":
		return "Teklif gönderdi"
	case "load":
		return "İlan bilgisi paylaştı"
	case "system":
		return message.Body
	default:
		return message.Body
	}
}

func (a *API) messageViews(loadID string, items []models.Message) []models.Message {
	views := make([]models.Message, 0, len(items))
	for _, message := range items {
		views = append(views, a.messageView(loadID, message))
	}
	return views
}

func (a *API) messageView(loadID string, message models.Message) models.Message {
	if message.ReplyToMessageID != "" {
		if original, err := a.store.GetMessageInLoad(loadID, message.ReplyToMessageID); err == nil {
			message.ReplyTo = &models.MessageReply{
				ID: original.ID, SenderID: original.SenderID, SenderRole: original.SenderRole,
				Type: original.Type, Body: original.Body, AttachmentURL: original.AttachmentURL, DeletedAt: original.DeletedAt,
			}
		}
	}
	return message
}

func (a *API) addOfferMessage(l models.Load, offer models.Offer) {
	now := time.Now().UTC()
	message := models.Message{
		ID: uuid.NewString(), LoadID: l.ID, SenderID: offer.DriverID, SenderRole: "driver", Type: "offer",
		Body: "Teklif gönderdi", OfferID: offer.ID, OfferAmountTL: offer.AmountTL, OfferBasePriceTL: l.BasePriceTL,
		OfferStatus: offer.Status, OfferNote: offer.Note, Status: "sent", CreatedAt: now, UpdatedAt: now,
	}
	if _, _, err := a.store.CreateMessage(message); err != nil {
		log.Printf("offer message could not be persisted: %v", err)
		return
	}
	a.updateConversationPreview(l, message)
	if err := a.store.RecordDomainEvent("message.created", message.ID, message); err != nil {
		log.Printf("offer message event not persisted: %v", err)
	}
}

func (a *API) addSystemMessage(l models.Load, body string) {
	now := time.Now().UTC()
	message := models.Message{
		ID: uuid.NewString(), LoadID: l.ID, SenderID: "system", SenderRole: "system", Type: "system", Body: body,
		Status: "delivered", DeliveredAt: &now, ReadAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if _, _, err := a.store.CreateMessage(message); err != nil {
		log.Printf("system message could not be persisted: %v", err)
		return
	}
	a.updateConversationPreview(l, message)
	if err := a.store.RecordDomainEvent("message.created", message.ID, message); err != nil {
		log.Printf("system message event not persisted: %v", err)
	}
}

func (a *API) updateConversationPreview(l models.Load, message models.Message) {
	conversation := a.conversationRecord(l)
	conversation.LastMessage = messagePreview(message)
	conversation.LastMessageType = message.Type
	conversation.LastMessageAt = message.CreatedAt
	conversation.UpdatedAt = message.CreatedAt
	if err := a.store.SaveConversation(conversation); err != nil {
		log.Printf("conversation preview could not be persisted: %v", err)
	}
}

type messageRequest struct {
	Type               string   `json:"type"`
	Body               string   `json:"body"`
	AttachmentURL      string   `json:"attachmentUrl"`
	AttachmentMimeType string   `json:"attachmentMimeType"`
	Latitude           *float64 `json:"latitude"`
	Longitude          *float64 `json:"longitude"`
	LocationAddress    string   `json:"locationAddress"`
	ReplyToMessageID   string   `json:"replyToMessageId"`
	ClientMessageID    string   `json:"clientMessageId"`
}

func (a *API) sendMessage(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getMessageLoad(w, r)
	if !ok {
		return
	}
	p := current(r)
	var req messageRequest
	if !decode(w, r, &req) {
		return
	}
	messageType := strings.ToLower(strings.TrimSpace(req.Type))
	if messageType == "" {
		messageType = "text"
	}
	if messageType == "system" || messageType == "offer" {
		badRequest(w, "bu mesaj türü yalnızca sistem tarafından oluşturulabilir")
		return
	}
	if messageType != "text" && messageType != "image" && messageType != "location" && messageType != "load" {
		badRequest(w, "geçersiz mesaj türü")
		return
	}
	body := strings.TrimSpace(req.Body)
	if utf8.RuneCountInString(body) > 2000 {
		badRequest(w, "mesaj en fazla 2000 karakter olabilir")
		return
	}
	if req.ClientMessageID != "" && (utf8.RuneCountInString(req.ClientMessageID) > 128 || strings.TrimSpace(req.ClientMessageID) != req.ClientMessageID) {
		badRequest(w, "geçersiz istemci mesaj kimliği")
		return
	}
	switch messageType {
	case "text":
		if body == "" {
			badRequest(w, "mesaj içeriği zorunludur")
			return
		}
	case "image":
		if err := a.validateMessageAttachment(l.ID, p.ID, req.AttachmentURL); err != nil {
			badRequest(w, err.Error())
			return
		}
	case "location":
		if req.Latitude == nil || req.Longitude == nil || !service.ValidCoordinate(models.Coordinate{Latitude: *req.Latitude, Longitude: *req.Longitude}) {
			badRequest(w, "geçerli bir konum zorunludur")
			return
		}
		if utf8.RuneCountInString(strings.TrimSpace(req.LocationAddress)) > 250 {
			badRequest(w, "konum adresi çok uzun")
			return
		}
	case "load":
		// The conversation is already bound to this load. Build its summary on
		// the server instead of trusting a client-supplied load identifier.
		body = strings.TrimSpace(l.Title + "\n" + l.Pickup.Address + " → " + l.Delivery.Address)
	}
	if req.ReplyToMessageID != "" {
		if _, err := a.store.GetMessageInLoad(l.ID, req.ReplyToMessageID); err != nil {
			badRequest(w, "yanıtlanacak mesaj bu konuşmada bulunamadı")
			return
		}
	}
	now := time.Now().UTC()
	m := models.Message{
		ID: uuid.NewString(), LoadID: l.ID, SenderID: p.ID, SenderRole: p.Role, Type: messageType,
		Body: body, AttachmentURL: req.AttachmentURL, AttachmentMimeType: req.AttachmentMimeType,
		Latitude: req.Latitude, Longitude: req.Longitude, LocationAddress: strings.TrimSpace(req.LocationAddress),
		ReplyToMessageID: req.ReplyToMessageID, ClientMessageID: req.ClientMessageID,
		Status: "sent", CreatedAt: now, UpdatedAt: now,
	}
	created, duplicate, err := a.store.CreateMessage(m)
	if err != nil {
		serverError(w, err)
		return
	}
	if !duplicate {
		a.updateConversationPreview(l, created)
		if err := a.store.RecordDomainEvent("message.created", created.ID, created); err != nil {
			log.Printf("message.created event not persisted: %v", err)
		}
	}
	status := http.StatusCreated
	if duplicate {
		status = http.StatusOK
	}
	jsonResponse(w, status, a.messageView(l.ID, created))
}

func (a *API) uploadConversationAttachment(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getMessageLoad(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(a.maxUploadBytes); err != nil {
		badRequest(w, "fotoğraf boyutu limiti aşıldı")
		return
	}
	file, header, err := r.FormFile("photo")
	if err != nil {
		badRequest(w, "photo alanı zorunludur")
		return
	}
	defer file.Close()
	url, err := a.savePhoto(file, header)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	photoID := strings.TrimPrefix(url, "/api/photos/")
	if err := a.store.ClaimMessageAttachment(photoID, current(r).ID, l.ID); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]string{"url": url, "mimeType": strings.ToLower(header.Header.Get("Content-Type"))})
}

func (a *API) validateMessageAttachment(loadID, userID, url string) error {
	if !strings.HasPrefix(url, "/api/photos/") {
		return errors.New("geçerli bir sohbet fotoğrafı zorunludur")
	}
	photoID := strings.TrimPrefix(url, "/api/photos/")
	if photoID == "" || strings.Contains(photoID, "/") {
		return errors.New("geçersiz fotoğraf")
	}
	claim, err := a.store.MessageAttachmentClaim(photoID)
	if err != nil || claim != userID+":"+loadID {
		return errors.New("fotoğraf bu konuşma için yetkilendirilmemiş")
	}
	return nil
}

func (a *API) deleteMessage(w http.ResponseWriter, r *http.Request) {
	message, err := a.store.GetMessage(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	l, err := a.store.GetLoad(message.LoadID)
	if err != nil || !a.canAccessMessageLoad(l, current(r)) {
		forbidden(w)
		return
	}
	p := current(r)
	if message.SenderID != p.ID || message.Type == "system" || message.DeletedAt != nil {
		forbidden(w)
		return
	}
	updated, err := a.store.SoftDeleteMessage(l.ID, message.ID, p.ID, time.Now().UTC())
	if err != nil {
		serverError(w, err)
		return
	}
	if latest, latestErr := a.store.Messages(l.ID); latestErr == nil && len(latest) > 0 {
		a.updateConversationPreview(l, latest[len(latest)-1])
	}
	jsonResponse(w, http.StatusOK, a.messageView(l.ID, updated))
}
func (a *API) uploadPhoto(w http.ResponseWriter, r *http.Request) {
	if e := r.ParseMultipartForm(a.maxUploadBytes); e != nil {
		badRequest(w, "fotoğraf boyutu limiti aşıldı")
		return
	}
	file, header, e := r.FormFile("photo")
	if e != nil {
		badRequest(w, "photo alanı zorunludur")
		return
	}
	defer file.Close()
	url, e := a.savePhoto(file, header)
	if e != nil {
		badRequest(w, e.Error())
		return
	}
	jsonResponse(w, 201, map[string]string{"url": url})
}
func (a *API) uploadLoadPhotos(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	if current(r).Role != "customer" || l.CustomerID != current(r).ID {
		forbidden(w)
		return
	}
	if err := r.ParseMultipartForm(a.maxUploadBytes * 5); err != nil {
		badRequest(w, "fotoğraf boyutu limiti aşıldı")
		return
	}
	files := r.MultipartForm.File["photos"]
	if len(files) == 0 {
		badRequest(w, "en az bir fotoğraf seçin")
		return
	}
	if len(files)+len(l.PhotoURLs) > 5 {
		badRequest(w, "bir ilana en fazla 5 fotoğraf eklenebilir")
		return
	}
	urls := make([]string, 0, len(files))
	for _, header := range files {
		file, err := header.Open()
		if err != nil {
			serverError(w, err)
			return
		}
		url, saveErr := a.savePhoto(file, header)
		_ = file.Close()
		if saveErr != nil {
			badRequest(w, saveErr.Error())
			return
		}
		urls = append(urls, url)
	}
	l.PhotoURLs = append(l.PhotoURLs, urls...)
	l.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveLoad(l); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusCreated, l)
}
func (a *API) savePhoto(file io.Reader, header *multipart.FileHeader) (string, error) {
	contentType := strings.ToLower(strings.TrimSpace(header.Header.Get("Content-Type")))
	allowed := map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}
	if !allowed[contentType] {
		return "", errors.New("yalnızca JPEG, PNG veya WEBP fotoğraf yüklenebilir")
	}
	if header.Size <= 0 || header.Size > a.maxUploadBytes {
		return "", errors.New("fotoğraf boyutu limiti aşıldı")
	}
	if strings.Contains(header.Filename, "/") || strings.Contains(header.Filename, "\\") {
		return "", errors.New("geçersiz dosya adı")
	}
	data, err := io.ReadAll(io.LimitReader(file, a.maxUploadBytes+1))
	if err != nil {
		return "", errors.New("fotoğraf okunamadı")
	}
	if len(data) == 0 || int64(len(data)) > a.maxUploadBytes {
		return "", errors.New("fotoğraf boyutu limiti aşıldı")
	}
	id := uuid.NewString()
	if err = a.store.SavePhoto(id, data, contentType); err != nil {
		return "", err
	}
	return "/api/photos/" + id, nil
}
func (a *API) deleteLoadPhoto(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	if current(r).Role != "customer" || l.CustomerID != current(r).ID {
		forbidden(w)
		return
	}
	photoID := r.PathValue("photoID")
	target := "/api/photos/" + photoID
	next := make([]string, 0, len(l.PhotoURLs))
	found := false
	for _, photoURL := range l.PhotoURLs {
		if photoURL == target {
			found = true
			continue
		}
		next = append(next, photoURL)
	}
	if !found {
		notFound(w)
		return
	}
	if err := a.store.DeletePhoto(photoID); err != nil {
		serverError(w, err)
		return
	}
	l.PhotoURLs, l.UpdatedAt = next, time.Now().UTC()
	if err := a.store.SaveLoad(l); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, l)
}
func (a *API) photo(w http.ResponseWriter, r *http.Request) {
	data, ct, e := a.store.GetPhoto(r.PathValue("id"))
	if e != nil {
		notFound(w)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = w.Write(data)
}

func (a *API) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		p, e := a.verify(raw)
		if e != nil {
			unauthorized(w, "oturum gerekli veya süresi dolmuş")
			return
		}
		if touchErr := a.store.TouchUserLastSeen(p.ID, time.Now().UTC()); touchErr != nil {
			log.Printf("last seen update failed for %s: %v", p.ID, touchErr)
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, p)))
	})
}
func current(r *http.Request) principal { p, _ := r.Context().Value(userKey).(principal); return p }
func (a *API) sign(u models.User, ttl time.Duration) (string, error) {
	claims, _ := json.Marshal(map[string]any{"sub": u.ID, "role": u.Role, "exp": time.Now().Add(ttl).Unix()})
	payload := base64.RawURLEncoding.EncodeToString(claims)
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
func (a *API) verify(token string) (principal, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return principal{}, errors.New("token")
	}
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte(parts[0]))
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return principal{}, errors.New("signature")
	}
	var c struct {
		Sub, Role string
		Exp       int64
	}
	data, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil || json.Unmarshal(data, &c) != nil || c.Exp < time.Now().Unix() {
		return principal{}, errors.New("claims")
	}
	return principal{c.Sub, c.Role}, nil
}
func hashPassword(value string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	const memory uint32 = 64 * 1024
	const iterations uint32 = 3
	const parallelism uint8 = 2
	key := argon2.IDKey([]byte(value), salt, iterations, memory, parallelism, 32)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", memory, iterations, parallelism, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}
func verifyPassword(encoded, value string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory, iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) == 0 {
		return false
	}
	actual := argon2.IDKey([]byte(value), salt, iterations, memory, parallelism, uint32(len(expected)))
	return hmac.Equal(expected, actual)
}
func publicUser(u models.User) map[string]any {
	user := map[string]any{"id": u.ID, "name": u.Name, "email": u.Email, "phone": u.Phone, "role": u.Role, "createdAt": u.CreatedAt}
	if !u.LastSeenAt.IsZero() {
		user["lastSeenAt"] = u.LastSeenAt
	}
	if u.Role == "driver" {
		user["driverProfile"] = u.DriverProfile
	}
	return user
}
func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if e := json.NewDecoder(r.Body).Decode(target); e != nil {
		badRequest(w, "geçersiz istek")
		return false
	}
	return true
}
func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func badRequest(w http.ResponseWriter, message string) {
	jsonResponse(w, 400, map[string]string{"error": message})
}
func unauthorized(w http.ResponseWriter, message string) {
	jsonResponse(w, 401, map[string]string{"error": message})
}
func forbidden(w http.ResponseWriter) {
	jsonResponse(w, 403, map[string]string{"error": "bu işlem için yetkiniz yok"})
}
func notFound(w http.ResponseWriter) {
	jsonResponse(w, 404, map[string]string{"error": "kayıt bulunamadı"})
}
func conflict(w http.ResponseWriter, message string) {
	jsonResponse(w, 409, map[string]string{"error": message})
}
func serverError(w http.ResponseWriter, e error) {
	log.Printf("api error: %v", e)
	jsonResponse(w, 500, map[string]string{"error": "sunucu hatası"})
}
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.NewString()
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(service.WithRequestID(r.Context(), id)))
	})
}
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("request_id=%s %s %s %s", service.RequestID(r.Context()), r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

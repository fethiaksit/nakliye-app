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
	"github.com/redis/go-redis/v9"
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
	store             *store.RedisStore
	secret            []byte
	maps              mapsService
	mapsKeyIssue      string
	locationRate      *service.FixedWindowLimiter
	maxUploadBytes    int64
	adminEmail        string
	adminPassword     string
	adminPasswordHash string
	adminSecret       []byte
	adminLoginRate    *service.FixedWindowLimiter
}

type mapsService interface {
	Autocomplete(context.Context, string, string, *models.Coordinate) ([]service.PlaceSuggestion, error)
	PlaceDetails(context.Context, string, string) (service.SearchResult, error)
	Reverse(context.Context, models.Coordinate) (service.SearchResult, error)
	Calculate(context.Context, models.Coordinate, models.Coordinate) (service.RouteResult, error)
}
type principal struct{ ID, Role string }
type contextKey string

const userKey contextKey = "user"

type Options struct {
	Secret                 string
	GoogleMapsServerAPIKey string
	MapsKeyError           string
	PricePerKM             float64
	MaxUploadMB            int
	AdminEmail             string
	AdminPassword          string
	AdminPasswordHash      string
	AdminSecret            string
}

func New(s *store.RedisStore, secret string) *API {
	return NewWithOptions(s, Options{
		Secret:      secret,
		PricePerKM:  service.DefaultPricePerKM,
		MaxUploadMB: 10,
	})
}

func NewWithOptions(s *store.RedisStore, options Options) *API {
	if options.PricePerKM <= 0 {
		options.PricePerKM = service.DefaultPricePerKM
	}
	if options.MaxUploadMB <= 0 || options.MaxUploadMB > 50 {
		options.MaxUploadMB = 10
	}
	return &API{
		store:             s,
		secret:            []byte(options.Secret),
		maps:              service.NewGoogleMapsClient(options.GoogleMapsServerAPIKey, options.PricePerKM),
		mapsKeyIssue:      options.MapsKeyError,
		locationRate:      service.NewFixedWindowLimiter(60, time.Minute),
		maxUploadBytes:    int64(options.MaxUploadMB) << 20,
		adminEmail:        strings.ToLower(strings.TrimSpace(options.AdminEmail)),
		adminPassword:     options.AdminPassword,
		adminPasswordHash: strings.TrimSpace(options.AdminPasswordHash),
		adminSecret:       []byte(options.AdminSecret),
		adminLoginRate:    service.NewFixedWindowLimiter(5, time.Minute),
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
	mux.HandleFunc("POST /api/admin/auth/login", a.adminLogin)
	mux.Handle("GET /api/admin/auth/me", a.adminAuth(http.HandlerFunc(a.adminMe)))
	mux.Handle("GET /api/admin/dashboard", a.adminAuth(http.HandlerFunc(a.adminDashboard)))
	mux.Handle("GET /api/admin/users", a.adminAuth(http.HandlerFunc(a.adminUsers)))
	mux.Handle("GET /api/admin/users/{id}", a.adminAuth(http.HandlerFunc(a.adminUser)))
	mux.Handle("PATCH /api/admin/users/{id}/status", a.adminAuth(http.HandlerFunc(a.adminUserStatus)))
	mux.Handle("GET /api/admin/drivers", a.adminAuth(http.HandlerFunc(a.adminDrivers)))
	mux.Handle("GET /api/admin/drivers/{id}", a.adminAuth(http.HandlerFunc(a.adminDriver)))
	mux.Handle("PATCH /api/admin/drivers/{id}/verification", a.adminAuth(http.HandlerFunc(a.adminDriverVerification)))
	mux.Handle("POST /api/admin/drivers/{id}/documents", a.adminAuth(http.HandlerFunc(a.adminCreateDriverDocument)))
	mux.Handle("PATCH /api/admin/driver-documents/{id}", a.adminAuth(http.HandlerFunc(a.adminReviewDriverDocument)))
	mux.Handle("PATCH /api/admin/vehicles/{id}/verification", a.adminAuth(http.HandlerFunc(a.adminVehicleVerification)))
	mux.Handle("GET /api/admin/loads", a.adminAuth(http.HandlerFunc(a.adminLoads)))
	mux.Handle("GET /api/admin/loads/{id}", a.adminAuth(http.HandlerFunc(a.adminLoad)))
	mux.Handle("PATCH /api/admin/loads/{id}/status", a.adminAuth(http.HandlerFunc(a.adminLoadStatus)))
	mux.Handle("GET /api/admin/complaints", a.adminAuth(http.HandlerFunc(a.adminComplaints)))
	mux.Handle("GET /api/admin/complaints/{id}", a.adminAuth(http.HandlerFunc(a.adminComplaint)))
	mux.Handle("PATCH /api/admin/complaints/{id}", a.adminAuth(http.HandlerFunc(a.adminUpdateComplaint)))
	mux.Handle("GET /api/admin/activity", a.adminAuth(http.HandlerFunc(a.adminActivity)))
	mux.Handle("GET /api/admin/stats", a.adminAuth(http.HandlerFunc(a.adminStats)))
	mux.Handle("GET /api/me", a.auth(http.HandlerFunc(a.me)))
	mux.Handle("PATCH /api/me", a.auth(http.HandlerFunc(a.updateMe)))
	mux.Handle("PATCH /api/me/password", a.auth(http.HandlerFunc(a.updatePassword)))
	mux.HandleFunc("GET /api/photos/{id}", a.photo)
	mux.HandleFunc("GET /api/maps/status", a.mapStatus)
	mux.Handle("GET /api/maps/places/autocomplete", a.auth(http.HandlerFunc(a.mapAutocomplete)))
	mux.Handle("GET /api/maps/places/{placeId}", a.auth(http.HandlerFunc(a.mapPlaceDetails)))
	mux.Handle("POST /api/maps/reverse-geocode", a.auth(http.HandlerFunc(a.mapReverseGeocode)))
	mux.Handle("POST /api/maps/routes/calculate", a.auth(http.HandlerFunc(a.mapCalculateRoute)))
	// Backward-compatible application aliases. They still route through the
	// same Google-only service used by the primary endpoints.
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
	mux.Handle("POST /api/messages/{id}/complaints", a.auth(http.HandlerFunc(a.createMessageComplaint)))
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
	mux.Handle("GET /api/driver/vehicles", a.auth(http.HandlerFunc(a.listVehicles)))
	mux.Handle("POST /api/driver/vehicles", a.auth(http.HandlerFunc(a.createVehicle)))
	mux.Handle("PATCH /api/driver/vehicles/{id}", a.auth(http.HandlerFunc(a.updateVehicle)))
	mux.Handle("DELETE /api/driver/vehicles/{id}", a.auth(http.HandlerFunc(a.deleteVehicle)))
	mux.Handle("PATCH /api/driver/vehicles/{id}/activate", a.auth(http.HandlerFunc(a.activateVehicle)))
	return requestID(logging(cors(mux)))
}
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Ping(); err != nil {
		errorResponse(w, http.StatusServiceUnavailable, "STORAGE_UNAVAILABLE", "veri deposuna ulaşılamıyor", map[string]any{"service": "nakliye-api", "storage": "redis"})
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
	// Public registration intentionally permits only the two mobile roles.
	// Corporate and admin are valid system roles but must be provisioned by a
	// trusted administrative workflow, never by this public endpoint.
	if strings.TrimSpace(req.Name) == "" || !strings.Contains(req.Email, "@") || !validTurkishPhone(req.Phone) || len(req.Password) < 8 || (req.Role != models.RoleCustomer && req.Role != models.RoleDriver) {
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
	u := models.User{ID: uuid.NewString(), Name: strings.TrimSpace(req.Name), Email: req.Email, Phone: req.Phone, Role: req.Role, PasswordHash: hash, AccountStatus: models.AccountStatusActive, CreatedAt: time.Now().UTC()}
	if u.Role == models.RoleDriver {
		u.DriverProfile.VerificationStatus = models.VerificationPending
		u.DriverProfile.LicenseStatus = models.VerificationPending
	}
	if e := a.store.CreateUser(u); errors.Is(e, store.ErrUserExists) {
		conflict(w, "e-posta veya telefon numarası zaten kayıtlı")
		return
	} else if e != nil {
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
	if e != nil || (u.Role != models.RoleCustomer && u.Role != models.RoleDriver) || accountStatus(u) != models.AccountStatusActive || !verifyPassword(u.PasswordHash, req.Password) {
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
	if accountStatus(u) != models.AccountStatusActive || (u.Role != models.RoleCustomer && u.Role != models.RoleDriver) {
		unauthorized(w, "hesap aktif değil")
		return
	}
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
	user := publicUser(u)
	if u.Role == models.RoleDriver {
		if vehicle, err := a.store.GetActiveVehicle(u.ID); err == nil {
			user["activeVehicle"] = vehicle
		}
	}
	jsonResponse(w, 200, map[string]any{"accessToken": access, "refreshToken": refresh, "user": user})
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
	if e != nil || accountStatus(u) != models.AccountStatusActive || (u.Role != models.RoleCustomer && u.Role != models.RoleDriver) {
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
	p := current(r)
	u, err := a.store.GetUser(p.ID)
	if err != nil {
		notFound(w)
		return
	}
	user := publicUser(u)
	if p.Role == models.RoleDriver {
		if vehicle, err := a.store.GetActiveVehicle(p.ID); err == nil {
			user["activeVehicle"] = vehicle
		}
	}
	jsonResponse(w, http.StatusOK, user)
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
	if principal.Role == models.RoleDriver {
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
	if p.Role == models.RoleDriver {
		a.driverLoads(w, r)
		return
	}
	if p.Role != models.RoleCustomer {
		forbidden(w)
		return
	}
	q := r.URL.Query()
	offset, _ := strconv.Atoi(q.Get("offset"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	filter, e := parseLoadFilter(q)
	if e != nil {
		badRequest(w, e.Error())
		return
	}
	ls, total, e := a.store.ListLoads(p.ID, "", filter, offset, limit)
	if e != nil {
		serverError(w, e)
		return
	}
	jsonResponse(w, 200, map[string]any{"items": a.withOfferSummary(ls), "total": total, "offset": offset, "limit": limit})
}
func (a *API) myLoads(w http.ResponseWriter, r *http.Request) {
	if current(r).Role != models.RoleCustomer {
		forbidden(w)
		return
	}
	a.loads(w, r)
}
func isOfferableStatus(status string) bool {
	return status == models.LoadStatusPublished || status == models.LoadStatusOffersReceived || status == models.LoadStatusOpenLegacy
}
func (a *API) driverLoads(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	q := r.URL.Query()
	offset, _ := strconv.Atoi(q.Get("offset"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	filter, err := parseLoadFilter(q)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	items, total, err := a.store.ListDriverLoads(p.ID, filter, offset, limit)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": a.withOfferSummary(items), "total": total, "offset": offset, "limit": limit})
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

// mapQuery is the small URL-query surface needed by parseLoadFilter. Using an
// interface keeps the parser directly testable with url.Values.
type mapQuery interface {
	Get(string) string
}

func parseLoadFilter(queryValues mapQuery) (store.LoadFilter, error) {
	filter := store.LoadFilter{
		Status:      strings.TrimSpace(queryValues.Get("status")),
		Query:       strings.TrimSpace(queryValues.Get("q")),
		UrgencyType: models.UrgencyType(strings.TrimSpace(queryValues.Get("urgencyType"))),
		CargoType:   models.CargoType(strings.TrimSpace(queryValues.Get("cargoType"))),
		VehicleType: models.VehicleType(strings.TrimSpace(queryValues.Get("vehicleType"))),
	}
	if filter.UrgencyType != "" && !models.ValidUrgencyType(filter.UrgencyType) {
		return filter, errors.New("geçersiz urgencyType filtresi")
	}
	if filter.CargoType != "" && !models.ValidCargoType(filter.CargoType) {
		return filter, errors.New("geçersiz cargoType filtresi")
	}
	if filter.VehicleType != "" && !models.ValidVehicleType(filter.VehicleType) {
		return filter, errors.New("geçersiz vehicleType filtresi")
	}
	var err error
	if filter.ScheduledFrom, err = parseOptionalRFC3339(queryValues.Get("scheduledFrom"), "scheduledFrom"); err != nil {
		return filter, err
	}
	if filter.ScheduledTo, err = parseOptionalRFC3339(queryValues.Get("scheduledTo"), "scheduledTo"); err != nil {
		return filter, err
	}
	if filter.ScheduledFrom != nil && filter.ScheduledTo != nil && filter.ScheduledFrom.After(*filter.ScheduledTo) {
		return filter, errors.New("scheduledFrom, scheduledTo değerinden sonra olamaz")
	}
	if filter.PickupElevatorAvailable, err = parseOptionalBool(queryValues.Get("pickupElevatorAvailable"), "pickupElevatorAvailable"); err != nil {
		return filter, err
	}
	if filter.DeliveryElevatorAvailable, err = parseOptionalBool(queryValues.Get("deliveryElevatorAvailable"), "deliveryElevatorAvailable"); err != nil {
		return filter, err
	}
	if filter.HelperNeeded, err = parseOptionalBool(queryValues.Get("helperNeeded"), "helperNeeded"); err != nil {
		return filter, err
	}
	return filter, nil
}

func parseOptionalRFC3339(raw, field string) (*time.Time, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, fmt.Errorf("%s RFC3339 biçiminde olmalıdır", field)
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func parseOptionalBool(raw, field string) (*bool, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		return nil, fmt.Errorf("%s true veya false olmalıdır", field)
	}
	return &parsed, nil
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
	results, err := a.maps.Autocomplete(r.Context(), query, r.URL.Query().Get("session_token"), autocompleteBias(r))
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
	coordinate := models.Coordinate{Latitude: latitude, Longitude: longitude}
	result, err := a.maps.Reverse(r.Context(), coordinate)
	if err != nil {
		log.Printf("[GOOGLE GEOCODING] request_id=%s lat=%.6f lng=%.6f error=%v", service.RequestID(r.Context()), latitude, longitude, err)
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
	errorResponse(w, http.StatusTooManyRequests, "RATE_LIMITED", "çok fazla konum isteği gönderildi; lütfen kısa süre sonra tekrar deneyin", map[string]any{"retryAfterSeconds": 60})
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
	errorResponse(w, status, code, message, map[string]any{})
}

func (a *API) mapStatus(w http.ResponseWriter, r *http.Request) {
	if a.mapsKeyIssue != "" {
		mapsErrorResponse(w, http.StatusServiceUnavailable, "MAPS_NOT_CONFIGURED", "Harita servisi yapılandırılmamış.")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"status": "ok", "provider": "google", "configured": true, "upstreamChecked": false})
}

func (a *API) mapsAvailable(w http.ResponseWriter, r *http.Request, operation string) bool {
	if a.mapsKeyIssue == "" {
		return true
	}
	log.Printf("[GOOGLE %s] request_id=%s status=0 reason=CONFIGURATION message=%q elapsed_ms=0", strings.ToUpper(operation), service.RequestID(r.Context()), a.mapsKeyIssue)
	mapsErrorResponse(w, http.StatusServiceUnavailable, "MAPS_NOT_CONFIGURED", mapsMessage(operation))
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
		mapsErrorResponse(w, http.StatusUnprocessableEntity, "ROUTE_NOT_FOUND", mapsMessage("routes"))
	case errors.Is(err, service.ErrPlaceNotFound):
		message := mapsMessage(operation)
		if operation == "geocoding" {
			message = "Bu konum için açık adres bulunamadı."
		}
		mapsErrorResponse(w, http.StatusUnprocessableEntity, "MAPS_ZERO_RESULTS", message)
	case errors.Is(err, service.ErrGoogleMapsNotConfigured):
		log.Printf("maps configuration error: %v", err)
		mapsErrorResponse(w, http.StatusServiceUnavailable, "MAPS_NOT_CONFIGURED", mapsMessage(operation))
	case errors.Is(err, service.ErrGoogleMapsQuotaExceeded):
		mapsErrorResponse(w, http.StatusTooManyRequests, "MAPS_RESOURCE_EXHAUSTED", mapsMessage(operation))
	case errors.Is(err, context.DeadlineExceeded):
		mapsErrorResponse(w, http.StatusGatewayTimeout, "MAPS_TIMEOUT", mapsMessage(operation))
	default:
		var googleErr *service.GoogleMapsError
		if errors.As(err, &googleErr) {
			writeProviderError(w, googleErr.HTTPStatus, googleErr.Reason, operation)
			return
		}
		log.Printf("maps request failed: %v", err)
		mapsErrorResponse(w, http.StatusServiceUnavailable, "MAPS_UPSTREAM_ERROR", mapsMessage(operation))
	}
}

func writeProviderError(w http.ResponseWriter, upstreamStatus int, upstreamReason, operation string) {
	code := "MAPS_UPSTREAM_ERROR"
	status := http.StatusBadGateway
	reason := strings.ToUpper(upstreamReason)
	if upstreamStatus == http.StatusUnauthorized || upstreamStatus == http.StatusForbidden || strings.Contains(reason, "PERMISSION") || strings.Contains(reason, "API_KEY") || strings.Contains(reason, "AUTH") || strings.Contains(reason, "BILLING") {
		code, status = "MAPS_PERMISSION_DENIED", http.StatusServiceUnavailable
	} else if upstreamStatus == http.StatusTooManyRequests || strings.Contains(reason, "RESOURCE_EXHAUSTED") || strings.Contains(reason, "QUOTA") || strings.Contains(reason, "RATE_LIMIT") {
		code, status = "MAPS_RESOURCE_EXHAUSTED", http.StatusTooManyRequests
	} else if strings.Contains(reason, "INVALID_ARGUMENT") || strings.Contains(reason, "INVALID_REQUEST") {
		code, status = "MAPS_INVALID_REQUEST", http.StatusBadGateway
	} else if upstreamStatus == 0 {
		code, status = "MAPS_NETWORK_ERROR", http.StatusServiceUnavailable
	}
	mapsErrorResponse(w, status, code, mapsMessage(operation))
}

// Maps endpoints return a stable data envelope. The legacy
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
	items, err := a.maps.Autocomplete(r.Context(), input, r.URL.Query().Get("session_token"), autocompleteBias(r))
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
		log.Printf("[GOOGLE PLACES] request_id=%s place_id=%q error=%v", service.RequestID(r.Context()), r.PathValue("placeId"), err)
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
		log.Printf("[GOOGLE GEOCODING] request_id=%s lat=%.6f lng=%.6f error=%v", service.RequestID(r.Context()), request.Latitude, request.Longitude, err)
		writeRouteError(w, err, "geocoding")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"data": result})
}

func autocompleteBias(r *http.Request) *models.Coordinate {
	latitude, latitudeErr := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	longitude, longitudeErr := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if latitudeErr != nil || longitudeErr != nil {
		return nil
	}
	coordinate := models.Coordinate{Latitude: latitude, Longitude: longitude}
	if !service.ValidCoordinate(coordinate) {
		return nil
	}
	return &coordinate
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
	Title                     string
	Description               string
	PhotoURLs                 []string           `json:"photoUrls"`
	Dimensions                models.Dimensions  `json:"dimensions"`
	Pickup                    models.Location    `json:"pickup"`
	Delivery                  models.Location    `json:"delivery"`
	UrgencyType               models.UrgencyType `json:"urgencyType"`
	ScheduledAt               *time.Time         `json:"scheduledAt"`
	CargoType                 models.CargoType   `json:"cargoType"`
	CargoTypeNote             string             `json:"cargoTypeNote"`
	VehicleType               models.VehicleType `json:"vehicleType"`
	PickupFloor               *int               `json:"pickupFloor"`
	DeliveryFloor             *int               `json:"deliveryFloor"`
	PickupElevatorAvailable   bool               `json:"pickupElevatorAvailable"`
	DeliveryElevatorAvailable bool               `json:"deliveryElevatorAvailable"`
	HelperNeeded              bool               `json:"helperNeeded"`
	HelperCount               int                `json:"helperCount"`
}

func normalizeLoadRequest(req *loadRequest) {
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	req.CargoTypeNote = strings.TrimSpace(req.CargoTypeNote)
	if req.ScheduledAt != nil {
		scheduledAt := req.ScheduledAt.UTC()
		req.ScheduledAt = &scheduledAt
	}
	if req.UrgencyType != models.UrgencyScheduled {
		req.ScheduledAt = nil
	}
	if !req.HelperNeeded {
		req.HelperCount = 0
	}
}

func validLoad(req loadRequest, now time.Time) error {
	if req.Title == "" || strings.TrimSpace(req.Pickup.Address) == "" || strings.TrimSpace(req.Delivery.Address) == "" {
		return errors.New("başlık, çıkış ve varış zorunludur")
	}
	if len([]rune(req.Title)) > 120 {
		return errors.New("başlık en fazla 120 karakter olabilir")
	}
	if req.Description == "" || len([]rune(req.Description)) > 2000 {
		return errors.New("açıklama zorunludur ve en fazla 2000 karakter olabilir")
	}
	if !service.ValidCoordinate(models.Coordinate{Latitude: req.Pickup.Latitude, Longitude: req.Pickup.Longitude}) || !service.ValidCoordinate(models.Coordinate{Latitude: req.Delivery.Latitude, Longitude: req.Delivery.Longitude}) {
		return service.ErrInvalidCoordinates
	}
	if req.Dimensions.WeightKG < models.MinWeightKG || req.Dimensions.WeightKG > models.MaxWeightKG {
		return fmt.Errorf("ağırlık %.1f ile %.0f kg arasında olmalıdır", models.MinWeightKG, models.MaxWeightKG)
	}
	for _, dimension := range []float64{req.Dimensions.LengthCM, req.Dimensions.WidthCM, req.Dimensions.HeightCM} {
		if dimension < models.MinDimensionCM || dimension > models.MaxDimensionCM {
			return fmt.Errorf("her ölçü %.0f ile %.0f cm arasında olmalıdır", models.MinDimensionCM, models.MaxDimensionCM)
		}
	}
	if !models.ValidUrgencyType(req.UrgencyType) {
		return errors.New("nakliye zamanı hemen, bugün veya planlı olmalıdır")
	}
	if req.UrgencyType == models.UrgencyScheduled && (req.ScheduledAt == nil || !req.ScheduledAt.After(now)) {
		return errors.New("planlı nakliye tarihi ve saati gelecekte olmalıdır")
	}
	if !models.ValidCargoType(req.CargoType) {
		return errors.New("geçerli bir nakliye türü seçiniz")
	}
	if req.CargoType == models.CargoTypeOther && req.CargoTypeNote == "" {
		return errors.New("diğer nakliye türü için kısa bir açıklama giriniz")
	}
	if len([]rune(req.CargoTypeNote)) > 200 {
		return errors.New("nakliye türü açıklaması en fazla 200 karakter olabilir")
	}
	if !models.ValidVehicleType(req.VehicleType) {
		return errors.New("geçerli bir araç ihtiyacı seçiniz")
	}
	for _, floor := range []*int{req.PickupFloor, req.DeliveryFloor} {
		if floor == nil || *floor < models.MinFloor || *floor > models.MaxFloor {
			return fmt.Errorf("çıkış ve varış katları %d ile %d arasında olmalıdır", models.MinFloor, models.MaxFloor)
		}
	}
	if req.HelperNeeded && (req.HelperCount < 1 || req.HelperCount > models.MaxHelperCount) {
		return fmt.Errorf("yardımcı personel sayısı 1 ile %d arasında olmalıdır", models.MaxHelperCount)
	}
	return nil
}

func normalizeLocation(location models.Location) models.Location {
	location.Address = strings.TrimSpace(location.Address)
	location.PlaceID = strings.TrimSpace(location.PlaceID)
	location.Street = strings.TrimSpace(location.Street)
	location.StreetNumber = strings.TrimSpace(location.StreetNumber)
	location.Neighborhood = strings.TrimSpace(location.Neighborhood)
	location.District = strings.TrimSpace(location.District)
	location.City = strings.TrimSpace(location.City)
	location.Province = strings.TrimSpace(location.Province)
	location.PostalCode = strings.TrimSpace(location.PostalCode)
	location.Country = strings.TrimSpace(location.Country)
	location.CountryCode = strings.ToUpper(strings.TrimSpace(location.CountryCode))
	return location
}

func (a *API) createLoad(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleCustomer {
		forbidden(w)
		return
	}
	var req loadRequest
	if !decode(w, r, &req) {
		return
	}
	normalizeLoadRequest(&req)
	if e := validLoad(req, time.Now().UTC()); e != nil {
		badRequest(w, e.Error())
		return
	}
	l, e := a.newLoad(r.Context(), p.ID, req, models.LoadStatusDraft)
	if e != nil {
		writeRouteError(w, e)
		return
	}
	if e = a.store.SaveLoad(l); e != nil {
		serverError(w, e)
		return
	}
	a.recordLoadStatus(l.ID, "", l.Status, p.ID, p.Role, "İlan oluşturuldu", l.CreatedAt)
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
	// Build the load with all extended fields from the request.
	load := models.Load{
		ID:                        uuid.NewString(),
		CustomerID:                customerID,
		Title:                     req.Title,
		Description:               req.Description,
		PhotoURLs:                 req.PhotoURLs,
		Dimensions:                req.Dimensions,
		Pickup:                    normalizeLocation(req.Pickup),
		Delivery:                  normalizeLocation(req.Delivery),
		RouteDistanceMeters:       route.DistanceMeters,
		RouteDurationSeconds:      route.DurationSeconds,
		PricePerKM:                route.PricePerKM,
		RouteEncodedPolyline:      route.EncodedPolyline,
		RouteProvider:             route.RouteProvider,
		RouteCoordinates:          route.RouteCoordinates,
		EstimatedKM:               route.DistanceKM,
		BasePriceTL:               route.EstimatedPriceTL,
		AgreedPriceTL:             route.EstimatedPriceTL,
		Status:                    status,
		CreatedAt:                 now,
		UpdatedAt:                 now,
		UrgencyType:               req.UrgencyType,
		ScheduledAt:               req.ScheduledAt,
		CargoType:                 req.CargoType,
		CargoTypeNote:             req.CargoTypeNote,
		VehicleType:               req.VehicleType,
		PickupFloor:               req.PickupFloor,
		DeliveryFloor:             req.DeliveryFloor,
		PickupElevatorAvailable:   req.PickupElevatorAvailable,
		DeliveryElevatorAvailable: req.DeliveryElevatorAvailable,
		HelperNeeded:              req.HelperNeeded,
		HelperCount:               req.HelperCount,
	}
	return load, nil
}
func (a *API) getOwnedLoad(w http.ResponseWriter, r *http.Request) (models.Load, bool) {
	l, e := a.store.GetLoad(r.PathValue("id"))
	if e != nil || l.DeletedAt != nil {
		notFound(w)
		return l, false
	}
	p := current(r)
	switch p.Role {
	case models.RoleCustomer:
		if l.CustomerID != p.ID {
			forbidden(w)
			return l, false
		}
	case models.RoleDriver:
		// Driver access is narrowed further by each operation.
	default:
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
	if p.Role == models.RoleDriver {
		if !isOfferableStatus(l.Status) && l.AssignedDriver != p.ID {
			forbidden(w)
			return
		}
	}
	jsonResponse(w, 200, l)
}
func (a *API) updateLoad(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	if current(r).Role != models.RoleCustomer || l.Status != models.LoadStatusDraft {
		badRequest(w, "yalnızca taslak ilan güncellenebilir")
		return
	}
	var req loadRequest
	if !decode(w, r, &req) {
		return
	}
	normalizeLoadRequest(&req)
	if e := validLoad(req, time.Now().UTC()); e != nil {
		badRequest(w, e.Error())
		return
	}
	updated, e := a.newLoad(r.Context(), l.CustomerID, req, models.LoadStatusDraft)
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
	if current(r).Role != models.RoleCustomer || l.Status != models.LoadStatusDraft {
		badRequest(w, "yalnızca taslak ilan yayınlanabilir")
		return
	}
	from := l.Status
	l.Status = models.LoadStatusPublished
	l.UpdatedAt = time.Now().UTC()
	if e := a.store.SaveLoad(l); e != nil {
		serverError(w, e)
		return
	}
	a.recordLoadStatus(l.ID, from, l.Status, current(r).ID, current(r).Role, "İlan yayınlandı", l.UpdatedAt)
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
	allowed := map[string]bool{models.LoadStatusCancelled: true, models.LoadStatusInTransit: true, models.LoadStatusCompleted: true}
	if !allowed[req.Status] {
		badRequest(w, "geçersiz durum")
		return
	}
	p := current(r)
	switch p.Role {
	case models.RoleCustomer:
		if req.Status != models.LoadStatusCancelled || l.CustomerID != p.ID || l.Status == models.LoadStatusCompleted || l.Status == models.LoadStatusCancelled {
			forbidden(w)
			return
		}
	case models.RoleDriver:
		validTransition := (req.Status == models.LoadStatusInTransit && l.Status == models.LoadStatusDriverSelected) || (req.Status == models.LoadStatusCompleted && l.Status == models.LoadStatusInTransit)
		if l.AssignedDriver != p.ID || !validTransition {
			forbidden(w)
			return
		}
	default:
		forbidden(w)
		return
	}
	from := l.Status
	l.Status = req.Status
	l.UpdatedAt = time.Now().UTC()
	if e := a.store.SaveLoad(l); e != nil {
		serverError(w, e)
		return
	}
	a.recordLoadStatus(l.ID, from, l.Status, p.ID, p.Role, "Durum mobil akıştan güncellendi", l.UpdatedAt)
	if l.AssignedDriver != "" {
		if e := a.store.SaveConversation(a.conversationRecord(l)); e != nil {
			log.Printf("conversation update after load status: %v", e)
		}
		statusText := map[string]string{
			models.LoadStatusCancelled: "İlan iptal edildi.",
			models.LoadStatusInTransit: "Nakliye işlemi başladı.",
			models.LoadStatusCompleted: "Nakliye tamamlandı.",
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
	if current(r).Role != models.RoleCustomer {
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
	if p.Role != models.RoleDriver {
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
	if l.Status == models.LoadStatusPublished || l.Status == models.LoadStatusOpenLegacy {
		from := l.Status
		l.Status, l.UpdatedAt = models.LoadStatusOffersReceived, now
		if e = a.store.SaveLoad(l); e != nil {
			serverError(w, e)
			return
		}
		a.recordLoadStatus(l.ID, from, l.Status, p.ID, p.Role, "İlk teklif alındı", l.UpdatedAt)
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
	if p.Role == models.RoleCustomer && l.CustomerID != p.ID {
		forbidden(w)
		return
	}
	if p.Role == models.RoleDriver {
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
			if vehicle, err := a.store.GetActiveVehicle(offer.DriverID); err == nil {
				view["vehicle"] = vehicle
			}
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
	if e != nil || l.CustomerID != p.ID || p.Role != models.RoleCustomer {
		forbidden(w)
		return
	}
	from := l.Status
	l.Status = models.LoadStatusDriverSelected
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
	a.recordLoadStatus(l.ID, from, l.Status, p.ID, p.Role, "Teklif kabul edildi", l.UpdatedAt)
	a.addOfferMessage(l, o)
	a.addSystemMessage(l, "Teklif kabul edildi.")
	jsonResponse(w, 200, l)
}
func (a *API) updateOffer(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
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
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	items, err := a.store.ListOffers("", p.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	activeVehicle, _ := a.store.GetActiveVehicle(p.ID)
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
		item := map[string]any{"offer": offer, "load": load}
		if activeVehicle.ID != "" {
			item["vehicle"] = activeVehicle
		}
		response = append(response, item)
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
	if p.Role != models.RoleDriver {
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
func (a *API) listVehicles(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	vehicles, err := a.store.ListVehicles(p.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": vehicles})
}
func (a *API) createVehicle(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	var req struct {
		VehicleType  string  `json:"vehicleType"`
		Brand        string  `json:"brand"`
		Model        string  `json:"model"`
		LicensePlate string  `json:"licensePlate"`
		CapacityKG   float64 `json:"capacityKg"`
		LengthCM     float64 `json:"lengthCm"`
		WidthCM      float64 `json:"widthCm"`
		HeightCM     float64 `json:"heightCm"`
		PhotoURL     string  `json:"photoUrl"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.VehicleType = strings.TrimSpace(req.VehicleType)
	req.Brand = strings.TrimSpace(req.Brand)
	req.Model = strings.TrimSpace(req.Model)
	req.LicensePlate = strings.TrimSpace(strings.ToUpper(req.LicensePlate))
	if req.VehicleType == "" || req.Brand == "" || req.Model == "" || req.LicensePlate == "" || req.CapacityKG <= 0 {
		badRequest(w, "araç tipi, marka, model, plaka ve kapasite zorunludur")
		return
	}
	if !models.ValidVehicleType(models.VehicleType(req.VehicleType)) {
		badRequest(w, "geçersiz araç tipi")
		return
	}
	existing, err := a.store.ListVehicles(p.ID)
	if err == nil {
		for _, v := range existing {
			if v.LicensePlate == req.LicensePlate {
				conflict(w, "bu plaka zaten kayıtlı")
				return
			}
		}
	}
	now := time.Now().UTC()
	v := models.Vehicle{
		ID:                 uuid.NewString(),
		DriverID:           p.ID,
		VehicleType:        req.VehicleType,
		Brand:              req.Brand,
		Model:              req.Model,
		LicensePlate:       req.LicensePlate,
		CapacityKG:         req.CapacityKG,
		LengthCM:           req.LengthCM,
		WidthCM:            req.WidthCM,
		HeightCM:           req.HeightCM,
		PhotoURL:           strings.TrimSpace(req.PhotoURL),
		IsActive:           false,
		CreatedAt:          now,
		UpdatedAt:          now,
		VerificationStatus: models.VerificationPending,
	}
	if err = a.store.SaveVehicle(v); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusCreated, v)
}
func (a *API) updateVehicle(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	vehicleID := r.PathValue("id")
	v, err := a.store.GetVehicle(vehicleID)
	if err != nil {
		notFound(w)
		return
	}
	if v.DriverID != p.ID {
		forbidden(w)
		return
	}
	var req struct {
		VehicleType  string  `json:"vehicleType"`
		Brand        string  `json:"brand"`
		Model        string  `json:"model"`
		LicensePlate string  `json:"licensePlate"`
		CapacityKG   float64 `json:"capacityKg"`
		LengthCM     float64 `json:"lengthCm"`
		WidthCM      float64 `json:"widthCm"`
		HeightCM     float64 `json:"heightCm"`
		PhotoURL     string  `json:"photoUrl"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.VehicleType = strings.TrimSpace(req.VehicleType)
	req.Brand = strings.TrimSpace(req.Brand)
	req.Model = strings.TrimSpace(req.Model)
	req.LicensePlate = strings.TrimSpace(strings.ToUpper(req.LicensePlate))
	if req.VehicleType != "" && !models.ValidVehicleType(models.VehicleType(req.VehicleType)) {
		badRequest(w, "geçersiz araç tipi")
		return
	}
	if req.LicensePlate != "" && req.LicensePlate != v.LicensePlate {
		existing, err := a.store.ListVehicles(p.ID)
		if err == nil {
			for _, ev := range existing {
				if ev.LicensePlate == req.LicensePlate {
					conflict(w, "bu plaka zaten kayıtlı")
					return
				}
			}
		}
	}
	if req.VehicleType != "" {
		v.VehicleType = req.VehicleType
	}
	if req.Brand != "" {
		v.Brand = req.Brand
	}
	if req.Model != "" {
		v.Model = req.Model
	}
	if req.LicensePlate != "" {
		v.LicensePlate = req.LicensePlate
	}
	if req.CapacityKG > 0 {
		v.CapacityKG = req.CapacityKG
	}
	if req.LengthCM > 0 {
		v.LengthCM = req.LengthCM
	}
	if req.WidthCM > 0 {
		v.WidthCM = req.WidthCM
	}
	if req.HeightCM > 0 {
		v.HeightCM = req.HeightCM
	}
	if req.PhotoURL != "" {
		v.PhotoURL = strings.TrimSpace(req.PhotoURL)
	}
	v.UpdatedAt = time.Now().UTC()
	if err = a.store.SaveVehicle(v); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, v)
}
func (a *API) deleteVehicle(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	vehicleID := r.PathValue("id")
	v, err := a.store.GetVehicle(vehicleID)
	if err != nil {
		notFound(w)
		return
	}
	if v.DriverID != p.ID {
		forbidden(w)
		return
	}
	if v.IsActive {
		badRequest(w, "aktif araç silinemez; önce başka bir aracı aktif edin")
		return
	}
	if err = a.store.DeleteVehicle(p.ID, vehicleID); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) activateVehicle(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	vehicleID := r.PathValue("id")
	v, err := a.store.GetVehicle(vehicleID)
	if err != nil {
		notFound(w)
		return
	}
	if v.DriverID != p.ID {
		forbidden(w)
		return
	}
	if err = a.store.SetActiveVehicle(p.ID, vehicleID); err != nil {
		if errors.Is(err, redis.Nil) {
			notFound(w)
			return
		}
		serverError(w, err)
		return
	}
	updated, _ := a.store.GetVehicle(vehicleID)
	jsonResponse(w, http.StatusOK, updated)
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
	if p.Role == models.RoleCustomer {
		customerID = p.ID
	} else if p.Role == models.RoleDriver {
		driverID = p.ID
	} else {
		forbidden(w)
		return
	}
	loads, _, err := a.store.ListLoads(customerID, driverID, store.LoadFilter{}, 0, 0)
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
		if filter == "active" && load.Status != models.LoadStatusDriverSelected && load.Status != models.LoadStatusInTransit {
			continue
		}
		if filter == "completed" && load.Status != models.LoadStatusCompleted {
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
	return l.DeletedAt == nil && l.AssignedDriver != "" && ((p.Role == models.RoleCustomer && l.CustomerID == p.ID) || (p.Role == models.RoleDriver && l.AssignedDriver == p.ID))
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
	if p.Role == models.RoleDriver {
		otherID = l.CustomerID
	}
	conversation.OtherParty = models.ConversationMember{ID: otherID, Name: "Karşı taraf"}
	if other, err := a.store.GetUser(otherID); err == nil {
		conversation.OtherParty = models.ConversationMember{ID: other.ID, Name: other.Name, Role: other.Role, LastSeenAt: other.LastSeenAt}
		if other.Role == models.RoleDriver {
			if vehicle, err := a.store.GetActiveVehicle(other.ID); err == nil {
				conversation.OtherParty.Vehicle = &vehicle
			}
		}
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
	r.Body = http.MaxBytesReader(w, r.Body, a.maxUploadBytes+(1<<20))
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
	r.Body = http.MaxBytesReader(w, r.Body, a.maxUploadBytes+(1<<20))
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
	if current(r).Role != models.RoleCustomer || l.CustomerID != current(r).ID {
		forbidden(w)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, (a.maxUploadBytes*5)+(2<<20))
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
	cleanup := func() {
		for _, savedURL := range urls {
			_ = a.store.DeletePhoto(strings.TrimPrefix(savedURL, "/api/photos/"))
		}
	}
	for _, header := range files {
		file, err := header.Open()
		if err != nil {
			serverError(w, err)
			return
		}
		url, saveErr := a.savePhoto(file, header)
		_ = file.Close()
		if saveErr != nil {
			cleanup()
			badRequest(w, saveErr.Error())
			return
		}
		urls = append(urls, url)
	}
	l.PhotoURLs = append(l.PhotoURLs, urls...)
	l.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveLoad(l); err != nil {
		cleanup()
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusCreated, l)
}
func (a *API) savePhoto(file io.Reader, header *multipart.FileHeader) (string, error) {
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
	contentType := strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	allowed := map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}
	if !allowed[contentType] {
		return "", errors.New("yalnızca JPEG, PNG veya WEBP fotoğraf yüklenebilir")
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
	if current(r).Role != models.RoleCustomer || l.CustomerID != current(r).ID {
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
		u, userErr := a.store.GetUser(p.ID)
		if userErr != nil || (u.Role != models.RoleCustomer && u.Role != models.RoleDriver) || u.Role != p.Role || accountStatus(u) != models.AccountStatusActive {
			unauthorized(w, "oturum kullanıcısı artık geçerli değil")
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
	user := map[string]any{"id": u.ID, "name": u.Name, "email": u.Email, "phone": u.Phone, "role": u.Role, "accountStatus": accountStatus(u), "createdAt": u.CreatedAt}
	if !u.LastSeenAt.IsZero() {
		user["lastSeenAt"] = u.LastSeenAt
	}
	if u.Role == models.RoleDriver {
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
	errorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", message, map[string]any{})
}
func unauthorized(w http.ResponseWriter, message string) {
	errorResponse(w, http.StatusUnauthorized, "UNAUTHORIZED", message, map[string]any{})
}
func forbidden(w http.ResponseWriter) {
	errorResponse(w, http.StatusForbidden, "FORBIDDEN", "bu işlem için yetkiniz yok", map[string]any{})
}
func notFound(w http.ResponseWriter) {
	errorResponse(w, http.StatusNotFound, "NOT_FOUND", "kayıt bulunamadı", map[string]any{})
}
func conflict(w http.ResponseWriter, message string) {
	errorResponse(w, http.StatusConflict, "CONFLICT", message, map[string]any{})
}
func serverError(w http.ResponseWriter, e error) {
	log.Printf("request_id=%s unexpected_api_error=%q", w.Header().Get("X-Request-ID"), e)
	errorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "sunucu hatası", map[string]any{})
}
func errorResponse(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	if details == nil {
		details = map[string]any{}
	}
	jsonResponse(w, status, map[string]any{
		"success":   false,
		"error":     map[string]any{"code": code, "message": message, "details": details},
		"requestId": w.Header().Get("X-Request-ID"),
	})
}
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
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
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		log.Printf("request_id=%s method=%s path=%s status=%d duration=%s", service.RequestID(r.Context()), r.Method, r.URL.Path, recorder.status, time.Since(started).Round(time.Millisecond))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *statusRecorder) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusRecorder) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

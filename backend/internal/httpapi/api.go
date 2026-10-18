package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/argon2"
	"io"
	"log"
	"log/slog"
	"mime/multipart"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"nakliye-api/internal/store"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type API struct {
	store             *store.RedisStore
	pricing           service.PricingConfig
	secret            []byte
	push              PushSender
	maps              mapsService
	mapsKeyIssue      string
	locationRate      *service.FixedWindowLimiter
	deliveryCodeRate  *service.FixedWindowLimiter
	maxUploadBytes    int64
	adminEmail        string
	adminPassword     string
	adminPasswordHash string
	adminSecret       []byte
	adminLoginRate    *service.FixedWindowLimiter
	emailSender       service.EmailSender
	resetRequestRate  *service.FixedWindowLimiter
	resetVerifyRate   *service.FixedWindowLimiter
	sentry            *service.SentryClient
	maintenanceMode   bool
}

type mapsService interface {
	Autocomplete(context.Context, string, string, *models.Coordinate) ([]service.PlaceSuggestion, error)
	PlaceDetails(context.Context, string, string) (service.SearchResult, error)
	Reverse(context.Context, models.Coordinate) (service.SearchResult, error)
	Calculate(context.Context, models.Coordinate, models.Coordinate, ...models.Coordinate) (service.RouteResult, error)
}
type principal struct{ ID, Role string }
type contextKey string

const userKey contextKey = "user"

type Options struct {
	Secret                 string
	GoogleMapsServerAPIKey string
	MapsKeyError           string
	Pricing                service.PricingConfig
	// PricePerKM is retained for source compatibility with older test and
	// integration callers. Active pricing uses vehicle-specific Pricing tariffs.
	PricePerKM        float64
	MaxUploadMB       int
	AdminEmail        string
	AdminPassword     string
	AdminPasswordHash string
	AdminSecret       string
	PushSender        PushSender
	EmailSender       service.EmailSender
	ResendAPIKey      string
	ResendFromEmail   string
	ResendAPIURL      string
	SentryDSN         string
	Environment       string
	AppVersion        string
	SentryClient      *service.SentryClient
	MaintenanceMode   bool
}

func New(s *store.RedisStore, secret string) *API {
	return NewWithOptions(s, Options{
		Secret:      secret,
		PricePerKM:  service.DefaultPricePerKM,
		MaxUploadMB: 10,
	})
}

func NewWithOptions(s *store.RedisStore, options Options) *API {
	pricing := options.Pricing
	if pricing.BaseDriverFee <= 0 && pricing.PricePerKM <= 0 {
		pricing = service.DefaultPricingConfig()
	}
	if pricing.PricePerKM <= 0 {
		pricing.PricePerKM = service.DefaultPricePerKM
	}
	if options.MaxUploadMB <= 0 || options.MaxUploadMB > 50 {
		options.MaxUploadMB = 10
	}
	pushSender := options.PushSender
	if pushSender == nil {
		pushSender = newExpoPushSender(s)
	}
	emailSender := options.EmailSender
	if emailSender == nil {
		emailSender = service.NewResendClient(options.ResendAPIKey, options.ResendFromEmail, options.ResendAPIURL)
	}
	sentryClient := options.SentryClient
	if sentryClient == nil && options.SentryDSN != "" {
		sentryClient = service.NewSentryClient(options.SentryDSN, options.Environment, options.AppVersion)
	}
	return &API{
		store:             s,
		pricing:           pricing,
		secret:            []byte(options.Secret),
		push:              pushSender,
		maps:              service.NewGoogleMapsClientWithPricing(options.GoogleMapsServerAPIKey, pricing),
		mapsKeyIssue:      options.MapsKeyError,
		locationRate:      service.NewFixedWindowLimiter(60, time.Minute),
		deliveryCodeRate:  service.NewFixedWindowLimiter(10, time.Minute),
		maxUploadBytes:    int64(options.MaxUploadMB) << 20,
		adminEmail:        strings.ToLower(strings.TrimSpace(options.AdminEmail)),
		adminPassword:     options.AdminPassword,
		adminPasswordHash: strings.TrimSpace(options.AdminPasswordHash),
		adminSecret:       []byte(options.AdminSecret),
		adminLoginRate:    service.NewFixedWindowLimiter(5, time.Minute),
		emailSender:       emailSender,
		resetRequestRate:  service.NewFixedWindowLimiter(3, 5*time.Minute),
		resetVerifyRate:   service.NewFixedWindowLimiter(10, 5*time.Minute),
		sentry:            sentryClient,
		maintenanceMode:   options.MaintenanceMode,
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
	mux.HandleFunc("POST /api/auth/forgot-password", a.forgotPassword)
	mux.HandleFunc("POST /api/auth/password-reset", a.forgotPassword)
	mux.HandleFunc("POST /api/auth/verify-reset-code", a.verifyResetCode)
	mux.HandleFunc("POST /api/auth/reset-password", a.resetPassword)
	mux.HandleFunc("POST /api/admin/auth/login", a.adminLogin)
	mux.Handle("GET /api/admin/auth/me", a.adminAuth(http.HandlerFunc(a.adminMe)))
	mux.Handle("GET /api/admin/dashboard", a.adminAuth(http.HandlerFunc(a.adminDashboard)))
	mux.Handle("GET /api/admin/users", a.adminAuth(http.HandlerFunc(a.adminUsers)))
	mux.Handle("GET /api/admin/users/{id}", a.adminAuth(http.HandlerFunc(a.adminUser)))
	mux.Handle("PATCH /api/admin/users/{id}/status", a.adminAuth(http.HandlerFunc(a.adminUserStatus)))
	mux.Handle("GET /api/admin/driver-wallets", a.adminAuth(http.HandlerFunc(a.adminDriverWalletAccounts)))
	mux.Handle("GET /api/admin/driver-wallets/payment-account", a.adminAuth(http.HandlerFunc(a.adminDriverPaymentAccount)))
	mux.Handle("PUT /api/admin/driver-wallets/payment-account", a.adminAuth(http.HandlerFunc(a.adminDriverPaymentAccount)))
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
	mux.Handle("GET /api/admin/corporate-accounts", a.adminAuth(http.HandlerFunc(a.adminCorporateApplications)))
	mux.Handle("GET /api/admin/corporate-accounts/{id}", a.adminAuth(http.HandlerFunc(a.adminCorporateApplications)))
	mux.Handle("PATCH /api/admin/corporate-accounts/{id}", a.adminAuth(http.HandlerFunc(a.adminCorporateApplications)))
	mux.Handle("PATCH /api/admin/corporate-accounts/{id}/status", a.adminAuth(http.HandlerFunc(a.adminCorporateApplications)))
	mux.Handle("GET /api/admin/corporate-applications", a.adminAuth(http.HandlerFunc(a.adminCorporateApplications)))
	mux.Handle("GET /api/admin/corporate-applications/{id}", a.adminAuth(http.HandlerFunc(a.adminCorporateApplications)))
	mux.Handle("PATCH /api/admin/corporate-applications/{id}", a.adminAuth(http.HandlerFunc(a.adminCorporateApplications)))
	mux.Handle("GET /api/admin/corporate-wallets/settings", a.adminAuth(http.HandlerFunc(a.adminWalletSettings)))
	mux.Handle("PUT /api/admin/corporate-wallets/settings", a.adminAuth(http.HandlerFunc(a.adminWalletSettings)))
	mux.Handle("GET /api/admin/corporate-wallets", a.adminAuth(http.HandlerFunc(a.adminWalletList)))
	mux.Handle("GET /api/admin/corporate-wallets/{id}", a.adminAuth(http.HandlerFunc(a.adminWallet)))
	mux.Handle("PATCH /api/admin/corporate-wallets/{id}/rate", a.adminAuth(http.HandlerFunc(a.adminWalletRate)))
	mux.Handle("POST /api/admin/corporate-wallets/{id}/adjustments", a.adminAuth(http.HandlerFunc(a.adminWalletAdjustment)))
	mux.Handle("GET /api/admin/account-deletion-requests", a.adminAuth(http.HandlerFunc(a.adminAccountDeletionRequests)))
	mux.Handle("PATCH /api/admin/account-deletion-requests/{id}", a.adminAuth(http.HandlerFunc(a.adminProcessAccountDeletionRequest)))
	mux.Handle("GET /api/me", a.auth(http.HandlerFunc(a.me)))
	mux.Handle("PATCH /api/me", a.auth(http.HandlerFunc(a.updateMe)))
	mux.Handle("PATCH /api/me/password", a.auth(http.HandlerFunc(a.updatePassword)))
	mux.Handle("POST /api/me/agreements", a.auth(http.HandlerFunc(a.updateAgreements)))
	mux.Handle("POST /api/me/delete-account", a.auth(http.HandlerFunc(a.deleteMyAccount)))
	mux.HandleFunc("POST /api/account-deletion-requests", a.requestAccountDeletionPublic)
	mux.Handle("GET /api/corporate/company", a.auth(http.HandlerFunc(a.corporateCompany)))
	mux.Handle("PATCH /api/corporate/company", a.auth(http.HandlerFunc(a.updateCorporateCompany)))
	mux.Handle("GET /api/corporate/dashboard", a.auth(http.HandlerFunc(a.corporateDashboard)))
	mux.Handle("GET /api/corporate/wallet", a.auth(http.HandlerFunc(a.corporateWallet)))
	mux.Handle("GET /api/corporate/loads/{id}/wallet", a.auth(http.HandlerFunc(a.corporateLoadWallet)))
	mux.Handle("POST /api/corporate/loads/{id}/wallet", a.auth(http.HandlerFunc(a.applyCorporateWallet)))
	mux.Handle("GET /api/corporate/favorite-drivers", a.auth(http.HandlerFunc(a.favoriteDrivers)))
	mux.Handle("POST /api/corporate/favorite-drivers", a.auth(http.HandlerFunc(a.addFavoriteDriver)))
	mux.Handle("DELETE /api/corporate/favorite-drivers/{id}", a.auth(http.HandlerFunc(a.removeFavoriteDriver)))
	mux.Handle("POST /api/push/token", a.auth(http.HandlerFunc(a.registerPushToken)))
	mux.Handle("DELETE /api/push/token", a.auth(http.HandlerFunc(a.deletePushToken)))
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
	mux.Handle("POST /api/pricing/estimate", a.auth(http.HandlerFunc(a.estimatePricing)))
	mux.Handle("POST /api/loads", a.auth(http.HandlerFunc(a.createLoad)))
	mux.Handle("GET /api/loads/{id}", a.auth(http.HandlerFunc(a.load)))
	mux.Handle("PUT /api/loads/{id}", a.auth(http.HandlerFunc(a.updateLoad)))
	mux.Handle("PATCH /api/loads/{id}/status", a.auth(http.HandlerFunc(a.updateStatus)))
	mux.Handle("DELETE /api/loads/{id}", a.auth(http.HandlerFunc(a.deleteLoad)))
	mux.Handle("POST /api/loads/{id}/publish", a.auth(http.HandlerFunc(a.publish)))
	mux.Handle("POST /api/loads/{id}/photos", a.auth(http.HandlerFunc(a.uploadLoadPhotos)))
	mux.Handle("DELETE /api/loads/{id}/photos/{photoID}", a.auth(http.HandlerFunc(a.deleteLoadPhoto)))
	mux.Handle("GET /api/loads/{id}/delivery-code", a.auth(http.HandlerFunc(a.deliveryCode)))
	mux.Handle("POST /api/loads/{id}/complete-delivery", a.auth(http.HandlerFunc(a.completeDelivery)))
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
	mux.Handle("POST /api/loads/{id}/complaints", a.auth(http.HandlerFunc(a.createLoadComplaint)))
	mux.Handle("GET /api/complaints/mine", a.auth(http.HandlerFunc(a.myComplaints)))
	mux.Handle("GET /api/complaints/{id}", a.auth(http.HandlerFunc(a.myComplaint)))
	mux.Handle("POST /api/complaints", a.auth(http.HandlerFunc(a.createSupportRequest)))
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
	mux.Handle("GET /api/driver/wallet", a.auth(http.HandlerFunc(a.driverWallet)))
	mux.Handle("GET /api/admin/drivers/{id}/wallet", a.adminAuth(http.HandlerFunc(a.adminDriverWallet)))
	mux.Handle("POST /api/admin/drivers/{id}/wallet/topups", a.adminAuth(http.HandlerFunc(a.adminDriverTopup)))
	mux.Handle("GET /api/drivers/offers", a.auth(http.HandlerFunc(a.driverOffers)))
	mux.Handle("GET /api/driver/vehicles", a.auth(http.HandlerFunc(a.listVehicles)))
	mux.Handle("POST /api/driver/vehicles", a.auth(http.HandlerFunc(a.createVehicle)))
	mux.Handle("PATCH /api/driver/vehicles/{id}", a.auth(http.HandlerFunc(a.updateVehicle)))
	mux.Handle("DELETE /api/driver/vehicles/{id}", a.auth(http.HandlerFunc(a.deleteVehicle)))
	mux.Handle("PATCH /api/driver/vehicles/{id}/activate", a.auth(http.HandlerFunc(a.activateVehicle)))
	mux.Handle("GET /api/driver/documents", a.auth(http.HandlerFunc(a.listDriverDocuments)))
	mux.Handle("POST /api/driver/documents", a.auth(http.HandlerFunc(a.uploadDriverDocument)))
	mux.Handle("GET /api/driver/documents/{id}", a.auth(http.HandlerFunc(a.driverDocument)))
	return requestID(securityHeaders(a.recovery(a.maintenance(logging(cors(a.globalRateLimit(a.idempotency(gzipMiddleware(mux)))))))))
}
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Ping(); err != nil {
		errorResponse(w, http.StatusServiceUnavailable, "STORAGE_UNAVAILABLE", "veri deposuna ulaşılamıyor", map[string]any{"service": "nakliye-api", "storage": "redis"})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok", "service": "nakliye-api", "storage": "redis"})
}
func (a *API) register(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !a.allowRate(w, "register_ip:"+ip, 10, time.Hour, "çok fazla kayıt denemesi yapıldı; lütfen daha sonra tekrar deneyin") {
		return
	}
	var req struct {
		Name, Email, Phone, Password, Role, AccountType, CompanyName string
		TermsAccepted                                                *bool  `json:"termsAccepted"`
		TermsVersion                                                 string `json:"termsVersion"`
		MarketingConsent                                             bool   `json:"marketingConsent"`
		KVKKAcknowledged                                             bool   `json:"kvkkAcknowledged"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.TermsAccepted == nil || !*req.TermsAccepted {
		badRequest(w, "kayıt olmak için kullanım koşullarını kabul etmelisiniz")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Phone = normalizePhone(req.Phone)
	if req.Email != "" {
		if !a.allowRate(w, "register_email:"+req.Email, 5, time.Hour, "bu e-posta ile çok fazla kayıt denemesi yapıldı; lütfen daha sonra tekrar deneyin") {
			return
		}
	}
	if req.Phone != "" {
		if !a.allowRate(w, "register_phone:"+req.Phone, 5, time.Hour, "bu telefon numarası ile çok fazla kayıt denemesi yapıldı; lütfen daha sonra tekrar deneyin") {
			return
		}
	}
	if req.Role == models.RoleCustomer && strings.TrimSpace(req.AccountType) == "" {
		req.AccountType = models.AccountTypeIndividual
	}
	reqID := service.RequestID(r.Context())
	slog.Info("register_started", "request_id", reqID, "email", req.Email, "phone", req.Phone)

	// Public registration intentionally permits only the two mobile roles.
	// A corporate customer remains a customer role and uses the same auth flow.
	if strings.TrimSpace(req.Name) == "" || !strings.Contains(req.Email, "@") || !validTurkishPhone(req.Phone) || len(req.Password) < 8 || (req.Role != models.RoleCustomer && req.Role != models.RoleDriver) {
		slog.Warn("register_validation_failed", "request_id", reqID, "step", "validation")
		badRequest(w, "ad, geçerli e-posta ve telefon, en az 8 karakter şifre ve rol zorunludur")
		return
	}
	if req.Role == models.RoleCustomer && !models.ValidCustomerAccountType(req.AccountType) || req.Role == models.RoleDriver && req.AccountType != "" {
		slog.Warn("register_validation_failed", "request_id", reqID, "step", "account_type")
		badRequest(w, "geçerli hesap türü zorunludur")
		return
	}
	if req.AccountType == models.AccountTypeCorporate && strings.TrimSpace(req.CompanyName) == "" {
		slog.Warn("register_validation_failed", "request_id", reqID, "step", "company_name")
		badRequest(w, "kurumsal hesap için firma adı zorunludur")
		return
	}
	if _, e := a.store.GetUserByEmail(req.Email); e == nil {
		slog.Warn("register_conflict", "request_id", reqID, "step", "check_email")
		conflict(w, "bu e-posta zaten kayıtlı")
		return
	}
	if _, e := a.store.GetUserByPhone(req.Phone); e == nil {
		slog.Warn("register_conflict", "request_id", reqID, "step", "check_phone")
		conflict(w, "bu telefon numarası zaten kayıtlı")
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		slog.Error("register_hash_failed", "request_id", reqID, "error", err.Error())
		serverError(w, err)
		return
	}
	now := time.Now().UTC()
	termsAccepted := *req.TermsAccepted
	termsVer := strings.TrimSpace(req.TermsVersion)
	if termsVer == "" {
		termsVer = models.CurrentTermsVersion
	}
	u := models.User{
		ID:               uuid.NewString(),
		Name:             strings.TrimSpace(req.Name),
		Email:            req.Email,
		Phone:            req.Phone,
		Role:             req.Role,
		AccountType:      req.AccountType,
		PasswordHash:     hash,
		AccountStatus:    models.AccountStatusActive,
		CreatedAt:        now,
		TermsAccepted:    termsAccepted,
		TermsVersion:     termsVer,
		TermsAcceptedAt:  &now,
		MarketingConsent: req.MarketingConsent,
		KVKKAcknowledged: req.KVKKAcknowledged,
	}
	if req.MarketingConsent {
		u.MarketingConsentAt = &now
	}
	if models.CustomerAccountType(u) == models.AccountTypeCorporate {
		u.CorporateStatus = models.CorporateStatusPending
	}
	if u.Role == models.RoleDriver {
		u.DriverProfile.VerificationStatus = models.VerificationPending
		u.DriverProfile.LicenseStatus = models.VerificationPending
	}
	var createErr error
	if u.Role == models.RoleCustomer && models.CustomerAccountType(u) == models.AccountTypeCorporate {
		company := models.Company{
			ID:               uuid.NewString(),
			OwnerCustomerID:  u.ID,
			Name:             strings.TrimSpace(req.CompanyName),
			AuthorizedPerson: u.Name,
			Phone:            u.Phone,
			Email:            u.Email,
			Status:           models.CorporateStatusPending,
			CreatedAt:        now,
			UpdatedAt:        now,
		}
		wallet := models.CorporateWallet{
			ID:        uuid.NewString(),
			CompanyID: company.ID,
			CreatedAt: now,
			UpdatedAt: now,
		}
		createErr = a.store.CreateCorporateAccount(u, company, wallet)
	} else {
		createErr = a.store.CreateUser(u)
	}
	if errors.Is(createErr, store.ErrUserExists) {
		slog.Warn("register_conflict", "request_id", reqID, "step", "db_insert")
		conflict(w, "e-posta veya telefon numarası zaten kayıtlı")
		return
	} else if createErr != nil {
		slog.Error("register_db_error", "request_id", reqID, "error", service.SanitizeLogString(createErr.Error()))
		serverError(w, createErr)
		return
	}

	_ = a.store.SaveAgreementAudit(models.UserAgreementAudit{
		UserID:           u.ID,
		TermsVersion:     termsVer,
		TermsAccepted:    termsAccepted,
		MarketingConsent: req.MarketingConsent,
		KVKKAcknowledged: req.KVKKAcknowledged,
		IPAddress:        ip,
		UserAgent:        r.UserAgent(),
		CreatedAt:        now,
	})

	slog.Info("register_completed", "request_id", reqID, "user_id", u.ID, "role", u.Role)

	a.session(w, u)
}
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !a.allowRate(w, "login_ip:"+ip, 30, time.Minute, "çok fazla giriş denemesi yapıldı; lütfen 1 dakika sonra tekrar deneyin") {
		return
	}
	var req struct{ Email, Phone, Password string }
	if !decode(w, r, &req) {
		return
	}
	accountIdentifier := strings.TrimSpace(strings.ToLower(req.Email))
	if accountIdentifier == "" {
		accountIdentifier = normalizePhone(req.Phone)
	}
	if accountIdentifier != "" {
		if !a.allowRate(w, "login_acc:"+accountIdentifier, 10, time.Minute, "bu hesap için çok fazla başarısız giriş denendi; lütfen 1 dakika sonra tekrar deneyin") {
			return
		}
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
	user := a.publicUser(u)
	if u.Role == models.RoleDriver {
		if vehicle, err := a.store.GetActiveVehicle(u.ID); err == nil {
			user["activeVehicle"] = vehicle
		}
	}
	jsonResponse(w, 200, map[string]any{"accessToken": access, "refreshToken": refresh, "user": user})
}
func (a *API) refresh(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !a.allowRate(w, "refresh_ip:"+ip, 30, time.Minute, "çok fazla oturum yenileme denemesi yapıldı; lütfen biraz bekleyin") {
		return
	}
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
const genericPasswordResetMessage = "Eğer bu e-posta adresi sistemde kayıtlıysa, 6 haneli doğrulama kodu gönderilmiştir."

func (a *API) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !decode(w, r, &req) {
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		badRequest(w, "geçerli bir e-posta adresi giriniz")
		return
	}

	ip := clientIP(r)
	if !a.allowRate(w, "reset_req:"+email, 3, 5*time.Minute, "çok fazla kod talebinde bulundunuz, lütfen 5 dakika sonra tekrar deneyin") ||
		!a.allowRate(w, "reset_req_ip:"+ip, 10, 5*time.Minute, "çok fazla kod talebinde bulundunuz, lütfen 5 dakika sonra tekrar deneyin") {
		return
	}

	reqID := service.RequestID(r.Context())
	// Güvenlik: Kullanıcının var olup olmadığını dışarı sızdırma.
	u, err := a.store.GetUserByEmail(email)
	if err != nil {
		slog.Warn("password_reset_user_lookup_failed", "request_id", reqID, "email", email)
		jsonResponse(w, http.StatusOK, map[string]any{"success": true, "message": genericPasswordResetMessage})
		return
	}
	if accountStatus(u) != models.AccountStatusActive {
		slog.Warn("password_reset_account_inactive", "request_id", reqID, "email", email, "user_id", u.ID, "status", accountStatus(u))
		jsonResponse(w, http.StatusOK, map[string]any{"success": true, "message": genericPasswordResetMessage})
		return
	}
	userRole := strings.TrimSpace(strings.ToLower(u.Role))
	if userRole != models.RoleCustomer && userRole != models.RoleCorporate && userRole != models.RoleDriver {
		slog.Warn("password_reset_unsupported_role", "request_id", reqID, "email", email, "user_id", u.ID, "role", u.Role)
		jsonResponse(w, http.StatusOK, map[string]any{"success": true, "message": genericPasswordResetMessage})
		return
	}

	// Müşteri / şoför rol kısıtlaması varsa kontrol et
	reqRole := strings.TrimSpace(strings.ToLower(req.Role))
	if reqRole != "" {
		roleMatches := userRole == reqRole || (reqRole == models.RoleCustomer && userRole == models.RoleCorporate)
		if !roleMatches {
			slog.Warn("password_reset_role_mismatch", "request_id", reqID, "email", email, "user_id", u.ID, "user_role", userRole, "req_role", reqRole)
			jsonResponse(w, http.StatusOK, map[string]any{"success": true, "message": genericPasswordResetMessage})
			return
		}
	}

	code, err := generate6DigitCode()
	if err != nil {
		serverError(w, err)
		return
	}

	hashedCode := a.hashResetCode(email, code)
	now := time.Now().UTC()
	rec := store.PasswordResetRecord{
		UserID:     u.ID,
		Email:      email,
		HashedCode: hashedCode,
		Role:       u.Role,
		Attempts:   0,
		CreatedAt:  now,
		ExpiresAt:  now.Add(5 * time.Minute),
	}

	if err := a.store.SavePasswordResetCode(rec, 5*time.Minute); err != nil {
		serverError(w, err)
		return
	}

	if err := a.emailSender.SendPasswordResetCode(r.Context(), email, code); err != nil {
		slog.Error("password_reset_email_failed", "request_id", reqID, "user_id", u.ID, "error", service.SanitizeLogString(err.Error()))
		// Kullanıcıya teknik ayrıntı veya gizli bilgi sızdırmadan genel yanıt ver
		jsonResponse(w, http.StatusOK, map[string]any{"success": true, "message": genericPasswordResetMessage})
		return
	}

	slog.Info("password_reset_code_dispatched", "request_id", reqID, "email", email, "user_id", u.ID, "role", u.Role)
	jsonResponse(w, http.StatusOK, map[string]any{"success": true, "message": genericPasswordResetMessage})
}

func (a *API) verifyResetCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if !decode(w, r, &req) {
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	code := strings.TrimSpace(req.Code)
	if email == "" || len(code) != 6 {
		badRequest(w, "geçerli bir e-posta ve 6 haneli kod giriniz")
		return
	}

	ip := clientIP(r)
	if !a.allowRate(w, "reset_vfy:"+email, 5, 5*time.Minute, "çok fazla deneme yapıldı, lütfen biraz bekleyin") ||
		!a.allowRate(w, "reset_vfy_ip:"+ip, 15, 5*time.Minute, "çok fazla deneme yapıldı, lütfen biraz bekleyin") {
		return
	}

	record, err := a.store.GetPasswordResetCode(email)
	if err != nil || record == nil {
		badRequest(w, "doğrulama kodunun süresi dolmuş veya kod geçersiz")
		return
	}

	if record.Attempts >= 5 {
		_ = a.store.DeletePasswordResetCode(email)
		badRequest(w, "çok fazla hatalı deneme yapıldı. Bu kod iptal edildi, lütfen yeni bir kod talep edin")
		return
	}

	expectedHash := a.hashResetCode(email, code)
	if subtle.ConstantTimeCompare([]byte(record.HashedCode), []byte(expectedHash)) != 1 {
		attempts, _ := a.store.IncrementResetAttempts(email)
		if attempts >= 5 {
			_ = a.store.DeletePasswordResetCode(email)
			badRequest(w, "çok fazla hatalı deneme yapıldı. Bu kod iptal edildi, lütfen yeni bir kod talep edin")
			return
		}
		badRequest(w, "girdiğiniz doğrulama kodu hatalı")
		return
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		serverError(w, err)
		return
	}
	resetToken := hex.EncodeToString(tokenBytes)

	tokenRec := store.PasswordResetTokenRecord{
		UserID:    record.UserID,
		Email:     email,
		CreatedAt: time.Now().UTC(),
	}
	if err := a.store.SavePasswordResetToken(resetToken, tokenRec, 10*time.Minute); err != nil {
		serverError(w, err)
		return
	}

	// Kod bir kez doğrulandıktan sonra silinir (tek kullanımlık)
	_ = a.store.DeletePasswordResetCode(email)

	jsonResponse(w, http.StatusOK, map[string]any{
		"success":    true,
		"message":    "kod başarıyla doğrulandı",
		"resetToken": resetToken,
	})
}

func (a *API) resetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		ResetToken  string `json:"resetToken"`
		Code        string `json:"code"`
		NewPassword string `json:"newPassword"`
	}
	if !decode(w, r, &req) {
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if len(req.NewPassword) < 8 {
		badRequest(w, "yeni şifre en az 8 karakter olmalıdır")
		return
	}

	ip := clientIP(r)
	if !a.allowRate(w, "reset_pwd:"+email, 5, 15*time.Minute, "çok fazla şifre sıfırlama denemesi yapıldı; lütfen 15 dakika sonra tekrar deneyin") ||
		!a.allowRate(w, "reset_pwd_ip:"+ip, 10, 15*time.Minute, "çok fazla şifre sıfırlama denemesi yapıldı; lütfen 15 dakika sonra tekrar deneyin") {
		return
	}

	var userID string
	resetToken := strings.TrimSpace(req.ResetToken)
	if resetToken == "" {
		badRequest(w, "şifre sıfırlama doğrulama belirteci (resetToken) zorunludur; lütfen önce kodu doğrulayın")
		return
	}

	tokenRec, err := a.store.ConsumePasswordResetToken(resetToken)
	if err != nil || tokenRec == nil {
		badRequest(w, "şifre sıfırlama oturumunun süresi dolmuş veya geçersiz, lütfen baştan başlayın")
		return
	}
	if strings.ToLower(tokenRec.Email) != email {
		badRequest(w, "geçersiz şifre sıfırlama oturumu")
		return
	}
	userID = tokenRec.UserID

	user, err := a.store.GetUser(userID)
	if err != nil {
		notFound(w)
		return
	}

	newHash, err := hashPassword(req.NewPassword)
	if err != nil {
		serverError(w, err)
		return
	}

	user.PasswordHash = newHash
	if err := a.store.SaveUser(user); err != nil {
		serverError(w, err)
		return
	}

	// Başarılı şifre değişikliğinde önceki oturumları iptal et
	_ = a.store.RevokeAllUserSessions(user.ID)
	_ = a.store.DeletePasswordResetCode(email)

	jsonResponse(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "şifreniz başarıyla güncellendi, yeni şifrenizle giriş yapabilirsiniz",
	})
}

func (a *API) hashResetCode(email, code string) string {
	h := hmac.New(sha256.New, a.secret)
	h.Write([]byte(strings.ToLower(strings.TrimSpace(email)) + ":" + strings.TrimSpace(code)))
	return hex.EncodeToString(h.Sum(nil))
}

func generate6DigitCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func clientIP(r *http.Request) string {
	// If X-Real-IP is provided by a configured reverse proxy (like Nginx), prefer it.
	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
		if ip := net.ParseIP(realIP); ip != nil {
			return realIP
		}
	}
	// For X-Forwarded-For: In standard reverse-proxy setups, the client's direct connection to the proxy
	// is appended to the list, or the rightmost non-trusted entry is used.
	// We parse and validate IP addresses from X-Forwarded-For.
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		parts := strings.Split(forwarded, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			p := strings.TrimSpace(parts[i])
			if ip := net.ParseIP(p); ip != nil {
				return p
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

// allowRate checks Redis rate limit. If limit is exceeded, it sets Retry-After header and returns HTTP 429.
func (a *API) allowRate(w http.ResponseWriter, key string, limit int, window time.Duration, msg string) bool {
	if a.store == nil {
		return true
	}
	allowed, _, retryAfter, err := a.store.AllowRateLimit(key, limit, window)
	if err != nil {
		log.Printf("[RATE_LIMIT_ERROR] key=%s err=%v", key, err)
		return true // Fail open on Redis connectivity error to prevent system lockout
	}
	if !allowed {
		tooManyRequests(w, msg, retryAfter)
		return false
	}
	return true
}
func (a *API) me(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	u, err := a.store.GetUser(p.ID)
	if err != nil {
		notFound(w)
		return
	}
	user := a.publicUser(u)
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
		Name          string                `json:"name"`
		Email         string                `json:"email"`
		Phone         string                `json:"phone"`
		DriverProfile *models.DriverProfile `json:"driverProfile"`
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
	if principal.Role == models.RoleDriver && req.DriverProfile != nil {
		if req.DriverProfile.CapacityKG < 0 || req.DriverProfile.Rating < 0 || req.DriverProfile.Rating > 5 {
			badRequest(w, "şoför profil bilgileri geçersiz")
			return
		}
		updated.DriverProfile = *req.DriverProfile
		updated.DriverProfile.CompletedJobs = user.DriverProfile.CompletedJobs
		updated.DriverProfile.Rating = user.DriverProfile.Rating
		updated.DriverProfile.LicenseStatus = user.DriverProfile.LicenseStatus
		updated.DriverProfile.VerificationStatus = user.DriverProfile.VerificationStatus
		updated.DriverProfile.VerificationNote = user.DriverProfile.VerificationNote
		updated.DriverProfile.VerifiedAt = user.DriverProfile.VerifiedAt
		updated.DriverProfile.VerifiedBy = user.DriverProfile.VerifiedBy
	}
	if err = a.store.UpdateUser(user, updated); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, a.publicUser(updated))
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

func (a *API) updateAgreements(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	u, err := a.store.GetUser(p.ID)
	if err != nil {
		notFound(w)
		return
	}
	var req struct {
		TermsAccepted    *bool  `json:"termsAccepted"`
		TermsVersion     string `json:"termsVersion"`
		MarketingConsent *bool  `json:"marketingConsent"`
		KVKKAcknowledged *bool  `json:"kvkkAcknowledged"`
	}
	if !decode(w, r, &req) {
		return
	}
	now := time.Now().UTC()
	updated := u
	if req.TermsAccepted != nil && *req.TermsAccepted {
		updated.TermsAccepted = true
		termsVer := strings.TrimSpace(req.TermsVersion)
		if termsVer == "" {
			termsVer = models.CurrentTermsVersion
		}
		updated.TermsVersion = termsVer
		updated.TermsAcceptedAt = &now
	}
	if req.MarketingConsent != nil {
		updated.MarketingConsent = *req.MarketingConsent
		if *req.MarketingConsent {
			updated.MarketingConsentAt = &now
		} else {
			updated.MarketingConsentAt = nil
		}
	}
	if req.KVKKAcknowledged != nil {
		updated.KVKKAcknowledged = *req.KVKKAcknowledged
	}
	if err := a.store.SaveUser(updated); err != nil {
		serverError(w, err)
		return
	}
	_ = a.store.SaveAgreementAudit(models.UserAgreementAudit{
		UserID:           updated.ID,
		TermsVersion:     updated.TermsVersion,
		TermsAccepted:    updated.TermsAccepted,
		MarketingConsent: updated.MarketingConsent,
		KVKKAcknowledged: updated.KVKKAcknowledged,
		IPAddress:        clientIP(r),
		UserAgent:        r.UserAgent(),
		CreatedAt:        now,
	})
	jsonResponse(w, http.StatusOK, a.publicUser(updated))
}

func (a *API) deleteMyAccount(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	u, err := a.store.GetUser(p.ID)
	if err != nil {
		notFound(w)
		return
	}
	var req struct {
		Password string `json:"password"`
		Reason   string `json:"reason,omitempty"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !verifyPassword(u.PasswordHash, req.Password) {
		badRequest(w, "şifre hatalı; hesap silme işlemi doğrulanamadı")
		return
	}

	activeStatuses := map[string]bool{
		models.LoadStatusDriverSelected:    true,
		models.LoadStatusDriverEnRoute:     true,
		models.LoadStatusAtPickup:          true,
		models.LoadStatusPickedUp:          true,
		models.LoadStatusEnRouteToDelivery: true,
	}

	if u.Role == models.RoleCustomer {
		loads, _, err := a.store.ListLoads(u.ID, "", store.LoadFilter{}, 0, 100)
		if err == nil {
			for _, l := range loads {
				if activeStatuses[l.Status] {
					badRequest(w, "devam eden aktif nakliyeniz bulunmaktadır; lütfen önce nakliyenizi tamamlayın veya iptal edin")
					return
				}
			}
		}
	} else if u.Role == models.RoleDriver {
		loads, _, err := a.store.ListLoads("", u.ID, store.LoadFilter{}, 0, 100)
		if err == nil {
			for _, l := range loads {
				if activeStatuses[l.Status] {
					badRequest(w, "üzerinizde devam eden aktif taşıma görevi bulunmaktadır; lütfen önce teslimatı tamamlayın")
					return
				}
			}
		}
	}

	now := time.Now().UTC()
	prevEmail := u.Email
	prevPhone := u.Phone

	if err := a.anonymizeAndCloseAccount(u, req.Reason); err != nil {
		serverError(w, err)
		return
	}

	_ = a.store.SaveAccountDeletionRequest(models.AccountDeletionRequest{
		ID:          uuid.NewString(),
		UserID:      u.ID,
		Email:       prevEmail,
		Phone:       prevPhone,
		Reason:      req.Reason,
		Status:      "completed",
		CreatedAt:   now,
		ProcessedAt: &now,
		ProcessedBy: "user",
	})

	jsonResponse(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"message": "Hesabınız ve kişisel verileriniz başarıyla silindi ve anonimleştirildi.",
	})
}

func (a *API) anonymizeAndCloseAccount(u models.User, reason string) error {
	now := time.Now().UTC()
	prev := u
	u.AccountStatus = models.AccountStatusDeleted
	u.DeletedAt = &now
	u.DeleteReason = strings.TrimSpace(reason)
	u.Name = "Silinmiş Kullanıcı"
	u.PasswordHash = ""
	tombstoneEmail := fmt.Sprintf("deleted-%s@deleted.nakliyego.local", u.ID)
	u.Email = tombstoneEmail
	uPrefix := u.ID
	if len(uPrefix) > 8 {
		uPrefix = uPrefix[:8]
	}
	u.Phone = fmt.Sprintf("+9000%s", uPrefix)

	// 1. Şoför profil bilgilerini anonimleştir
	if u.Role == models.RoleDriver {
		u.DriverProfile.LicensePlate = ""
		u.DriverProfile.ServiceArea = ""
		u.DriverProfile.VehicleModel = ""
		u.DriverProfile.VehicleType = ""
		u.DriverProfile.VerificationNote = "Hesap silindi ve anonimleştirildi"
		u.DriverProfile.NearbyLoadNotifications = false

		// 2. Araç kayıtlarını deaktive et ve plaka/görsel verilerini anonimleştir
		if vehicles, err := a.store.ListVehicles(u.ID); err == nil {
			for _, v := range vehicles {
				v.IsActive = false
				if strings.HasPrefix(v.PhotoURL, "/api/photos/") {
					photoID := strings.TrimPrefix(v.PhotoURL, "/api/photos/")
					_ = a.store.DeletePhoto(photoID)
					v.PhotoURL = ""
				}
				vPrefix := v.ID
				if len(vPrefix) > 8 {
					vPrefix = vPrefix[:8]
				}
				v.LicensePlate = "SİLİNDİ-" + vPrefix
				v.VerificationNote = "Hesap silindi; araç deaktive edildi"
				_ = a.store.SaveVehicle(v)
			}
		}

		// 3. Şoför mesleki belgeleri ve depolama dosyaları:
		// 4925 s. Karayolu Taşıma Kanunu ve zamanaşımı gereğince, onaylanmış resmi belgeler (ehliyet, SRC, psikoteknik, ruhsat)
		// idari denetim için 3 yıl yasal arşivde saklanır (Status = "archived").
		// Yasal saklama gereği olmayan (onaysız, reddedilen veya "other" türündeki) belgelerin gerçek dosyaları storage'dan silinir.
		if docs, err := a.store.ListDriverDocuments(u.ID); err == nil {
			for _, d := range docs {
				isStatutoryLegalDoc := d.Kind == "driver_license" || d.Kind == "src" || d.Kind == "psychotechnic" || d.Kind == "vehicle_registration"
				if isStatutoryLegalDoc && d.Status == "verified" {
					d.Status = "archived"
					d.ReviewNote = "Hesap silindi; 4925 sayılı Kanun gereği 3 yıl yasal arşivde saklanmaktadır"
					_ = a.store.SaveDriverDocument(d)
				} else {
					if strings.HasPrefix(d.FileURL, "/api/photos/") {
						photoID := strings.TrimPrefix(d.FileURL, "/api/photos/")
						_ = a.store.DeletePhoto(photoID)
					}
					d.FileURL = ""
					d.Status = "deleted"
					d.ReviewNote = "Yasal saklama yükümlülüğü bulunmadığından dosya ve veriler güvenli silindi"
					_ = a.store.SaveDriverDocument(d)
				}
			}
		}
	}

	// 4. Kullanıcı ana kaydını ve email/telefon indekslerini güncelle
	if err := a.store.UpdateUser(prev, u); err != nil {
		return err
	}

	// 5. Aktif oturum ve push bildirim tokenlarını iptal et
	_ = a.store.RevokeAllUserSessions(u.ID)
	_ = a.store.RevokeAllUserPushTokens(u.ID)

	return nil
}

func (a *API) requestAccountDeletionPublic(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !a.allowRate(w, "public_deletion_ip:"+ip, 5, time.Hour, "çok fazla talep gönderildi; lütfen daha sonra tekrar deneyin") {
		return
	}
	var req struct {
		Email   string `json:"email"`
		Phone   string `json:"phone"`
		Reason  string `json:"reason"`
		Confirm bool   `json:"confirm"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Phone = normalizePhone(req.Phone)
	if !req.Confirm || (req.Email == "" && req.Phone == "") {
		badRequest(w, "onay kutusu ve e-posta veya telefon bilgisi zorunludur")
		return
	}

	existingRequests, _ := a.store.ListAccountDeletionRequests("pending")
	for _, er := range existingRequests {
		if (req.Email != "" && strings.EqualFold(er.Email, req.Email)) || (req.Phone != "" && er.Phone == req.Phone) {
			jsonResponse(w, http.StatusOK, map[string]any{
				"status":  "received",
				"message": "Hesap silme talebiniz zaten alınmıştır ve inceleme sırasındadır. Güvenlik doğrulaması amacıyla kayıtlı iletişim adresiniz üzerinden sizinle iletişime geçilecektir.",
			})
			return
		}
	}

	var foundUser *models.User
	if req.Email != "" {
		if u, err := a.store.GetUserByEmail(req.Email); err == nil && u.ID != "" {
			foundUser = &u
		}
	}
	if foundUser == nil && req.Phone != "" {
		if u, err := a.store.GetUserByPhone(req.Phone); err == nil && u.ID != "" {
			foundUser = &u
		}
	}

	now := time.Now().UTC()
	reqRecord := models.AccountDeletionRequest{
		ID:        uuid.NewString(),
		Email:     req.Email,
		Phone:     req.Phone,
		Reason:    strings.TrimSpace(req.Reason),
		Status:    "pending",
		CreatedAt: now,
	}
	if foundUser != nil {
		reqRecord.UserID = foundUser.ID
	}
	_ = a.store.SaveAccountDeletionRequest(reqRecord)

	jsonResponse(w, http.StatusOK, map[string]any{
		"status":  "received",
		"message": "Hesap silme talebiniz başarıyla alınmıştır. Güvenlik doğrulaması amacıyla kayıtlı iletişim adresiniz üzerinden sizinle iletişime geçilecektir.",
	})
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
	return models.CanonicalLoadStatus(status) == models.LoadStatusPublished
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
	route = a.normalizeRoutePricing(route)
	jsonResponse(w, http.StatusOK, route)
}

func (a *API) allowLocationRequest(w http.ResponseWriter, r *http.Request) bool {
	ip := clientIP(r)
	key := ip
	if authenticated := current(r); authenticated.ID != "" {
		key = authenticated.ID + ":" + ip
	}
	return a.allowRate(w, "location:"+key, 60, time.Minute, "çok fazla konum isteği gönderildi; lütfen kısa süre sonra tekrar deneyin")
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

func (a *API) normalizeRoutePricing(route service.RouteResult) service.RouteResult {
	route.PricePerKM = a.pricing.PricePerKM
	if pricing, err := service.CalculateEstimatedPrice(a.pricing, service.PricingInput{DistanceKM: route.DistanceKM}); err == nil {
		route.EstimatedPriceTL = pricing.RecommendedPrice
	}
	return route
}

func (a *API) mapRoute(route service.RouteResult) mapRouteResponse {
	route = a.normalizeRoutePricing(route)
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
		Pickup        models.Coordinate   `json:"pickup"`
		Dropoff       models.Coordinate   `json:"dropoff"`
		Intermediates []models.Coordinate `json:"intermediates,omitempty"`
		Stops         []models.Coordinate `json:"stops,omitempty"`
	}
	if !decode(w, r, &request) {
		return
	}
	intermediates := request.Intermediates
	if len(intermediates) == 0 && len(request.Stops) > 0 {
		intermediates = request.Stops
	}
	route, err := a.maps.Calculate(r.Context(), request.Pickup, request.Dropoff, intermediates...)
	if err != nil {
		writeRouteError(w, err, "routes")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"data": a.mapRoute(route)})
}

type loadRequest struct {
	Title                     string             `json:"title"`
	Description               string             `json:"description"`
	PhotoURLs                 []string           `json:"photoUrls"`
	Dimensions                models.Dimensions  `json:"dimensions"`
	Pickup                    models.Location    `json:"pickup"`
	Stops                     []models.Stop      `json:"stops,omitempty"`
	Delivery                  models.Location    `json:"delivery"`
	CargoDetails              map[string]any     `json:"cargoDetails,omitempty"`
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
	WaitingMinutes            int                `json:"waitingMinutes"`
}

func normalizeLoadRequest(req *loadRequest) {
	if req.CargoDetails["capacityInput"] == "simple-v1" {
		capacity, manual, err := service.EstimateCargoCapacity(req.CargoType, req.CargoDetails)
		if err == nil {
			req.Dimensions.VolumeM3 = capacity.VolumeM3
			if req.Dimensions.WeightKG <= 0 {
				req.Dimensions.WeightKG = capacity.WeightKG
			}
			req.CargoDetails["capacityQuoteRequired"] = manual
		}
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	req.CargoTypeNote = strings.TrimSpace(req.CargoTypeNote)
	if req.VehicleType == "" {
		req.VehicleType = models.VehicleTypeFarketmez
	}
	if req.PickupFloor == nil {
		zero := 0
		req.PickupFloor = &zero
	}
	if req.DeliveryFloor == nil {
		zero := 0
		req.DeliveryFloor = &zero
	}
	if req.Dimensions.WeightKG <= 0 {
		req.Dimensions.WeightKG = 50
	}
	if req.Dimensions.LengthCM <= 0 {
		req.Dimensions.LengthCM = 100
	}
	if req.Dimensions.WidthCM <= 0 {
		req.Dimensions.WidthCM = 100
	}
	if req.Dimensions.HeightCM <= 0 {
		req.Dimensions.HeightCM = 100
	}
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
	for i := range req.Stops {
		req.Stops[i].Address = strings.TrimSpace(req.Stops[i].Address)
		req.Stops[i].PlaceID = strings.TrimSpace(req.Stops[i].PlaceID)
		req.Stops[i].Note = strings.TrimSpace(req.Stops[i].Note)
		req.Stops[i].Order = i + 1
		if req.Stops[i].ID == "" {
			req.Stops[i].ID = uuid.NewString()
		}
		if req.Stops[i].StopType == "" {
			req.Stops[i].StopType = models.StopTypePickup
		}
	}
}

func validLoad(req loadRequest, now time.Time) error {
	if req.CargoDetails["capacityInput"] == "simple-v1" {
		if _, _, err := service.EstimateCargoCapacity(req.CargoType, req.CargoDetails); err != nil {
			return err
		}
	}
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
	if len(req.Stops) > 5 {
		return errors.New("en fazla 5 ara durak eklenebilir")
	}
	for _, stop := range req.Stops {
		if strings.TrimSpace(stop.Address) == "" {
			return errors.New("ara durak adresi zorunludur")
		}
		if !service.ValidCoordinate(models.Coordinate{Latitude: stop.Latitude, Longitude: stop.Longitude}) {
			return errors.New("geçersiz ara durak koordinatı")
		}
		if !models.ValidStopType(stop.StopType) {
			return errors.New("geçersiz ara durak türü")
		}
	}
	if req.Dimensions.WeightKG < models.MinWeightKG || req.Dimensions.WeightKG > models.MaxWeightKG {
		return fmt.Errorf("ağırlık %.1f ile %.0f kg arasında olmalıdır", models.MinWeightKG, models.MaxWeightKG)
	}
	for _, dimension := range []float64{req.Dimensions.LengthCM, req.Dimensions.WidthCM, req.Dimensions.HeightCM} {
		if dimension < models.MinDimensionCM || dimension > models.MaxDimensionCM {
			return fmt.Errorf("her ölçü %.0f ile %.0f cm arasında olmalıdır", models.MinDimensionCM, models.MaxDimensionCM)
		}
	}
	if req.Dimensions.VolumeM3 < 0 || req.Dimensions.VolumeM3 > 125000 {
		return errors.New("yük hacmi geçerli bir değer olmalıdır")
	}
	for _, key := range []string{"loadingResponsibility", "unloadingResponsibility"} {
		if v, ok := req.CargoDetails[key]; ok && v != "customer" && v != "driver" {
			return errors.New("yükleme ve boşaltma sorumluluğu müşteri veya şoför olmalıdır")
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
	if req.WaitingMinutes < 0 {
		return errors.New("bekleme süresi negatif olamaz")
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

// Estimate uses the same route and calculation as creation without persisting
// a draft, photos, or status events. Client prices/multipliers are never inputs.
func (a *API) estimatePricing(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleCustomer {
		forbidden(w)
		return
	}
	if !a.mapsAvailable(w, r, "routes") || !a.allowLocationRequest(w, r) {
		return
	}
	var req loadRequest
	if !decode(w, r, &req) {
		return
	}
	normalizeLoadRequest(&req)
	if err := validLoad(req, time.Now().UTC()); err != nil {
		badRequest(w, err.Error())
		return
	}
	load, err := a.newLoad(r.Context(), p.ID, req, models.LoadStatusDraft)
	if err != nil {
		writeRouteError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, load.Pricing)
}

func (a *API) priceLoad(distanceKM float64, req loadRequest, now time.Time) (service.PricingBreakdown, error) {
	// Helper selection supplies handling at either end unless the customer
	// explicitly takes responsibility there. Unsuitable elevators mean stairs.
	handling := func(key string) bool {
		v, _ := req.CargoDetails[key].(string)
		return v == "driver" || (v == "" && req.HelperNeeded)
	}
	suitable := func(key string) bool { v, ok := req.CargoDetails[key].(bool); return !ok || v }
	return service.CalculateEstimatedPrice(a.pricing, service.PricingInput{
		DistanceKM: distanceKM, Dimensions: req.Dimensions, VolumeM3: req.Dimensions.VolumeM3, VehicleType: req.VehicleType,
		HelperCount: req.HelperCount, PickupDriverHandling: handling("loadingResponsibility"), DeliveryDriverHandling: handling("unloadingResponsibility"),
		PickupFloor: req.PickupFloor, DeliveryFloor: req.DeliveryFloor,
		PickupElevatorAvailable: req.PickupElevatorAvailable && suitable("pickupElevatorSuitable"), DeliveryElevatorAvailable: req.DeliveryElevatorAvailable && suitable("deliveryElevatorSuitable"),
		WaitingMinutes: req.WaitingMinutes, RequestedStartAt: req.ScheduledAt, UrgencyType: req.UrgencyType, Now: now,
		ManualQuoteRequired: (req.CargoType == models.CargoTypeEvEsyasi && req.CargoDetails["moveType"] == "komple") || (req.CargoDetails["capacityInput"] == "simple-v1" && req.CargoDetails["capacityQuoteRequired"] == true),
	})
}

func (a *API) createLoad(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleCustomer {
		forbidden(w)
		return
	}
	if !a.allowRate(w, "create_load:"+p.ID, 30, time.Hour, "kısa sürede çok fazla ilan oluşturdunuz; lütfen bir süre bekleyin") {
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
	a.recordLoadStatus(l.ID, "", l.Status, p.ID, p.Role, models.LoadStatusSourceCustomerApp, "İlan oluşturuldu", l.CreatedAt)
	jsonResponse(w, 201, l)
}
func (a *API) newLoad(ctx context.Context, customerID string, req loadRequest, status string) (models.Load, error) {
	var intermediateCoords []models.Coordinate
	for _, stop := range req.Stops {
		intermediateCoords = append(intermediateCoords, models.Coordinate{Latitude: stop.Latitude, Longitude: stop.Longitude})
	}
	route, e := a.maps.Calculate(ctx,
		models.Coordinate{Latitude: req.Pickup.Latitude, Longitude: req.Pickup.Longitude},
		models.Coordinate{Latitude: req.Delivery.Latitude, Longitude: req.Delivery.Longitude},
		intermediateCoords...,
	)
	if e != nil {
		return models.Load{}, e
	}
	now := time.Now().UTC()
	pricing, e := a.priceLoad(route.DistanceKM, req, now)
	if e != nil {
		return models.Load{}, e
	}
	if a.pricingLogEnabled() {
		log.Printf("[PRICING] distance_km=%.2f base_driver_fee=%.2f price_per_km=%.2f distance_fee=%.2f base_price=%.2f load_level=%s load_multiplier=%.2f waiting_fee=%.2f final_price=%.2f", pricing.DistanceKM, pricing.BaseDriverFee, pricing.PricePerKM, pricing.DistanceFee, pricing.BasePrice, pricing.LoadLevel, pricing.LoadMultiplier, pricing.WaitingFee, pricing.FinalPrice)
	}
	// Build the load with all extended fields from the request.
	load := models.Load{
		ID:                        uuid.NewString(),
		CustomerID:                customerID,
		Title:                     req.Title,
		Description:               req.Description,
		PhotoURLs:                 req.PhotoURLs,
		Dimensions:                req.Dimensions,
		Pickup:                    normalizeLocation(req.Pickup),
		Stops:                     req.Stops,
		Delivery:                  normalizeLocation(req.Delivery),
		CargoDetails:              req.CargoDetails,
		RouteDistanceMeters:       route.DistanceMeters,
		RouteDurationSeconds:      route.DurationSeconds,
		PricePerKM:                pricing.PricePerKM,
		RouteEncodedPolyline:      route.EncodedPolyline,
		RouteProvider:             route.RouteProvider,
		RouteCoordinates:          route.RouteCoordinates,
		EstimatedKM:               pricing.DistanceKM,
		BasePriceTL:               pricing.FinalPrice,
		AgreedPriceTL:             0, // Set only when a customer accepts a driver offer.
		Pricing:                   pricingSnapshot(pricing),
		Status:                    status,
		CreatedAt:                 now,
		UpdatedAt:                 now,
		UrgencyType:               req.UrgencyType,
		ScheduledAt:               req.ScheduledAt,
		CargoType:                 req.CargoType,
		CargoTypeNote:             req.CargoTypeNote,
		VehicleType:               req.VehicleType,
		RequestedVehicleType:      req.VehicleType,
		PickupFloor:               req.PickupFloor,
		DeliveryFloor:             req.DeliveryFloor,
		PickupElevatorAvailable:   req.PickupElevatorAvailable,
		DeliveryElevatorAvailable: req.DeliveryElevatorAvailable,
		HelperNeeded:              req.HelperNeeded,
		HelperCount:               req.HelperCount,
	}
	// Drivers and vehicle filters must see the effective class used for pricing.
	// Body style and TIR requirements are retained independently of the tariff.
	if !pricing.ManualQuoteRequired && req.VehicleType != models.VehicleTypeAcikKasa && req.VehicleType != models.VehicleTypeKapaliKasa && req.VehicleType != models.VehicleTypeTir {
		load.VehicleType = pricing.VehicleType
	}
	return load, nil
}

func pricingSnapshot(breakdown service.PricingBreakdown) *models.PricingSnapshot {
	return &models.PricingSnapshot{
		VehicleType: breakdown.VehicleType, IncludedKM: breakdown.IncludedKM, OccupancyRatio: breakdown.OccupancyRatio,
		LoadingFee: breakdown.LoadingFee, PickupFloorFee: breakdown.PickupFloorFee, DeliveryFloorFee: breakdown.DeliveryFloorFee,
		MinPrice: breakdown.MinPrice, MaxPrice: breakdown.MaxPrice, ManualQuoteRequired: breakdown.ManualQuoteRequired, AlgorithmVersion: breakdown.AlgorithmVersion,

		DistanceKM: breakdown.DistanceKM, BaseDriverFee: breakdown.BaseDriverFee,
		PricePerKM: breakdown.PricePerKM, DistanceFee: breakdown.DistanceFee,
		BasePrice: breakdown.BasePrice, LoadLevel: string(breakdown.LoadLevel),
		LoadMultiplier: breakdown.LoadMultiplier, LoadExtra: breakdown.LoadExtra,
		WaitingMinutes: breakdown.WaitingMinutes, WaitingFee: breakdown.WaitingFee,
		NightMultiplier: breakdown.NightMultiplier, UrgentMultiplier: breakdown.UrgentMultiplier,
		HolidayMultiplier: breakdown.HolidayMultiplier, WeekendMultiplier: breakdown.WeekendMultiplier,
		FinalPrice: breakdown.FinalPrice, RecommendedPrice: breakdown.RecommendedPrice,
		Currency: breakdown.Currency,
	}
}

func (a *API) pricingLogEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "development") || strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "test")
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
	if e = a.store.SaveLoadIfUnchanged(l, updated); e != nil {
		writeLoadStatusError(w, e)
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
	event := newLoadStatusEvent(l.ID, from, l.Status, current(r).ID, current(r).Role, models.LoadStatusSourceCustomerApp, "İlan yayınlandı", l.UpdatedAt)
	if e := a.store.TransitionLoadStatus(from, l, event); e != nil {
		writeLoadStatusError(w, e)
		return
	}
	a.pushNearbyLoad(l)
	jsonResponse(w, 200, l)
}
func (a *API) updateStatus(w http.ResponseWriter, r *http.Request) {
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Status = strings.TrimSpace(req.Status)
	if !models.ValidCanonicalLoadStatus(req.Status) || req.Status == models.LoadStatusDraft || req.Status == models.LoadStatusPublished {
		badRequest(w, "geçersiz durum")
		return
	}
	if req.Status == models.LoadStatusCompleted {
		badRequest(w, "tamamlama için teslimat kodu ve fotoğraf doğrulaması zorunludur")
		return
	}
	p := current(r)
	switch p.Role {
	case models.RoleCustomer:
		if req.Status != models.LoadStatusCancelled || l.CustomerID != p.ID {
			forbidden(w)
			return
		}
	case models.RoleDriver:
		if l.AssignedDriver != p.ID {
			forbidden(w)
			return
		}
		if req.Status == models.LoadStatusCancelled {
			forbidden(w)
			return
		}
	default:
		forbidden(w)
		return
	}
	from := l.Status
	if !models.CanTransition(from, req.Status) {
		conflict(w, "geçersiz durum geçişi")
		return
	}
	l.Status = req.Status
	l.UpdatedAt = time.Now().UTC()
	source := models.LoadStatusSourceCustomerApp
	if p.Role == models.RoleDriver {
		source = models.LoadStatusSourceDriverApp
	}
	event := newLoadStatusEvent(l.ID, from, l.Status, p.ID, p.Role, source, "Durum mobil akıştan güncellendi", l.UpdatedAt)
	var transitionErr error
	if l.Status == models.LoadStatusCancelled {
		company, companyErr := a.companyForCorporateCustomer(l.CustomerID)
		if companyErr != nil {
			serverError(w, companyErr)
			return
		}
		reversal := models.WalletTransaction{
			ID: uuid.NewString(), LoadID: l.ID, Type: models.WalletTransactionReversal,
			Description: "İptal edilen nakliye kredi iadesi", PickupAddress: l.Pickup.Address, DeliveryAddress: l.Delivery.Address,
			ActorID: p.ID, ActorRole: p.Role, CreatedAt: l.UpdatedAt,
		}
		if company != nil {
			reversal.CompanyID = company.ID
		}
		_, transitionErr = a.store.TransitionLoadStatusAndReverseWallet(from, l, event, company, reversal)
	} else {
		transitionErr = a.store.TransitionLoadStatus(from, l, event)
	}
	if transitionErr != nil {
		if isWalletError(transitionErr) {
			writeWalletError(w, transitionErr)
		} else {
			writeLoadStatusError(w, transitionErr)
		}
		return
	}
	if l.AssignedDriver != "" {
		if e := a.store.SaveConversation(a.conversationRecord(l)); e != nil {
			log.Printf("conversation update after load status: %v", e)
		}
		statusText := map[string]string{
			models.LoadStatusDriverEnRoute:     "Şoför yola çıktı.",
			models.LoadStatusAtPickup:          "Şoför yükleme noktasına ulaştı.",
			models.LoadStatusPickedUp:          "Yük alındı.",
			models.LoadStatusEnRouteToDelivery: "Yük teslim noktasına gidiyor.",
			models.LoadStatusDelivered:         "Yük teslim edildi.",
			models.LoadStatusCompleted:         "Nakliye tamamlandı.",
			models.LoadStatusCancelled:         "İlan iptal edildi.",
		}[l.Status]
		if statusText != "" {
			a.addSystemMessage(l, statusText)
		}
	}
	a.pushLoadStatus(l, p.ID)
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
	if l.Status != models.LoadStatusDraft && l.Status != models.LoadStatusPublished && l.Status != models.LoadStatusCancelled && l.Status != models.LoadStatusCompleted {
		conflict(w, "Aktif nakliye silinemez. Önce işi iptal edin.")
		return
	}
	original := l
	now := time.Now().UTC()
	l.DeletedAt = &now
	l.UpdatedAt = now
	if e := a.store.SaveLoadIfUnchanged(original, l); e != nil {
		writeLoadStatusError(w, e)
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
	if !a.allowRate(w, "create_offer:"+p.ID, 60, time.Minute, "kısa sürede çok fazla teklif verdiniz; lütfen 1 dakika bekleyin") {
		return
	}
	l, e := a.store.GetLoad(r.PathValue("id"))
	if e != nil || l.DeletedAt != nil || !isOfferableStatus(l.Status) {
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
	if !a.checkDriverOfferBalance(w, p.ID, req.AmountTL) {
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
	a.sendPush(l.CustomerID, "Yeni teklif", "İlanınıza yeni bir şoför teklifi geldi.", map[string]string{"type": "offer", "loadId": l.ID, "screen": "load"})
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
			view["driver"] = a.publicUser(driver)
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
	if l.DeletedAt != nil {
		notFound(w)
		return
	}
	from := l.Status
	if !models.CanTransition(from, models.LoadStatusDriverSelected) {
		conflict(w, "ilan şoför seçimine uygun değil")
		return
	}
	l.Status = models.LoadStatusDriverSelected
	l.AssignedDriver = o.DriverID
	l.AgreedPriceTL = o.AmountTL
	l.DriverCommissionCents, _ = models.DriverCommissionCents(o.AmountTL)
	l.UpdatedAt = time.Now().UTC()
	o.Status = "accepted"
	o.UpdatedAt = l.UpdatedAt
	allOffers, e := a.store.ListOffers(l.ID, "")
	if e != nil {
		serverError(w, e)
		return
	}
	conversation := a.conversationRecord(l)
	event := newLoadStatusEvent(l.ID, from, l.Status, p.ID, p.Role, models.LoadStatusSourceOfferAcceptance, "Teklif kabul edildi", l.UpdatedAt)
	deliveryVerification, e := a.newDeliveryVerification(l)
	if e != nil {
		serverError(w, e)
		return
	}
	if e = a.store.AcceptOffer(l, o, allOffers, conversation, event, deliveryVerification); e != nil {
		if errors.Is(e, store.ErrDriverWalletBalance) {
			conflict(w, "Şoförün kullanılabilir bakiyesi %10 hizmet bedeli için yetersiz. İş atanmadı.")
		} else {
			writeLoadStatusError(w, e)
		}
		return
	}
	a.addOfferMessage(l, o)
	a.addSystemMessage(l, "Teklif kabul edildi.")
	a.sendPush(o.DriverID, "Teklifiniz kabul edildi", fmt.Sprintf("%.2f TL hizmet bedeli bloke edildi. Ücret yalnızca nakliye tamamlandığında tahsil edilecektir.", float64(l.DriverCommissionCents)/100), map[string]string{"type": "driver_selected", "loadId": l.ID, "screen": "load"})
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
	load, loadErr := a.store.GetLoad(offer.LoadID)
	if loadErr != nil || load.DeletedAt != nil || !isOfferableStatus(load.Status) {
		conflict(w, "İlan teklif güncellemeye uygun değil.")
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
	if !a.checkDriverOfferBalance(w, p.ID, req.AmountTL) {
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
func (a *API) listDriverDocuments(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	documents, err := a.store.ListDriverDocuments(p.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": documents})
}
func (a *API) uploadDriverDocument(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	var request struct {
		Kind    string `json:"kind"`
		Title   string `json:"title"`
		FileURL string `json:"fileUrl"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Kind = strings.TrimSpace(request.Kind)
	request.Title = strings.TrimSpace(request.Title)
	request.FileURL = strings.TrimSpace(request.FileURL)
	validURL := strings.HasPrefix(request.FileURL, "/api/photos/") || strings.HasPrefix(request.FileURL, "https://") || strings.HasPrefix(request.FileURL, "http://")
	if !allowedDocumentKinds[request.Kind] || request.Title == "" || !validURL {
		badRequest(w, "geçerli belge türü, başlık ve güvenli dosya adresi zorunludur")
		return
	}

	now := time.Now().UTC()
	existingDocs, err := a.store.ListDriverDocuments(p.ID)
	if err != nil {
		serverError(w, err)
		return
	}

	var document models.DriverDocument
	var found bool
	for _, doc := range existingDocs {
		if doc.Kind == request.Kind {
			document = doc
			found = true
			break
		}
	}

	if found {
		document.Title = request.Title
		document.FileURL = request.FileURL
		document.Status = models.VerificationPending
		document.ReviewNote = ""
		document.ReviewedAt = nil
		document.ReviewedBy = ""
		document.UpdatedAt = now
	} else {
		document = models.DriverDocument{
			ID:        uuid.NewString(),
			DriverID:  p.ID,
			Kind:      request.Kind,
			Title:     request.Title,
			FileURL:   request.FileURL,
			Status:    models.VerificationPending,
			CreatedAt: now,
			UpdatedAt: now,
		}
	}

	if err = a.store.SaveDriverDocument(document); err != nil {
		serverError(w, err)
		return
	}

	_ = a.store.RecordAdminActivity("driver.document_uploaded", p.ID, document.ID, map[string]any{
		"driverId": p.ID,
		"kind":     document.Kind,
		"status":   document.Status,
	})

	jsonResponse(w, http.StatusOK, document)
}
func (a *API) driverDocument(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	document, err := a.store.GetDriverDocument(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	if document.DriverID != p.ID {
		forbidden(w)
		return
	}
	jsonResponse(w, http.StatusOK, document)
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
		if filter == "active" && !models.IsActiveLoadStatus(load.Status) {
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
	p := current(r)
	if !a.allowRate(w, "send_msg:"+p.ID, 30, time.Minute, "kısa sürede çok fazla mesaj gönderdiniz; lütfen biraz bekleyin") {
		return
	}
	l, ok := a.getMessageLoad(w, r)
	if !ok {
		return
	}
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
		recipientID := l.CustomerID
		if p.ID == l.CustomerID {
			recipientID = l.AssignedDriver
		}
		if recipientID != "" && recipientID != p.ID {
			senderName := "Yeni mesaj"
			if sender, getErr := a.store.GetUser(p.ID); getErr == nil && strings.TrimSpace(sender.Name) != "" {
				senderName = strings.TrimSpace(sender.Name)
			}
			a.sendPush(recipientID, "Yeni mesaj", senderName+": "+shortPushPreview(created), map[string]string{"type": "message", "loadId": l.ID, "conversationId": l.ID, "screen": "conversation"})
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
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			errorResponse(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "fotoğraf boyutu limiti aşıldı", map[string]any{})
			return
		}
		badRequest(w, "fotoğraf boyutu limiti aşıldı")
		return
	}
	file, header, err := r.FormFile("photo")
	if err != nil {
		badRequest(w, "photo alanı zorunludur")
		return
	}
	defer file.Close()
	url, err := a.savePhoto(file, header, current(r).ID, l.ID)
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
	p := current(r)
	ip := clientIP(r)
	if !a.allowRate(w, "upload_usr:"+p.ID, 20, time.Minute, "kısa sürede çok fazla fotoğraf yüklediniz; lütfen 1 dakika bekleyin") ||
		!a.allowRate(w, "upload_ip:"+ip, 40, time.Minute, "kısa sürede çok fazla fotoğraf yüklendi; lütfen 1 dakika bekleyin") {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, a.maxUploadBytes+(1<<20))
	if e := r.ParseMultipartForm(a.maxUploadBytes); e != nil {
		var maxErr *http.MaxBytesError
		if errors.As(e, &maxErr) {
			errorResponse(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "fotoğraf boyutu limiti aşıldı", map[string]any{})
			return
		}
		badRequest(w, "fotoğraf boyutu limiti aşıldı")
		return
	}
	file, header, e := r.FormFile("photo")
	if e != nil {
		badRequest(w, "photo alanı zorunludur")
		return
	}
	defer file.Close()
	url, e := a.savePhoto(file, header, p.ID, "")
	if e != nil {
		badRequest(w, e.Error())
		return
	}
	jsonResponse(w, 201, map[string]string{"url": url})
}
func (a *API) uploadLoadPhotos(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	ip := clientIP(r)
	if !a.allowRate(w, "upload_usr:"+p.ID, 20, time.Minute, "kısa sürede çok fazla fotoğraf yüklediniz; lütfen 1 dakika bekleyin") ||
		!a.allowRate(w, "upload_ip:"+ip, 40, time.Minute, "kısa sürede çok fazla fotoğraf yüklendi; lütfen 1 dakika bekleyin") {
		return
	}
	l, ok := a.getOwnedLoad(w, r)
	if !ok {
		return
	}
	if p.Role != models.RoleCustomer || l.CustomerID != p.ID {
		forbidden(w)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, (a.maxUploadBytes*5)+(2<<20))
	if err := r.ParseMultipartForm(a.maxUploadBytes * 5); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			errorResponse(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "fotoğraf boyutu limiti aşıldı", map[string]any{})
			return
		}
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
		url, saveErr := a.savePhoto(file, header, current(r).ID, l.ID)
		_ = file.Close()
		if saveErr != nil {
			cleanup()
			badRequest(w, saveErr.Error())
			return
		}
		urls = append(urls, url)
	}
	original := l
	l.PhotoURLs = append(l.PhotoURLs, urls...)
	l.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveLoadIfUnchanged(original, l); err != nil {
		cleanup()
		writeLoadStatusError(w, err)
		return
	}
	jsonResponse(w, http.StatusCreated, l)
}
func (a *API) savePhoto(file io.Reader, header *multipart.FileHeader, ownerID, loadID string) (string, error) {
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
	if err = a.store.SavePhoto(id, data, contentType, ownerID, loadID); err != nil {
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
	original := l
	l.PhotoURLs, l.UpdatedAt = next, time.Now().UTC()
	if err := a.store.SaveLoadIfUnchanged(original, l); err != nil {
		writeLoadStatusError(w, err)
		return
	}
	if err := a.store.DeletePhoto(photoID); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, l)
}
func (a *API) photo(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if raw == "" {
		raw = r.URL.Query().Get("token")
	}
	if raw == "" {
		unauthorized(w, "oturum gerekli")
		return
	}

	isAdmin := false
	var userID string
	var u models.User

	_, adminErr := a.verifyAdmin(raw)
	if adminErr == nil {
		isAdmin = true
	} else {
		p, err := a.verify(raw)
		if err != nil {
			unauthorized(w, "geçersiz token")
			return
		}
		userID = p.ID
		u, _ = a.store.GetUser(userID)
	}

	photoID := r.PathValue("id")
	data, ct, ownerID, loadID, e := a.store.GetPhoto(photoID)
	if e != nil {
		notFound(w)
		return
	}

	if !isAdmin {
		authorized := false
		if ownerID == userID {
			authorized = true
		}

		if !authorized && loadID != "" {
			l, err := a.store.GetLoad(loadID)
			if err == nil {
				if l.CustomerID == userID || l.AssignedDriver == userID {
					authorized = true
				} else if u.Role == models.RoleDriver && l.Status == models.LoadStatusPublished {
					authorized = true
				}
			}
		}

		if !authorized {
			claim, err := a.store.MessageAttachmentClaim(photoID)
			if err == nil && claim != "" {
				parts := strings.SplitN(claim, ":", 2)
				if len(parts) == 2 {
					if parts[0] == userID {
						authorized = true
					} else {
						l, err := a.store.GetLoad(parts[1])
						if err == nil && (l.CustomerID == userID || l.AssignedDriver == userID) {
							authorized = true
						}
					}
				}
			}
		}

		if !authorized && ownerID == "" && loadID == "" {
			if u.Role == models.RoleDriver {
				docs, _ := a.store.ListDriverDocuments(userID)
				for _, doc := range docs {
					if strings.HasSuffix(doc.FileURL, photoID) {
						authorized = true
						break
					}
				}
				if !authorized {
					vehs, _ := a.store.ListVehicles(userID)
					for _, veh := range vehs {
						if strings.HasSuffix(veh.PhotoURL, photoID) {
							authorized = true
							break
						}
					}
				}
			}
			if !authorized {
				var loads []models.Load
				if u.Role == models.RoleCustomer {
					loads, _, _ = a.store.ListLoads(userID, "", store.LoadFilter{}, 0, 1000)
				} else if u.Role == models.RoleDriver {
					loads, _, _ = a.store.ListLoads("", userID, store.LoadFilter{}, 0, 1000)
					openLoads, _ := a.store.ListOpenLoads()
					loads = append(loads, openLoads...)
				}
				for _, l := range loads {
					for _, url := range l.PhotoURLs {
						if strings.HasSuffix(url, photoID) {
							authorized = true
							break
						}
					}
					if l.DeliveryPhotoURL != "" && strings.HasSuffix(l.DeliveryPhotoURL, photoID) {
						authorized = true
					}
					if authorized {
						break
					}
				}
			}
		}

		if !authorized {
			forbidden(w)
			return
		}
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
func (a *API) publicUser(u models.User) map[string]any {
	user := map[string]any{
		"id":            u.ID,
		"name":          u.Name,
		"email":         u.Email,
		"phone":         u.Phone,
		"role":          u.Role,
		"accountStatus": accountStatus(u),
		"createdAt":     u.CreatedAt,
	}
	if !u.LastSeenAt.IsZero() {
		user["lastSeenAt"] = u.LastSeenAt
	}
	if u.Role == models.RoleDriver {
		user["driverProfile"] = u.DriverProfile
		user["corporate"] = nil
		user["company"] = nil
	} else if u.Role == models.RoleCustomer || u.Role == models.RoleCorporate || models.CustomerAccountType(u) == models.AccountTypeCorporate {
		user["accountType"] = models.CustomerAccountType(u)
		if models.CustomerAccountType(u) == models.AccountTypeCorporate {
			var comp models.Company
			var hasCompany bool
			if a != nil && a.store != nil {
				if c, err := a.store.GetCompanyByUser(u.ID); err == nil && c.ID != "" {
					comp = c
					hasCompany = true
				} else if all, lErr := a.store.ListAllCompanies(); lErr == nil {
					for _, c := range all {
						if c.OwnerCustomerID == u.ID {
							comp = c
							hasCompany = true
							break
						}
					}
				}
			}
			if hasCompany {
				status := models.CanonicalCorporateStatus(comp.Status)
				if status == "" {
					status = models.CanonicalCorporateStatus(u.CorporateStatus)
				}
				if status == "" {
					status = models.CorporateStatusPending
				}
				user["corporateStatus"] = status
				user["status"] = status
				user["corporateId"] = comp.ID
				user["corporate_id"] = comp.ID

				var approvedAt *time.Time
				if comp.ApprovedAt != nil {
					approvedAt = comp.ApprovedAt
				} else if u.CorporateApprovedAt != nil {
					approvedAt = u.CorporateApprovedAt
				}

				if approvedAt != nil {
					user["approvedAt"] = approvedAt
					user["corporateApprovedAt"] = approvedAt
				}
				if u.CorporateApprovedBy != "" {
					user["approvedBy"] = u.CorporateApprovedBy
					user["corporateApprovedBy"] = u.CorporateApprovedBy
				}
				if u.CorporateRejectionReason != "" {
					user["rejectionReason"] = u.CorporateRejectionReason
					user["corporateRejectionReason"] = u.CorporateRejectionReason
				}

				corporateObj := map[string]any{
					"id":               comp.ID,
					"user_id":          u.ID,
					"userId":           u.ID,
					"status":           status,
					"name":             comp.Name,
					"authorizedPerson": comp.AuthorizedPerson,
					"taxNumber":        comp.TaxNumber,
					"taxOffice":        comp.TaxOffice,
					"address":          comp.Address,
					"phone":            comp.Phone,
					"email":            comp.Email,
					"approved_at":      approvedAt,
					"approvedAt":       approvedAt,
					"rejected_at":      nil,
					"rejectedAt":       nil,
					"rejectionReason":  u.CorporateRejectionReason,
				}
				user["corporate"] = corporateObj
				user["company"] = corporateObj
			} else {
				if u.CorporateStatus != "" {
					user["corporateStatus"] = models.CanonicalCorporateStatus(u.CorporateStatus)
					user["status"] = models.CanonicalCorporateStatus(u.CorporateStatus)
				}
				user["corporate"] = nil
				user["company"] = nil
			}
		} else {
			user["corporate"] = nil
			user["company"] = nil
		}
	} else {
		user["corporate"] = nil
		user["company"] = nil
	}
	user["termsAccepted"] = u.TermsAccepted
	user["termsVersion"] = u.TermsVersion
	if u.TermsAcceptedAt != nil {
		user["termsAcceptedAt"] = u.TermsAcceptedAt
	}
	user["marketingConsent"] = u.MarketingConsent
	if u.MarketingConsentAt != nil {
		user["marketingConsentAt"] = u.MarketingConsentAt
	}
	user["kvkkAcknowledged"] = u.KVKKAcknowledged
	user["currentTermsVersion"] = models.CurrentTermsVersion
	user["termsUpdateRequired"] = u.TermsVersion != models.CurrentTermsVersion

	return user
}
func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if e := json.NewDecoder(r.Body).Decode(target); e != nil {
		var maxErr *http.MaxBytesError
		if errors.As(e, &maxErr) {
			errorResponse(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "istek gövdesi boyut sınırını aştı (maksimum 1 MB)", map[string]any{})
			return false
		}
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
func tooManyRequests(w http.ResponseWriter, message string, retryAfterSeconds int) {
	if retryAfterSeconds <= 0 {
		retryAfterSeconds = 60
	}
	w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
	errorResponse(w, http.StatusTooManyRequests, "RATE_LIMIT_EXCEEDED", message, map[string]any{
		"retryAfterSeconds": retryAfterSeconds,
	})
}
func (a *API) serverError(w http.ResponseWriter, r *http.Request, e error) {
	reqID := w.Header().Get("X-Request-ID")
	slog.Error("unexpected_api_error", "request_id", reqID, "error", service.SanitizeLogString(fmt.Sprintf("%v", e)))
	if a.sentry != nil && a.sentry.Enabled() {
		tags := map[string]string{
			"requestId": reqID,
		}
		if r != nil {
			if p := current(r); p.ID != "" {
				tags["userId"] = p.ID
				tags["role"] = p.Role
			}
		}
		a.sentry.CaptureError(context.Background(), e, r, tags, map[string]any{"requestId": reqID})
	}
	errorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "sunucu hatası", map[string]any{})
}
func serverError(w http.ResponseWriter, e error) {
	slog.Error("unexpected_api_error", "request_id", w.Header().Get("X-Request-ID"), "error", service.SanitizeLogString(fmt.Sprintf("%v", e)))
	errorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "sunucu hatası", map[string]any{})
}
func (a *API) writeLoadStatusError(w http.ResponseWriter, r *http.Request, e error) {
	if errors.Is(e, store.ErrLoadStatusConflict) || errors.Is(e, store.ErrInvalidLoadStatusTransition) {
		conflict(w, "durum başka bir işlem tarafından değiştirildi veya geçiş artık geçerli değil")
		return
	}
	a.serverError(w, r, e)
}
func writeLoadStatusError(w http.ResponseWriter, e error) {
	if errors.Is(e, store.ErrLoadStatusConflict) || errors.Is(e, store.ErrInvalidLoadStatusTransition) {
		conflict(w, "durum başka bir işlem tarafından değiştirildi veya geçiş artık geçerli değil")
		return
	}
	serverError(w, e)
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
func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	hostname := strings.ToLower(u.Hostname())

	// Local development
	if scheme == "http" || scheme == "https" {
		if hostname == "localhost" || hostname == "127.0.0.1" {
			return true
		}
	}

	// Remote origins require HTTPS
	if scheme == "https" {
		// Production & staging NakliyeGo domains
		if hostname == "nakliyego.com" || strings.HasSuffix(hostname, ".nakliyego.com") {
			return true
		}
		// Current AWS beta sslip.io host and subdomains
		if hostname == "18-157-76-136.sslip.io" ||
			strings.HasSuffix(hostname, ".18-157-76-136.sslip.io") ||
			strings.HasSuffix(hostname, "-18-157-76-136.sslip.io") {
			return true
		}
	}

	// Optional custom origins configured via CORS_ALLOWED_ORIGINS (comma-separated)
	if extraOrigins := os.Getenv("CORS_ALLOWED_ORIGINS"); extraOrigins != "" {
		for _, raw := range strings.Split(extraOrigins, ",") {
			trimmed := strings.ToLower(strings.TrimSpace(raw))
			if trimmed == "" {
				continue
			}
			if strings.EqualFold(origin, trimmed) {
				return true
			}
			if strings.HasPrefix(trimmed, "*.") {
				suffix := trimmed[1:]
				if strings.HasSuffix(hostname, suffix) {
					return true
				}
			}
		}
	}

	return false
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := isAllowedOrigin(origin)

		if origin != "" && allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Idempotency-Key")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID, X-Idempotent-Replayed, Retry-After")
			w.Header().Set("Access-Control-Max-Age", "86400")
		}

		if r.Method == "OPTIONS" {
			if origin != "" && !allowed {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		if !strings.HasPrefix(r.URL.Path, "/api/photos/") {
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		}
		if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) globalRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/health" || path == "/api/health" || path == "/health/live" || path == "/health/ready" || path == "/api/health/live" || path == "/api/health/ready" {
			next.ServeHTTP(w, r)
			return
		}
		ip := clientIP(r)
		if !a.allowRate(w, "global_ip:"+ip, 300, time.Minute, "çok fazla istek gönderildi; lütfen kısa bir süre bekleyin") {
			return
		}
		next.ServeHTTP(w, r)
	})
}

type idempotencyRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	body        bytes.Buffer
}

func (w *idempotencyRecorder) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *idempotencyRecorder) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	_, _ = w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

func (a *API) idempotency(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodPatch && r.Method != http.MethodDelete {
			next.ServeHTTP(w, r)
			return
		}
		rawKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if rawKey == "" {
			next.ServeHTTP(w, r)
			return
		}
		if len(rawKey) < 8 || len(rawKey) > 128 {
			badRequest(w, "Idempotency-Key 8 ile 128 karakter arasında olmalıdır")
			return
		}
		ct := strings.ToLower(r.Header.Get("Content-Type"))
		if strings.HasPrefix(ct, "multipart/form-data") {
			next.ServeHTTP(w, r)
			return
		}

		bodyBytes, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				errorResponse(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "istek gövdesi boyut sınırını aştı (maksimum 1 MB)", map[string]any{})
				return
			}
			badRequest(w, "geçersiz istek gövdesi")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		bodySum := sha256.Sum256(bodyBytes)
		bodyHash := hex.EncodeToString(bodySum[:])

		actorScope := clientIP(r)
		if authHeader := strings.TrimSpace(r.Header.Get("Authorization")); authHeader != "" {
			authSum := sha256.Sum256([]byte(authHeader))
			actorScope = hex.EncodeToString(authSum[:16])
		}
		scopeHash := sha256.Sum256([]byte(actorScope + "|" + r.Method + "|" + r.URL.Path + "|" + rawKey))
		storeKey := hex.EncodeToString(scopeHash[:])

		if existing, getErr := a.store.GetIdempotencyResponse(storeKey); getErr == nil && existing != nil {
			if existing.BodyHash != bodyHash {
				conflict(w, "Idempotency-Key farklı bir istek gövdesi ile tekrar kullanılamaz")
				return
			}
			if existing.ContentType != "" {
				w.Header().Set("Content-Type", existing.ContentType)
			}
			w.Header().Set("X-Idempotent-Replayed", "true")
			w.WriteHeader(existing.Status)
			_, _ = w.Write(existing.Body)
			return
		}

		rec := &idempotencyRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		if rec.status >= 200 && rec.status < 300 {
			_ = a.store.SaveIdempotencyResponse(storeKey, store.IdempotencyResponse{
				BodyHash:    bodyHash,
				Status:      rec.status,
				ContentType: rec.Header().Get("Content-Type"),
				Body:        rec.body.Bytes(),
			}, 24*time.Hour)
		}
	})
}

func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if id == "" || len(id) > 64 {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(service.WithRequestID(r.Context(), id)))
	})
}
func (a *API) recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				reqID := w.Header().Get("X-Request-ID")
				slog.Error("panic_recovered", "request_id", reqID, "method", r.Method, "path", r.URL.Path, "panic", service.SanitizeLogString(fmt.Sprintf("%v", rec)))
				if a.sentry != nil && a.sentry.Enabled() {
					a.sentry.CapturePanic(r.Context(), rec, r, nil)
				}
				errorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "sunucu hatası", map[string]any{})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
func (a *API) maintenance(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.maintenanceMode {
			path := r.URL.Path
			if path != "/health" && path != "/api/health" && path != "/health/live" && path != "/health/ready" && path != "/api/health/live" && path != "/api/health/ready" && !strings.HasPrefix(path, "/api/admin") {
				errorResponse(w, http.StatusServiceUnavailable, "MAINTENANCE_MODE", "Sistem planlı bakım çalışmasındadır; lütfen daha sonra tekrar deneyin", map[string]any{"service": "nakliye-api", "maintenance": true})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		slog.Info("http_request",
			"request_id", service.RequestID(r.Context()),
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"duration_ms", time.Since(started).Milliseconds(),
		)
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

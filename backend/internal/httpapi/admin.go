package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"nakliye-api/internal/models"
)

const adminScope = "admin-panel"

const adminKey contextKey = "admin"

type adminPrincipal struct {
	Email string
}

func (a *API) adminConfigured() bool {
	return a.adminEmail != "" && len(a.adminSecret) >= 32 && (a.adminPassword != "" || a.adminPasswordHash != "")
}

func (a *API) adminLogin(w http.ResponseWriter, r *http.Request) {
	if !a.adminConfigured() {
		errorResponse(w, http.StatusServiceUnavailable, "ADMIN_DISABLED", "admin erişimi yapılandırılmamış", map[string]any{})
		return
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || host == "" {
		host = r.RemoteAddr
	}
	if !a.adminLoginRate.Allow(host) {
		w.Header().Set("Retry-After", "60")
		errorResponse(w, http.StatusTooManyRequests, "RATE_LIMITED", "çok fazla giriş denemesi", map[string]any{"retryAfterSeconds": 60})
		return
	}
	var request struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &request) {
		return
	}
	emailMatches := hmac.Equal([]byte(strings.ToLower(strings.TrimSpace(request.Email))), []byte(a.adminEmail))
	passwordMatches := false
	if a.adminPasswordHash != "" {
		passwordMatches = verifyPassword(a.adminPasswordHash, request.Password)
	} else {
		passwordMatches = hmac.Equal([]byte(request.Password), []byte(a.adminPassword))
	}
	if !emailMatches || !passwordMatches {
		unauthorized(w, "admin e-postası veya şifre hatalı")
		return
	}
	token, err := a.signAdmin(a.adminEmail, 8*time.Hour)
	if err != nil {
		serverError(w, err)
		return
	}
	_ = a.store.RecordAdminActivity("admin.login", a.adminEmail, a.adminEmail, map[string]any{"ip": host})
	jsonResponse(w, http.StatusOK, map[string]any{
		"accessToken": token,
		"expiresIn":   8 * 60 * 60,
		"admin":       map[string]string{"email": a.adminEmail, "role": models.RoleAdmin},
	})
}

func (a *API) adminMe(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]string{"email": currentAdmin(r).Email, "role": models.RoleAdmin})
}

func (a *API) signAdmin(email string, ttl time.Duration) (string, error) {
	claims, err := json.Marshal(map[string]any{
		"sub": email, "role": models.RoleAdmin, "scope": adminScope,
		"exp": time.Now().Add(ttl).Unix(), "jti": uuid.NewString(),
	})
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(claims)
	mac := hmac.New(sha256.New, a.adminSecret)
	_, _ = mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (a *API) verifyAdmin(token string) (adminPrincipal, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(a.adminSecret) < 32 {
		return adminPrincipal{}, errors.New("admin token")
	}
	mac := hmac.New(sha256.New, a.adminSecret)
	_, _ = mac.Write([]byte(parts[0]))
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(signature, mac.Sum(nil)) {
		return adminPrincipal{}, errors.New("admin signature")
	}
	var claims struct {
		Sub, Role, Scope string
		Exp              int64
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(body, &claims) != nil || claims.Exp < time.Now().Unix() ||
		claims.Sub != a.adminEmail || claims.Role != models.RoleAdmin || claims.Scope != adminScope {
		return adminPrincipal{}, errors.New("admin claims")
	}
	return adminPrincipal{Email: claims.Sub}, nil
}

func (a *API) adminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		principal, err := a.verifyAdmin(raw)
		if err != nil {
			unauthorized(w, "admin oturumu gerekli veya süresi dolmuş")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), adminKey, principal)))
	})
}

func currentAdmin(r *http.Request) adminPrincipal {
	principal, _ := r.Context().Value(adminKey).(adminPrincipal)
	return principal
}

func accountStatus(user models.User) string {
	if user.AccountStatus == models.AccountStatusBlocked || user.BlockedAt != nil {
		return models.AccountStatusBlocked
	}
	return models.AccountStatusActive
}

func driverVerificationStatus(user models.User) string {
	status := user.DriverProfile.VerificationStatus
	if status == "" {
		status = user.DriverProfile.LicenseStatus
	}
	if !models.ValidVerificationStatus(status) {
		return models.VerificationPending
	}
	return status
}

func vehicleVerificationStatus(vehicle models.Vehicle) string {
	if models.ValidVerificationStatus(vehicle.VerificationStatus) {
		return vehicle.VerificationStatus
	}
	return models.VerificationPending
}

func adminUserView(user models.User) map[string]any {
	view := publicUser(user)
	view["accountStatus"] = accountStatus(user)
	if user.BlockedAt != nil {
		view["blockedAt"] = user.BlockedAt
		view["blockedReason"] = user.BlockedReason
	}
	if user.Role == models.RoleDriver {
		view["verificationStatus"] = driverVerificationStatus(user)
	}
	return view
}

func pagination(query mapQuery) (int, int) {
	offset, _ := strconv.Atoi(query.Get("offset"))
	limit, _ := strconv.Atoi(query.Get("limit"))
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	return offset, limit
}

func page[T any](items []T, offset, limit int) []T {
	if offset >= len(items) {
		return []T{}
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end]
}

func containsFold(value, query string) bool {
	return strings.Contains(strings.ToLower(value), strings.ToLower(strings.TrimSpace(query)))
}

func (a *API) adminDashboard(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListAllUsers()
	if err != nil {
		serverError(w, err)
		return
	}
	loads, err := a.store.ListAllLoads()
	if err != nil {
		serverError(w, err)
		return
	}
	complaints, err := a.store.ListComplaints()
	if err != nil {
		serverError(w, err)
		return
	}
	counts := dashboardCounts(users, loads, complaints)
	queue := make([]map[string]any, 0)
	for _, user := range users {
		if user.Role == models.RoleDriver && driverVerificationStatus(user) == models.VerificationPending {
			queue = append(queue, adminUserView(user))
			if len(queue) == 5 {
				break
			}
		}
	}
	activity, _ := a.store.ListActivityEvents(8)
	jsonResponse(w, http.StatusOK, map[string]any{
		"counts": counts, "daily": buildDailyStats(users, loads, complaints, 7),
		"verificationQueue": queue, "recentActivity": activity,
	})
}

func dashboardCounts(users []models.User, loads []models.Load, complaints []models.MessageComplaint) map[string]int {
	counts := map[string]int{
		"customers": 0, "drivers": 0, "verifiedDrivers": 0, "pendingDrivers": 0,
		"activeLoads": 0, "completedJobs": 0, "cancelledJobs": 0, "openComplaints": 0,
	}
	for _, user := range users {
		switch user.Role {
		case models.RoleCustomer:
			counts["customers"]++
		case models.RoleDriver:
			counts["drivers"]++
			if driverVerificationStatus(user) == models.VerificationVerified {
				counts["verifiedDrivers"]++
			} else {
				counts["pendingDrivers"]++
			}
		}
	}
	for _, load := range loads {
		if load.DeletedAt != nil {
			continue
		}
		switch load.Status {
		case models.LoadStatusPublished, models.LoadStatusDriverSelected, models.LoadStatusDriverEnRoute,
			models.LoadStatusAtPickup, models.LoadStatusPickedUp, models.LoadStatusEnRouteToDelivery,
			models.LoadStatusDelivered:
			counts["activeLoads"]++
		case models.LoadStatusCompleted:
			counts["completedJobs"]++
		case models.LoadStatusCancelled:
			counts["cancelledJobs"]++
		}
	}
	for _, complaint := range complaints {
		if complaint.Status == models.ComplaintStatusOpen || complaint.Status == models.ComplaintStatusReviewing {
			counts["openComplaints"]++
		}
	}
	return counts
}

func buildDailyStats(users []models.User, loads []models.Load, complaints []models.MessageComplaint, days int) []map[string]any {
	if days < 1 || days > 90 {
		days = 7
	}
	now := time.Now().UTC()
	result := make([]map[string]any, 0, days)
	byDay := make(map[string]map[string]any, days)
	for index := days - 1; index >= 0; index-- {
		day := now.AddDate(0, 0, -index).Format("2006-01-02")
		entry := map[string]any{"date": day, "newUsers": 0, "newLoads": 0, "completedJobs": 0, "complaints": 0}
		byDay[day] = entry
		result = append(result, entry)
	}
	increment := func(timestamp time.Time, key string) {
		if entry := byDay[timestamp.UTC().Format("2006-01-02")]; entry != nil {
			entry[key] = entry[key].(int) + 1
		}
	}
	for _, user := range users {
		increment(user.CreatedAt, "newUsers")
	}
	for _, load := range loads {
		increment(load.CreatedAt, "newLoads")
		if load.Status == models.LoadStatusCompleted {
			increment(load.UpdatedAt, "completedJobs")
		}
	}
	for _, complaint := range complaints {
		increment(complaint.CreatedAt, "complaints")
	}
	return result
}

func (a *API) adminUsers(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListAllUsers()
	if err != nil {
		serverError(w, err)
		return
	}
	query, role, status := r.URL.Query().Get("q"), r.URL.Query().Get("role"), r.URL.Query().Get("status")
	filtered := make([]map[string]any, 0, len(users))
	for _, user := range users {
		if role != "" && user.Role != role || status != "" && accountStatus(user) != status {
			continue
		}
		if query != "" && !containsFold(strings.Join([]string{user.ID, user.Name, user.Email, user.Phone}, " "), query) {
			continue
		}
		filtered = append(filtered, adminUserView(user))
	}
	offset, limit := pagination(r.URL.Query())
	jsonResponse(w, http.StatusOK, map[string]any{"items": page(filtered, offset, limit), "total": len(filtered), "offset": offset, "limit": limit})
}

func (a *API) adminUser(w http.ResponseWriter, r *http.Request) {
	user, err := a.store.GetUser(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	view := adminUserView(user)
	loads, _ := a.store.ListAllLoads()
	owned := make([]models.Load, 0)
	assigned := make([]models.Load, 0)
	for _, load := range loads {
		if load.CustomerID == user.ID {
			owned = append(owned, load)
		}
		if load.AssignedDriver == user.ID {
			assigned = append(assigned, load)
		}
	}
	view["loads"] = owned
	view["assignedLoads"] = assigned
	if user.Role == models.RoleDriver {
		view["vehicles"], _ = a.store.ListVehicles(user.ID)
		view["documents"], _ = a.store.ListDriverDocuments(user.ID)
	} else if models.CustomerAccountType(user) == models.AccountTypeCorporate {
		if company, companyErr := a.store.GetCompanyByUser(user.ID); companyErr == nil {
			view["company"] = company
			if wallet, walletErr := a.store.GetCorporateWallet(company.ID); walletErr == nil {
				view["wallet"] = wallet
				transactions, summaryErr := a.store.ListWalletTransactions(wallet.ID)
				if summaryErr != nil {
					serverError(w, summaryErr)
					return
				}
				summary, summaryErr := a.store.WalletSummary(company, transactions)
				if summaryErr != nil {
					serverError(w, summaryErr)
					return
				}
				view["walletSummary"] = summary
				view["walletTransactions"] = transactions
			}
		}
	}
	jsonResponse(w, http.StatusOK, view)
}

func (a *API) adminUserStatus(w http.ResponseWriter, r *http.Request) {
	user, err := a.store.GetUser(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	var request struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Status, request.Reason = strings.TrimSpace(request.Status), strings.TrimSpace(request.Reason)
	if !models.ValidAccountStatus(request.Status) || request.Status == models.AccountStatusBlocked && request.Reason == "" {
		badRequest(w, "geçerli durum ve engelleme nedeni zorunludur")
		return
	}
	previous := user
	user.AccountStatus = request.Status
	if request.Status == models.AccountStatusBlocked {
		now := time.Now().UTC()
		user.BlockedAt, user.BlockedReason = &now, request.Reason
	} else {
		user.BlockedAt, user.BlockedReason = nil, ""
	}
	if err = a.store.UpdateUser(previous, user); err != nil {
		serverError(w, err)
		return
	}
	a.adminAudit("user.status_changed", r, user.ID, map[string]any{"from": accountStatus(previous), "to": request.Status, "reason": request.Reason})
	jsonResponse(w, http.StatusOK, adminUserView(user))
}

func (a *API) adminDrivers(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListAllUsers()
	if err != nil {
		serverError(w, err)
		return
	}
	status, query := r.URL.Query().Get("verificationStatus"), r.URL.Query().Get("q")
	items := make([]map[string]any, 0)
	for _, user := range users {
		if user.Role != models.RoleDriver || status != "" && driverVerificationStatus(user) != status {
			continue
		}
		if query != "" && !containsFold(strings.Join([]string{user.Name, user.Email, user.Phone, user.DriverProfile.LicensePlate}, " "), query) {
			continue
		}
		view := adminUserView(user)
		vehicles, _ := a.store.ListVehicles(user.ID)
		documents, _ := a.store.ListDriverDocuments(user.ID)
		view["vehicleCount"], view["documentCount"] = len(vehicles), len(documents)
		view["pendingDocuments"] = pendingDocumentCount(documents)
		items = append(items, view)
	}
	offset, limit := pagination(r.URL.Query())
	jsonResponse(w, http.StatusOK, map[string]any{"items": page(items, offset, limit), "total": len(items), "offset": offset, "limit": limit})
}

func pendingDocumentCount(documents []models.DriverDocument) int {
	count := 0
	for _, document := range documents {
		if document.Status == "" || document.Status == models.VerificationPending {
			count++
		}
	}
	return count
}

func (a *API) adminDriver(w http.ResponseWriter, r *http.Request) {
	user, err := a.store.GetUser(r.PathValue("id"))
	if err != nil || user.Role != models.RoleDriver {
		notFound(w)
		return
	}
	vehicles, _ := a.store.ListVehicles(user.ID)
	for index := range vehicles {
		vehicles[index].VerificationStatus = vehicleVerificationStatus(vehicles[index])
	}
	documents, _ := a.store.ListDriverDocuments(user.ID)
	jsonResponse(w, http.StatusOK, map[string]any{"user": adminUserView(user), "vehicles": vehicles, "documents": documents})
}

func (a *API) adminDriverVerification(w http.ResponseWriter, r *http.Request) {
	user, err := a.store.GetUser(r.PathValue("id"))
	if err != nil || user.Role != models.RoleDriver {
		notFound(w)
		return
	}
	var request struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Status, request.Note = strings.TrimSpace(request.Status), strings.TrimSpace(request.Note)
	if !models.ValidVerificationStatus(request.Status) || request.Status == models.VerificationRejected && request.Note == "" {
		badRequest(w, "geçerli doğrulama durumu ve ret notu zorunludur")
		return
	}
	previous := user
	user.DriverProfile.VerificationStatus = request.Status
	user.DriverProfile.LicenseStatus = request.Status
	user.DriverProfile.VerificationNote = request.Note
	user.DriverProfile.VerifiedBy = currentAdmin(r).Email
	now := time.Now().UTC()
	if request.Status == models.VerificationVerified {
		user.DriverProfile.VerifiedAt = &now
	} else {
		user.DriverProfile.VerifiedAt = nil
	}
	if err = a.store.UpdateUser(previous, user); err != nil {
		serverError(w, err)
		return
	}
	a.adminAudit("driver.verification_changed", r, user.ID, map[string]any{"status": request.Status, "note": request.Note})
	jsonResponse(w, http.StatusOK, adminUserView(user))
}

var allowedDocumentKinds = map[string]bool{
	"identity": true, "driver_license": true, "vehicle_registration": true,
	"insurance": true, "criminal_record": true, "other": true,
}

func (a *API) adminCreateDriverDocument(w http.ResponseWriter, r *http.Request) {
	driver, err := a.store.GetUser(r.PathValue("id"))
	if err != nil || driver.Role != models.RoleDriver {
		notFound(w)
		return
	}
	var request struct {
		Kind, Title, FileURL string
	}
	if !decode(w, r, &request) {
		return
	}
	request.Kind, request.Title, request.FileURL = strings.TrimSpace(request.Kind), strings.TrimSpace(request.Title), strings.TrimSpace(request.FileURL)
	validURL := strings.HasPrefix(request.FileURL, "/api/photos/") || strings.HasPrefix(request.FileURL, "https://")
	if !allowedDocumentKinds[request.Kind] || request.Title == "" || !validURL {
		badRequest(w, "geçerli belge türü, başlık ve güvenli dosya adresi zorunludur")
		return
	}
	now := time.Now().UTC()
	document := models.DriverDocument{ID: uuid.NewString(), DriverID: driver.ID, Kind: request.Kind, Title: request.Title, FileURL: request.FileURL, Status: models.VerificationPending, CreatedAt: now, UpdatedAt: now}
	if err = a.store.SaveDriverDocument(document); err != nil {
		serverError(w, err)
		return
	}
	a.adminAudit("driver.document_added", r, document.ID, map[string]any{"driverId": driver.ID, "kind": document.Kind})
	jsonResponse(w, http.StatusCreated, document)
}

func (a *API) adminReviewDriverDocument(w http.ResponseWriter, r *http.Request) {
	document, err := a.store.GetDriverDocument(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	var request struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Status, request.Note = strings.TrimSpace(request.Status), strings.TrimSpace(request.Note)
	if !models.ValidVerificationStatus(request.Status) || request.Status == models.VerificationRejected && request.Note == "" {
		badRequest(w, "geçerli belge durumu ve ret notu zorunludur")
		return
	}
	now := time.Now().UTC()
	document.Status, document.ReviewNote, document.UpdatedAt = request.Status, request.Note, now
	document.ReviewedAt, document.ReviewedBy = &now, currentAdmin(r).Email
	if err = a.store.SaveDriverDocument(document); err != nil {
		serverError(w, err)
		return
	}
	a.adminAudit("driver.document_reviewed", r, document.ID, map[string]any{"driverId": document.DriverID, "status": document.Status})
	jsonResponse(w, http.StatusOK, document)
}

func (a *API) adminVehicleVerification(w http.ResponseWriter, r *http.Request) {
	vehicle, err := a.store.GetVehicle(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	var request struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Status, request.Note = strings.TrimSpace(request.Status), strings.TrimSpace(request.Note)
	if !models.ValidVerificationStatus(request.Status) || request.Status == models.VerificationRejected && request.Note == "" {
		badRequest(w, "geçerli araç durumu ve ret notu zorunludur")
		return
	}
	now := time.Now().UTC()
	vehicle.VerificationStatus, vehicle.VerificationNote, vehicle.UpdatedAt = request.Status, request.Note, now
	vehicle.VerifiedBy = currentAdmin(r).Email
	if request.Status == models.VerificationVerified {
		vehicle.VerifiedAt = &now
	} else {
		vehicle.VerifiedAt = nil
	}
	if err = a.store.SaveVehicle(vehicle); err != nil {
		serverError(w, err)
		return
	}
	a.adminAudit("vehicle.verification_changed", r, vehicle.ID, map[string]any{"driverId": vehicle.DriverID, "status": request.Status})
	jsonResponse(w, http.StatusOK, vehicle)
}

func (a *API) adminLoads(w http.ResponseWriter, r *http.Request) {
	loads, err := a.store.ListAllLoads()
	if err != nil {
		serverError(w, err)
		return
	}
	status, query := r.URL.Query().Get("status"), r.URL.Query().Get("q")
	includeDeleted := r.URL.Query().Get("includeDeleted") == "true"
	items := make([]map[string]any, 0, len(loads))
	for _, load := range loads {
		if !includeDeleted && load.DeletedAt != nil || status != "" && load.Status != status {
			continue
		}
		if query != "" && !containsFold(strings.Join([]string{load.ID, load.Title, load.Pickup.Address, load.Delivery.Address}, " "), query) {
			continue
		}
		item := map[string]any{"load": load}
		if customer, getErr := a.store.GetUser(load.CustomerID); getErr == nil {
			item["customer"] = adminUserView(customer)
		}
		if load.AssignedDriver != "" {
			if driver, getErr := a.store.GetUser(load.AssignedDriver); getErr == nil {
				item["driver"] = adminUserView(driver)
			}
		}
		items = append(items, item)
	}
	offset, limit := pagination(r.URL.Query())
	jsonResponse(w, http.StatusOK, map[string]any{"items": page(items, offset, limit), "total": len(items), "offset": offset, "limit": limit})
}

func (a *API) adminLoad(w http.ResponseWriter, r *http.Request) {
	load, err := a.store.GetLoad(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	history, err := a.store.ListLoadStatusHistory(load.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	offers, _ := a.store.ListOffers(load.ID, "")
	response := map[string]any{"load": load, "statusHistory": history, "offers": a.offerViews(offers)}
	if customer, getErr := a.store.GetUser(load.CustomerID); getErr == nil {
		response["customer"] = adminUserView(customer)
	}
	if load.AssignedDriver != "" {
		if driver, getErr := a.store.GetUser(load.AssignedDriver); getErr == nil {
			response["driver"] = adminUserView(driver)
		}
	}
	jsonResponse(w, http.StatusOK, response)
}

func (a *API) adminLoadStatus(w http.ResponseWriter, r *http.Request) {
	load, err := a.store.GetLoad(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	var request struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Status, request.Note = strings.TrimSpace(request.Status), strings.TrimSpace(request.Note)
	if !models.ValidCanonicalLoadStatus(request.Status) || request.Status == models.LoadStatusDraft || request.Status == models.LoadStatusPublished || request.Note == "" {
		badRequest(w, "farklı ve geçerli durum ile işlem notu zorunludur")
		return
	}
	if request.Status == models.LoadStatusCompleted {
		badRequest(w, "admin teslimat override akışı bu fazda etkin değildir")
		return
	}
	from := load.Status
	if request.Status == models.LoadStatusDriverSelected && load.AssignedDriver == "" {
		badRequest(w, "şoför atanmadan şoför seçildi durumuna geçilemez")
		return
	}
	if !models.CanTransition(from, request.Status) {
		conflict(w, "geçersiz durum geçişi")
		return
	}
	load.Status, load.UpdatedAt = request.Status, time.Now().UTC()
	event := newLoadStatusEvent(load.ID, from, load.Status, currentAdmin(r).Email, models.RoleAdmin, models.LoadStatusSourceAdmin, request.Note, load.UpdatedAt)
	var transitionErr error
	if load.Status == models.LoadStatusCancelled {
		company, companyErr := a.companyForCorporateCustomer(load.CustomerID)
		if companyErr != nil {
			serverError(w, companyErr)
			return
		}
		reversal := models.WalletTransaction{
			ID: uuid.NewString(), LoadID: load.ID, Type: models.WalletTransactionReversal,
			Description: "Yönetim iptali kredi iadesi: " + request.Note, PickupAddress: load.Pickup.Address, DeliveryAddress: load.Delivery.Address,
			ActorID: currentAdmin(r).Email, ActorRole: models.RoleAdmin, CreatedAt: load.UpdatedAt,
		}
		if company != nil {
			reversal.CompanyID = company.ID
		}
		_, transitionErr = a.store.TransitionLoadStatusAndReverseWallet(from, load, event, company, reversal)
	} else {
		transitionErr = a.store.TransitionLoadStatus(from, load, event)
	}
	if transitionErr != nil {
		if isWalletError(transitionErr) {
			writeWalletError(w, transitionErr)
		} else {
			writeLoadStatusError(w, transitionErr)
		}
		return
	}
	if load.AssignedDriver != "" {
		_ = a.store.SaveConversation(a.conversationRecord(load))
		a.addSystemMessage(load, "İlan durumu yönetim tarafından güncellendi: "+request.Note)
	}
	a.adminAudit("load.status_changed", r, load.ID, map[string]any{"from": from, "to": load.Status, "note": request.Note})
	jsonResponse(w, http.StatusOK, load)
}

func (a *API) createMessageComplaint(w http.ResponseWriter, r *http.Request) {
	message, err := a.store.GetMessage(r.PathValue("id"))
	if err != nil || message.DeletedAt != nil {
		notFound(w)
		return
	}
	load, err := a.store.GetLoad(message.LoadID)
	principal := current(r)
	if err != nil || !a.canAccessMessageLoad(load, principal) {
		forbidden(w)
		return
	}
	if message.SenderID == principal.ID || message.SenderID == "system" {
		badRequest(w, "kendi mesajınız şikâyet edilemez")
		return
	}
	a.createComplaint(w, r, load, message.ID, message.SenderID)
}

func (a *API) createLoadComplaint(w http.ResponseWriter, r *http.Request) {
	load, err := a.store.GetLoad(r.PathValue("id"))
	principal := current(r)
	if err != nil || !a.canAccessMessageLoad(load, principal) {
		forbidden(w)
		return
	}
	reportedUserID := load.AssignedDriver
	if principal.Role == models.RoleDriver {
		reportedUserID = load.CustomerID
	}
	a.createComplaint(w, r, load, "", reportedUserID)
}

func (a *API) createComplaint(w http.ResponseWriter, r *http.Request, load models.Load, messageID, reportedUserID string) {
	principal := current(r)
	if existing, findErr := a.store.FindComplaint(messageID, load.ID, principal.ID); findErr == nil {
		conflict(w, "bu kayıt için zaten bir şikâyetiniz var: "+existing.ID)
		return
	}
	var request struct {
		Reason      string `json:"reason"`
		Description string `json:"description"`
		Detail      string `json:"detail"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Reason, request.Description = strings.TrimSpace(request.Reason), strings.TrimSpace(request.Description)
	if request.Description == "" {
		request.Description = strings.TrimSpace(request.Detail)
	}
	if !models.ValidComplaintReason(request.Reason) || request.Description == "" || utf8.RuneCountInString(request.Description) > 1000 {
		badRequest(w, "geçerli şikâyet nedeni ve en fazla 1000 karakter açıklama zorunludur")
		return
	}
	now := time.Now().UTC()
	complaint := models.MessageComplaint{
		ID: uuid.NewString(), Type: models.SupportTypeComplaint, Subject: "Nakliye şikâyeti", MessageID: messageID, LoadID: load.ID, ConversationID: load.ID, ReporterID: principal.ID,
		ReportedUserID: reportedUserID, Reason: request.Reason, Detail: request.Description,
		Status: models.ComplaintStatusOpen, CreatedAt: now, UpdatedAt: now,
	}
	if messageID != "" {
		complaint.Subject = "Mesaj şikâyeti"
	}
	if err := a.store.SaveComplaint(complaint); err != nil {
		serverError(w, err)
		return
	}
	_ = a.store.RecordDomainEvent("complaint.created", complaint.ID, complaint)
	jsonResponse(w, http.StatusCreated, complaint)
}

func complaintSubject(complaint models.MessageComplaint) string {
	if strings.TrimSpace(complaint.Subject) != "" {
		return complaint.Subject
	}
	if complaint.MessageID != "" {
		return "Mesaj şikâyeti"
	}
	if complaint.Type == models.SupportTypeFeedback {
		return "Öneri / geri bildirim"
	}
	return "Nakliye şikâyeti"
}

func (a *API) userComplaintView(complaint models.MessageComplaint, principal principal) map[string]any {
	complaintType := complaint.Type
	if complaintType == "" {
		complaintType = models.SupportTypeComplaint
	}
	view := map[string]any{"complaint": map[string]any{
		"id": complaint.ID, "type": complaintType, "subject": complaintSubject(complaint),
		"loadId": complaint.LoadID, "messageId": complaint.MessageID, "reason": complaint.Reason,
		"description": complaint.Detail, "status": complaint.Status, "createdAt": complaint.CreatedAt,
		"updatedAt": complaint.UpdatedAt, "resolvedAt": complaint.ResolvedAt,
	}}
	if complaint.LoadID != "" {
		if load, err := a.store.GetLoad(complaint.LoadID); err == nil && a.canAccessMessageLoad(load, principal) {
			view["load"] = load
		}
	}
	return view
}

func (a *API) myComplaints(w http.ResponseWriter, r *http.Request) {
	principal := current(r)
	complaints, err := a.store.ListComplaintsByReporter(principal.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	items := make([]map[string]any, 0, len(complaints))
	for _, complaint := range complaints {
		items = append(items, a.userComplaintView(complaint, principal))
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) myComplaint(w http.ResponseWriter, r *http.Request) {
	complaint, err := a.store.GetComplaint(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	principal := current(r)
	if complaint.ReporterID != principal.ID {
		forbidden(w)
		return
	}
	jsonResponse(w, http.StatusOK, a.userComplaintView(complaint, principal))
}

func (a *API) createSupportRequest(w http.ResponseWriter, r *http.Request) {
	principal := current(r)
	var request struct {
		Type        string `json:"type"`
		Subject     string `json:"subject"`
		Reason      string `json:"reason"`
		Description string `json:"description"`
		LoadID      string `json:"loadId"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Type = strings.TrimSpace(request.Type)
	request.Subject = strings.TrimSpace(request.Subject)
	request.Reason = strings.TrimSpace(request.Reason)
	request.Description = strings.TrimSpace(request.Description)
	request.LoadID = strings.TrimSpace(request.LoadID)
	if !models.ValidSupportType(request.Type) || request.Subject == "" || utf8.RuneCountInString(request.Subject) > 120 || request.Description == "" || utf8.RuneCountInString(request.Description) > 1000 {
		badRequest(w, "bildirim türü, en fazla 120 karakter konu ve en fazla 1000 karakter açıklama zorunludur")
		return
	}
	if request.Type == models.SupportTypeComplaint && !models.ValidComplaintReason(request.Reason) {
		badRequest(w, "geçerli şikâyet nedeni zorunludur")
		return
	}
	if request.Type == models.SupportTypeFeedback {
		request.Reason = "other"
	}

	var load models.Load
	var reportedUserID string
	if request.LoadID != "" {
		var err error
		load, err = a.store.GetLoad(request.LoadID)
		if err != nil || !a.canAccessMessageLoad(load, principal) {
			forbidden(w)
			return
		}
		reportedUserID = load.AssignedDriver
		if principal.Role == models.RoleDriver {
			reportedUserID = load.CustomerID
		}
		if request.Type == models.SupportTypeComplaint {
			owned, _ := a.store.ListComplaintsByReporter(principal.ID)
			for _, existing := range owned {
				if existing.Type == models.SupportTypeComplaint && existing.LoadID == load.ID && existing.MessageID == "" && existing.Status != models.ComplaintStatusRejected {
					conflict(w, "bu nakliye için zaten açık bir şikâyetiniz var: "+existing.ID)
					return
				}
			}
		}
	}

	now := time.Now().UTC()
	complaint := models.MessageComplaint{
		ID: uuid.NewString(), Type: request.Type, Subject: request.Subject, ReporterID: principal.ID,
		ReportedUserID: reportedUserID, LoadID: request.LoadID, Reason: request.Reason, Detail: request.Description,
		Status: models.ComplaintStatusOpen, CreatedAt: now, UpdatedAt: now,
	}
	if load.ID != "" {
		complaint.ConversationID = load.ID
	}
	if err := a.store.SaveComplaint(complaint); err != nil {
		serverError(w, err)
		return
	}
	_ = a.store.RecordDomainEvent("complaint.created", complaint.ID, complaint)
	jsonResponse(w, http.StatusCreated, a.userComplaintView(complaint, principal))
}

func (a *API) complaintView(complaint models.MessageComplaint) map[string]any {
	view := map[string]any{"complaint": complaint}
	if message, err := a.store.GetMessage(complaint.MessageID); err == nil {
		view["message"] = message
	}
	if load, err := a.store.GetLoad(complaint.LoadID); err == nil {
		view["load"] = load
		view["conversation"] = a.conversationRecord(load)
	}
	if reporter, err := a.store.GetUser(complaint.ReporterID); err == nil {
		view["reporter"] = adminUserView(reporter)
	}
	if reported, err := a.store.GetUser(complaint.ReportedUserID); err == nil {
		view["reportedUser"] = adminUserView(reported)
	}
	return view
}

func (a *API) adminComplaints(w http.ResponseWriter, r *http.Request) {
	complaints, err := a.store.ListComplaints()
	if err != nil {
		serverError(w, err)
		return
	}
	status, query := r.URL.Query().Get("status"), r.URL.Query().Get("q")
	items := make([]map[string]any, 0, len(complaints))
	for _, complaint := range complaints {
		if status != "" && complaint.Status != status {
			continue
		}
		view := a.complaintView(complaint)
		if query != "" {
			body, _ := json.Marshal(view)
			if !containsFold(string(body), query) {
				continue
			}
		}
		items = append(items, view)
	}
	offset, limit := pagination(r.URL.Query())
	jsonResponse(w, http.StatusOK, map[string]any{"items": page(items, offset, limit), "total": len(items), "offset": offset, "limit": limit})
}

func (a *API) adminComplaint(w http.ResponseWriter, r *http.Request) {
	complaint, err := a.store.GetComplaint(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	jsonResponse(w, http.StatusOK, a.complaintView(complaint))
}

func (a *API) adminUpdateComplaint(w http.ResponseWriter, r *http.Request) {
	complaint, err := a.store.GetComplaint(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return
	}
	var request struct {
		Status         string `json:"status"`
		AdminNote      string `json:"adminNote"`
		ResolutionNote string `json:"resolutionNote"`
		RemoveMessage  bool   `json:"removeMessage"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.Status, request.AdminNote = strings.TrimSpace(request.Status), strings.TrimSpace(request.AdminNote)
	if request.AdminNote == "" {
		request.AdminNote = strings.TrimSpace(request.ResolutionNote)
	}
	if !models.ValidComplaintStatus(request.Status) || (request.Status == models.ComplaintStatusResolved || request.Status == models.ComplaintStatusRejected) && request.AdminNote == "" {
		badRequest(w, "geçerli şikâyet durumu ve kapanış notu zorunludur")
		return
	}
	now := time.Now().UTC()
	complaint.Status, complaint.ResolutionNote, complaint.UpdatedAt = request.Status, request.AdminNote, now
	if request.Status == models.ComplaintStatusResolved || request.Status == models.ComplaintStatusRejected {
		complaint.ResolvedAt, complaint.ResolvedBy = &now, currentAdmin(r).Email
	} else {
		complaint.ResolvedAt, complaint.ResolvedBy = nil, ""
	}
	if request.RemoveMessage && complaint.MessageID != "" {
		message, messageErr := a.store.GetMessage(complaint.MessageID)
		if messageErr == nil && message.DeletedAt == nil {
			if _, deleteErr := a.store.SoftDeleteMessage(complaint.LoadID, complaint.MessageID, "admin:"+currentAdmin(r).Email, now); deleteErr != nil {
				serverError(w, deleteErr)
				return
			}
		}
	}
	if err = a.store.SaveComplaint(complaint); err != nil {
		serverError(w, err)
		return
	}
	a.adminAudit("complaint.updated", r, complaint.ID, map[string]any{"status": complaint.Status, "adminNote": complaint.ResolutionNote, "messageRemoved": request.RemoveMessage})
	jsonResponse(w, http.StatusOK, a.complaintView(complaint))
}

func (a *API) adminActivity(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 64)
	events, err := a.store.ListActivityEvents(limit)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": events})
}

func (a *API) adminStats(w http.ResponseWriter, r *http.Request) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days < 1 || days > 90 {
		days = 30
	}
	users, err := a.store.ListAllUsers()
	if err != nil {
		serverError(w, err)
		return
	}
	loads, err := a.store.ListAllLoads()
	if err != nil {
		serverError(w, err)
		return
	}
	complaints, err := a.store.ListComplaints()
	if err != nil {
		serverError(w, err)
		return
	}
	messageCount, offerCount := 0, 0
	for _, load := range loads {
		messages, _ := a.store.Messages(load.ID)
		offers, _ := a.store.ListOffers(load.ID, "")
		messageCount += len(messages)
		offerCount += len(offers)
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"daily":  buildDailyStats(users, loads, complaints, days),
		"totals": map[string]any{"users": len(users), "loads": len(loads), "messages": messageCount, "offers": offerCount, "complaints": len(complaints)},
		"system": map[string]string{"api": "ok", "storage": "redis"},
	})
}

func (a *API) adminAudit(eventType string, r *http.Request, aggregateID string, payload any) {
	if err := a.store.RecordAdminActivity(eventType, currentAdmin(r).Email, aggregateID, payload); err != nil {
		log.Printf("admin audit event %s could not be persisted: %v", eventType, err)
	}
}

func newLoadStatusEvent(loadID, from, to, actorID, actorRole, source, note string, changedAt time.Time) models.LoadStatusEvent {
	return models.LoadStatusEvent{
		ID: uuid.NewString(), LoadID: loadID, FromStatus: models.CanonicalLoadStatus(from), ToStatus: to,
		ChangedAt: changedAt, ChangedByUserID: actorID, ChangedByRole: actorRole, Source: source, Note: note,
		ActorID: actorID, ActorRole: actorRole, CreatedAt: changedAt,
	}
}

func (a *API) recordLoadStatus(loadID, from, to, actorID, actorRole, source, note string, changedAt time.Time) {
	event := newLoadStatusEvent(loadID, from, to, actorID, actorRole, source, note, changedAt)
	if err := a.store.SaveLoadStatusEvent(event); err != nil {
		log.Printf("load status history could not be persisted: %v", err)
	}
}

package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
)

func (a *API) corporateContext(w http.ResponseWriter, r *http.Request) (models.User, models.Company, bool) {
	principal := current(r)
	if principal.Role != models.RoleCustomer {
		forbidden(w)
		return models.User{}, models.Company{}, false
	}
	user, err := a.store.GetUser(principal.ID)
	if err != nil {
		notFound(w)
		return models.User{}, models.Company{}, false
	}
	if models.CustomerAccountType(user) != models.AccountTypeCorporate {
		forbidden(w)
		return models.User{}, models.Company{}, false
	}
	if user.CorporateStatus != "" && user.CorporateStatus != models.CorporateStatusApproved {
		forbidden(w)
		return models.User{}, models.Company{}, false
	}
	company, err := a.store.GetCompanyByUser(user.ID)
	if err != nil || company.OwnerCustomerID != user.ID {
		forbidden(w)
		return models.User{}, models.Company{}, false
	}
	return user, company, true
}

func (a *API) companyForCorporateCustomer(customerID string) (*models.Company, error) {
	user, err := a.store.GetUser(customerID)
	if err != nil {
		return nil, err
	}
	if models.CustomerAccountType(user) != models.AccountTypeCorporate {
		return nil, nil
	}
	company, err := a.store.GetCompanyByUser(customerID)
	if err != nil || company.OwnerCustomerID != customerID {
		return nil, store.ErrCorporateAccountRequired
	}
	return &company, nil
}

func (a *API) corporateCompany(w http.ResponseWriter, r *http.Request) {
	_, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"company": company})
}

func onlyDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func (a *API) updateCorporateCompany(w http.ResponseWriter, r *http.Request) {
	_, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	var request struct {
		Name, AuthorizedPerson, TaxNumber, TaxOffice, Address, Phone, Email string
	}
	if !decode(w, r, &request) {
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	request.AuthorizedPerson = strings.TrimSpace(request.AuthorizedPerson)
	request.TaxNumber = strings.TrimSpace(request.TaxNumber)
	request.TaxOffice = strings.TrimSpace(request.TaxOffice)
	request.Address = strings.TrimSpace(request.Address)
	request.Phone = normalizePhone(request.Phone)
	request.Email = strings.ToLower(strings.TrimSpace(request.Email))
	if request.Name == "" || request.AuthorizedPerson == "" || request.TaxOffice == "" || request.Address == "" ||
		(len(request.TaxNumber) != 10 && len(request.TaxNumber) != 11) || !onlyDigits(request.TaxNumber) || !validTurkishPhone(request.Phone) || !strings.Contains(request.Email, "@") {
		badRequest(w, "firma adı, yetkili, 10 veya 11 haneli vergi numarası, vergi dairesi, adres, telefon ve e-posta zorunludur")
		return
	}
	company.Name = request.Name
	company.AuthorizedPerson = request.AuthorizedPerson
	company.TaxNumber = request.TaxNumber
	company.TaxOffice = request.TaxOffice
	company.Address = request.Address
	company.Phone = request.Phone
	company.Email = request.Email
	company.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveCompany(company); err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"company": company})
}

func inSameMonth(value, reference time.Time) bool {
	value, reference = value.In(time.FixedZone("Europe/Istanbul", 3*60*60)), reference.In(time.FixedZone("Europe/Istanbul", 3*60*60))
	return value.Year() == reference.Year() && value.Month() == reference.Month()
}

func (a *API) corporateDashboard(w http.ResponseWriter, r *http.Request) {
	user, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	loads, _, err := a.store.ListLoads(user.ID, "", store.LoadFilter{}, 0, 0)
	if err != nil {
		serverError(w, err)
		return
	}
	wallet, err := a.store.GetCorporateWallet(company.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	transactions, err := a.store.ListWalletTransactions(wallet.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	now := time.Now().UTC()
	active, completed, recentActive, recentCompleted := 0, 0, make([]models.Load, 0, 3), make([]models.Load, 0, 3)
	pending := 0
	for _, load := range loads {
		if models.IsActiveLoadStatus(load.Status) {
			active++
			if len(recentActive) < 3 {
				recentActive = append(recentActive, load)
			}
		}
		if load.Status == models.LoadStatusDraft || load.Status == models.LoadStatusPublished {
			pending++
		}
		if load.Status == models.LoadStatusCompleted {
			if inSameMonth(load.UpdatedAt, now) {
				completed++
			}
			if len(recentCompleted) < 3 {
				recentCompleted = append(recentCompleted, load)
			}
		}
	}
	if len(transactions) > 5 {
		transactions = transactions[:5]
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"company": company, "wallet": wallet,
		"counts":            map[string]int{"activeLoads": active, "completedThisMonth": completed, "pendingListings": pending},
		"recentActiveLoads": recentActive, "recentCompletedLoads": recentCompleted, "recentWalletTransactions": transactions,
	})
}

func (a *API) corporateWallet(w http.ResponseWriter, r *http.Request) {
	_, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	wallet, err := a.store.GetCorporateWallet(company.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	transactions, err := a.store.ListWalletTransactions(wallet.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	summary, err := a.store.WalletSummary(company, transactions)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"wallet": wallet, "transactions": transactions, "summary": summary})
}

func minCents(first, second int64) int64 {
	if first < second {
		return first
	}
	return second
}

func (a *API) corporateLoadWalletView(company models.Company, load models.Load) (map[string]any, error) {
	policy, err := a.store.GetWalletPolicy()
	if err != nil {
		return nil, err
	}
	wallet, err := a.store.GetCorporateWallet(company.ID)
	if err != nil {
		return nil, err
	}
	priceCents, valid := models.TLToCents(load.AgreedPriceTL)
	if !valid {
		priceCents = 0
	}
	var allocation *models.LoadWalletAllocation
	stored, allocationErr := a.store.GetLoadWalletAllocation(load.ID)
	if allocationErr == nil {
		if stored.CompanyID != company.ID || stored.LoadID != load.ID {
			return nil, store.ErrCorporateAccountRequired
		}
		allocation = &stored
	} else if !errors.Is(allocationErr, redis.Nil) {
		return nil, allocationErr
	}
	usedCents := int64(0)
	if allocation != nil {
		usedCents = allocation.UsedCents
	}
	maxUsable := int64(0)
	if policy.Enabled && load.Status == models.LoadStatusDriverSelected && allocation == nil {
		maxUsable = minCents(wallet.BalanceCents, models.WalletPercent(priceCents, policy.MaxUsageBps, false))
	}
	return map[string]any{
		"enabled": policy.Enabled, "maxUsageBps": policy.MaxUsageBps,
		"wallet": wallet, "allocation": allocation, "agreedAmountCents": priceCents,
		"usedCents": usedCents, "customerPayableCents": priceCents - usedCents, "maxUsableCents": maxUsable,
	}, nil
}

func (a *API) corporateLoadWallet(w http.ResponseWriter, r *http.Request) {
	user, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	load, err := a.store.GetLoad(r.PathValue("id"))
	if err != nil || load.DeletedAt != nil {
		notFound(w)
		return
	}
	if load.CustomerID != user.ID {
		forbidden(w)
		return
	}
	view, err := a.corporateLoadWalletView(company, load)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, view)
}

func writeWalletError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrWalletBalance):
		badRequest(w, "cüzdan kapalı olabilir veya tutar/oran izin verilen sınırları aşıyor")
	case errors.Is(err, store.ErrWalletUsageExists):
		conflict(w, "bu nakliye için cüzdan kredisi daha önce kullanılmış")
	case errors.Is(err, store.ErrWalletConflict), errors.Is(err, store.ErrLoadStatusConflict):
		conflict(w, "cüzdan veya nakliye eşzamanlı olarak değişti; güncel bakiyeyle tekrar deneyin")
	case errors.Is(err, store.ErrInvalidLoadStatusTransition):
		conflict(w, "cüzdan yalnız fiyatı kesinleşmiş ve henüz başlamamış nakliyede kullanılabilir")
	default:
		serverError(w, err)
	}
}

func isWalletError(err error) bool {
	return errors.Is(err, store.ErrWalletBalance) || errors.Is(err, store.ErrWalletUsageExists) ||
		errors.Is(err, store.ErrWalletConflict) || errors.Is(err, store.ErrCorporateAccountRequired)
}

func (a *API) applyCorporateWallet(w http.ResponseWriter, r *http.Request) {
	user, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	load, err := a.store.GetLoad(r.PathValue("id"))
	if err != nil || load.DeletedAt != nil {
		notFound(w)
		return
	}
	if load.CustomerID != user.ID {
		forbidden(w)
		return
	}
	var request struct {
		AmountCents int64 `json:"amountCents"`
	}
	if !decode(w, r, &request) {
		return
	}
	if request.AmountCents <= 0 {
		badRequest(w, "kullanılacak kredi sıfırdan büyük olmalıdır")
		return
	}
	now := time.Now().UTC()
	transaction := models.WalletTransaction{
		ID: uuid.NewString(), CompanyID: company.ID, LoadID: load.ID, Type: models.WalletTransactionShipmentUsage,
		Description: "Nakliyede kullanılan kurumsal kredi", PickupAddress: load.Pickup.Address, DeliveryAddress: load.Delivery.Address,
		ActorID: user.ID, ActorRole: user.Role, CreatedAt: now,
	}
	wallet, allocation, created, err := a.store.ApplyWalletCredit(company, load, request.AmountCents, transaction)
	if err != nil {
		writeWalletError(w, err)
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]any{
		"wallet": wallet, "allocation": allocation, "transaction": created,
		"agreedAmountCents": allocation.OriginalAmountCents, "usedCents": allocation.UsedCents,
		"customerPayableCents": allocation.NetEligibleAmountCents, "maxUsableCents": 0,
	})
}

func (a *API) favoriteDrivers(w http.ResponseWriter, r *http.Request) {
	_, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	favorites, err := a.store.ListFavoriteDrivers(company.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	items := make([]map[string]any, 0, len(favorites))
	for _, favorite := range favorites {
		driver, getErr := a.store.GetUser(favorite.DriverID)
		if getErr != nil || driver.Role != models.RoleDriver {
			continue
		}
		item := map[string]any{"favorite": favorite, "driver": publicUser(driver)}
		if vehicle, vehicleErr := a.store.GetActiveVehicle(driver.ID); vehicleErr == nil {
			item["vehicle"] = vehicle
		}
		items = append(items, item)
	}
	jsonResponse(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) addFavoriteDriver(w http.ResponseWriter, r *http.Request) {
	user, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	var request struct {
		DriverID string `json:"driverId"`
	}
	if !decode(w, r, &request) {
		return
	}
	request.DriverID = strings.TrimSpace(request.DriverID)
	driver, err := a.store.GetUser(request.DriverID)
	if err != nil || driver.Role != models.RoleDriver {
		badRequest(w, "geçerli şoför zorunludur")
		return
	}
	eligible, err := a.store.HasCompletedLoadWithDriver(user.ID, driver.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !eligible {
		badRequest(w, "yalnız tamamlanan bir nakliyede çalıştığınız şoförü favorileyebilirsiniz")
		return
	}
	favorite := models.FavoriteDriver{CompanyID: company.ID, DriverID: driver.ID, CreatedAt: time.Now().UTC()}
	if err = a.store.AddFavoriteDriver(favorite); errors.Is(err, store.ErrFavoriteDriverExists) {
		conflict(w, "şoför zaten favorilerinizde")
		return
	} else if err != nil {
		serverError(w, err)
		return
	}
	item := map[string]any{"favorite": favorite, "driver": publicUser(driver)}
	if vehicle, vehicleErr := a.store.GetActiveVehicle(driver.ID); vehicleErr == nil {
		item["vehicle"] = vehicle
	}
	jsonResponse(w, http.StatusCreated, item)
}

func (a *API) removeFavoriteDriver(w http.ResponseWriter, r *http.Request) {
	_, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	if err := a.store.RemoveFavoriteDriver(company.ID, r.PathValue("id")); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

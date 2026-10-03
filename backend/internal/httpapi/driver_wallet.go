package httpapi

import (
	"errors"
	"fmt"
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
	"net/http"
	"strings"
	"time"
)

func (a *API) driverWalletView(w http.ResponseWriter, r *http.Request, id string) {
	wallet, err := a.store.GetDriverWallet(id)
	if err != nil {
		serverError(w, err)
		return
	}
	entries, err := a.store.ListDriverWalletTransactions(id)
	if err != nil {
		serverError(w, err)
		return
	}
	account, err := a.store.GetDriverPaymentAccount()
	if err != nil {
		serverError(w, err)
		return
	}
	var paymentAccount *models.DriverPaymentAccount
	if account.Enabled {
		paymentAccount = &account
	}
	jsonResponse(w, 200, map[string]any{"wallet": wallet, "transactions": entries, "paymentAccount": paymentAccount, "paymentReference": "SOFOR-" + id})
}

func (a *API) adminDriverPaymentAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		var account models.DriverPaymentAccount
		if !decode(w, r, &account) {
			return
		}
		account.Normalize()
		if err := account.Validate(); err != nil {
			badRequest(w, err.Error())
			return
		}
		account.UpdatedAt = time.Now().UTC()
		if err := a.store.SaveDriverPaymentAccount(account); err != nil {
			serverError(w, err)
			return
		}
		a.adminAudit("driver.payment_account_updated", r, "driver-payment-account", account)
		jsonResponse(w, 200, account)
		return
	}
	account, err := a.store.GetDriverPaymentAccount()
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, 200, account)
}
func (a *API) driverWallet(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	a.driverWalletView(w, r, p.ID)
}
func (a *API) adminDriverWallet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	u, err := a.store.GetUser(id)
	if err != nil || u.Role != models.RoleDriver {
		notFound(w)
		return
	}
	a.driverWalletView(w, r, id)
}
func (a *API) adminDriverTopup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	u, err := a.store.GetUser(id)
	if err != nil || u.Role != models.RoleDriver {
		notFound(w)
		return
	}
	var body struct {
		AmountCents int64  `json:"amountCents"`
		Reference   string `json:"reference"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Reference = strings.TrimSpace(body.Reference)
	if body.AmountCents <= 0 || body.AmountCents > models.MaxWalletCents || len(body.Reference) < 3 || len(body.Reference) > 200 {
		badRequest(w, "Geçerli tutar ve ödeme referansı girin.")
		return
	}
	err = a.store.TopupDriverWallet(id, body.AmountCents, body.Reference, currentAdmin(r).Email)
	if err != nil {
		if errors.Is(err, store.ErrWalletConflict) || errors.Is(err, store.ErrWalletUsageExists) || errors.Is(err, store.ErrDriverWalletBalance) {
			conflict(w, "Bakiye yüklenemedi. Referansı ve tutarı kontrol edip yeniden deneyin.")
			return
		}
		serverError(w, err)
		return
	}
	a.adminAudit("driver.wallet_topup", r, id, body)
	a.driverWalletView(w, r, id)
}
func (a *API) checkDriverOfferBalance(w http.ResponseWriter, id string, amountTL float64) bool {
	fee, valid := models.DriverCommissionCents(amountTL)
	if !valid {
		badRequest(w, "Geçerli bir teklif tutarı girin.")
		return false
	}
	wallet, err := a.store.GetDriverWallet(id)
	if err != nil {
		serverError(w, err)
		return false
	}
	if wallet.AvailableCents < fee {
		conflict(w, fmt.Sprintf("Teklif için en az %.2f TL kullanılabilir bakiye gerekiyor. Teklif verirken ücret alınmaz.", float64(fee)/100))
		return false
	}
	return true
}

// Admin account overview includes unfunded drivers, not only persisted wallets.
func (a *API) adminDriverWalletAccounts(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListAllUsers()
	if err != nil {
		serverError(w, err)
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	status := r.URL.Query().Get("walletStatus")
	if status != "" && status != "funded" && status != "reserved" && status != "empty" {
		badRequest(w, "Geçersiz hesap filtresi.")
		return
	}
	items := make([]map[string]any, 0)
	fundedCount, reservedCount := 0, 0
	for _, user := range users {
		if user.Role != models.RoleDriver {
			continue
		}
		if query != "" && !containsFold(strings.Join([]string{user.ID, user.Name, user.Email, user.Phone}, " "), query) {
			continue
		}
		wallet, err := a.store.GetDriverWallet(user.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		if status == "funded" && wallet.BalanceCents == 0 || status == "reserved" && wallet.ReservedCents == 0 || status == "empty" && wallet.BalanceCents != 0 {
			continue
		}
		if wallet.BalanceCents > 0 {
			fundedCount++
		}
		if wallet.ReservedCents > 0 {
			reservedCount++
		}
		items = append(items, map[string]any{"driver": a.adminUserView(user), "wallet": wallet})
	}
	offset, limit := pagination(r.URL.Query())
	jsonResponse(w, 200, map[string]any{"items": page(items, offset, limit), "total": len(items), "offset": offset, "limit": limit, "summary": map[string]int{"fundedCount": fundedCount, "reservedCount": reservedCount}})
}

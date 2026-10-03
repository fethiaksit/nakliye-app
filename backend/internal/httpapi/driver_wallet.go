package httpapi

import (
	"errors"
	"fmt"
	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
	"net/http"
	"strings"
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
	jsonResponse(w, 200, map[string]any{"wallet": wallet, "transactions": entries})
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

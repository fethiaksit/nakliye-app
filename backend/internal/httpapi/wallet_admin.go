package httpapi

import (
	"crypto/sha256"
	"fmt"
	"nakliye-api/internal/models"
	"net/http"
	"strings"
)

func (a *API) adminWalletSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		var p models.WalletPolicy
		if !decode(w, r, &p) {
			return
		}
		if err := p.Validate(); err != nil {
			badRequest(w, err.Error())
			return
		}
		previous, err := a.store.GetWalletPolicy()
		if err != nil {
			serverError(w, err)
			return
		}
		if err = a.store.SaveWalletPolicy(p); err != nil {
			serverError(w, err)
			return
		}
		a.adminAudit("wallet.settings_changed", r, "wallet-settings", map[string]any{"before": previous, "after": p})
	}
	p, err := a.store.GetWalletPolicy()
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, 200, p)
}

func (a *API) walletCompanyForAdmin(w http.ResponseWriter, r *http.Request) (models.Company, bool) {
	user, err := a.store.GetUser(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return models.Company{}, false
	}
	if models.CustomerAccountType(user) != models.AccountTypeCorporate {
		forbidden(w)
		return models.Company{}, false
	}
	if user.CorporateStatus != "" && user.CorporateStatus != models.CorporateStatusApproved {
		forbidden(w)
		return models.Company{}, false
	}
	company, err := a.store.GetCompanyByUser(user.ID)
	if err != nil {
		serverError(w, err)
		return company, false
	}
	return company, true
}
func (a *API) adminWalletView(company models.Company) (map[string]any, error) {
	wallet, err := a.store.GetCorporateWallet(company.ID)
	if err != nil {
		return nil, err
	}
	transactions, err := a.store.ListWalletTransactions(wallet.ID)
	if err != nil {
		return nil, err
	}
	summary, err := a.store.WalletSummary(company, transactions)
	if err != nil {
		return nil, err
	}
	return map[string]any{"company": company, "wallet": wallet, "summary": summary, "transactions": transactions}, nil
}
func (a *API) adminWalletList(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListAllUsers()
	if err != nil {
		serverError(w, err)
		return
	}
	items := make([]map[string]any, 0)
	for _, u := range users {
		if models.CustomerAccountType(u) != models.AccountTypeCorporate {
			continue
		}
		if u.CorporateStatus != "" && u.CorporateStatus != models.CorporateStatusApproved {
			continue
		}
		company, e := a.store.GetCompanyByUser(u.ID)
		if e != nil {
			serverError(w, e)
			return
		}
		if q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))); q != "" && !strings.Contains(strings.ToLower(company.Name+" "+u.Name+" "+u.Email), q) {
			continue
		}
		view, e := a.adminWalletView(company)
		if e != nil {
			serverError(w, e)
			return
		}
		delete(view, "transactions")
		items = append(items, view)
	}
	jsonResponse(w, 200, map[string]any{"items": items})
}
func (a *API) adminWallet(w http.ResponseWriter, r *http.Request) {
	company, ok := a.walletCompanyForAdmin(w, r)
	if !ok {
		return
	}
	view, err := a.adminWalletView(company)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, 200, view)
}
func (a *API) adminWalletRate(w http.ResponseWriter, r *http.Request) {
	company, ok := a.walletCompanyForAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		RewardRateBps *int64 `json:"rewardRateBps"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := a.store.SaveWalletRate(company.ID, body.RewardRateBps); err != nil {
		writeWalletError(w, err)
		return
	}
	a.adminAudit("wallet.customer_rate_changed", r, company.ID, body)
	a.adminWallet(w, r)
}
func (a *API) adminWalletAdjustment(w http.ResponseWriter, r *http.Request) {
	company, ok := a.walletCompanyForAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		IdempotencyKey string `json:"idempotencyKey"`
		AmountCents    int64  `json:"amountCents"`
		Description    string `json:"description"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Description = strings.TrimSpace(body.Description)
	if len(body.IdempotencyKey) < 8 || len(body.IdempotencyKey) > 128 || body.Description == "" || len(body.Description) > 1000 {
		badRequest(w, "işlem anahtarı (8–128 karakter) ve açıklama zorunludur")
		return
	}
	id := fmt.Sprintf("admin-%x", sha256.Sum256([]byte(company.ID+":"+body.IdempotencyKey)))
	entry, err := a.store.AdjustWallet(company, models.WalletTransaction{ID: id, AmountCents: body.AmountCents, Description: body.Description, ActorID: currentAdmin(r).Email, ActorRole: models.RoleAdmin})
	if err != nil {
		writeWalletError(w, err)
		return
	}
	a.adminAudit("wallet.admin_adjustment", r, company.ID, entry)
	jsonResponse(w, 200, entry)
}

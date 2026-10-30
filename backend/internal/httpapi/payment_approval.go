package httpapi

import (
	"github.com/google/uuid"
	"nakliye-api/internal/models"
	"net/http"
	"time"
)

func (a *API) selectCreditOffer(w http.ResponseWriter, r *http.Request, l models.Load, o models.Offer, credit int64) {
	user, company, ok := a.corporateContext(w, r)
	if !ok {
		return
	}
	if models.CanonicalLoadStatus(l.Status) != models.LoadStatusPublished {
		conflict(w, "İlan ödeme seçimine uygun değil.")
		return
	}
	cents, valid := models.TLToCents(o.AmountTL)
	if !valid {
		badRequest(w, "Geçersiz teklif bedeli")
		return
	}
	now := time.Now().UTC()
	l.Status = models.LoadStatusPaymentApprovalPending
	l.AgreedPriceTL = o.AmountTL
	l.PaymentApproval = &models.PaymentApproval{ID: uuid.NewString(), LoadID: l.ID, OfferID: o.ID, DriverID: o.DriverID, AmountCents: cents, CreditCents: credit, CustomerPayableCents: cents - credit, Status: "pending", RequestedAt: now}
	l.UpdatedAt = now
	entry := models.WalletTransaction{ID: uuid.NewString(), CompanyID: company.ID, LoadID: l.ID, Type: models.WalletTransactionShipmentUsage, Description: "Şoför ödeme onayı için ayrılan kurumsal kredi", ActorID: user.ID, ActorRole: user.Role, CreatedAt: now}
	if _, _, _, err := a.store.ApplyWalletCredit(company, l, credit, entry); err != nil {
		writeWalletError(w, err)
		return
	}
	a.sendPush(o.DriverID, "Kurumsal nakliye — ödeme onayı", "Müşteriden alacağınız tutarı ve cüzdan kredisi karşılığını inceleyip onaylayın.", map[string]string{"eventId": "payment-request:" + l.PaymentApproval.ID, "type": "payment_approval_pending", "loadId": l.ID, "screen": "load"})
	jsonResponse(w, 200, l)
}

func (a *API) decidePaymentApproval(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	l, err := a.store.GetLoad(r.PathValue("id"))
	if err != nil || l.DeletedAt != nil {
		notFound(w)
		return
	}
	if p.Role != models.RoleDriver || l.PaymentApproval == nil || l.PaymentApproval.DriverID != p.ID {
		forbidden(w)
		return
	}
	var req struct {
		SelectionID string `json:"selectionId"`
		Accept      *bool  `json:"accept"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Accept == nil || req.SelectionID == "" {
		badRequest(w, "Açık ödeme kararı ve seçim kimliği zorunludur.")
		return
	}
	approval := *l.PaymentApproval
	if approval.ID != req.SelectionID || approval.Status != "pending" || l.Status != models.LoadStatusPaymentApprovalPending {
		conflict(w, "Ödeme seçimi artık güncel değil.")
		return
	}
	now := time.Now().UTC()
	approval.DecidedAt = &now
	approval.DecidedBy = p.ID
	l.PaymentApproval = &approval
	if *req.Accept {
		o, e := a.store.GetOffer(approval.OfferID)
		if e != nil {
			notFound(w)
			return
		}
		approval.Status = "approved"
		a.acceptSelectedOffer(w, r, l, o)
		return
	}
	approval.Status = "rejected"
	l.Status = models.LoadStatusPublished
	l.AgreedPriceTL = 0
	l.UpdatedAt = now
	company, e := a.companyForCorporateCustomer(l.CustomerID)
	if e != nil || company == nil {
		serverError(w, e)
		return
	}
	event := newLoadStatusEvent(l.ID, models.LoadStatusPaymentApprovalPending, l.Status, p.ID, p.Role, models.LoadStatusSourceDriverApp, "Şoför ödeme şeklini reddetti", now)
	refund := models.WalletTransaction{ID: uuid.NewString(), CompanyID: company.ID, LoadID: l.ID, Type: models.WalletTransactionReversal, Description: "Reddedilen ödeme seçiminin kredi iadesi", ActorID: p.ID, ActorRole: p.Role, CreatedAt: now}
	if _, e = a.store.TransitionLoadStatusAndReverseWallet(models.LoadStatusPaymentApprovalPending, l, event, company, refund); e != nil {
		writeWalletError(w, e)
		return
	}
	a.sendPush(l.CustomerID, "Şoför ödeme şeklini reddetti", "Kurumsal krediniz iade edildi. İlanınız yeniden teklif seçimine açık.", map[string]string{"eventId": "payment-decision:" + approval.ID, "type": "payment_approval_rejected", "loadId": l.ID, "screen": "load"})
	jsonResponse(w, 200, l)
}

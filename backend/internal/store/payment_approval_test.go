package store

import (
	"nakliye-api/internal/models"
	"testing"
	"time"
)

func TestCreditReservationLedgerFailureLeavesMoneyAndLoadUnchanged(t *testing.T) {
	s, company := walletStore(t)
	if _, e := s.AdjustWallet(company, models.WalletTransaction{ID: "seed", AmountCents: 10000, Description: "Seed"}); e != nil {
		t.Fatal(e)
	}
	l := models.Load{ID: "credit-job", CustomerID: company.OwnerCustomerID, Status: models.LoadStatusPublished}
	if e := s.SaveLoad(l); e != nil {
		t.Fatal(e)
	}
	offer := models.Offer{ID: "offer", LoadID: l.ID, DriverID: "driver", AmountTL: 4100, Status: "pending"}
	if e := s.SaveOffer(offer); e != nil {
		t.Fatal(e)
	}
	if e := s.client.Set(s.ctx, "wallet-transactions:w", "invalid-index", 0).Err(); e != nil {
		t.Fatal(e)
	}
	now := time.Now().UTC()
	l.Status = models.LoadStatusPaymentApprovalPending
	l.PaymentApproval = &models.PaymentApproval{ID: "selection", LoadID: l.ID, OfferID: offer.ID, DriverID: offer.DriverID, Status: "pending", AmountCents: 410000, CreditCents: 6000, CustomerPayableCents: 404000, RequestedAt: now}
	_, _, _, err := s.ApplyWalletCredit(company, l, 6000, models.WalletTransaction{ID: "spend", LoadID: l.ID, CompanyID: company.ID, Type: models.WalletTransactionShipmentUsage, CreatedAt: now})
	if err == nil {
		t.Fatal("expected index failure")
	}
	stored, _ := s.GetLoad(l.ID)
	wallet, _ := s.GetCorporateWallet(company.ID)
	if stored.Status != models.LoadStatusPublished || wallet.BalanceCents != 10000 {
		t.Fatalf("partial transaction: load=%s balance=%d", stored.Status, wallet.BalanceCents)
	}
}

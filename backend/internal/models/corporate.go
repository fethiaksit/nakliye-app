package models

import (
	"math"
	"time"
)

const (
	AccountTypeIndividual = "individual"
	AccountTypeCorporate  = "corporate"
)

const (
	WalletTransactionShipmentReward = "shipment_reward"
	WalletTransactionShipmentUsage  = "shipment_usage"
	WalletTransactionAdjustment     = "adjustment"
	WalletTransactionReversal       = "reversal"
)

func ValidCustomerAccountType(value string) bool {
	return value == AccountTypeIndividual || value == AccountTypeCorporate
}

// CustomerAccountType keeps customer records created before account types
// were introduced backward compatible without mutating their persisted data.
func CustomerAccountType(user User) string {
	if user.Role == RoleCustomer && user.AccountType == AccountTypeCorporate {
		return AccountTypeCorporate
	}
	return AccountTypeIndividual
}

// Company ownership is resolved from the authenticated user through a
// server-side mapping. Additional company-user mappings can be added later
// without changing the company or wallet records.
type Company struct {
	ID               string    `json:"id"`
	OwnerCustomerID  string    `json:"ownerCustomerId"`
	Name             string    `json:"name"`
	AuthorizedPerson string    `json:"authorizedPerson"`
	TaxNumber        string    `json:"taxNumber"`
	TaxOffice        string    `json:"taxOffice"`
	Address          string    `json:"address"`
	Phone            string    `json:"phone"`
	Email            string    `json:"email"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type CorporateWallet struct {
	ID           string    `json:"id"`
	CompanyID    string    `json:"companyId"`
	BalanceCents int64     `json:"balanceCents"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// AmountCents is signed: rewards and reversals are positive, usage is
// negative. BalanceAfterCents makes each immutable ledger record auditable.
type WalletTransaction struct {
	ID                string    `json:"id"`
	WalletID          string    `json:"walletId"`
	CompanyID         string    `json:"companyId"`
	LoadID            string    `json:"loadId,omitempty"`
	Type              string    `json:"type"`
	AmountCents       int64     `json:"amountCents"`
	BalanceAfterCents int64     `json:"balanceAfterCents"`
	Description       string    `json:"description"`
	PickupAddress     string    `json:"pickupAddress,omitempty"`
	DeliveryAddress   string    `json:"deliveryAddress,omitempty"`
	ActorID           string    `json:"actorId,omitempty"`
	ActorRole         string    `json:"actorRole,omitempty"`
	CreatedAt         time.Time `json:"createdAt"`
}

// LoadWalletAllocation is deliberately not embedded in Load. Driver-facing
// load responses therefore keep the agreed driver price unchanged and do not
// disclose the customer's incentive balance or usage.
type LoadWalletAllocation struct {
	LoadID                     string    `json:"loadId"`
	CompanyID                  string    `json:"companyId"`
	WalletID                   string    `json:"walletId"`
	OriginalAmountCents        int64     `json:"originalAmountCents"`
	UsedCents                  int64     `json:"usedCents"`
	NetEligibleAmountCents     int64     `json:"netEligibleAmountCents"`
	UsageTransactionID         string    `json:"usageTransactionId,omitempty"`
	UsageReversalTransactionID string    `json:"usageReversalTransactionId,omitempty"`
	RewardTransactionID        string    `json:"rewardTransactionId,omitempty"`
	CreatedAt                  time.Time `json:"createdAt"`
	UpdatedAt                  time.Time `json:"updatedAt"`
}

type FavoriteDriver struct {
	CompanyID string    `json:"companyId"`
	DriverID  string    `json:"driverId"`
	CreatedAt time.Time `json:"createdAt"`
}

func TLToCents(value float64) (int64, bool) {
	if value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) || value > float64(math.MaxInt64)/100 {
		return 0, false
	}
	return int64(math.Round(value * 100)), true
}

// CorporateRewardCents calculates the 10% loyalty credit after previously
// used wallet credit. Integer cents avoid floating-point ledger drift.
func CorporateRewardCents(agreedPriceTL float64, usedCents int64) (eligibleCents, rewardCents int64, ok bool) {
	priceCents, valid := TLToCents(agreedPriceTL)
	if !valid || usedCents < 0 || usedCents > priceCents {
		return 0, 0, false
	}
	eligibleCents = priceCents - usedCents
	return eligibleCents, (eligibleCents + 5) / 10, true
}

package models

import (
	"math"
	"math/big"
	"strconv"
	"time"
)

const (
	AccountTypeIndividual   = "individual"
	AccountTypeCorporate    = "corporate"
	CorporateStatusPending  = "pending"
	CorporateStatusApproved = "approved"
	CorporateStatusRejected = "rejected"
)

func ValidCorporateStatus(value string) bool {
	return value == CorporateStatusPending || value == CorporateStatusApproved || value == CorporateStatusRejected
}

const (
	WalletTransactionShipmentReward = "earn"
	WalletTransactionShipmentUsage  = "spend"
	WalletTransactionAdjustment     = "admin_adjustment"
	WalletTransactionReversal       = "refund"
	WalletTransactionExpired        = "expired"
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
	SchemaVersion       int        `json:"schemaVersion"`
	CorporateCustomerID string     `json:"corporateCustomerId"`
	BalanceBeforeCents  int64      `json:"balanceBeforeCents"`
	RewardRateBps       int64      `json:"rewardRateBps"`
	ExpiresAt           *time.Time `json:"expiresAt,omitempty"`
	ID                  string     `json:"id"`
	WalletID            string     `json:"walletId"`
	CompanyID           string     `json:"companyId"`
	LoadID              string     `json:"loadId,omitempty"`
	Type                string     `json:"type"`
	AmountCents         int64      `json:"amountCents"`
	BalanceAfterCents   int64      `json:"balanceAfterCents"`
	Description         string     `json:"description"`
	PickupAddress       string     `json:"pickupAddress,omitempty"`
	DeliveryAddress     string     `json:"deliveryAddress,omitempty"`
	ActorID             string     `json:"actorId,omitempty"`
	ActorRole           string     `json:"actorRole,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
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
	if value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	// Legacy load/offer APIs expose TL floats. Convert their decimal representation
	// once at this boundary; all wallet arithmetic remains exact integer/rational.
	r, ok := new(big.Rat).SetString(strconv.FormatFloat(value, 'f', -1, 64))
	if !ok {
		return 0, false
	}
	r.Mul(r, big.NewRat(100, 1))
	if r.Cmp(big.NewRat(MaxWalletCents, 1)) > 0 {
		return 0, false
	}
	r.Add(r, big.NewRat(1, 2))
	n := new(big.Int).Quo(r.Num(), r.Denom())
	if !n.IsInt64() || n.Sign() <= 0 {
		return 0, false
	}
	return n.Int64(), true
}

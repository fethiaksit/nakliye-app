package models

import "time"

// Driver wallets are independent of corporate promotional credits. All values are kuruş.
type DriverWallet struct {
	DriverID       string    `json:"driverId"`
	BalanceCents   int64     `json:"balanceCents"`
	ReservedCents  int64     `json:"reservedCents"`
	AvailableCents int64     `json:"availableCents"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
type DriverWalletTransaction struct {
	ID                 string    `json:"id"`
	DriverID           string    `json:"driverId"`
	LoadID             string    `json:"loadId,omitempty"`
	Type               string    `json:"type"`
	AmountCents        int64     `json:"amountCents"`
	BalanceBeforeCents int64     `json:"balanceBeforeCents"`
	BalanceAfterCents  int64     `json:"balanceAfterCents"`
	ReservedAfterCents int64     `json:"reservedAfterCents"`
	Reference          string    `json:"reference,omitempty"`
	ActorID            string    `json:"actorId,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
}
type DriverCommission struct {
	LoadID      string `json:"loadId"`
	DriverID    string `json:"driverId"`
	AmountCents int64  `json:"amountCents"`
	Status      string `json:"status"`
}

func DriverCommissionCents(amountTL float64) (int64, bool) {
	cents, valid := TLToCents(amountTL)
	if !valid {
		return 0, false
	}
	fee := WalletPercent(cents, 1000, true)
	return fee, fee > 0
}

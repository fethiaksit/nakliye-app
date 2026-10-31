package store

import (
	"encoding/json"
	"errors"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"strings"
)

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
func samePaymentTerms(a, b *models.PaymentApproval) bool {
	return a != nil && b != nil && a.ID == b.ID && a.LoadID == b.LoadID && a.OfferID == b.OfferID && a.DriverID == b.DriverID && a.AmountCents == b.AmountCents && a.CreditCents == b.CreditCents && a.CustomerPayableCents == b.CustomerPayableCents && a.RequestedAt.Equal(b.RequestedAt)
}

// Retry only optimistic conflicts; connection failures are returned to callers.
// A retry after a lost response sees the committed state and cannot pay twice.
func (s *RedisStore) watchPayment(fn func(*redis.Tx) error, keys ...string) error {
	// Redis MULTI does not roll back a command-level WRONGTYPE error. Validate
	// and WATCH every financial/history index before issuing any writes.
	indexes := map[string]bool{}
	for _, key := range keys {
		switch {
		case strings.HasPrefix(key, "load:"):
			indexes["load-status-history:"+strings.TrimPrefix(key, "load:")] = true
		case strings.HasPrefix(key, "wallet:"):
			indexes["wallet-transactions:"+strings.TrimPrefix(key, "wallet:")] = true
		case strings.HasPrefix(key, "driver-wallet:"):
			indexes["driver-wallet-transactions:"+strings.TrimPrefix(key, "driver-wallet:")] = true
		}
	}
	for key := range indexes {
		keys = append(keys, key)
	}
	var err error
	for i := 0; i < 8; i++ {
		err = s.client.Watch(s.ctx, func(tx *redis.Tx) error {
			if err := s.guardOperation(tx, keys); err != nil {
				return err
			}
			for key := range indexes {
				kind, e := tx.Type(s.ctx, key).Result()
				if e != nil {
					return e
				}
				if kind != "none" && kind != "zset" {
					return ErrWalletConflict
				}
			}
			return fn(tx)
		}, keys...)
		if !errors.Is(err, redis.TxFailedErr) {
			return err
		}
	}
	return err
}

// Operational status is not proof of consent: old or inconsistent records must
// also satisfy the reserved corporate credit and immutable approval snapshot.
func (s *RedisStore) requireDriverPaymentConsent(tx *redis.Tx, load models.Load) error {
	approval := load.PaymentApproval
	if approval != nil && approval.Status == "pending" {
		return ErrInvalidLoadStatusTransition
	}

	// Corporate cash plans require the same explicit driver decision as credit plans.
	corporate, err := tx.Exists(s.ctx, "company:user:"+load.CustomerID).Result()
	if err != nil {
		return err
	}
	status := models.CanonicalLoadStatus(load.Status)
	operational := status != models.LoadStatusDraft && status != models.LoadStatusPublished && status != models.LoadStatusCancelled
	if corporate > 0 && (load.AssignedDriver != "" || operational) || approval != nil && approval.Status == "approved" {
		price, valid := models.TLToCents(load.AgreedPriceTL)
		if approval == nil || approval.Status != "approved" || approval.DecidedAt == nil || approval.DecidedBy != load.AssignedDriver || approval.DriverID != load.AssignedDriver || approval.LoadID != load.ID || !valid || approval.AmountCents != price || approval.CreditCents < 0 || approval.CustomerPayableCents != price-approval.CreditCents {
			return ErrInvalidLoadStatusTransition
		}
	}
	body, err := tx.Get(s.ctx, "load-wallet:"+load.ID).Bytes()
	if errors.Is(err, redis.Nil) {
		if approval != nil && approval.CreditCents > 0 && approval.Status == "approved" {
			return ErrLoadStatusConflict
		}
		return nil
	}
	if err != nil {
		return err
	}
	var allocation models.LoadWalletAllocation
	if err = json.Unmarshal(body, &allocation); err != nil {
		return err
	}
	if allocation.UsedCents <= 0 || allocation.UsageReversalTransactionID != "" {
		return nil
	}
	price, valid := models.TLToCents(load.AgreedPriceTL)
	if approval == nil || approval.Status != "approved" || approval.DecidedAt == nil || approval.DecidedBy != load.AssignedDriver || approval.DriverID != load.AssignedDriver || approval.LoadID != load.ID || !valid || approval.AmountCents != price || approval.CreditCents != allocation.UsedCents || approval.CustomerPayableCents != price-allocation.UsedCents || allocation.LoadID != load.ID || allocation.OriginalAmountCents != price {
		return ErrInvalidLoadStatusTransition
	}
	return nil
}

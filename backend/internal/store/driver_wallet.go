package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"time"
)

var ErrDriverWalletBalance = errors.New("insufficient driver wallet balance")

func driverWalletKey(id string) string     { return "driver-wallet:" + id }
func driverCommissionKey(id string) string { return "driver-commission:" + id }
func (s *RedisStore) readDriverWallet(reader walletReader, id string) (models.DriverWallet, error) {
	w := models.DriverWallet{DriverID: id}
	b, e := reader.Get(s.ctx, driverWalletKey(id)).Bytes()
	if errors.Is(e, redis.Nil) {
		return w, nil
	}
	if e != nil {
		return w, e
	}
	if e = json.Unmarshal(b, &w); e != nil {
		return w, e
	}
	if w.DriverID != id || w.ReservedCents < 0 || w.BalanceCents < w.ReservedCents || w.BalanceCents > models.MaxWalletCents {
		return w, ErrDriverWalletBalance
	}
	w.AvailableCents = w.BalanceCents - w.ReservedCents
	return w, nil
}
func (s *RedisStore) GetDriverWallet(id string) (models.DriverWallet, error) {
	return s.readDriverWallet(s.client, id)
}
func (s *RedisStore) ListDriverWalletTransactions(id string) ([]models.DriverWalletTransaction, error) {
	ids, e := s.client.ZRevRange(s.ctx, "driver-wallet-transactions:"+id, 0, -1).Result()
	if e != nil {
		return nil, e
	}
	entries := make([]models.DriverWalletTransaction, 0, len(ids))
	for _, key := range ids {
		b, e := s.client.Get(s.ctx, "driver-wallet-transaction:"+key).Bytes()
		if e != nil {
			return nil, e
		}
		var entry models.DriverWalletTransaction
		if e = json.Unmarshal(b, &entry); e != nil {
			return nil, e
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// Topups are admin-confirmed receipts; the payment reference is an immutable idempotency key.
func (s *RedisStore) TopupDriverWallet(id string, amount int64, reference, actor string) error {
	if amount <= 0 || amount > models.MaxWalletCents || reference == "" {
		return ErrDriverWalletBalance
	}
	hash := sha256.Sum256([]byte(id + "\x00" + reference))
	entryID := "topup:" + hex.EncodeToString(hash[:])
	entryKey := "driver-wallet-transaction:" + entryID
	err := s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		old, e := tx.Get(s.ctx, entryKey).Bytes()
		if e == nil {
			var entry models.DriverWalletTransaction
			if e = json.Unmarshal(old, &entry); e != nil {
				return e
			}
			if entry.DriverID != id || entry.AmountCents != amount || entry.Reference != reference {
				return ErrWalletUsageExists
			}
			return nil
		}
		if !errors.Is(e, redis.Nil) {
			return e
		}
		w, e := s.readDriverWallet(tx, id)
		if e != nil {
			return e
		}
		if w.BalanceCents > models.MaxWalletCents-amount {
			return ErrDriverWalletBalance
		}
		before := w.BalanceCents
		w.BalanceCents += amount
		w.AvailableCents = w.BalanceCents - w.ReservedCents
		w.UpdatedAt = time.Now().UTC()
		entry := models.DriverWalletTransaction{ID: entryID, DriverID: id, Type: "TOPUP", AmountCents: amount, BalanceBeforeCents: before, BalanceAfterCents: w.BalanceCents, ReservedAfterCents: w.ReservedCents, Reference: reference, ActorID: actor, CreatedAt: w.UpdatedAt}
		wb, e := json.Marshal(w)
		if e != nil {
			return e
		}
		eb, e := json.Marshal(entry)
		if e != nil {
			return e
		}
		_, e = tx.TxPipelined(s.ctx, func(p redis.Pipeliner) error {
			p.Set(s.ctx, driverWalletKey(id), wb, 0)
			p.Set(s.ctx, entryKey, eb, 0)
			p.ZAdd(s.ctx, "driver-wallet-transactions:"+id, redis.Z{Score: float64(entry.CreatedAt.UnixMicro()), Member: entryID})
			return nil
		})
		return e
	}, driverWalletKey(id), entryKey)
	if errors.Is(err, redis.TxFailedErr) {
		return ErrWalletConflict
	}
	return err
}

type driverWalletMutation struct {
	wallet     models.DriverWallet
	commission models.DriverCommission
	entry      models.DriverWalletTransaction
}

func driverWatchKeys(load models.Load) []string {
	return []string{driverWalletKey(load.AssignedDriver), driverCommissionKey(load.ID)}
}

// Called inside the same WATCH/MULTI as the job state transition, never after it.
func (s *RedisStore) prepareDriverCommission(tx *redis.Tx, load models.Load, kind, actor string, at time.Time) (*driverWalletMutation, error) {
	if load.DriverCommissionCents == 0 {
		return nil, nil
	} // grandfather already accepted jobs
	w, e := s.readDriverWallet(tx, load.AssignedDriver)
	if e != nil {
		return nil, e
	}
	c := models.DriverCommission{LoadID: load.ID, DriverID: load.AssignedDriver, AmountCents: load.DriverCommissionCents, Status: "reserved"}
	b, e := tx.Get(s.ctx, driverCommissionKey(load.ID)).Bytes()
	if kind == "RESERVE" {
		if e == nil {
			return nil, ErrLoadStatusConflict
		}
		if !errors.Is(e, redis.Nil) {
			return nil, e
		}
		if w.AvailableCents < c.AmountCents {
			return nil, ErrDriverWalletBalance
		}
	} else {
		if e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &c); e != nil {
			return nil, e
		}
		if c.Status != "reserved" || c.DriverID != load.AssignedDriver || c.LoadID != load.ID || c.AmountCents != load.DriverCommissionCents || w.ReservedCents < c.AmountCents {
			return nil, ErrLoadStatusConflict
		}
	}
	before := w.BalanceCents
	switch kind {
	case "RESERVE":
		w.ReservedCents += c.AmountCents
	case "RELEASE":
		w.ReservedCents -= c.AmountCents
		c.Status = "released"
	case "COMMISSION":
		w.ReservedCents -= c.AmountCents
		w.BalanceCents -= c.AmountCents
		c.Status = "charged"
	default:
		return nil, ErrInvalidLoadStatusTransition
	}
	w.AvailableCents = w.BalanceCents - w.ReservedCents
	w.UpdatedAt = at
	amount := c.AmountCents
	if kind == "COMMISSION" {
		amount = -amount
	}
	entry := models.DriverWalletTransaction{ID: load.ID + ":" + kind, DriverID: w.DriverID, LoadID: load.ID, Type: kind, AmountCents: amount, BalanceBeforeCents: before, BalanceAfterCents: w.BalanceCents, ReservedAfterCents: w.ReservedCents, ActorID: actor, CreatedAt: at}
	return &driverWalletMutation{wallet: w, commission: c, entry: entry}, nil
}
func (s *RedisStore) writeDriverCommission(p redis.Pipeliner, m *driverWalletMutation) {
	if m == nil {
		return
	}
	// These concrete structs contain only JSON-safe scalar fields.
	wb, _ := json.Marshal(m.wallet)
	cb, _ := json.Marshal(m.commission)
	eb, _ := json.Marshal(m.entry)
	p.Set(s.ctx, driverWalletKey(m.wallet.DriverID), wb, 0)
	p.Set(s.ctx, driverCommissionKey(m.commission.LoadID), cb, 0)
	p.Set(s.ctx, "driver-wallet-transaction:"+m.entry.ID, eb, 0)
	p.ZAdd(s.ctx, "driver-wallet-transactions:"+m.wallet.DriverID, redis.Z{Score: float64(m.entry.CreatedAt.UnixMicro()), Member: m.entry.ID})
}

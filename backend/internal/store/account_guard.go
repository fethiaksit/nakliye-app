package store

import (
	"encoding/json"
	"errors"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"strings"
)

var ErrAccountUnavailable = errors.New("hesap kapatılıyor veya kapalı; işlem yapılamaz")

// Watch the persisted account as well as financial records. A request that was
// authenticated before closure must not commit after the deletion fence.
func (s *RedisStore) guardAccounts(tx *redis.Tx, ids ...string) error {
	for _, id := range ids {
		if id == "" {
			continue
		}
		key := "user:" + id
		if err := tx.Watch(s.ctx, key).Err(); err != nil {
			return err
		}
		b, err := tx.Get(s.ctx, key).Bytes()
		// Some historical/imported records have no account. Existing tombstones are
		// never removed; their fence is enforced independently of caller snapshots.
		if errors.Is(err, redis.Nil) {
			continue
		}
		if err != nil {
			return err
		}
		var u models.User
		if err = json.Unmarshal(b, &u); err != nil {
			return err
		}
		if u.DeletedAt != nil || u.AccountStatus == models.AccountStatusDeleted || u.AccountStatus == models.AccountStatusDeleting {
			return ErrAccountUnavailable
		}
	}
	return nil
}

func (s *RedisStore) guardOperation(tx *redis.Tx, keys []string) error {
	ids := []string{}
	for _, key := range keys {
		switch {
		case strings.HasPrefix(key, "user:"):
			ids = append(ids, strings.TrimPrefix(key, "user:"))
		case strings.HasPrefix(key, "driver-wallet:"):
			ids = append(ids, strings.TrimPrefix(key, "driver-wallet:"))
		case strings.HasPrefix(key, "load:"), strings.HasPrefix(key, "offer:"), strings.HasPrefix(key, "wallet:"):
			b, err := tx.Get(s.ctx, key).Bytes()
			if errors.Is(err, redis.Nil) {
				continue
			}
			if err != nil {
				return err
			}
			switch {
			case strings.HasPrefix(key, "load:"):
				var l models.Load
				if err = json.Unmarshal(b, &l); err != nil {
					return err
				}
				ids = append(ids, l.CustomerID, l.AssignedDriver)
				if l.PaymentApproval != nil && l.PaymentApproval.Status == "pending" {
					ids = append(ids, l.PaymentApproval.DriverID)
				}
			case strings.HasPrefix(key, "offer:"):
				var o models.Offer
				if err = json.Unmarshal(b, &o); err != nil {
					return err
				}
				if o.Status == "pending" {
					ids = append(ids, o.DriverID)
				}
			case strings.HasPrefix(key, "wallet:"):
				// wallet:company:* is an index, not a wallet JSON record.
				if strings.HasPrefix(key, "wallet:company:") {
					continue
				}
				var w models.CorporateWallet
				if err = json.Unmarshal(b, &w); err != nil {
					return err
				}
				ck := "company:" + w.CompanyID
				if err = tx.Watch(s.ctx, ck).Err(); err != nil {
					return err
				}
				cb, err := tx.Get(s.ctx, ck).Bytes()
				if err != nil {
					return err
				}
				var c models.Company
				if err = json.Unmarshal(cb, &c); err != nil {
					return err
				}
				ids = append(ids, c.OwnerCustomerID)
			}
		}
	}
	return s.guardAccounts(tx, ids...)
}

func (s *RedisStore) guardCleanup(tx *redis.Tx, id string, sanitizing bool) error {
	err := s.guardAccounts(tx, id)
	if !errors.Is(err, ErrAccountUnavailable) || !sanitizing {
		return err
	}
	var u models.User
	b, e := tx.Get(s.ctx, "user:"+id).Bytes()
	if e != nil {
		return e
	}
	if e = json.Unmarshal(b, &u); e != nil {
		return e
	}
	if u.AccountStatus != models.AccountStatusDeleting {
		return err
	}
	return nil
}

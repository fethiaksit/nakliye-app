package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"time"
)

// The same eligibility rules serve preview and atomic fencing. Every index and
// record read here is WATCHed; ordinary writes WATCH the user in the other direction.
func (s *RedisStore) prepareAccountDeletion(id string, begin bool) (models.User, error) {
	var u models.User
	err := s.watchPush(func(tx *redis.Tx) error {
		u = models.User{} // retry must not retain fields omitted by an older stored record
		read := func(key string, out any) error {
			if err := tx.Watch(s.ctx, key).Err(); err != nil {
				return err
			}
			b, err := tx.Get(s.ctx, key).Bytes()
			if err != nil {
				return err
			}
			return json.Unmarshal(b, out)
		}
		if err := read("user:"+id, &u); err != nil {
			return err
		}
		if u.AccountStatus == models.AccountStatusDeleted {
			return ErrAccountUnavailable
		}
		if u.AccountStatus == models.AccountStatusDeleting {
			return nil
		} // support can resume interrupted cleanup
		if err := tx.Watch(s.ctx, "loads", "offers:driver:"+id, "complaints", "company:user:"+id).Err(); err != nil {
			return err
		}
		ids, err := tx.ZRange(s.ctx, "loads", 0, -1).Result()
		if err != nil {
			return err
		}
		loads := map[string]models.Load{}
		for _, lid := range ids {
			var l models.Load
			if err := read("load:"+lid, &l); err != nil {
				return err
			}
			if l.ID == "" {
				return fmt.Errorf("geçersiz nakliye kaydı")
			}
			loads[l.ID] = l
			related := l.CustomerID == id || l.AssignedDriver == id || (l.PaymentApproval != nil && l.PaymentApproval.DriverID == id && l.PaymentApproval.Status == "pending")
			status := models.CanonicalLoadStatus(l.Status)
			if related && status != models.LoadStatusCompleted && status != models.LoadStatusCancelled {
				return fmt.Errorf("kapanmamış nakliye veya ödeme onayı bulunmaktadır")
			}
			// Commission reservations may outlive an inconsistent terminal load.
			if l.AssignedDriver == id {
				var c models.DriverCommission
				if err := read(driverCommissionKey(l.ID), &c); err != nil && !errors.Is(err, redis.Nil) {
					return err
				}
				if c.Status == "reserved" {
					return fmt.Errorf("komisyon rezervasyonu için mutabakat gereklidir")
				}
			}
		}
		offers, err := tx.SMembers(s.ctx, "offers:driver:"+id).Result()
		if err != nil {
			return err
		}
		for _, oid := range offers {
			var o models.Offer
			if err := read("offer:"+oid, &o); err != nil {
				return err
			}
			l, ok := loads[o.LoadID]
			if !ok {
				return fmt.Errorf("teklif nakliyesi bulunamadı")
			}
			if o.Status == "pending" && models.CanonicalLoadStatus(l.Status) == models.LoadStatusPublished {
				return fmt.Errorf("açık teklifinizi önce geri çekin")
			}
		}
		var dw models.DriverWallet
		if err := read(driverWalletKey(id), &dw); err != nil && !errors.Is(err, redis.Nil) {
			return err
		}
		if dw.BalanceCents != 0 || dw.ReservedCents != 0 {
			return fmt.Errorf("cüzdan bakiyesi veya komisyon borcu için destek mutabakatı gereklidir")
		}
		companyID, err := tx.Get(s.ctx, "company:user:"+id).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return err
		}
		if companyID != "" {
			if err := tx.Watch(s.ctx, "wallet:company:"+companyID).Err(); err != nil {
				return err
			}
			wid, err := tx.Get(s.ctx, "wallet:company:"+companyID).Result()
			if err != nil {
				return err
			}
			var wallet models.CorporateWallet
			if err := read("wallet:"+wid, &wallet); err != nil {
				return err
			}
			if wallet.BalanceCents != 0 {
				return fmt.Errorf("kurumsal cüzdan bakiyesi için destek mutabakatı gereklidir")
			}
		}
		complaints, err := tx.ZRange(s.ctx, "complaints", 0, -1).Result()
		if err != nil {
			return err
		}
		for _, cid := range complaints {
			var c models.MessageComplaint
			if err := read("complaint:"+cid, &c); err != nil {
				return err
			}
			if (c.ReporterID == id || c.ReportedUserID == id) && (c.Status == models.ComplaintStatusOpen || c.Status == models.ComplaintStatusReviewing) {
				return fmt.Errorf("açık şikâyet için destek incelemesi gereklidir")
			}
		}
		if !begin {
			return nil
		}
		u.AccountStatus = models.AccountStatusDeleting
		u.MarketingConsent = false
		now := time.Now().UTC()
		u.DeletedAt = &now // authentication fails immediately, including legacy clients
		_, err = tx.TxPipelined(s.ctx, func(p redis.Pipeliner) error { p.Set(s.ctx, "user:"+id, mustJSON(u), 0); return nil })
		return err
	}, "user:"+id)
	return u, err
}
func (s *RedisStore) CheckAccountDeletion(id string) error {
	_, err := s.prepareAccountDeletion(id, false)
	return err
}
func (s *RedisStore) BeginAccountDeletion(id string) (models.User, error) {
	return s.prepareAccountDeletion(id, true)
}

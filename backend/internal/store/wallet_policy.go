package store

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"time"
)

const walletPolicyKey = "corporate-wallet:settings:v1"

func walletRateKey(companyID string) string { return "corporate-wallet:rate:" + companyID }

type walletReader interface {
	Get(ctx context.Context, key string) *redis.StringCmd
}

func (s *RedisStore) readWalletPolicy(reader walletReader) (models.WalletPolicy, error) {
	p := models.DefaultWalletPolicy()
	b, err := reader.Get(s.ctx, walletPolicyKey).Bytes()
	if errors.Is(err, redis.Nil) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal(b, &p); err != nil {
		return p, err
	}
	return p, p.Validate()
}

// Additive, repeatable migration. Existing balances and ledger records are never rewritten.
func (s *RedisStore) MigrateWalletPolicy() error {
	b, err := json.Marshal(models.DefaultWalletPolicy())
	if err != nil {
		return err
	}
	return s.client.SetNX(s.ctx, walletPolicyKey, b, 0).Err()
}
func (s *RedisStore) GetWalletPolicy() (models.WalletPolicy, error) {
	return s.readWalletPolicy(s.client)
}
func (s *RedisStore) SaveWalletPolicy(p models.WalletPolicy) error {
	if err := p.Validate(); err != nil {
		return err
	}
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return s.client.Set(s.ctx, walletPolicyKey, b, 0).Err()
}
func (s *RedisStore) readWalletRate(reader walletReader, companyID string) (*int64, error) {
	b, err := reader.Get(s.ctx, walletRateKey(companyID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var rate *int64
	err = json.Unmarshal(b, &rate)
	return rate, err
}
func (s *RedisStore) SaveWalletRate(companyID string, rate *int64) error {
	key := walletRateKey(companyID)
	err := s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		p, err := s.readWalletPolicy(tx)
		if err != nil {
			return err
		}
		if rate != nil && (*rate < p.MinRewardRateBps || *rate > p.MaxRewardRateBps) {
			return ErrWalletBalance
		}
		b, err := json.Marshal(rate)
		if err != nil {
			return err
		}
		_, err = tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error { pipe.Set(s.ctx, key, b, 0); return nil })
		return err
	}, walletPolicyKey, key)
	if errors.Is(err, redis.TxFailedErr) {
		return ErrWalletConflict
	}
	return err
}
func (s *RedisStore) corporateProgress(company models.Company) (int64, int64, error) {
	loads, _, err := s.ListLoads(company.OwnerCustomerID, "", LoadFilter{Status: models.LoadStatusCompleted}, 0, 0)
	if err != nil {
		return 0, 0, err
	}
	var jobs, volume int64
	for _, l := range loads {
		if !l.DeliveryVerified {
			continue
		}
		cents, ok := models.TLToCents(l.AgreedPriceTL)
		if !ok || cents > models.MaxWalletCents-volume {
			return 0, 0, ErrWalletBalance
		}
		jobs++
		volume += cents
	}
	return jobs, volume, nil
}

type WalletSummary struct {
	Enabled          bool   `json:"enabled"`
	TotalEarnedCents int64  `json:"totalEarnedCents"`
	TotalUsedCents   int64  `json:"totalUsedCents"`
	Tier             string `json:"tier"`
	RewardRateBps    int64  `json:"rewardRateBps"`
	OverrideRateBps  *int64 `json:"overrideRateBps"`
	MaxUsageBps      int64  `json:"maxUsageBps"`
	CompletedJobs    int64  `json:"completedJobs"`
	VolumeCents      int64  `json:"volumeCents"`
}

func (s *RedisStore) WalletSummary(company models.Company, transactions []models.WalletTransaction) (WalletSummary, error) {
	var out WalletSummary
	p, err := s.GetWalletPolicy()
	if err != nil {
		return out, err
	}
	override, err := s.readWalletRate(s.client, company.ID)
	if err != nil {
		return out, err
	}
	jobs, volume, err := s.corporateProgress(company)
	if err != nil {
		return out, err
	}
	out = WalletSummary{Enabled: p.Enabled, OverrideRateBps: override, MaxUsageBps: p.MaxUsageBps, CompletedJobs: jobs, VolumeCents: volume}
	out.Tier, out.RewardRateBps = p.Rate(jobs, volume, override)
	for _, t := range transactions {
		switch t.Type {
		case models.WalletTransactionShipmentReward:
			out.TotalEarnedCents += t.AmountCents
		case models.WalletTransactionShipmentUsage:
			out.TotalUsedCents -= t.AmountCents
		case models.WalletTransactionReversal:
			out.TotalUsedCents -= t.AmountCents
		}
	}
	return out, nil
}

func (s *RedisStore) AdjustWallet(company models.Company, entry models.WalletTransaction) (models.WalletTransaction, error) {
	if entry.ID == "" || entry.AmountCents == 0 || entry.AmountCents > models.MaxWalletCents || entry.AmountCents < -models.MaxWalletCents {
		return entry, ErrWalletBalance
	}
	wallet, err := s.GetCorporateWallet(company.ID)
	if err != nil {
		return entry, err
	}
	wk, tk := "wallet:"+wallet.ID, "wallet-transaction:"+entry.ID
	err = s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		existing, e := tx.Get(s.ctx, tk).Bytes()
		if e == nil {
			var previous models.WalletTransaction
			if e = json.Unmarshal(existing, &previous); e != nil {
				return e
			}
			if previous.WalletID != wallet.ID || previous.AmountCents != entry.AmountCents || previous.Description != entry.Description {
				return ErrWalletUsageExists
			}
			entry = previous
			return nil
		}
		if !errors.Is(e, redis.Nil) {
			return e
		}
		b, e := tx.Get(s.ctx, wk).Bytes()
		if e != nil {
			return e
		}
		if e = json.Unmarshal(b, &wallet); e != nil {
			return e
		}
		if entry.AmountCents < -wallet.BalanceCents || (entry.AmountCents > 0 && wallet.BalanceCents > models.MaxWalletCents-entry.AmountCents) {
			return ErrWalletBalance
		}
		entry.SchemaVersion = 1
		entry.WalletID = wallet.ID
		entry.CompanyID = company.ID
		entry.CorporateCustomerID = company.OwnerCustomerID
		entry.Type = models.WalletTransactionAdjustment
		entry.BalanceBeforeCents = wallet.BalanceCents
		wallet.BalanceCents += entry.AmountCents
		wallet.UpdatedAt = time.Now().UTC()
		entry.CreatedAt = wallet.UpdatedAt
		entry.BalanceAfterCents = wallet.BalanceCents
		wb, e := json.Marshal(wallet)
		if e != nil {
			return e
		}
		eb, e := json.Marshal(entry)
		if e != nil {
			return e
		}
		_, e = tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(s.ctx, wk, wb, 0)
			pipe.Set(s.ctx, tk, eb, 0)
			pipe.ZAdd(s.ctx, "wallet-transactions:"+wallet.ID, redis.Z{Score: float64(entry.CreatedAt.UnixMicro()), Member: entry.ID})
			return nil
		})
		return e
	}, wk, tk)
	if errors.Is(err, redis.TxFailedErr) {
		err = ErrWalletConflict
	}
	return entry, err
}

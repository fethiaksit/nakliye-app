package models

import (
	"errors"
	"strings"
)

// Money is integer kuruş; rates are basis points (500 = 5%).
const MaxWalletCents int64 = 9_000_000_000_000 // safely representable by all clients

type WalletTier struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	RewardRateBps    int64  `json:"rewardRateBps"`
	MinCompletedJobs *int64 `json:"minCompletedJobs"`
	MinVolumeCents   *int64 `json:"minVolumeCents"`
}

type WalletPolicy struct {
	Version              int          `json:"version"`
	Enabled              bool         `json:"enabled"`
	DefaultRewardRateBps int64        `json:"defaultRewardRateBps"`
	MinRewardRateBps     int64        `json:"minRewardRateBps"`
	MaxRewardRateBps     int64        `json:"maxRewardRateBps"`
	MaxUsageBps          int64        `json:"maxUsageBps"`
	Tiers                []WalletTier `json:"tiers"`
}

func DefaultWalletPolicy() WalletPolicy {
	return WalletPolicy{Version: 1, Enabled: true, DefaultRewardRateBps: 500, MinRewardRateBps: 500, MaxRewardRateBps: 2000, MaxUsageBps: 2500,
		Tiers: []WalletTier{{ID: "bronze", Name: "Bronz", RewardRateBps: 750}, {ID: "silver", Name: "Gümüş", RewardRateBps: 1000}, {ID: "gold", Name: "Altın", RewardRateBps: 1500}, {ID: "platinum", Name: "Platinum", RewardRateBps: 2000}}}
}

func (p WalletPolicy) Validate() error {
	invalid := errors.New("oranlar %5–%20 arasında, kullanım limiti %0–%100 arasında olmalı; seviye kimlikleri tekil ve eşikleri geçerli olmalıdır")
	if p.Version != 1 || p.MinRewardRateBps < 500 || p.MaxRewardRateBps > 2000 || p.MinRewardRateBps > p.MaxRewardRateBps || p.DefaultRewardRateBps < p.MinRewardRateBps || p.DefaultRewardRateBps > p.MaxRewardRateBps || p.MaxUsageBps < 0 || p.MaxUsageBps > 10000 || len(p.Tiers) > 20 {
		return invalid
	}
	seen := map[string]bool{"starter": true}
	for _, t := range p.Tiers {
		if strings.TrimSpace(t.ID) == "" || strings.TrimSpace(t.Name) == "" || seen[t.ID] || t.RewardRateBps < p.MinRewardRateBps || t.RewardRateBps > p.MaxRewardRateBps || (t.MinCompletedJobs != nil && (*t.MinCompletedJobs < 1 || *t.MinCompletedJobs > 1000000000)) || (t.MinVolumeCents != nil && (*t.MinVolumeCents < 1 || *t.MinVolumeCents > MaxWalletCents)) {
			return invalid
		}
		seen[t.ID] = true
	}
	return nil
}

// Either configured threshold qualifies. Null thresholds disable automatic promotion.
func (p WalletPolicy) Rate(jobs, volume int64, override *int64) (string, int64) {
	name, rate := "Başlangıç", p.DefaultRewardRateBps
	for _, t := range p.Tiers {
		if ((t.MinCompletedJobs != nil && jobs >= *t.MinCompletedJobs) || (t.MinVolumeCents != nil && volume >= *t.MinVolumeCents)) && t.RewardRateBps >= rate {
			name, rate = t.Name, t.RewardRateBps
		}
	}
	if override != nil {
		rate = *override
	}
	if rate < p.MinRewardRateBps {
		rate = p.MinRewardRateBps
	}
	if rate > p.MaxRewardRateBps {
		rate = p.MaxRewardRateBps
	}
	return name, rate
}

// Split before multiplying to avoid overflow; cap floors, rewards round half up.
func WalletPercent(cents, bps int64, round bool) int64 {
	remainder := (cents % 10000) * bps
	if round {
		remainder += 5000
	}
	return (cents/10000)*bps + remainder/10000
}

package models

import (
	"math"
	"testing"
)

func TestWalletMoneyBoundary(t *testing.T) {
	for _, c := range []struct {
		tl   float64
		want int64
		ok   bool
	}{{1.005, 101, true}, {8000, 800000, true}, {0, 0, false}, {-1, 0, false}, {math.Inf(1), 0, false}, {math.NaN(), 0, false}, {float64(MaxWalletCents)/100 + 1, 0, false}} {
		got, ok := TLToCents(c.tl)
		if got != c.want || ok != c.ok {
			t.Fatalf("TLToCents(%v)=%d,%v want %d,%v", c.tl, got, ok, c.want, c.ok)
		}
	}
}
func TestWalletPercentageAndLevels(t *testing.T) {
	for _, c := range []struct {
		amount, rate int64
		round        bool
		want         int64
	}{{800000, 2500, false, 200000}, {1000000, 1000, true, 100000}, {1, 500, true, 0}, {10, 500, true, 1}, {3, 2500, false, 0}, {MaxWalletCents, 2000, true, 1800000000000}} {
		if got := WalletPercent(c.amount, c.rate, c.round); got != c.want {
			t.Fatalf("percentage %#v got %d", c, got)
		}
	}
	p := DefaultWalletPolicy()
	jobs, volume := int64(2), int64(1000000)
	p.Tiers[0].MinCompletedJobs = &jobs
	p.Tiers[1].MinVolumeCents = &volume
	for _, c := range []struct{ jobs, volume, want int64 }{{0, 0, 500}, {2, 0, 750}, {0, 1000000, 1000}, {2, 1000000, 1000}} {
		_, rate := p.Rate(c.jobs, c.volume, nil)
		if rate != c.want {
			t.Fatalf("tier %#v rate %d", c, rate)
		}
	}
	override := int64(2000)
	p.MaxRewardRateBps = 1500
	_, rate := p.Rate(0, 0, &override)
	if rate != 1500 {
		t.Fatal("override must obey current policy cap")
	}
}

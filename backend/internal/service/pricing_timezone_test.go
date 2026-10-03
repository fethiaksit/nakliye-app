package service

import (
	"testing"
	"time"
)

// Run this test binary in an empty filesystem as well as the regular suite:
// minimal runtime images have neither OS zoneinfo nor the Go SDK's zoneinfo.zip.
func TestPricingTimezoneDataInMinimalRuntime(t *testing.T) {
	now := time.Date(2026, 10, 3, 9, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name              string
		utcHour           int
		multiplier, price float64
	}{
		{"Istanbul 07:00", 4, 1, 1250},
		{"Istanbul 19:00", 16, 1.1, 1400},
		{"Istanbul 23:00", 20, 1.2, 1500},
	} {
		t.Run(tc.name, func(t *testing.T) {
			start := time.Date(2026, 10, 4, tc.utcHour, 0, 0, 0, time.UTC)
			got, err := CalculateEstimatedPrice(DefaultPricingConfig(), PricingInput{DistanceKM: 5, Now: now, RequestedStartAt: &start})
			if err != nil {
				t.Fatalf("pricing cannot load its configured timezone: %v", err)
			}
			if got.NightMultiplier != tc.multiplier || got.RecommendedPrice != tc.price {
				t.Fatalf("wrong Istanbul tariff: multiplier=%v price=%v", got.NightMultiplier, got.RecommendedPrice)
			}
		})
	}
}

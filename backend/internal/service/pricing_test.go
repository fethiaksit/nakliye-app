package service

import (
	"math"
	"testing"

	"nakliye-api/internal/models"
)

func TestDefaultRoutePreviewIncludesFirstFiveKilometers(t *testing.T) {
	config := DefaultPricingConfig()
	for _, tc := range []struct{ km, base, fee float64 }{{1, 1250, 0}, {5, 1250, 0}, {10, 1425, 175}, {45, 2650, 1400}, {100, 4575, 3325}, {200, 8075, 6825}} {
		base, err := CalculateBasePrice(config, tc.km)
		if err != nil || base != tc.base {
			t.Errorf("%v km base %v %v want %v", tc.km, base, err, tc.base)
		}
		fee, err := CalculateDistanceFee(config, tc.km)
		if err != nil || fee != tc.fee {
			t.Errorf("%v km fee %v %v want %v", tc.km, fee, err, tc.fee)
		}
	}
}

func TestCalculateWaitingFee(t *testing.T) {
	config := DefaultPricingConfig()
	for _, test := range []struct {
		minutes int
		want    float64
	}{
		{minutes: 0, want: 0}, {minutes: 30, want: 0}, {minutes: 31, want: 300},
		{minutes: 60, want: 300}, {minutes: 61, want: 600}, {minutes: 120, want: 600},
		{minutes: 121, want: 1000}, {minutes: 180, want: 1000}, {minutes: 181, want: 1400},
	} {
		got, err := CalculateWaitingFee(config, test.minutes)
		if err != nil || got != test.want {
			t.Errorf("CalculateWaitingFee(%d) = %v, %v; want %v", test.minutes, got, err, test.want)
		}
	}
	if _, err := CalculateWaitingFee(config, -1); err == nil {
		t.Fatal("negative waiting minutes must be rejected")
	}
}

func TestPricingRejectsInvalidDistanceAndLoadData(t *testing.T) {
	config := DefaultPricingConfig()
	for _, distance := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		if _, err := CalculateEstimatedPrice(config, PricingInput{DistanceKM: distance, LoadLevel: LoadLevelNormal}); err == nil {
			t.Errorf("distance %v was accepted", distance)
		}
	}
	if _, err := DetermineLoadLevel(LoadFeatures{Dimensions: models.Dimensions{WeightKG: -1, LengthCM: 1, WidthCM: 1, HeightCM: 1}}); err == nil {
		t.Fatal("negative weight must be rejected")
	}
	if _, err := CalculateEstimatedPrice(config, PricingInput{DistanceKM: 45, LoadLevel: "unknown"}); err == nil {
		t.Fatal("unknown load level must be rejected")
	}
}

package service

import (
	"math"
	"testing"
	"time"

	"nakliye-api/internal/models"
)

func TestCalculateBasePriceUsesProgressiveDistanceFee(t *testing.T) {
	config := DefaultPricingConfig()
	for _, test := range []struct {
		km   float64
		want float64
	}{
		{km: 1, want: 1550},
		{km: 10, want: 2000},
		{km: 20, want: 2500},
		{km: 45, want: 3750},
		{km: 50, want: 4000},
		{km: 100, want: 6500},
		{km: 120, want: 7400},
		{km: 150, want: 8750},
		{km: 200, want: 10875},
		{km: 300, want: 15125},
	} {
		got, err := CalculateBasePrice(config, test.km)
		if err != nil {
			t.Fatalf("CalculateBasePrice(%v) error: %v", test.km, err)
		}
		if got != test.want {
			t.Errorf("CalculateBasePrice(%v) = %v, want %v", test.km, got, test.want)
		}
		t.Logf("%g km = %g TL", test.km, got)
	}
	for _, distance := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		if _, err := CalculateBasePrice(config, distance); err == nil {
			t.Errorf("CalculateBasePrice(%v) accepted invalid distance", distance)
		}
	}
}

func TestCalculateDistanceFeeUsesProgressiveTiers(t *testing.T) {
	config := DefaultPricingConfig()
	for _, test := range []struct {
		km   float64
		want float64
	}{
		{km: 10, want: 500},
		{km: 45, want: 2250},
		{km: 100, want: 5000},
		{km: 120, want: 5900},
		{km: 150, want: 7250},
		{km: 200, want: 9375},
		{km: 300, want: 13625},
	} {
		got, err := CalculateDistanceFee(config, test.km)
		if err != nil {
			t.Fatalf("CalculateDistanceFee(%v) error: %v", test.km, err)
		}
		if got != test.want {
			t.Errorf("CalculateDistanceFee(%v) = %v, want %v", test.km, got, test.want)
		}
		t.Logf("%g km distance fee = %g TL", test.km, got)
	}
	for _, distance := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		if _, err := CalculateDistanceFee(config, distance); err == nil {
			t.Errorf("CalculateDistanceFee(%v) accepted invalid distance", distance)
		}
	}
}

func TestCalculateEstimatedPriceUsesProgressiveDistanceFee(t *testing.T) {
	breakdown, err := CalculateEstimatedPrice(DefaultPricingConfig(), PricingInput{DistanceKM: 200, LoadLevel: LoadLevelNormal})
	if err != nil {
		t.Fatal(err)
	}
	if breakdown.DistanceFee != 9375 || breakdown.BasePrice != 10875 || breakdown.FinalPrice != 10900 {
		t.Fatalf("breakdown = %#v, want distance fee=9375 base=10875 final=10900", breakdown)
	}
}

func TestCalculateEstimatedPriceAppliesLoadTimeAndRounding(t *testing.T) {
	config := DefaultPricingConfig()
	location, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.January, 2, 12, 0, 0, 0, location)
	cases := []struct {
		name       string
		level      LoadLevel
		waiting    int
		start      *time.Time
		at         time.Time
		wantFinal  float64
		wantNight  float64
		wantUrgent float64
	}{
		{name: "normal", level: LoadLevelNormal, wantFinal: 3750, wantNight: 1, wantUrgent: 1},
		{name: "very hard rounds", level: LoadLevelVeryHard, wantFinal: 4900, wantNight: 1, wantUrgent: 1},
		{name: "hard plus waiting", level: LoadLevelHard, waiting: 60, wantFinal: 4800, wantNight: 1, wantUrgent: 1},
		{name: "hard plus night", level: LoadLevelHard, start: timePtr(time.Date(2026, time.January, 2, 23, 0, 0, 0, location)), wantFinal: 4950, wantNight: 1.1, wantUrgent: 1},
		{name: "hard plus night and urgent", level: LoadLevelHard, at: time.Date(2026, time.January, 2, 22, 0, 0, 0, location), start: timePtr(time.Date(2026, time.January, 2, 23, 0, 0, 0, location)), wantFinal: 5450, wantNight: 1.1, wantUrgent: 1.1},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			inputNow := test.at
			if inputNow.IsZero() {
				inputNow = now
			}
			input := PricingInput{DistanceKM: 45, LoadLevel: test.level, WaitingMinutes: test.waiting, RequestedStartAt: test.start, Now: inputNow}
			got, err := CalculateEstimatedPrice(config, input)
			if err != nil {
				t.Fatal(err)
			}
			if got.FinalPrice != test.wantFinal || got.NightMultiplier != test.wantNight || got.UrgentMultiplier != test.wantUrgent {
				t.Fatalf("breakdown = %#v, want final=%v night=%v urgent=%v", got, test.wantFinal, test.wantNight, test.wantUrgent)
			}
		})
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

func timePtr(value time.Time) *time.Time { return &value }

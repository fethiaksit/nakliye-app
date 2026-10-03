package service

import (
	"encoding/json"
	"nakliye-api/internal/models"
	"testing"
	"time"
)

func TestCityPricingTariffsAndHandling(t *testing.T) {
	cases := []struct {
		name, payload string
		want          float64
	}{
		{"minimum", `{"DistanceKM":2,"VehicleType":"minivan"}`, 1250},
		{"minivan", `{"DistanceKM":10,"VehicleType":"minivan"}`, 1450},
		{"panelvan", `{"DistanceKM":22,"VehicleType":"panelvan"}`, 2350},
		{"driver", `{"DistanceKM":22,"VehicleType":"panelvan","PickupDriverHandling":true,"DeliveryDriverHandling":true}`, 2750},
		{"one helper", `{"DistanceKM":5,"VehicleType":"panelvan","HelperCount":1}`, 2500},
		{"two helpers", `{"DistanceKM":5,"VehicleType":"panelvan","HelperCount":2}`, 3300},
		{"both stairs", `{"DistanceKM":5,"VehicleType":"panelvan","PickupDriverHandling":true,"DeliveryDriverHandling":true,"PickupFloor":2,"DeliveryFloor":4}`, 2750},
		{"customer stairs free", `{"DistanceKM":5,"VehicleType":"panelvan","PickupFloor":5,"DeliveryFloor":5}`, 1600},
		{"elevators free", `{"DistanceKM":5,"VehicleType":"panelvan","PickupDriverHandling":true,"DeliveryDriverHandling":true,"PickupFloor":5,"DeliveryFloor":5,"PickupElevatorAvailable":true,"DeliveryElevatorAvailable":true}`, 2000},
		{"occupancy example", `{"DistanceKM":35,"VehicleType":"kamyonet","Dimensions":{"WeightKG":2000}}`, 4200},
		{"volume vehicle", `{"DistanceKM":5,"VehicleType":"farketmez","VolumeM3":5}`, 1600},
		{"weight vehicle", `{"DistanceKM":5,"VehicleType":"farketmez","Dimensions":{"WeightKG":2000}}`, 2250},
		{"upgrade", `{"DistanceKM":5,"VehicleType":"minivan","Dimensions":{"WeightKG":2000}}`, 2250},
		{"truck", `{"DistanceKM":15,"VehicleType":"kamyon"}`, 4100},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := PricingInput{LoadLevel: LoadLevelNormal}
			if err := json.Unmarshal([]byte(tc.payload), &input); err != nil {
				t.Fatal(err)
			}
			got, err := CalculateEstimatedPrice(DefaultPricingConfig(), input)
			if err != nil {
				t.Fatal(err)
			}
			if got.RecommendedPrice != tc.want {
				t.Fatalf("got %v want %v", got.RecommendedPrice, tc.want)
			}
		})
	}
}
func TestCityPricingTimeBoundaries(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Istanbul")
	now := time.Date(2026, 10, 3, 10, 0, 0, 0, loc)
	for _, tc := range []struct {
		hour int
		want float64
	}{{6, 1500}, {7, 1250}, {8, 1250}, {18, 1250}, {19, 1400}, {22, 1400}, {23, 1500}} {
		start := time.Date(2026, 10, 4, tc.hour, 0, 0, 0, loc)
		got, err := CalculateEstimatedPrice(DefaultPricingConfig(), PricingInput{DistanceKM: 5, LoadLevel: LoadLevelNormal, RequestedStartAt: &start, Now: now})
		if err != nil || got.RecommendedPrice != tc.want {
			t.Errorf("hour %d got %v (%v) want %v", tc.hour, got.RecommendedPrice, err, tc.want)
		}
	}
}

func TestCityPricingOccupancyBoundariesAndUrgency(t *testing.T) {
	for _, tc := range []struct{ weight, want float64 }{{250, 1250}, {251, 1350}, {375, 1350}, {376, 1450}, {450, 1450}, {451, 1550}, {500, 1550}} {
		got, err := CalculateEstimatedPrice(DefaultPricingConfig(), PricingInput{DistanceKM: 5, Dimensions: models.Dimensions{WeightKG: tc.weight}})
		if err != nil || got.RecommendedPrice != tc.want {
			t.Errorf("weight %v got %v (%v) want %v", tc.weight, got.RecommendedPrice, err, tc.want)
		}
	}
	for _, tc := range []struct {
		urgency models.UrgencyType
		want    float64
	}{{models.UrgencyImmediate, 1500}, {models.UrgencyToday, 1400}} {
		now := time.Date(2026, 10, 3, 9, 0, 0, 0, time.UTC)
		got, err := CalculateEstimatedPrice(DefaultPricingConfig(), PricingInput{DistanceKM: 5, UrgencyType: tc.urgency, Now: now})
		if err != nil || got.RecommendedPrice != tc.want {
			t.Fatalf("urgency %s: %#v, %v", tc.urgency, got, err)
		}
	}
}
func TestCityPricingUnsupportedJobsRequireOffersWithoutInventingAPrice(t *testing.T) {
	for _, input := range []PricingInput{{DistanceKM: 5, ManualQuoteRequired: true}, {DistanceKM: 5, VehicleType: models.VehicleTypeTir}, {DistanceKM: 5, VolumeM3: 61}, {DistanceKM: 5, Dimensions: models.Dimensions{WeightKG: 12001}}} {
		got, err := CalculateEstimatedPrice(DefaultPricingConfig(), input)
		if err != nil || !got.ManualQuoteRequired || got.RecommendedPrice != 0 || got.MinPrice != 0 || got.MaxPrice != 0 {
			t.Fatalf("unsupported job: %#v %v", got, err)
		}
	}
}

package service

import (
	"errors"
	"fmt"
	"math"
	"time"

	"nakliye-api/internal/models"
)

const (
	DefaultBaseDriverFee        = 1500.0
	DefaultPricePerKM           = 50.0
	DefaultSecondTierPricePerKM = 45.0
	DefaultThirdTierPricePerKM  = 42.5
)

// LoadLevel is deliberately closed. The API derives it from verified listing
// attributes instead of accepting a multiplier from a mobile client.
type LoadLevel string

const (
	LoadLevelNormal   LoadLevel = "NORMAL"
	LoadLevelMedium   LoadLevel = "MEDIUM"
	LoadLevelHard     LoadLevel = "HARD"
	LoadLevelVeryHard LoadLevel = "VERY_HARD"
)

// PricingConfig is the single source for pricing rules. It is kept as a
// value object so it can later be loaded from an admin setting or a database
// without moving calculation logic into HTTP handlers.
type PricingConfig struct {
	BaseDriverFee        float64
	PricePerKM           float64
	SecondTierPricePerKM float64
	ThirdTierPricePerKM  float64

	LoadNormalMultiplier   float64
	LoadMediumMultiplier   float64
	LoadHardMultiplier     float64
	LoadVeryHardMultiplier float64

	NightMultiplier   float64
	UrgentMultiplier  float64
	HolidayMultiplier float64
	WeekendMultiplier float64

	WaitingFreeMinutes       int
	WaitingFirstHourFee      float64
	WaitingSecondHourFee     float64
	WaitingAdditionalHourFee float64

	RoundingUnit float64
	Timezone     string

	// Objective thresholds for deriving a level from the existing listing
	// fields. They remain centralized for a future admin pricing setting.
	MediumWeightKG   float64
	HardWeightKG     float64
	VeryHardWeightKG float64
	MediumVolumeM3   float64
	HardVolumeM3     float64
	VeryHardVolumeM3 float64
}

func DefaultPricingConfig() PricingConfig {
	return PricingConfig{
		BaseDriverFee:        DefaultBaseDriverFee,
		PricePerKM:           DefaultPricePerKM,
		SecondTierPricePerKM: DefaultSecondTierPricePerKM,
		ThirdTierPricePerKM:  DefaultThirdTierPricePerKM,

		LoadNormalMultiplier:   1.00,
		LoadMediumMultiplier:   1.10,
		LoadHardMultiplier:     1.20,
		LoadVeryHardMultiplier: 1.30,

		NightMultiplier:   1.10,
		UrgentMultiplier:  1.10,
		HolidayMultiplier: 1.10,
		WeekendMultiplier: 1.00,

		WaitingFreeMinutes:       30,
		WaitingFirstHourFee:      300,
		WaitingSecondHourFee:     600,
		WaitingAdditionalHourFee: 400,

		RoundingUnit: 50,
		Timezone:     "Europe/Istanbul",

		MediumWeightKG:   100,
		HardWeightKG:     500,
		VeryHardWeightKG: 1000,
		MediumVolumeM3:   1,
		HardVolumeM3:     3,
		VeryHardVolumeM3: 8,
	}
}

func normalizedPricingConfig(config PricingConfig) PricingConfig {
	defaults := DefaultPricingConfig()
	if config.BaseDriverFee <= 0 {
		config.BaseDriverFee = defaults.BaseDriverFee
	}
	if config.PricePerKM <= 0 {
		config.PricePerKM = defaults.PricePerKM
	}
	if config.SecondTierPricePerKM <= 0 {
		config.SecondTierPricePerKM = defaults.SecondTierPricePerKM
	}
	if config.ThirdTierPricePerKM <= 0 {
		config.ThirdTierPricePerKM = defaults.ThirdTierPricePerKM
	}
	if config.LoadNormalMultiplier <= 0 {
		config.LoadNormalMultiplier = defaults.LoadNormalMultiplier
	}
	if config.LoadMediumMultiplier <= 0 {
		config.LoadMediumMultiplier = defaults.LoadMediumMultiplier
	}
	if config.LoadHardMultiplier <= 0 {
		config.LoadHardMultiplier = defaults.LoadHardMultiplier
	}
	if config.LoadVeryHardMultiplier <= 0 {
		config.LoadVeryHardMultiplier = defaults.LoadVeryHardMultiplier
	}
	if config.NightMultiplier <= 0 {
		config.NightMultiplier = defaults.NightMultiplier
	}
	if config.UrgentMultiplier <= 0 {
		config.UrgentMultiplier = defaults.UrgentMultiplier
	}
	if config.HolidayMultiplier <= 0 {
		config.HolidayMultiplier = defaults.HolidayMultiplier
	}
	if config.WeekendMultiplier <= 0 {
		config.WeekendMultiplier = defaults.WeekendMultiplier
	}
	if config.WaitingFreeMinutes <= 0 {
		config.WaitingFreeMinutes = defaults.WaitingFreeMinutes
	}
	if config.WaitingFirstHourFee <= 0 {
		config.WaitingFirstHourFee = defaults.WaitingFirstHourFee
	}
	if config.WaitingSecondHourFee <= 0 {
		config.WaitingSecondHourFee = defaults.WaitingSecondHourFee
	}
	if config.WaitingAdditionalHourFee <= 0 {
		config.WaitingAdditionalHourFee = defaults.WaitingAdditionalHourFee
	}
	if config.RoundingUnit <= 0 {
		config.RoundingUnit = defaults.RoundingUnit
	}
	if config.Timezone == "" {
		config.Timezone = defaults.Timezone
	}
	if config.MediumWeightKG <= 0 {
		config.MediumWeightKG = defaults.MediumWeightKG
	}
	if config.HardWeightKG <= 0 {
		config.HardWeightKG = defaults.HardWeightKG
	}
	if config.VeryHardWeightKG <= 0 {
		config.VeryHardWeightKG = defaults.VeryHardWeightKG
	}
	if config.MediumVolumeM3 <= 0 {
		config.MediumVolumeM3 = defaults.MediumVolumeM3
	}
	if config.HardVolumeM3 <= 0 {
		config.HardVolumeM3 = defaults.HardVolumeM3
	}
	if config.VeryHardVolumeM3 <= 0 {
		config.VeryHardVolumeM3 = defaults.VeryHardVolumeM3
	}
	return config
}

func validFinite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func roundCurrency(value float64) float64 {
	return math.Round(value*100) / 100
}

// RoundToNearest50 is the only final-price rounding helper.
func RoundToNearest50(value float64) float64 {
	return math.Round(value/50) * 50
}

func CalculateBasePrice(config PricingConfig, distanceKM float64) (float64, error) {
	config = normalizedPricingConfig(config)
	distanceFee, err := CalculateDistanceFee(config, distanceKM)
	if err != nil {
		return 0, err
	}
	return roundCurrency(config.BaseDriverFee + distanceFee), nil
}

// CalculateDistanceFee applies progressive kilometer tiers. The first 100 km
// use the base rate, the next 50 km use the second-tier rate, and every
// kilometer after 150 km uses the third-tier rate.
func CalculateDistanceFee(config PricingConfig, distanceKM float64) (float64, error) {
	config = normalizedPricingConfig(config)
	if !validFinite(distanceKM) || distanceKM <= 0 {
		return 0, errors.New("mesafe sıfırdan büyük ve geçerli olmalıdır")
	}
	firstTierKM := math.Min(distanceKM, 100)
	secondTierKM := math.Min(math.Max(distanceKM-100, 0), 50)
	thirdTierKM := math.Max(distanceKM-150, 0)
	return roundCurrency(
		firstTierKM*config.PricePerKM +
			secondTierKM*config.SecondTierPricePerKM +
			thirdTierKM*config.ThirdTierPricePerKM,
	), nil
}

func CalculateWaitingFee(config PricingConfig, minutes int) (float64, error) {
	config = normalizedPricingConfig(config)
	if minutes < 0 {
		return 0, errors.New("bekleme süresi negatif olamaz")
	}
	if minutes <= config.WaitingFreeMinutes {
		return 0, nil
	}
	if minutes <= 60 {
		return config.WaitingFirstHourFee, nil
	}
	if minutes <= 120 {
		return config.WaitingSecondHourFee, nil
	}
	additionalHours := math.Ceil(float64(minutes-120) / 60)
	return config.WaitingSecondHourFee + additionalHours*config.WaitingAdditionalHourFee, nil
}

type PricingInput struct {
	DistanceKM       float64
	LoadLevel        LoadLevel
	WaitingMinutes   int
	RequestedStartAt *time.Time
	UrgencyType      models.UrgencyType
	Now              time.Time
	IsHoliday        bool
}

type PricingBreakdown struct {
	DistanceKM        float64   `json:"distanceKm"`
	BaseDriverFee     float64   `json:"baseDriverFee"`
	PricePerKM        float64   `json:"pricePerKm"`
	DistanceFee       float64   `json:"distanceFee"`
	BasePrice         float64   `json:"basePrice"`
	LoadLevel         LoadLevel `json:"loadLevel"`
	LoadMultiplier    float64   `json:"loadMultiplier"`
	LoadExtra         float64   `json:"loadExtra"`
	WaitingMinutes    int       `json:"waitingMinutes"`
	WaitingFee        float64   `json:"waitingFee"`
	NightMultiplier   float64   `json:"nightMultiplier"`
	UrgentMultiplier  float64   `json:"urgentMultiplier"`
	HolidayMultiplier float64   `json:"holidayMultiplier"`
	WeekendMultiplier float64   `json:"weekendMultiplier"`
	FinalPrice        float64   `json:"finalPrice"`
	RecommendedPrice  float64   `json:"recommendedPrice"`
	Currency          string    `json:"currency"`
}

func CalculateEstimatedPrice(config PricingConfig, input PricingInput) (PricingBreakdown, error) {
	config = normalizedPricingConfig(config)
	if !validFinite(input.DistanceKM) || input.DistanceKM <= 0 {
		return PricingBreakdown{}, errors.New("mesafe sıfırdan büyük ve geçerli olmalıdır")
	}
	loadMultiplier, ok := multiplierForLevel(config, input.LoadLevel)
	if !ok {
		return PricingBreakdown{}, fmt.Errorf("geçersiz yük seviyesi: %q", input.LoadLevel)
	}
	waitingFee, err := CalculateWaitingFee(config, input.WaitingMinutes)
	if err != nil {
		return PricingBreakdown{}, err
	}
	distanceFee, err := CalculateDistanceFee(config, input.DistanceKM)
	if err != nil {
		return PricingBreakdown{}, err
	}
	basePrice := roundCurrency(config.BaseDriverFee + distanceFee)
	now := input.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	start := input.RequestedStartAt
	if input.UrgencyType == models.UrgencyImmediate {
		start = &now
	}
	nightMultiplier, urgentMultiplier := 1.0, 1.0
	weekendMultiplier := 1.0
	if start != nil {
		location, locationErr := time.LoadLocation(config.Timezone)
		if locationErr != nil {
			location = time.UTC
		}
		localStart := start.In(location)
		if localStart.Hour() >= 22 || localStart.Hour() < 6 {
			nightMultiplier = config.NightMultiplier
		}
		if localStart.Weekday() == time.Saturday || localStart.Weekday() == time.Sunday {
			weekendMultiplier = config.WeekendMultiplier
		}
		untilStart := start.Sub(now)
		if untilStart >= 0 && untilStart <= 2*time.Hour {
			urgentMultiplier = config.UrgentMultiplier
		}
	}
	holidayMultiplier := 1.0
	if input.IsHoliday {
		holidayMultiplier = config.HolidayMultiplier
	}
	loadAdjustedPrice := basePrice * loadMultiplier
	preWaiting := loadAdjustedPrice * nightMultiplier * urgentMultiplier * holidayMultiplier * weekendMultiplier
	finalPrice := RoundToNearest50(preWaiting + waitingFee)
	return PricingBreakdown{
		DistanceKM:        roundCurrency(input.DistanceKM),
		BaseDriverFee:     config.BaseDriverFee,
		PricePerKM:        config.PricePerKM,
		DistanceFee:       distanceFee,
		BasePrice:         basePrice,
		LoadLevel:         input.LoadLevel,
		LoadMultiplier:    loadMultiplier,
		LoadExtra:         roundCurrency(loadAdjustedPrice - basePrice),
		WaitingMinutes:    input.WaitingMinutes,
		WaitingFee:        roundCurrency(waitingFee),
		NightMultiplier:   nightMultiplier,
		UrgentMultiplier:  urgentMultiplier,
		HolidayMultiplier: holidayMultiplier,
		WeekendMultiplier: weekendMultiplier,
		FinalPrice:        finalPrice,
		RecommendedPrice:  finalPrice,
		Currency:          "TRY",
	}, nil
}

func multiplierForLevel(config PricingConfig, level LoadLevel) (float64, bool) {
	switch level {
	case LoadLevelNormal:
		return config.LoadNormalMultiplier, true
	case LoadLevelMedium:
		return config.LoadMediumMultiplier, true
	case LoadLevelHard:
		return config.LoadHardMultiplier, true
	case LoadLevelVeryHard:
		return config.LoadVeryHardMultiplier, true
	default:
		return 0, false
	}
}

type LoadFeatures struct {
	Dimensions                models.Dimensions
	CargoType                 models.CargoType
	PickupFloor               *int
	DeliveryFloor             *int
	PickupElevatorAvailable   bool
	DeliveryElevatorAvailable bool
	HelperNeeded              bool
}

func DetermineLoadLevel(features LoadFeatures) (LoadLevel, error) {
	return determineLoadLevel(DefaultPricingConfig(), features)
}

func DetermineLoadLevelWithConfig(config PricingConfig, features LoadFeatures) (LoadLevel, error) {
	return determineLoadLevel(normalizedPricingConfig(config), features)
}

func determineLoadLevel(config PricingConfig, features LoadFeatures) (LoadLevel, error) {
	values := []float64{features.Dimensions.LengthCM, features.Dimensions.WidthCM, features.Dimensions.HeightCM, features.Dimensions.WeightKG}
	for _, value := range values {
		if !validFinite(value) || value < 0 {
			return "", errors.New("yük ölçüleri ve ağırlığı geçerli, negatif olmayan değerler olmalıdır")
		}
	}
	volumeM3 := features.Dimensions.LengthCM * features.Dimensions.WidthCM * features.Dimensions.HeightCM / 1_000_000
	level := LoadLevelNormal
	maxLevel := func(candidate LoadLevel) {
		if loadLevelRank(candidate) > loadLevelRank(level) {
			level = candidate
		}
	}
	if features.Dimensions.WeightKG >= config.VeryHardWeightKG || volumeM3 >= config.VeryHardVolumeM3 {
		maxLevel(LoadLevelVeryHard)
	} else if features.Dimensions.WeightKG >= config.HardWeightKG || volumeM3 >= config.HardVolumeM3 {
		maxLevel(LoadLevelHard)
	} else if features.Dimensions.WeightKG >= config.MediumWeightKG || volumeM3 >= config.MediumVolumeM3 {
		maxLevel(LoadLevelMedium)
	}
	if features.HelperNeeded {
		maxLevel(LoadLevelMedium)
	}
	if features.CargoType == models.CargoTypePalletized || features.CargoType == models.CargoTypeMotorcycle {
		maxLevel(LoadLevelHard)
	} else if features.CargoType == models.CargoTypeFurniture || features.CargoType == models.CargoTypeWhiteGoods {
		maxLevel(LoadLevelMedium)
	}
	for _, access := range []struct {
		floor    *int
		elevator bool
	}{
		{features.PickupFloor, features.PickupElevatorAvailable},
		{features.DeliveryFloor, features.DeliveryElevatorAvailable},
	} {
		if access.floor == nil || *access.floor <= 0 || access.elevator {
			continue
		}
		maxLevel(LoadLevelMedium)
		if *access.floor >= 4 {
			maxLevel(LoadLevelHard)
		}
	}
	return level, nil
}

func loadLevelRank(level LoadLevel) int {
	switch level {
	case LoadLevelMedium:
		return 1
	case LoadLevelHard:
		return 2
	case LoadLevelVeryHard:
		return 3
	default:
		return 0
	}
}

// Price is retained as a compatibility wrapper for old route callers. New
// pricing must go through CalculateEstimatedPrice and never uses a caller's
// price-per-km value.
func Price(distanceMeters int, _ float64) float64 {
	if distanceMeters <= 0 {
		return 0
	}
	price, err := CalculateBasePrice(DefaultPricingConfig(), float64(distanceMeters)/1000)
	if err != nil {
		return 0
	}
	return price
}

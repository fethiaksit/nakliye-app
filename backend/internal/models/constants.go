package models

// UrgencyType is persisted as a closed value so listings can be filtered and
// reported without interpreting free-form text.
type UrgencyType string

const (
	UrgencyImmediate UrgencyType = "immediate"
	UrgencyToday     UrgencyType = "today"
	UrgencyScheduled UrgencyType = "scheduled"
)

// LoadType aliases keep the first phase's public Go constants source
// compatible while the persisted field is named more precisely.
type LoadType = UrgencyType

const (
	LoadTypeImmediate = UrgencyImmediate
	LoadTypeToday     = UrgencyToday
	LoadTypeScheduled = UrgencyScheduled
)

func ValidUrgencyType(value UrgencyType) bool {
	switch value {
	case UrgencyImmediate, UrgencyToday, UrgencyScheduled:
		return true
	default:
		return false
	}
}

type CargoType string

const (
	CargoTypeEvEsyasi    CargoType = "ev_esyasi"
	CargoTypeMobilya     CargoType = "mobilya"
	CargoTypeBeyazEsya   CargoType = "beyaz_esya"
	CargoTypePaletliYuk  CargoType = "paletli_yuk"
	CargoTypeMotosiklet  CargoType = "motosiklet"
	CargoTypeTicariYuk   CargoType = "ticari_yuk"
	CargoTypeParsiyelYuk CargoType = "parsiyel_yuk"
	CargoTypeDiger       CargoType = "diger"

	CargoTypeHouseholdGoods = CargoTypeEvEsyasi
	CargoTypeFurniture      = CargoTypeMobilya
	CargoTypeWhiteGoods     = CargoTypeBeyazEsya
	CargoTypePalletized     = CargoTypePaletliYuk
	CargoTypeMotorcycle     = CargoTypeMotosiklet
	CargoTypeCommercial     = CargoTypeTicariYuk
	CargoTypePartial        = CargoTypeParsiyelYuk
	CargoTypeOther          = CargoTypeDiger

	LoadTypeEvEsyasi    = CargoTypeEvEsyasi
	LoadTypeMobilya     = CargoTypeMobilya
	LoadTypeBeyazEsya   = CargoTypeBeyazEsya
	LoadTypePaletliYuk  = CargoTypePaletliYuk
	LoadTypeMotosiklet  = CargoTypeMotosiklet
	LoadTypeTicariYuk   = CargoTypeTicariYuk
	LoadTypeParsiyelYuk = CargoTypeParsiyelYuk
	LoadTypeDiger       = CargoTypeDiger
)

func ValidCargoType(value CargoType) bool {
	switch value {
	case CargoTypeHouseholdGoods, CargoTypeFurniture, CargoTypeWhiteGoods, CargoTypePalletized,
		CargoTypeMotorcycle, CargoTypeCommercial, CargoTypePartial, CargoTypeOther:
		return true
	default:
		return false
	}
}

type VehicleType string

const (
	VehicleTypePanelvan   VehicleType = "panelvan"
	VehicleTypeKamyonet   VehicleType = "kamyonet"
	VehicleTypeAcikKasa   VehicleType = "acik_kasa"
	VehicleTypeKapaliKasa VehicleType = "kapali_kasa"
	VehicleTypeKamyon     VehicleType = "kamyon"
	VehicleTypeTir        VehicleType = "tir"
	VehicleTypeFarketmez  VehicleType = "farketmez"

	VehicleTypePanelVan   = VehicleTypePanelvan
	VehicleTypePickup     = VehicleTypeKamyonet
	VehicleTypeOpenBody   = VehicleTypeAcikKasa
	VehicleTypeClosedBody = VehicleTypeKapaliKasa
	VehicleTypeTruck      = VehicleTypeKamyon
	VehicleTypeSemi       = VehicleTypeTir
	VehicleTypeAny        = VehicleTypeFarketmez
)

func ValidVehicleType(value VehicleType) bool {
	switch value {
	case VehicleTypePanelVan, VehicleTypePickup, VehicleTypeOpenBody, VehicleTypeClosedBody,
		VehicleTypeTruck, VehicleTypeSemi, VehicleTypeAny:
		return true
	default:
		return false
	}
}

const (
	MinWeightKG    = 0.1
	MaxWeightKG    = 100_000.0
	MinDimensionCM = 1.0
	MaxDimensionCM = 5_000.0
	MinFloor       = -5
	MaxFloor       = 100
	MaxHelperCount = 20

	MinWeightKg    = MinWeightKG
	MaxWeightKg    = MaxWeightKG
	MinDimensionCm = MinDimensionCM
	MaxDimensionCm = MaxDimensionCM
)

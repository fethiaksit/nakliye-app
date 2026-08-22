package models

// LoadType represents the different types of loads/shipments
type LoadType string

const (
    LoadTypeImmediate          LoadType = "immediate"
    LoadTypeToday              LoadType = "today"
    LoadTypeScheduled          LoadType = "scheduled"

    LoadTypeEvEsyasi           LoadType = "ev_esyasi"
    LoadTypeMobilya            LoadType = "mobilya"
    LoadTypeBeyazEsya          LoadType = "beyaz_esya"
    LoadTypePaletliYuk       LoadType = "paletli_yuk"
    LoadTypeMotosiklet         LoadType = "motosiklet"
    LoadTypeTicariYuk          LoadType = "ticari_yuk"
    LoadTypeParsiyelYuk        LoadType = "parsiyel_yuk"
    LoadTypeDiger              LoadType = "diger"
)

// VehicleType represents the different vehicle types that can be used
type VehicleType string

const (
    VehicleTypePanelvan   VehicleType = "panelvan"
    VehicleTypeKamyonet   VehicleType = "kamyonet"
    VehicleTypeAcikKasa   VehicleType = "acik_kasa"
    VehicleTypeKapaliKasa VehicleType = "kapali_kasa"
    VehicleTypeKamyon     VehicleType = "kamyon"
    VehicleTypeTir        VehicleType = "tir"
    VehicleTypeFarketmez  VehicleType = "farketmez"
)

// CargoType represents the different cargo types
type CargoType string

const (
    CargoTypeEvEsyasi       CargoType = "ev_esyasi"
    CargoTypeMobilya        CargoType = "mobilya"
    CargoTypeBeyazEsya      CargoType = "beyaz_esya"
    CargoTypePaletliYuk     CargoType = "paletli_yuk"
    CargoTypeMotosiklet     CargoType = "motosiklet"
    CargoTypeTicariYuk      CargoType = "ticari_yuk"
    CargoTypeParsiyelYuk    CargoType = "parsiyel_yuk"
    CargoTypeDiger          CargoType = "diger"
)

// Validation constants for load fields
const (
    MinWeightKg            = 0.1
    MaxWeightKg            = 10000.0
    MinDimensionCm         = 1
    MinStringLength        = 1
    MaxStringLength        = 100
)
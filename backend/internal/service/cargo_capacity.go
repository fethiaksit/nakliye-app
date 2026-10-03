package service

import (
	"errors"
	"math"
	"nakliye-api/internal/models"
	"strconv"
)

// Reference capacities are approximate; unfamiliar cargo requires a driver quote.
// Keep this table on the server so preview and persisted listings use one source.
func EstimateCargoCapacity(cargo models.CargoType, details map[string]any) (models.Dimensions, bool, error) {
	unknown := models.Dimensions{VolumeM3: 1, WeightKG: 50}
	size, _ := details["loadSize"].(string)
	if size != "" && size != "small" && size != "medium" && size != "large" && size != "unknown" {
		return unknown, true, errors.New("geçersiz yük büyüklüğü")
	}
	generic := func() (models.Dimensions, bool, error) {
		switch size {
		case "small":
			return models.Dimensions{VolumeM3: 2, WeightKG: 100}, false, nil
		case "medium":
			return models.Dimensions{VolumeM3: 6, WeightKG: 600}, false, nil
		case "large":
			return models.Dimensions{VolumeM3: 15, WeightKG: 1500}, false, nil
		default:
			return unknown, true, nil
		}
	}
	count := func(v any) (float64, error) {
		var n float64
		switch v := v.(type) {
		case float64:
			n = v
		case int:
			n = float64(v)
		case string:
			var err error
			n, err = strconv.ParseFloat(v, 64)
			if err != nil {
				return 0, errors.New("eşya adedi geçersiz")
			}
		default:
			return 0, errors.New("eşya adedi geçersiz")
		}
		if math.IsNaN(n) || math.IsInf(n, 0) || n < 1 || n > 1000 || math.Trunc(n) != n {
			return 0, errors.New("eşya adedi 1 ile 1000 arasında tam sayı olmalıdır")
		}
		return n, nil
	}
	switch cargo {
	case models.CargoTypeEvEsyasi:
		if details["moveType"] == "komple" {
			return unknown, true, nil
		}
		return generic()
	case models.CargoTypeMobilya, models.CargoTypeBeyazEsya:
		refs := map[string][2]float64{
			"Koltuk": {1.2, 80}, "Kanepe": {2, 80}, "Yatak": {1.5, 40}, "Baza": {1.5, 60}, "Dolap": {2.5, 100}, "Masa": {1.2, 50}, "Sandalye": {.3, 8}, "TV Ünitesi": {1.2, 40},
			"Buzdolabı": {1, 80}, "Çamaşır Makinesi": {.5, 75}, "Bulaşık Makinesi": {.5, 55}, "Kurutma Makinesi": {.5, 50}, "Fırın": {.6, 60}, "Derin Dondurucu": {.8, 60}, "Televizyon": {.4, 15},
		}
		items, ok := details["items"].([]any)
		if !ok {
			if details["items"] != nil {
				return unknown, true, errors.New("eşya listesi geçersiz")
			}
			return generic()
		}
		total := models.Dimensions{}
		manual := len(items) == 0
		for _, raw := range items {
			item, ok := raw.(map[string]any)
			if !ok {
				return unknown, true, errors.New("eşya listesi geçersiz")
			}
			n, err := count(item["count"])
			if err != nil {
				return unknown, true, err
			}
			name, _ := item["name"].(string)
			ref, known := refs[name]
			if !known {
				manual = true
				continue
			}
			total.VolumeM3 += ref[0] * n
			total.WeightKG += ref[1] * n
		}
		if manual {
			return unknown, true, nil
		}
		total.VolumeM3 = math.Round(total.VolumeM3*100) / 100
		total.WeightKG = math.Round(total.WeightKG*100) / 100
		return total, false, nil
	case models.CargoTypePaletliYuk:
		if details["palletCount"] == nil {
			return unknown, true, nil
		}
		n, err := count(details["palletCount"])
		if err != nil {
			return unknown, true, err
		}
		switch details["palletSize"] {
		case "euro":
			return models.Dimensions{VolumeM3: 1.5 * n, WeightKG: 250 * n}, false, nil
		case "industrial":
			return models.Dimensions{VolumeM3: 1.8 * n, WeightKG: 250 * n}, false, nil
		default:
			return unknown, true, nil
		}
	case models.CargoTypeMotosiklet:
		return models.Dimensions{VolumeM3: 1, WeightKG: 200}, false, nil
	default:
		return generic()
	}
}

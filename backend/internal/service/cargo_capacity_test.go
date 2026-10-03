package service

import (
	"encoding/json"
	"nakliye-api/internal/models"
	"testing"
)

func TestSimpleCargoCapacityUsesItemsInsteadOfCustomerVolume(t *testing.T) {
	cases := []struct {
		cargo          models.CargoType
		body           string
		volume, weight float64
		manual         bool
	}{
		{models.CargoTypeFurniture, `{"items":[{"name":"Kanepe","count":2},{"name":"Sandalye","count":4}]}`, 5.2, 192, false},
		{models.CargoTypeWhiteGoods, `{"items":[{"name":"Buzdolabı","count":1},{"name":"Çamaşır Makinesi","count":1}]}`, 1.5, 155, false},
		{models.CargoTypePalletized, `{"palletCount":3,"palletSize":"euro"}`, 4.5, 750, false},
		{models.CargoTypeMotorcycle, `{"motorcycleType":"Scooter"}`, 1, 200, false},
		{models.CargoTypeCommercial, `{"loadSize":"medium"}`, 6, 600, false},
		{models.CargoTypeOther, `{"loadSize":"unknown"}`, 1, 50, true},
		{models.CargoTypeHouseholdGoods, `{"moveType":"komple","homeSize":"3+1"}`, 1, 50, true},
	}
	for _, tc := range cases {
		var details map[string]any
		json.Unmarshal([]byte(tc.body), &details)
		got, manual, err := EstimateCargoCapacity(tc.cargo, details)
		if err != nil || got.VolumeM3 != tc.volume || got.WeightKG != tc.weight || manual != tc.manual {
			t.Errorf("%s %s: %#v manual=%v err=%v", tc.cargo, tc.body, got, manual, err)
		}
	}
}
func TestSimpleCargoCapacityRejectsMalformedCounts(t *testing.T) {
	for _, body := range []string{`{"items":[{"name":"Kanepe","count":-1}]}`, `{"items":[{"name":"Kanepe","count":1.5}]}`, `{"items":[{"name":"Kanepe","count":1001}]}`, `{"loadSize":"arbitrary"}`} {
		var details map[string]any
		json.Unmarshal([]byte(body), &details)
		if _, _, err := EstimateCargoCapacity(models.CargoTypeFurniture, details); err == nil {
			t.Errorf("accepted %s", body)
		}
	}
}

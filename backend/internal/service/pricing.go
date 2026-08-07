package service

import (
	"math"
)

const DefaultPricePerKM = 200.0

// Price is deliberately calculated only from the server-verified road distance.
// It must not use a price submitted by a mobile client.
func Price(distanceMeters int, pricePerKM float64) float64 {
	return math.Round((float64(distanceMeters)/1000)*pricePerKM*100) / 100
}

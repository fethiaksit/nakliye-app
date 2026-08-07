package main

import (
	"context"
	"flag"
	"log"
	"time"

	"nakliye-api/internal/config"
	"nakliye-api/internal/models"
	"nakliye-api/internal/service"
	"nakliye-api/internal/store"
)

// routebackfill upgrades pre-Google Redis load records after a real Google
// server key has been configured. It is opt-in so a deployment never mutates
// customer data merely because the API binary starts.
func main() {
	apply := flag.Bool("apply", false, "Google rota verisini Redis kayıtlarına yaz")
	flag.Parse()
	if !*apply {
		log.Print("Dry run: no records changed. To backfill existing routes run: go run ./cmd/routebackfill --apply")
		return
	}
	cfg := config.Load()
	if cfg.GoogleMapsServerAPIKey == "" {
		log.Fatal("GOOGLE_MAPS_API_KEY zorunludur")
	}
	redisStore, err := store.New(cfg.RedisURL)
	if err != nil {
		log.Fatal(err)
	}
	if err = redisStore.Ping(); err != nil {
		log.Fatalf("Redis'e bağlanılamadı: %v", err)
	}
	maps := service.NewGoogleMapsClient(cfg.GoogleMapsServerAPIKey, cfg.PricePerKM)
	offset := 0
	updated := 0
	for {
		loads, total, err := redisStore.ListLoads("", "", "", "", offset, 100)
		if err != nil {
			log.Fatal(err)
		}
		for _, load := range loads {
			if load.DeletedAt != nil || load.RouteProvider == "google" {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			route, routeErr := maps.Calculate(ctx, coordinate(load.Pickup), coordinate(load.Delivery))
			cancel()
			if routeErr != nil {
				log.Printf("load %s rota güncellenemedi: %v", load.ID, routeErr)
				continue
			}
			load.RouteDistanceMeters = route.DistanceMeters
			load.RouteDurationSeconds = route.DurationSeconds
			load.PricePerKM = route.PricePerKM
			load.RouteEncodedPolyline = route.EncodedPolyline
			load.RouteProvider = route.RouteProvider
			load.RouteCoordinates = route.RouteCoordinates
			load.EstimatedKM = route.DistanceKM
			load.BasePriceTL = route.EstimatedPriceTL
			if load.AgreedPriceTL == 0 || load.Status == "draft" || load.Status == "published" || load.Status == "open" || load.Status == "offers_received" {
				load.AgreedPriceTL = route.EstimatedPriceTL
			}
			load.UpdatedAt = time.Now().UTC()
			if err = redisStore.SaveLoad(load); err != nil {
				log.Printf("load %s kaydedilemedi: %v", load.ID, err)
				continue
			}
			updated++
		}
		offset += len(loads)
		if offset >= total || len(loads) == 0 {
			break
		}
	}
	log.Printf("Google rota backfill tamamlandı: %d kayıt güncellendi", updated)
}

func coordinate(location models.Location) models.Coordinate {
	return models.Coordinate{Latitude: location.Latitude, Longitude: location.Longitude}
}

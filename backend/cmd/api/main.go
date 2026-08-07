package main

import (
	"log"
	"nakliye-api/internal/config"
	"nakliye-api/internal/httpapi"
	"nakliye-api/internal/store"
	"net"
	"net/http"
)

func main() {
	cfg := config.Load()
	if cfg.GoogleMapsServerKeyError != "" {
		log.Printf("[MAPS CONFIG] server key configured: false; reason=%s", cfg.GoogleMapsServerKeyError)
	} else {
		log.Printf("[MAPS CONFIG] server key configured: true; suffix=%s", config.MaskSecret(cfg.GoogleMapsServerAPIKey))
	}
	s, err := store.New(cfg.RedisURL)
	if err != nil {
		log.Fatal(err)
	}
	if err = s.Ping(); err != nil {
		log.Fatalf("Redis'e bağlanılamadı: %v", err)
	}
	log.Printf("Server listening on http://0.0.0.0:%s", cfg.Port)
	if cfg.LANHost != "" {
		log.Printf("LAN access: http://%s:%s", cfg.LANHost, cfg.Port)
	}
	// On macOS, ListenAndServe's generic "tcp" network may produce an IPv6-only
	// socket. Expo Go and physical clients reach this service through an IPv4 LAN
	// address, so force tcp4 instead of relying on platform dual-stack defaults.
	listener, err := net.Listen("tcp4", "0.0.0.0:"+cfg.Port)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.Serve(listener, httpapi.NewWithOptions(s, httpapi.Options{
		Secret:                   cfg.JWTSecret,
		GoogleMapsServerAPIKey:   cfg.GoogleMapsServerAPIKey,
		GoogleMapsServerKeyError: cfg.GoogleMapsServerKeyError,
		PricePerKM:               cfg.PricePerKM,
		MaxUploadMB:              cfg.MaxUploadMB,
	}).Routes()))
}

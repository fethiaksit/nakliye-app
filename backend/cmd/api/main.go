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
	if err := cfg.Validate(); err != nil {
		log.Fatalf("Configuration error: %v", err)
	}
	log.Printf("Environment: %s", cfg.Environment)
	if cfg.MapsKeyError != "" {
		log.Printf("[MAPS CONFIG] provider=google server key configured: false; reason=%s", cfg.MapsKeyError)
	} else {
		log.Printf("[MAPS CONFIG] provider=google server key configured: true")
	}
	s, err := store.New(cfg.RedisURL)
	if err != nil {
		log.Fatal(err)
	}
	if err = s.Ping(); err != nil {
		log.Fatalf("Redis'e bağlanılamadı: %v", err)
	}
	if err = s.MigrateWalletPolicy(); err != nil {
		log.Fatalf("Cüzdan şema güncellemesi: %v", err)
	}
	log.Printf("Server listening on http://0.0.0.0:%s (environment=%s)", cfg.Port, cfg.Environment)
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
	if cfg.ResendAPIKey != "" {
		log.Printf("[EMAIL CONFIG] provider=resend configured: true from=%s", cfg.ResendFromEmail)
	} else {
		log.Printf("[EMAIL CONFIG] provider=resend configured: false (RESEND_API_KEY boş)")
	}
	log.Fatal(http.Serve(listener, httpapi.NewWithOptions(s, httpapi.Options{
		Secret:                 cfg.JWTSecret,
		GoogleMapsServerAPIKey: cfg.GoogleMapsServerAPIKey,
		MapsKeyError:           cfg.MapsKeyError,
		Pricing:                cfg.Pricing,
		MaxUploadMB:            cfg.MaxUploadMB,
		AdminEmail:             cfg.AdminEmail,
		AdminPassword:          cfg.AdminPassword,
		AdminPasswordHash:      cfg.AdminPasswordHash,
		AdminSecret:            cfg.AdminJWTSecret,
		ResendAPIKey:           cfg.ResendAPIKey,
		ResendFromEmail:        cfg.ResendFromEmail,
		ResendAPIURL:           cfg.ResendAPIURL,
		SentryDSN:              cfg.SentryDSN,
		Environment:            cfg.Environment,
		AppVersion:             cfg.AppVersion,
		MaintenanceMode:        cfg.MaintenanceMode,
	}).Routes()))
}

package main

import (
	"context"
	"log/slog"
	"nakliye-api/internal/config"
	"nakliye-api/internal/httpapi"
	"nakliye-api/internal/service"
	"nakliye-api/internal/store"
	"net"
	"net/http"
	"os"
)

func main() {
	logger := service.ConfigureDefaultLogger(os.Stdout)
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		logger.Error("configuration_validation_failed", "error", err.Error())
		os.Exit(1)
	}
	logger.Info("service_configured", "config", cfg.SafeSummary())
	if cfg.MapsKeyError != "" {
		logger.Warn("maps_config_incomplete", "provider", "google", "configured", false, "reason", cfg.MapsKeyError)
	} else {
		logger.Info("maps_config_ready", "provider", "google", "configured", true)
	}
	s, err := store.New(cfg.RedisURL)
	if err != nil {
		logger.Error("redis_client_init_failed", "error", service.SanitizeLogString(err.Error()))
		os.Exit(1)
	}
	if err = s.Ping(); err != nil {
		logger.Error("redis_ping_failed", "error", service.SanitizeLogString(err.Error()))
		os.Exit(1)
	}
	if err = s.MigrateWalletPolicy(); err != nil {
		logger.Error("wallet_schema_migration_failed", "error", service.SanitizeLogString(err.Error()))
		os.Exit(1)
	}
	logger.Info("server_starting", "addr", "0.0.0.0:"+cfg.Port, "environment", cfg.Environment)
	if cfg.LANHost != "" {
		logger.Info("lan_access_enabled", "url", "http://"+cfg.LANHost+":"+cfg.Port)
	}
	// On macOS, ListenAndServe's generic "tcp" network may produce an IPv6-only
	// socket. Expo Go and physical clients reach this service through an IPv4 LAN
	// address, so force tcp4 instead of relying on platform dual-stack defaults.
	listener, err := net.Listen("tcp4", "0.0.0.0:"+cfg.Port)
	if err != nil {
		logger.Error("tcp_listen_failed", "error", err.Error())
		os.Exit(1)
	}
	if cfg.ResendAPIKey != "" {
		logger.Info("email_config_ready", "provider", "resend", "configured", true, "from_email", cfg.ResendFromEmail)
	} else {
		logger.Warn("email_config_incomplete", "provider", "resend", "configured", false)
	}
	api := httpapi.NewWithOptions(s, httpapi.Options{
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
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	api.StartPushReceiptWorker(ctx)
	if err := http.Serve(listener, api.Routes()); err != nil {
		slog.Error("server_stopped", "error", err.Error())
		os.Exit(1)
	}
}

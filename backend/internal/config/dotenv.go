package config

import (
	"bufio"
	"os"
	"strings"
)

// loadDotEnv supports the small KEY=value surface used by this service. Values
// already provided by the process environment always win, which keeps Docker
// and production secret managers authoritative. Invalid lines are ignored so
// startup remains compatible with ordinary shell-style .env comments.
func loadDotEnv(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	for scanner := bufio.NewScanner(file); scanner.Scan(); {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		// Do not remove quote characters: googleMapsServerAPIKey reports them as a
		// configuration mistake instead of silently changing a credential.
		_ = os.Setenv(key, value)
	}
}

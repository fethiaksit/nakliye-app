package config

import "testing"

func TestMapsServerKeyValidation(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantKey string
		wantErr bool
	}{
		{name: "missing", wantErr: true},
		{name: "leading whitespace", raw: " key", wantErr: true},
		{name: "quoted", raw: "'key'", wantErr: true},
		{name: "valid", raw: "AIza-test-key", wantKey: "AIza-test-key"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			key, errText := mapsServerKey(test.raw)
			if (errText != "") != test.wantErr || key != test.wantKey {
				t.Fatalf("mapsServerKey(%q) = (%q, %q)", test.raw, key, errText)
			}
		})
	}
}

func TestMaskSecretNeverReturnsTheFullValue(t *testing.T) {
	if got := MaskSecret("AIza-long-test-key"); got != "****-key" {
		t.Fatalf("MaskSecret returned %q", got)
	}
}

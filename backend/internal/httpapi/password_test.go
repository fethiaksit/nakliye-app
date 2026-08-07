package httpapi

import "testing"

func TestArgon2idPasswordRoundTrip(t *testing.T) {
	hash, err := hashPassword("GucluSifre123")
	if err != nil {
		t.Fatalf("hashPassword returned an error: %v", err)
	}
	if !verifyPassword(hash, "GucluSifre123") {
		t.Fatal("the original password must verify")
	}
	if verifyPassword(hash, "yanlış") {
		t.Fatal("an incorrect password must not verify")
	}
}

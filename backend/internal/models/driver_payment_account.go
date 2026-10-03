package models

import (
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type DriverPaymentAccount struct {
	Enabled     bool      `json:"enabled"`
	CompanyName string    `json:"companyName"`
	BankName    string    `json:"bankName"`
	IBAN        string    `json:"iban"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func (a *DriverPaymentAccount) Normalize() {
	a.CompanyName = strings.TrimSpace(a.CompanyName)
	a.BankName = strings.TrimSpace(a.BankName)
	a.IBAN = strings.ToUpper(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, a.IBAN))
}

func (a DriverPaymentAccount) Validate() error {
	if utf8.RuneCountInString(a.CompanyName) > 200 || utf8.RuneCountInString(a.BankName) > 100 || len(a.IBAN) > 26 {
		return errors.New("Hesap bilgileri izin verilen uzunluğu aşıyor.")
	}
	if !a.Enabled {
		return nil
	}
	if a.CompanyName == "" || a.BankName == "" {
		return errors.New("Şirket unvanı ve banka adı zorunludur.")
	}
	if len(a.IBAN) != 26 || !strings.HasPrefix(a.IBAN, "TR") {
		return errors.New("Geçerli bir Türkiye IBAN'ı girin.")
	}
	for _, r := range a.IBAN[2:] {
		if r < '0' || r > '9' {
			return errors.New("Geçerli bir Türkiye IBAN'ı girin.")
		}
	}
	remainder := 0
	for _, r := range a.IBAN[4:] + "2927" + a.IBAN[2:4] {
		remainder = (remainder*10 + int(r-'0')) % 97
	}
	if remainder != 1 {
		return errors.New("IBAN kontrol numarası geçersiz.")
	}
	return nil
}

package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// EmailSender defines the interface for dispatching transactional emails.
type EmailSender interface {
	SendPasswordResetCode(ctx context.Context, toEmail, code string) error
}

// ResendClient implements EmailSender using the Resend REST API.
type ResendClient struct {
	apiKey    string
	fromEmail string
	apiURL    string
	client    *http.Client
}

func NewResendClient(apiKey, fromEmail, apiURL string) *ResendClient {
	if apiURL == "" {
		apiURL = "https://api.resend.com/emails"
	}
	if fromEmail == "" {
		fromEmail = "onboarding@resend.dev"
	}
	return &ResendClient{
		apiKey:    strings.TrimSpace(apiKey),
		fromEmail: strings.TrimSpace(fromEmail),
		apiURL:    apiURL,
		client:    &http.Client{Timeout: 10 * time.Second},
	}
}

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

type resendSuccessResponse struct {
	ID string `json:"id"`
}

type resendErrorResponse struct {
	Name       string `json:"name,omitempty"`
	Message    string `json:"message,omitempty"`
	StatusCode int    `json:"statusCode,omitempty"`
}

func (c *ResendClient) SendPasswordResetCode(ctx context.Context, toEmail, code string) error {
	if c.apiKey == "" {
		return errors.New("RESEND_API_KEY yapılandırılmamış")
	}
	targetEmail := strings.TrimSpace(strings.ToLower(toEmail))
	if targetEmail == "" {
		return errors.New("geçersiz alıcı e-posta adresi")
	}

	htmlContent := fmt.Sprintf(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Şifre Sıfırlama Kodu</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #1E293B;">
  <div style="max-width: 520px; margin: 0 auto; background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="display: inline-block; background-color: #0F172A; color: #FFFFFF; font-weight: 700; font-size: 20px; padding: 10px 20px; border-radius: 10px; letter-spacing: -0.5px;">
        NakliyeGo
      </div>
    </div>
    
    <h1 style="font-size: 20px; font-weight: 600; text-align: center; margin-top: 0; margin-bottom: 12px; color: #0F172A;">
      Şifre Sıfırlama Doğrulama Kodu
    </h1>
    
    <p style="font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px; text-align: center;">
      NakliyeGo hesabınız için şifre sıfırlama talebinde bulundunuz. Aşağıdaki 6 haneli doğrulama kodunu uygulamada girerek yeni şifrenizi belirleyebilirsiniz:
    </p>
    
    <div style="background-color: #F1F5F9; border: 1px dashed #CBD5E1; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <span style="font-family: monospace, Courier, monospace; font-size: 34px; font-weight: 700; letter-spacing: 8px; color: #0284C7;">
        %s
      </span>
    </div>
    
    <div style="background-color: #FEF3C7; border: 1px solid #FDE68A; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 13px; color: #92400E; line-height: 1.5;">
        <strong>Önemli:</strong> Bu kod <strong>5 dakika</strong> boyunca geçerlidir. Kodunuzu kimseyle paylaşmayınız.
      </p>
    </div>
    
    <p style="font-size: 13px; line-height: 1.5; color: #64748B; margin-bottom: 0; text-align: center;">
      Bu şifre sıfırlama talebini siz yapmadıysanız lütfen bu e-postayı dikkate almayınız. Hesabınız güvendedir.
    </p>
    
    <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 28px 0 20px 0;">
    
    <div style="text-align: center; font-size: 12px; color: #94A3B8;">
      &copy; NakliyeGo Taşıma Platformu &bull; Güvenli Taşımacılık Çözümleri
    </div>
  </div>
</body>
</html>`, code)

	textContent := fmt.Sprintf("Merhaba,\n\nNakliyeGo hesabınız için şifre sıfırlama doğrulama kodunuz:\n\n%s\n\nBu kod 5 dakika boyunca geçerlidir.\n\nBu talebi siz yapmadıysanız bu e-postayı dikkate almayınız.\n\nNakliyeGo Ekibi", code)

	reqBody := resendRequest{
		From:    c.fromEmail,
		To:      []string{targetEmail},
		Subject: "NakliyeGo - Şifre Sıfırlama Doğrulama Kodu",
		HTML:    htmlContent,
		Text:    textContent,
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("resend request marshal error: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("resend request create error: %w", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", "NakliyeGo-Backend/1.0")

	resp, err := c.client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("resend network error: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("resend response read error: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		var resendErr resendErrorResponse
		_ = json.Unmarshal(bodyBytes, &resendErr)
		msg := resendErr.Message
		if msg == "" {
			msg = string(bodyBytes)
		}
		return fmt.Errorf("resend api error (status %d): %s", resp.StatusCode, msg)
	}

	var success resendSuccessResponse
	if err := json.Unmarshal(bodyBytes, &success); err != nil || success.ID == "" {
		return errors.New("resend invalid success response")
	}

	return nil
}

// MockEmailSender provides an in-memory implementation of EmailSender for unit/integration tests.
type MockEmailSender struct {
	mu          sync.Mutex
	SentEmails  []MockSentEmail
	ShouldFail  bool
	FailMessage string
}

type MockSentEmail struct {
	ToEmail string
	Code    string
	SentAt  time.Time
}

func NewMockEmailSender() *MockEmailSender {
	return &MockEmailSender{
		SentEmails: make([]MockSentEmail, 0),
	}
}

func (m *MockEmailSender) SendPasswordResetCode(_ context.Context, toEmail, code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ShouldFail {
		msg := m.FailMessage
		if msg == "" {
			msg = "resend simulated api failure"
		}
		return errors.New(msg)
	}
	m.SentEmails = append(m.SentEmails, MockSentEmail{
		ToEmail: toEmail,
		Code:    code,
		SentAt:  time.Now().UTC(),
	})
	return nil
}

func (m *MockEmailSender) LastSentCode(email string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	email = strings.ToLower(strings.TrimSpace(email))
	for i := len(m.SentEmails) - 1; i >= 0; i-- {
		if strings.ToLower(m.SentEmails[i].ToEmail) == email {
			return m.SentEmails[i].Code
		}
	}
	return ""
}

func (m *MockEmailSender) TotalSent() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.SentEmails)
}

package httpapi

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"nakliye-api/internal/models"
)

func generateDeliveryCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()+100000), nil
}

func (a *API) deliveryCodeHash(loadID, code string) string {
	mac := hmac.New(sha256.New, a.secret)
	_, _ = mac.Write([]byte("delivery-code:" + loadID + ":" + code))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *API) deliveryCodeCipher() (cipher.AEAD, error) {
	key := sha256.Sum256(append([]byte("nakliyego-delivery-code:"), a.secret...))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func (a *API) encryptDeliveryCode(loadID, code string) (string, error) {
	gcm, err := a.deliveryCodeCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(code), []byte(loadID))
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}

func (a *API) decryptDeliveryCode(loadID, encrypted string) (string, error) {
	data, err := base64.RawURLEncoding.DecodeString(encrypted)
	if err != nil {
		return "", err
	}
	gcm, err := a.deliveryCodeCipher()
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", fmt.Errorf("delivery code ciphertext is invalid")
	}
	nonce, ciphertext := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, []byte(loadID))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func (a *API) newDeliveryVerification(load models.Load) (models.DeliveryVerification, error) {
	code, err := generateDeliveryCode()
	if err != nil {
		return models.DeliveryVerification{}, err
	}
	ciphertext, err := a.encryptDeliveryCode(load.ID, code)
	if err != nil {
		return models.DeliveryVerification{}, err
	}
	return models.DeliveryVerification{
		LoadID: load.ID, CustomerID: load.CustomerID, DriverID: load.AssignedDriver,
		CodeHash: a.deliveryCodeHash(load.ID, code), CodeCiphertext: ciphertext, CreatedAt: load.UpdatedAt,
	}, nil
}

func validDeliveryCode(code string) bool {
	if len(code) < 4 || len(code) > 6 {
		return false
	}
	for _, character := range []byte(code) {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func deliveryCodeAvailableForLoad(load models.Load) bool {
	if load.DeliveryVerified || load.AssignedDriver == "" {
		return false
	}

	switch models.CanonicalLoadStatus(load.Status) {
	case models.LoadStatusDriverSelected,
		models.LoadStatusDriverEnRoute,
		models.LoadStatusAtPickup,
		models.LoadStatusPickedUp,
		models.LoadStatusEnRouteToDelivery,
		models.LoadStatusDelivered:
		return true
	default:
		return false
	}
}

func (a *API) deliveryCode(w http.ResponseWriter, r *http.Request) {
	principal := current(r)
	if principal.Role != models.RoleCustomer {
		forbidden(w)
		return
	}
	load, err := a.store.GetLoad(r.PathValue("id"))
	if err != nil || load.DeletedAt != nil {
		notFound(w)
		return
	}
	if load.CustomerID != principal.ID {
		forbidden(w)
		return
	}
	verification, err := a.store.GetDeliveryVerification(load.ID)
	if err != nil {
		// Faz 10'dan önce kabul edilmiş veya verification kaydı eksilmiş
		// aktif yükleri güvenli biçimde onar.
		if !deliveryCodeAvailableForLoad(load) {
			notFound(w)
			return
		}

		generated, generateErr := a.newDeliveryVerification(load)
		if generateErr != nil {
			serverError(w, generateErr)
			return
		}

		verification, err = a.store.EnsureDeliveryVerification(generated)
		if err != nil {
			serverError(w, err)
			return
		}
	}
	if verification.CustomerID != principal.ID || verification.LoadID != load.ID {
		forbidden(w)
		return
	}
	if verification.Verified || verification.CodeCiphertext == "" {
		conflict(w, "teslimat kodu artık kullanılamaz")
		return
	}
	code, err := a.decryptDeliveryCode(load.ID, verification.CodeCiphertext)
	if err != nil {
		serverError(w, err)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"deliveryCode": code, "createdAt": verification.CreatedAt})
}

func (a *API) completeDelivery(w http.ResponseWriter, r *http.Request) {
	principal := current(r)
	if principal.Role != models.RoleDriver {
		forbidden(w)
		return
	}
	load, err := a.store.GetLoad(r.PathValue("id"))
	if err != nil || load.DeletedAt != nil {
		notFound(w)
		return
	}
	if load.AssignedDriver != principal.ID {
		forbidden(w)
		return
	}
	if load.Status != models.LoadStatusDelivered {
		conflict(w, "yalnızca teslim edilmiş aktif iş tamamlanabilir")
		return
	}
	if !a.deliveryCodeRate.Allow(load.ID + ":" + principal.ID) {
		w.Header().Set("Retry-After", "60")
		errorResponse(w, http.StatusTooManyRequests, "RATE_LIMITED", "çok fazla teslimat doğrulama denemesi", map[string]any{"retryAfterSeconds": 60})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, a.maxUploadBytes+(1<<20))
	if err = r.ParseMultipartForm(a.maxUploadBytes); err != nil {
		badRequest(w, "teslimat fotoğrafı boyutu limiti aşıldı")
		return
	}
	code := strings.TrimSpace(r.FormValue("code"))
	if !validDeliveryCode(code) {
		badRequest(w, "geçerli teslimat kodu zorunludur")
		return
	}
	verification, err := a.store.GetDeliveryVerification(load.ID)
	if err != nil || verification.Verified || verification.CodeHash == "" {
		conflict(w, "teslimat doğrulaması kullanılamıyor")
		return
	}
	if verification.LoadID != load.ID || verification.CustomerID != load.CustomerID || verification.DriverID != principal.ID {
		forbidden(w)
		return
	}
	expectedHash := a.deliveryCodeHash(load.ID, code)
	if !hmac.Equal([]byte(verification.CodeHash), []byte(expectedHash)) {
		badRequest(w, "teslimat kodu geçersiz")
		return
	}

	file, header, err := r.FormFile("photo")
	if err != nil {
		badRequest(w, "teslimat fotoğrafı zorunludur")
		return
	}
	defer file.Close()
	photoURL, err := a.savePhoto(file, header, principal.ID, load.ID)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	cleanupPhoto := func() { _ = a.store.DeletePhoto(strings.TrimPrefix(photoURL, "/api/photos/")) }

	now := time.Now().UTC()
	from := load.Status
	load.Status, load.UpdatedAt = models.LoadStatusCompleted, now
	load.DeliveryVerified, load.DeliveryVerifiedAt = true, &now
	load.DeliveryPhotoURL = photoURL
	load.DeliveryVerificationMethod = models.DeliveryVerificationMethodCodePhoto
	verification.CodeCiphertext = ""
	verification.Verified, verification.VerifiedAt = true, &now
	verification.VerifiedByUserID, verification.VerifiedByRole = principal.ID, principal.Role
	verification.VerificationMethod, verification.PhotoURL = models.DeliveryVerificationMethodCodePhoto, photoURL
	event := newLoadStatusEvent(load.ID, from, load.Status, principal.ID, principal.Role, models.LoadStatusSourceDriverApp, "Teslimat kodu ve fotoğraf doğrulandı", now)
	var rewardTemplate *models.WalletTransaction
	company, companyErr := a.companyForCorporateCustomer(load.CustomerID)
	if companyErr != nil {
		cleanupPhoto()
		serverError(w, companyErr)
		return
	}
	if company != nil {
		rewardTemplate = &models.WalletTransaction{
			ID: uuid.NewString(), CompanyID: company.ID, LoadID: load.ID, Type: models.WalletTransactionShipmentReward,
			Description: "Tamamlanan nakliyeden %10 kurumsal kredi", PickupAddress: load.Pickup.Address, DeliveryAddress: load.Delivery.Address,
			ActorID: "system", ActorRole: "system", CreatedAt: now,
		}
	}
	reward, err := a.store.CompleteDeliveryWithReward(from, load, event, verification, rewardTemplate)
	if err != nil {
		cleanupPhoto()
		writeLoadStatusError(w, err)
		return
	}
	if reward != nil {
		_ = a.store.RecordDomainEvent("wallet.shipment_reward", load.ID, reward)
	}
	if err = a.store.SaveConversation(a.conversationRecord(load)); err != nil {
		log.Printf("conversation update after verified delivery: %v", err)
	}
	a.addSystemMessage(load, "Teslimat kodu ve fotoğraf doğrulandı. Nakliye tamamlandı.")
	a.pushLoadStatus(load, principal.ID)
	jsonResponse(w, http.StatusOK, load)
}

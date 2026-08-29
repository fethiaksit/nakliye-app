package store

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
)

func (s *RedisStore) GetDeliveryVerification(loadID string) (models.DeliveryVerification, error) {
	var verification models.DeliveryVerification
	body, err := s.client.Get(s.ctx, "load-delivery-verification:"+loadID).Bytes()
	if err != nil {
		return verification, err
	}
	return verification, json.Unmarshal(body, &verification)
}

// CompleteDelivery commits the verified proof, load state and status-history
// event in one Redis transaction. This is intentionally separate from the
// generic status transition so completed can never be persisted without proof.
func (s *RedisStore) CompleteDelivery(expectedStatus string, updated models.Load, event models.LoadStatusEvent, verification models.DeliveryVerification) error {
	expectedStatus = models.CanonicalLoadStatus(expectedStatus)
	event = normalizeLoadStatusEvent(event)
	photoID := strings.TrimPrefix(verification.PhotoURL, "/api/photos/")
	if updated.ID == "" || expectedStatus != models.LoadStatusDelivered || updated.Status != models.LoadStatusCompleted ||
		event.LoadID != updated.ID || models.CanonicalLoadStatus(event.FromStatus) != expectedStatus || event.ToStatus != updated.Status ||
		event.ChangedByUserID == "" || event.ChangedByRole == "" || event.Source == "" || event.ChangedAt.IsZero() ||
		verification.LoadID != updated.ID || verification.CustomerID != updated.CustomerID || verification.DriverID != updated.AssignedDriver ||
		verification.CodeHash == "" || verification.CodeCiphertext != "" || !verification.Verified || verification.VerifiedAt == nil ||
		verification.VerifiedByUserID == "" || verification.VerifiedByRole == "" || verification.VerificationMethod == "" ||
		photoID == verification.PhotoURL || photoID == "" || strings.Contains(photoID, "/") ||
		!updated.DeliveryVerified || updated.DeliveryVerifiedAt == nil || updated.DeliveryPhotoURL != verification.PhotoURL ||
		updated.DeliveryVerificationMethod != verification.VerificationMethod || !models.CanTransition(expectedStatus, updated.Status) {
		return ErrInvalidLoadStatusTransition
	}

	loadBody, err := json.Marshal(updated)
	if err != nil {
		return err
	}
	verificationBody, err := json.Marshal(verification)
	if err != nil {
		return err
	}
	eventBody, err := json.Marshal(event)
	if err != nil {
		return err
	}
	loadKey := "load:" + updated.ID
	verificationKey := "load-delivery-verification:" + updated.ID
	eventKey := "load-status-event:" + event.ID
	photoKey := "photo:" + photoID
	err = s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		storedLoadBody, getErr := tx.Get(s.ctx, loadKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedLoad models.Load
		if unmarshalErr := json.Unmarshal(storedLoadBody, &storedLoad); unmarshalErr != nil {
			return unmarshalErr
		}
		currentStatus := models.CanonicalLoadStatus(storedLoad.Status)
		if currentStatus != expectedStatus || storedLoad.CustomerID != verification.CustomerID || storedLoad.AssignedDriver != verification.DriverID {
			return ErrLoadStatusConflict
		}
		if !models.CanTransition(currentStatus, updated.Status) {
			return ErrInvalidLoadStatusTransition
		}

		storedVerificationBody, getErr := tx.Get(s.ctx, verificationKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedVerification models.DeliveryVerification
		if unmarshalErr := json.Unmarshal(storedVerificationBody, &storedVerification); unmarshalErr != nil {
			return unmarshalErr
		}
		if storedVerification.LoadID != verification.LoadID || storedVerification.CustomerID != verification.CustomerID ||
			storedVerification.DriverID != verification.DriverID || storedVerification.CodeHash != verification.CodeHash || storedVerification.Verified {
			return ErrLoadStatusConflict
		}
		if exists, existsErr := tx.Exists(s.ctx, photoKey).Result(); existsErr != nil {
			return existsErr
		} else if exists == 0 {
			return ErrInvalidLoadStatusTransition
		}
		if exists, existsErr := tx.Exists(s.ctx, eventKey).Result(); existsErr != nil {
			return existsErr
		} else if exists != 0 {
			return ErrLoadStatusConflict
		}

		_, txErr := tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(s.ctx, loadKey, loadBody, 0)
			pipe.Set(s.ctx, verificationKey, verificationBody, 0)
			pipe.Set(s.ctx, eventKey, eventBody, 0)
			pipe.ZAdd(s.ctx, "load-status-history:"+updated.ID, redis.Z{Score: float64(event.ChangedAt.UnixMicro()), Member: event.ID})
			return nil
		})
		return txErr
	}, loadKey, verificationKey, eventKey, photoKey)
	if errors.Is(err, redis.TxFailedErr) {
		return ErrLoadStatusConflict
	}
	return err
}

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

// CompleteDelivery retains the existing persistence contract for individual
// customers and tests that do not need a corporate reward.
func (s *RedisStore) CompleteDelivery(expectedStatus string, updated models.Load, event models.LoadStatusEvent, verification models.DeliveryVerification) error {
	_, err := s.CompleteDeliveryWithReward(expectedStatus, updated, event, verification, nil)
	return err
}

// CompleteDeliveryWithReward commits proof, load state, history and an
// optional corporate wallet reward atomically. A failed wallet write therefore
// cannot leave a completed corporate shipment without its ledger entry.
func (s *RedisStore) CompleteDeliveryWithReward(expectedStatus string, updated models.Load, event models.LoadStatusEvent, verification models.DeliveryVerification, rewardTemplate *models.WalletTransaction) (*models.WalletTransaction, error) {
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
		return nil, ErrInvalidLoadStatusTransition
	}

	loadBody, err := json.Marshal(updated)
	if err != nil {
		return nil, err
	}
	verificationBody, err := json.Marshal(verification)
	if err != nil {
		return nil, err
	}
	eventBody, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}
	loadKey := "load:" + updated.ID
	verificationKey := "load-delivery-verification:" + updated.ID
	eventKey := "load-status-event:" + event.ID
	photoKey := "photo:" + photoID
	watchKeys := []string{loadKey, verificationKey, eventKey, photoKey}

	var reward models.WalletTransaction
	var wallet models.CorporateWallet
	var company models.Company
	allocationKey, walletKey, rewardUniqueKey, rewardTransactionKey := "", "", "", ""
	if rewardTemplate != nil {
		reward = *rewardTemplate
		if reward.ID == "" || reward.CompanyID == "" || reward.LoadID != updated.ID || reward.Type != models.WalletTransactionShipmentReward || reward.CreatedAt.IsZero() {
			return nil, ErrCorporateAccountRequired
		}
		company, err = s.GetCompany(reward.CompanyID)
		if err != nil || company.OwnerCustomerID != updated.CustomerID {
			return nil, ErrCorporateAccountRequired
		}
		wallet, err = s.GetCorporateWallet(company.ID)
		if err != nil {
			return nil, err
		}
		allocationKey = "load-wallet:" + updated.ID
		walletKey = "wallet:" + wallet.ID
		rewardUniqueKey = walletUniqueKey(models.WalletTransactionShipmentReward, updated.ID)
		rewardTransactionKey = "wallet-transaction:" + reward.ID
		watchKeys = append(watchKeys, allocationKey, walletKey, rewardUniqueKey, rewardTransactionKey)
	}

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

		var walletBody, allocationBody, rewardBody []byte
		var allocation models.LoadWalletAllocation
		if rewardTemplate != nil {
			if exists, existsErr := tx.Exists(s.ctx, rewardUniqueKey, rewardTransactionKey).Result(); existsErr != nil {
				return existsErr
			} else if exists != 0 {
				return ErrLoadStatusConflict
			}
			storedWalletBody, walletErr := tx.Get(s.ctx, walletKey).Bytes()
			if walletErr != nil {
				return walletErr
			}
			if unmarshalErr := json.Unmarshal(storedWalletBody, &wallet); unmarshalErr != nil {
				return unmarshalErr
			}
			if wallet.CompanyID != company.ID {
				return ErrCorporateAccountRequired
			}
			storedAllocationBody, allocationErr := tx.Get(s.ctx, allocationKey).Bytes()
			if errors.Is(allocationErr, redis.Nil) {
				priceCents, valid := models.TLToCents(storedLoad.AgreedPriceTL)
				if !valid {
					return ErrWalletBalance
				}
				allocation = models.LoadWalletAllocation{
					LoadID: storedLoad.ID, CompanyID: company.ID, WalletID: wallet.ID,
					OriginalAmountCents: priceCents, NetEligibleAmountCents: priceCents,
					CreatedAt: reward.CreatedAt, UpdatedAt: reward.CreatedAt,
				}
			} else if allocationErr != nil {
				return allocationErr
			} else if unmarshalErr := json.Unmarshal(storedAllocationBody, &allocation); unmarshalErr != nil {
				return unmarshalErr
			}
			eligibleCents, rewardCents, valid := models.CorporateRewardCents(storedLoad.AgreedPriceTL, allocation.UsedCents)
			priceCents, priceValid := models.TLToCents(storedLoad.AgreedPriceTL)
			if !valid || !priceValid || allocation.CompanyID != company.ID || allocation.WalletID != wallet.ID || allocation.LoadID != storedLoad.ID ||
				allocation.OriginalAmountCents != priceCents || allocation.NetEligibleAmountCents != eligibleCents || allocation.UsageReversalTransactionID != "" || allocation.RewardTransactionID != "" ||
				wallet.BalanceCents > int64(^uint64(0)>>1)-rewardCents {
				return ErrWalletBalance
			}
			wallet.BalanceCents += rewardCents
			wallet.UpdatedAt = reward.CreatedAt
			allocation.RewardTransactionID = reward.ID
			allocation.UpdatedAt = reward.CreatedAt
			reward.WalletID = wallet.ID
			reward.AmountCents = rewardCents
			reward.BalanceAfterCents = wallet.BalanceCents
			walletBody, getErr = json.Marshal(wallet)
			if getErr != nil {
				return getErr
			}
			allocationBody, getErr = json.Marshal(allocation)
			if getErr != nil {
				return getErr
			}
			rewardBody, getErr = json.Marshal(reward)
			if getErr != nil {
				return getErr
			}
		}

		_, txErr := tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(s.ctx, loadKey, loadBody, 0)
			pipe.Set(s.ctx, verificationKey, verificationBody, 0)
			pipe.Set(s.ctx, eventKey, eventBody, 0)
			pipe.ZAdd(s.ctx, "load-status-history:"+updated.ID, redis.Z{Score: float64(event.ChangedAt.UnixMicro()), Member: event.ID})
			if rewardTemplate != nil {
				pipe.Set(s.ctx, walletKey, walletBody, 0)
				pipe.Set(s.ctx, allocationKey, allocationBody, 0)
				pipe.Set(s.ctx, rewardTransactionKey, rewardBody, 0)
				pipe.ZAdd(s.ctx, "wallet-transactions:"+wallet.ID, redis.Z{Score: float64(reward.CreatedAt.UnixMicro()), Member: reward.ID})
				pipe.Set(s.ctx, rewardUniqueKey, reward.ID, 0)
			}
			return nil
		})
		return txErr
	}, watchKeys...)
	if errors.Is(err, redis.TxFailedErr) {
		return nil, ErrLoadStatusConflict
	}
	if err != nil {
		return nil, err
	}
	if rewardTemplate == nil {
		return nil, nil
	}
	return &reward, nil
}

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

// EnsureDeliveryVerification returns the existing delivery verification or
// creates it once when an older accepted load does not yet have one.
// SetNX prevents an existing delivery code from ever being replaced.
func (s *RedisStore) EnsureDeliveryVerification(verification models.DeliveryVerification) (models.DeliveryVerification, error) {
	var empty models.DeliveryVerification

	if verification.LoadID == "" ||
		verification.CustomerID == "" ||
		verification.DriverID == "" ||
		verification.CodeHash == "" ||
		verification.CodeCiphertext == "" ||
		verification.CreatedAt.IsZero() {
		return empty, errors.New("invalid delivery verification")
	}

	existing, err := s.GetDeliveryVerification(verification.LoadID)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, redis.Nil) {
		return empty, err
	}

	body, err := json.Marshal(verification)
	if err != nil {
		return empty, err
	}

	key := "load-delivery-verification:" + verification.LoadID

	created, err := s.client.SetNX(s.ctx, key, body, 0).Result()
	if err != nil {
		return empty, err
	}

	if created {
		return verification, nil
	}

	// Başka bir istek aynı anda kaydı oluşturduysa mevcut olanı kullan.
	return s.GetDeliveryVerification(verification.LoadID)
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
	watchKeys := []string{loadKey, verificationKey, eventKey, photoKey, "load-wallet:" + updated.ID, "driver-wallet-transaction:" + updated.ID + ":CORPORATE_CREDIT_COMPENSATION"}

	watchKeys = append(watchKeys, driverWatchKeys(updated)...)
	var reward models.WalletTransaction
	var wallet models.CorporateWallet
	var company models.Company
	rewardEnabled := false
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
		owner, ownerErr := s.GetUser(company.OwnerCustomerID)
		if ownerErr != nil {
			return nil, ownerErr
		}
		if owner.CorporateStatus != "" && owner.CorporateStatus != models.CorporateStatusApproved {
			rewardTemplate = nil
		}
		if rewardTemplate == nil {
			goto rewardSetupDone
		}
		wallet, err = s.GetCorporateWallet(company.ID)
		if err != nil {
			return nil, err
		}
		allocationKey = "load-wallet:" + updated.ID
		walletKey = "wallet:" + wallet.ID
		rewardUniqueKey = walletUniqueKey(models.WalletTransactionShipmentReward, updated.ID)
		rewardTransactionKey = "wallet-transaction:" + reward.ID
		watchKeys = append(watchKeys, allocationKey, walletKey, rewardUniqueKey, rewardTransactionKey, walletPolicyKey, walletRateKey(company.ID))
	}
rewardSetupDone:

	err = s.watchPayment(func(tx *redis.Tx) error {
		storedLoadBody, getErr := tx.Get(s.ctx, loadKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedLoad models.Load
		if unmarshalErr := json.Unmarshal(storedLoadBody, &storedLoad); unmarshalErr != nil {
			return unmarshalErr
		}
		if e := s.requireDriverPaymentConsent(tx, storedLoad); e != nil {
			return e
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

		driverMutation, commissionErr := s.prepareDriverCommission(tx, storedLoad, "COMMISSION", event.ChangedByUserID, event.ChangedAt)
		if commissionErr != nil {
			return commissionErr
		}
		var compensation *models.DriverWalletTransaction
		if approval := storedLoad.PaymentApproval; approval != nil && approval.Status == "approved" && approval.CreditCents > 0 {
			price, valid := models.TLToCents(storedLoad.AgreedPriceTL)
			if !valid || approval.LoadID != storedLoad.ID || approval.DriverID != storedLoad.AssignedDriver || approval.DecidedAt == nil || approval.DecidedBy != storedLoad.AssignedDriver || approval.CreditCents <= 0 || approval.AmountCents != price || approval.CustomerPayableCents != price-approval.CreditCents || !samePaymentTerms(approval, updated.PaymentApproval) || approval.CompensationTransactionID != "" || driverMutation == nil {
				return ErrLoadStatusConflict
			}
			body, e := tx.Get(s.ctx, "load-wallet:"+storedLoad.ID).Bytes()
			if e != nil {
				return e
			}
			var allocation models.LoadWalletAllocation
			if e = json.Unmarshal(body, &allocation); e != nil {
				return e
			}
			if allocation.LoadID != storedLoad.ID || allocation.UsedCents != approval.CreditCents || allocation.OriginalAmountCents != price || allocation.NetEligibleAmountCents != approval.CustomerPayableCents || allocation.UsageTransactionID == "" || allocation.UsageReversalTransactionID != "" {
				return ErrLoadStatusConflict
			}
			entryID := storedLoad.ID + ":" + models.DriverTransactionCorporateCreditCompensation
			if n, e := tx.Exists(s.ctx, "driver-wallet-transaction:"+entryID).Result(); e != nil {
				return e
			} else if n != 0 {
				return ErrLoadStatusConflict
			}
			w := &driverMutation.wallet
			if w.BalanceCents > models.MaxWalletCents-approval.CreditCents {
				return ErrDriverWalletBalance
			}
			before := w.BalanceCents
			w.BalanceCents += approval.CreditCents
			w.AvailableCents = w.BalanceCents - w.ReservedCents
			compensation = &models.DriverWalletTransaction{ID: entryID, DriverID: w.DriverID, LoadID: storedLoad.ID, Type: models.DriverTransactionCorporateCreditCompensation, AmountCents: approval.CreditCents, BalanceBeforeCents: before, BalanceAfterCents: w.BalanceCents, ReservedAfterCents: w.ReservedCents, Reference: approval.ID, ActorID: event.ChangedByUserID, CreatedAt: event.ChangedAt}
			copied := *approval
			copied.CompensationTransactionID = entryID
			updated.PaymentApproval = &copied
			loadBody = mustJSON(updated)
		} else if storedLoad.PaymentApproval != nil && storedLoad.PaymentApproval.Status == "pending" {
			return ErrLoadStatusConflict
		}
		var walletBody, allocationBody, rewardBody []byte
		var allocation models.LoadWalletAllocation
		if rewardTemplate != nil {
			policy, policyErr := s.readWalletPolicy(tx)
			if policyErr != nil {
				return policyErr
			}
			rewardEnabled = policy.Enabled
			override, rateErr := s.readWalletRate(tx, company.ID)
			if rateErr != nil {
				return rateErr
			}
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
			priceCents, priceValid := models.TLToCents(storedLoad.AgreedPriceTL)
			eligibleCents := priceCents - allocation.UsedCents
			jobs, volume, progressErr := s.corporateProgress(company)
			if progressErr != nil {
				return progressErr
			}
			_, rate := policy.Rate(jobs, volume, override)
			rewardCents := models.WalletPercent(eligibleCents, rate, true)
			if !rewardEnabled {
				rewardCents = 0
			}
			if !priceValid || priceCents > models.MaxWalletCents || allocation.UsedCents < 0 || eligibleCents < 0 || allocation.CompanyID != company.ID || allocation.WalletID != wallet.ID || allocation.LoadID != storedLoad.ID ||
				allocation.OriginalAmountCents != priceCents || allocation.NetEligibleAmountCents != eligibleCents ||
				wallet.BalanceCents > models.MaxWalletCents-rewardCents {
				return ErrWalletBalance
			}
			// Another completion/cancellation can commit between WATCH reads.
			// Its ledger markers are a state conflict, never a balance error.
			if allocation.UsageReversalTransactionID != "" || allocation.RewardTransactionID != "" {
				return ErrLoadStatusConflict
			}
			reward.SchemaVersion = 1
			reward.CorporateCustomerID = company.OwnerCustomerID
			reward.RewardRateBps = rate
			reward.BalanceBeforeCents = wallet.BalanceCents
			wallet.BalanceCents += rewardCents
			wallet.UpdatedAt = reward.CreatedAt
			if rewardEnabled {
				allocation.RewardTransactionID = reward.ID
			}
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
			s.writeDriverCommission(pipe, driverMutation)
			if compensation != nil {
				pipe.Set(s.ctx, "driver-wallet-transaction:"+compensation.ID, mustJSON(compensation), 0)
				pipe.ZAdd(s.ctx, "driver-wallet-transactions:"+compensation.DriverID, redis.Z{Score: float64(compensation.CreatedAt.UnixMicro()), Member: compensation.ID})
				pipe.Set(s.ctx, "payment-approval:"+updated.PaymentApproval.ID, mustJSON(updated.PaymentApproval), 0)
			}
			pipe.Set(s.ctx, loadKey, loadBody, 0)
			pipe.Set(s.ctx, verificationKey, verificationBody, 0)
			pipe.Set(s.ctx, eventKey, eventBody, 0)
			pipe.ZAdd(s.ctx, "load-status-history:"+updated.ID, redis.Z{Score: float64(event.ChangedAt.UnixMicro()), Member: event.ID})
			if rewardTemplate != nil {
				pipe.Set(s.ctx, walletKey, walletBody, 0)
				pipe.Set(s.ctx, allocationKey, allocationBody, 0)
				if rewardEnabled {
					pipe.Set(s.ctx, rewardTransactionKey, rewardBody, 0)
					pipe.ZAdd(s.ctx, "wallet-transactions:"+wallet.ID, redis.Z{Score: float64(reward.CreatedAt.UnixMicro()), Member: reward.ID})
					pipe.Set(s.ctx, rewardUniqueKey, reward.ID, 0)
				}
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
	if rewardTemplate == nil || !rewardEnabled {
		return nil, nil
	}
	return &reward, nil
}

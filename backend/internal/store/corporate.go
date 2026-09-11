package store

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
)

var (
	ErrCorporateAccountRequired = errors.New("corporate account required")
	ErrWalletBalance            = errors.New("wallet balance is insufficient")
	ErrWalletUsageExists        = errors.New("wallet usage already exists")
	ErrWalletConflict           = errors.New("wallet changed concurrently")
	ErrFavoriteDriverExists     = errors.New("favorite driver already exists")
	ErrFavoriteDriverIneligible = errors.New("driver is not eligible for favorite")
)

func (s *RedisStore) CreateCorporateAccount(user models.User, company models.Company, wallet models.CorporateWallet) error {
	userBody, err := json.Marshal(user)
	if err != nil {
		return err
	}
	companyBody, err := json.Marshal(company)
	if err != nil {
		return err
	}
	walletBody, err := json.Marshal(wallet)
	if err != nil {
		return err
	}
	if user.Role != models.RoleCustomer || models.CustomerAccountType(user) != models.AccountTypeCorporate ||
		company.OwnerCustomerID != user.ID || wallet.CompanyID != company.ID || company.ID == "" || wallet.ID == "" {
		return ErrCorporateAccountRequired
	}
	script := redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[1])
redis.call('SET', KEYS[3], ARGV[2])
redis.call('SET', KEYS[4], ARGV[3])
redis.call('SET', KEYS[5], ARGV[4])
redis.call('SET', KEYS[6], ARGV[5])
redis.call('SET', KEYS[7], ARGV[6])
return 1`)
	created, err := script.Run(s.ctx, s.client, []string{
		"user-email:" + strings.ToLower(user.Email),
		"user-phone:" + user.Phone,
		"user:" + user.ID,
		"company:user:" + user.ID,
		"company:" + company.ID,
		"wallet:company:" + company.ID,
		"wallet:" + wallet.ID,
	}, user.ID, userBody, company.ID, companyBody, wallet.ID, walletBody).Int64()
	if err != nil {
		return err
	}
	if created != 1 {
		return ErrUserExists
	}
	return nil
}

func (s *RedisStore) GetCompany(id string) (models.Company, error) {
	var company models.Company
	body, err := s.client.Get(s.ctx, "company:"+id).Bytes()
	if err != nil {
		return company, err
	}
	return company, json.Unmarshal(body, &company)
}

func (s *RedisStore) GetCompanyByUser(userID string) (models.Company, error) {
	companyID, err := s.client.Get(s.ctx, "company:user:"+userID).Result()
	if err != nil {
		return models.Company{}, err
	}
	return s.GetCompany(companyID)
}

func (s *RedisStore) SaveCompany(company models.Company) error {
	body, err := json.Marshal(company)
	if err != nil {
		return err
	}
	ownerCompanyID, err := s.client.Get(s.ctx, "company:user:"+company.OwnerCustomerID).Result()
	if err != nil || ownerCompanyID != company.ID {
		return ErrCorporateAccountRequired
	}
	return s.client.Set(s.ctx, "company:"+company.ID, body, 0).Err()
}

func (s *RedisStore) GetCorporateWallet(companyID string) (models.CorporateWallet, error) {
	walletID, err := s.client.Get(s.ctx, "wallet:company:"+companyID).Result()
	if err != nil {
		return models.CorporateWallet{}, err
	}
	var wallet models.CorporateWallet
	body, err := s.client.Get(s.ctx, "wallet:"+walletID).Bytes()
	if err != nil {
		return wallet, err
	}
	return wallet, json.Unmarshal(body, &wallet)
}

func (s *RedisStore) GetWalletTransaction(id string) (models.WalletTransaction, error) {
	var transaction models.WalletTransaction
	body, err := s.client.Get(s.ctx, "wallet-transaction:"+id).Bytes()
	if err != nil {
		return transaction, err
	}
	return transaction, json.Unmarshal(body, &transaction)
}

func (s *RedisStore) ListWalletTransactions(walletID string) ([]models.WalletTransaction, error) {
	ids, err := s.client.ZRevRange(s.ctx, "wallet-transactions:"+walletID, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	transactions := make([]models.WalletTransaction, 0, len(ids))
	for _, id := range ids {
		transaction, getErr := s.GetWalletTransaction(id)
		if getErr == nil && transaction.WalletID == walletID {
			transactions = append(transactions, transaction)
		}
	}
	return transactions, nil
}

func (s *RedisStore) GetLoadWalletAllocation(loadID string) (models.LoadWalletAllocation, error) {
	var allocation models.LoadWalletAllocation
	body, err := s.client.Get(s.ctx, "load-wallet:"+loadID).Bytes()
	if err != nil {
		return allocation, err
	}
	return allocation, json.Unmarshal(body, &allocation)
}

func walletUniqueKey(transactionType, loadID string) string {
	return "wallet-transaction-unique:" + transactionType + ":" + loadID
}

func (s *RedisStore) ApplyWalletCredit(company models.Company, requestedLoad models.Load, amountCents int64, transaction models.WalletTransaction) (models.CorporateWallet, models.LoadWalletAllocation, models.WalletTransaction, error) {
	if company.ID == "" || company.OwnerCustomerID != requestedLoad.CustomerID || amountCents <= 0 || transaction.ID == "" ||
		transaction.Type != models.WalletTransactionShipmentUsage || transaction.LoadID != requestedLoad.ID || transaction.CompanyID != company.ID || transaction.CreatedAt.IsZero() {
		return models.CorporateWallet{}, models.LoadWalletAllocation{}, models.WalletTransaction{}, ErrCorporateAccountRequired
	}
	wallet, err := s.GetCorporateWallet(company.ID)
	if err != nil {
		return models.CorporateWallet{}, models.LoadWalletAllocation{}, models.WalletTransaction{}, err
	}
	loadKey := "load:" + requestedLoad.ID
	walletKey := "wallet:" + wallet.ID
	allocationKey := "load-wallet:" + requestedLoad.ID
	uniqueKey := walletUniqueKey(models.WalletTransactionShipmentUsage, requestedLoad.ID)
	transactionKey := "wallet-transaction:" + transaction.ID
	err = s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		loadBody, getErr := tx.Get(s.ctx, loadKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedLoad models.Load
		if unmarshalErr := json.Unmarshal(loadBody, &storedLoad); unmarshalErr != nil {
			return unmarshalErr
		}
		if storedLoad.CustomerID != company.OwnerCustomerID || models.CanonicalLoadStatus(storedLoad.Status) != models.LoadStatusDriverSelected || storedLoad.DeletedAt != nil {
			return ErrInvalidLoadStatusTransition
		}
		priceCents, validPrice := models.TLToCents(storedLoad.AgreedPriceTL)
		if !validPrice || amountCents > priceCents {
			return ErrWalletBalance
		}
		if exists, existsErr := tx.Exists(s.ctx, allocationKey, uniqueKey).Result(); existsErr != nil {
			return existsErr
		} else if exists != 0 {
			return ErrWalletUsageExists
		}
		walletBody, getErr := tx.Get(s.ctx, walletKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedWallet models.CorporateWallet
		if unmarshalErr := json.Unmarshal(walletBody, &storedWallet); unmarshalErr != nil {
			return unmarshalErr
		}
		if storedWallet.CompanyID != company.ID || storedWallet.BalanceCents < amountCents {
			return ErrWalletBalance
		}
		storedWallet.BalanceCents -= amountCents
		storedWallet.UpdatedAt = transaction.CreatedAt
		allocation := models.LoadWalletAllocation{
			LoadID: requestedLoad.ID, CompanyID: company.ID, WalletID: storedWallet.ID,
			OriginalAmountCents: priceCents, UsedCents: amountCents, NetEligibleAmountCents: priceCents - amountCents,
			UsageTransactionID: transaction.ID, CreatedAt: transaction.CreatedAt, UpdatedAt: transaction.CreatedAt,
		}
		transaction.WalletID = storedWallet.ID
		transaction.AmountCents = -amountCents
		transaction.BalanceAfterCents = storedWallet.BalanceCents
		walletBody, getErr = json.Marshal(storedWallet)
		if getErr != nil {
			return getErr
		}
		allocationBody, getErr := json.Marshal(allocation)
		if getErr != nil {
			return getErr
		}
		transactionBody, getErr := json.Marshal(transaction)
		if getErr != nil {
			return getErr
		}
		_, txErr := tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(s.ctx, walletKey, walletBody, 0)
			pipe.Set(s.ctx, allocationKey, allocationBody, 0)
			pipe.Set(s.ctx, transactionKey, transactionBody, 0)
			pipe.ZAdd(s.ctx, "wallet-transactions:"+storedWallet.ID, redis.Z{Score: float64(transaction.CreatedAt.UnixMicro()), Member: transaction.ID})
			pipe.Set(s.ctx, uniqueKey, transaction.ID, 0)
			wallet = storedWallet
			return nil
		})
		return txErr
	}, loadKey, walletKey, allocationKey, uniqueKey, transactionKey)
	if errors.Is(err, redis.TxFailedErr) {
		err = ErrWalletConflict
	}
	if err != nil {
		return models.CorporateWallet{}, models.LoadWalletAllocation{}, models.WalletTransaction{}, err
	}
	allocation, err := s.GetLoadWalletAllocation(requestedLoad.ID)
	return wallet, allocation, transaction, err
}

// TransitionLoadStatusAndReverseWallet keeps a cancellation and its immutable
// credit reversal in one optimistic Redis transaction. It is used by both the
// customer and admin cancellation paths.
func (s *RedisStore) TransitionLoadStatusAndReverseWallet(expectedStatus string, updated models.Load, event models.LoadStatusEvent, company *models.Company, transaction models.WalletTransaction) (*models.WalletTransaction, error) {
	if company == nil {
		return nil, s.TransitionLoadStatus(expectedStatus, updated, event)
	}
	allocation, err := s.GetLoadWalletAllocation(updated.ID)
	if errors.Is(err, redis.Nil) {
		return nil, s.TransitionLoadStatus(expectedStatus, updated, event)
	}
	if err != nil {
		return nil, err
	}
	if updated.Status != models.LoadStatusCancelled || company.OwnerCustomerID != updated.CustomerID || allocation.CompanyID != company.ID || allocation.UsedCents <= 0 ||
		transaction.ID == "" || transaction.Type != models.WalletTransactionReversal || transaction.LoadID != updated.ID || transaction.CompanyID != company.ID || transaction.CreatedAt.IsZero() {
		return nil, ErrInvalidLoadStatusTransition
	}
	wallet, err := s.GetCorporateWallet(company.ID)
	if err != nil {
		return nil, err
	}
	expectedStatus = models.CanonicalLoadStatus(expectedStatus)
	event = normalizeLoadStatusEvent(event)
	if event.LoadID != updated.ID || models.CanonicalLoadStatus(event.FromStatus) != expectedStatus || event.ToStatus != updated.Status ||
		event.ChangedByUserID == "" || event.ChangedByRole == "" || event.Source == "" || event.ChangedAt.IsZero() || !models.CanTransition(expectedStatus, updated.Status) {
		return nil, ErrInvalidLoadStatusTransition
	}
	loadBody, err := json.Marshal(updated)
	if err != nil {
		return nil, err
	}
	eventBody, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}
	loadKey := "load:" + updated.ID
	eventKey := "load-status-event:" + event.ID
	walletKey := "wallet:" + wallet.ID
	allocationKey := "load-wallet:" + updated.ID
	uniqueKey := walletUniqueKey(models.WalletTransactionReversal, updated.ID)
	transactionKey := "wallet-transaction:" + transaction.ID
	err = s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		storedLoadBody, getErr := tx.Get(s.ctx, loadKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedLoad models.Load
		if unmarshalErr := json.Unmarshal(storedLoadBody, &storedLoad); unmarshalErr != nil {
			return unmarshalErr
		}
		if models.CanonicalLoadStatus(storedLoad.Status) != expectedStatus || storedLoad.CustomerID != company.OwnerCustomerID || !models.CanTransition(storedLoad.Status, updated.Status) {
			return ErrLoadStatusConflict
		}
		storedAllocationBody, getErr := tx.Get(s.ctx, allocationKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedAllocation models.LoadWalletAllocation
		if unmarshalErr := json.Unmarshal(storedAllocationBody, &storedAllocation); unmarshalErr != nil {
			return unmarshalErr
		}
		if storedAllocation.CompanyID != company.ID || storedAllocation.WalletID != wallet.ID || storedAllocation.UsedCents <= 0 || storedAllocation.UsageReversalTransactionID != "" {
			return ErrWalletUsageExists
		}
		if exists, existsErr := tx.Exists(s.ctx, eventKey, uniqueKey, transactionKey).Result(); existsErr != nil {
			return existsErr
		} else if exists != 0 {
			return ErrLoadStatusConflict
		}
		storedWalletBody, getErr := tx.Get(s.ctx, walletKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedWallet models.CorporateWallet
		if unmarshalErr := json.Unmarshal(storedWalletBody, &storedWallet); unmarshalErr != nil {
			return unmarshalErr
		}
		if storedWallet.CompanyID != company.ID || storedWallet.BalanceCents > int64(^uint64(0)>>1)-storedAllocation.UsedCents {
			return ErrWalletBalance
		}
		storedWallet.BalanceCents += storedAllocation.UsedCents
		storedWallet.UpdatedAt = transaction.CreatedAt
		storedAllocation.UsageReversalTransactionID = transaction.ID
		storedAllocation.UpdatedAt = transaction.CreatedAt
		transaction.WalletID = storedWallet.ID
		transaction.AmountCents = storedAllocation.UsedCents
		transaction.BalanceAfterCents = storedWallet.BalanceCents
		walletBody, marshalErr := json.Marshal(storedWallet)
		if marshalErr != nil {
			return marshalErr
		}
		allocationBody, marshalErr := json.Marshal(storedAllocation)
		if marshalErr != nil {
			return marshalErr
		}
		transactionBody, marshalErr := json.Marshal(transaction)
		if marshalErr != nil {
			return marshalErr
		}
		_, txErr := tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(s.ctx, loadKey, loadBody, 0)
			pipe.Set(s.ctx, eventKey, eventBody, 0)
			pipe.ZAdd(s.ctx, "load-status-history:"+updated.ID, redis.Z{Score: float64(event.ChangedAt.UnixMicro()), Member: event.ID})
			pipe.Set(s.ctx, walletKey, walletBody, 0)
			pipe.Set(s.ctx, allocationKey, allocationBody, 0)
			pipe.Set(s.ctx, transactionKey, transactionBody, 0)
			pipe.ZAdd(s.ctx, "wallet-transactions:"+storedWallet.ID, redis.Z{Score: float64(transaction.CreatedAt.UnixMicro()), Member: transaction.ID})
			pipe.Set(s.ctx, uniqueKey, transaction.ID, 0)
			return nil
		})
		return txErr
	}, loadKey, eventKey, walletKey, allocationKey, uniqueKey, transactionKey)
	if errors.Is(err, redis.TxFailedErr) {
		err = ErrWalletConflict
	}
	if err != nil {
		return nil, err
	}
	return &transaction, nil
}

func (s *RedisStore) HasCompletedLoadWithDriver(customerID, driverID string) (bool, error) {
	loads, _, err := s.ListLoads(customerID, "", LoadFilter{Status: models.LoadStatusCompleted}, 0, 0)
	if err != nil {
		return false, err
	}
	for _, load := range loads {
		if load.AssignedDriver == driverID {
			return true, nil
		}
	}
	return false, nil
}

func (s *RedisStore) AddFavoriteDriver(favorite models.FavoriteDriver) error {
	if favorite.CompanyID == "" || favorite.DriverID == "" || favorite.CreatedAt.IsZero() {
		return ErrFavoriteDriverIneligible
	}
	body, err := json.Marshal(favorite)
	if err != nil {
		return err
	}
	script := redis.NewScript(`
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 0 end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
return 1`)
	added, err := script.Run(s.ctx, s.client, []string{
		"favorite-drivers:company:" + favorite.CompanyID,
		"favorite-driver:" + favorite.CompanyID + ":" + favorite.DriverID,
	}, favorite.DriverID, body).Int64()
	if err != nil {
		return err
	}
	if added != 1 {
		return ErrFavoriteDriverExists
	}
	return nil
}

func (s *RedisStore) RemoveFavoriteDriver(companyID, driverID string) error {
	pipe := s.client.TxPipeline()
	pipe.SRem(s.ctx, "favorite-drivers:company:"+companyID, driverID)
	pipe.Del(s.ctx, "favorite-driver:"+companyID+":"+driverID)
	_, err := pipe.Exec(s.ctx)
	return err
}

func (s *RedisStore) ListFavoriteDrivers(companyID string) ([]models.FavoriteDriver, error) {
	driverIDs, err := s.client.SMembers(s.ctx, "favorite-drivers:company:"+companyID).Result()
	if err != nil {
		return nil, err
	}
	favorites := make([]models.FavoriteDriver, 0, len(driverIDs))
	for _, driverID := range driverIDs {
		var favorite models.FavoriteDriver
		body, getErr := s.client.Get(s.ctx, "favorite-driver:"+companyID+":"+driverID).Bytes()
		if getErr == nil && json.Unmarshal(body, &favorite) == nil {
			favorites = append(favorites, favorite)
		}
	}
	sort.Slice(favorites, func(i, j int) bool { return favorites[i].CreatedAt.After(favorites[j].CreatedAt) })
	return favorites, nil
}

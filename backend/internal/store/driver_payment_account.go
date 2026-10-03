package store

import (
	"encoding/json"
	"errors"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
)

const driverPaymentAccountKey = "driver-wallet:payment-account:v1"

func (s *RedisStore) GetDriverPaymentAccount() (models.DriverPaymentAccount, error) {
	var account models.DriverPaymentAccount
	b, err := s.client.Get(s.ctx, driverPaymentAccountKey).Bytes()
	if errors.Is(err, redis.Nil) {
		return account, nil
	}
	if err != nil {
		return account, err
	}
	err = json.Unmarshal(b, &account)
	return account, err
}

func (s *RedisStore) SaveDriverPaymentAccount(account models.DriverPaymentAccount) error {
	if err := account.Validate(); err != nil {
		return err
	}
	b, err := json.Marshal(account)
	if err != nil {
		return err
	}
	return s.client.Set(s.ctx, driverPaymentAccountKey, b, 0).Err()
}

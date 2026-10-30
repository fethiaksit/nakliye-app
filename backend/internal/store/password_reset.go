package store

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type PasswordResetRecord struct {
	UserID     string    `json:"userId"`
	Email      string    `json:"email"`
	HashedCode string    `json:"hashedCode"`
	Role       string    `json:"role,omitempty"`
	Attempts   int       `json:"attempts"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

type PasswordResetTokenRecord struct {
	UserID    string    `json:"userId"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *RedisStore) SavePasswordResetCode(record PasswordResetRecord, ttl time.Duration) error {
	b, err := json.Marshal(record)
	if err != nil {
		return err
	}
	key := "pwdreset:code:" + strings.ToLower(strings.TrimSpace(record.Email))
	return s.watchPayment(func(tx *redis.Tx) error {
		_, err := tx.TxPipelined(s.ctx, func(p redis.Pipeliner) error { p.Set(s.ctx, key, b, ttl); return nil })
		return err
	}, "user:"+record.UserID)
}

func (s *RedisStore) GetPasswordResetCode(email string) (*PasswordResetRecord, error) {
	key := "pwdreset:code:" + strings.ToLower(strings.TrimSpace(email))
	b, err := s.client.Get(s.ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	var record PasswordResetRecord
	if err := json.Unmarshal(b, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

func (s *RedisStore) IncrementResetAttempts(email string) (int, error) {
	key := "pwdreset:code:" + strings.ToLower(strings.TrimSpace(email))
	script := redis.NewScript(`
local val = redis.call('GET', KEYS[1])
if not val then
  return -1
end
local rec = cjson.decode(val)
rec.attempts = (rec.attempts or 0) + 1
local ttl = redis.call('TTL', KEYS[1])
local encoded = cjson.encode(rec)
if ttl > 0 then
  redis.call('SET', KEYS[1], encoded, 'EX', ttl)
else
  redis.call('SET', KEYS[1], encoded)
end
return rec.attempts
`)
	attempts, err := script.Run(s.ctx, s.client, []string{key}).Int64()
	if err != nil {
		return 0, err
	}
	return int(attempts), nil
}

func (s *RedisStore) DeletePasswordResetCode(email string) error {
	key := "pwdreset:code:" + strings.ToLower(strings.TrimSpace(email))
	return s.client.Del(s.ctx, key).Err()
}

func (s *RedisStore) SavePasswordResetToken(token string, record PasswordResetTokenRecord, ttl time.Duration) error {
	b, err := json.Marshal(record)
	if err != nil {
		return err
	}
	key := "pwdreset:token:" + strings.TrimSpace(token)
	return s.watchPayment(func(tx *redis.Tx) error {
		_, err := tx.TxPipelined(s.ctx, func(p redis.Pipeliner) error { p.Set(s.ctx, key, b, ttl); return nil })
		return err
	}, "user:"+record.UserID)
}

func (s *RedisStore) ConsumePasswordResetToken(token string) (*PasswordResetTokenRecord, error) {
	key := "pwdreset:token:" + strings.TrimSpace(token)
	b, err := s.client.GetDel(s.ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	var record PasswordResetTokenRecord
	if err := json.Unmarshal(b, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

func (s *RedisStore) RevokeAllUserSessions(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return nil
	}
	key := "user-refresh:" + userID
	tokens, err := s.client.SMembers(s.ctx, key).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return err
	}
	pipe := s.client.TxPipeline()
	for _, tok := range tokens {
		pipe.Del(s.ctx, "refresh:"+tok)
	}
	pipe.Del(s.ctx, key)
	_, err = pipe.Exec(s.ctx)
	return err
}

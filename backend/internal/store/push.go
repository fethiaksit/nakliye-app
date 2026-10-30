package store

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
)

func (s *RedisStore) SavePushToken(token models.PushToken) error {
	key := "push-token:" + token.ExpoPushToken
	return s.watchPush(func(tx *redis.Tx) error {
		if err := s.guardAccounts(tx, token.UserID); err != nil {
			return err
		}
		var previous models.PushToken
		body, err := tx.Get(s.ctx, key).Bytes()
		if err != nil && err != redis.Nil {
			return err
		}
		if err == nil {
			if err = json.Unmarshal(body, &previous); err != nil {
				return err
			}
		}
		body, err = json.Marshal(token)
		if err != nil {
			return err
		}
		_, err = tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			if previous.UserID != "" && previous.UserID != token.UserID {
				pipe.SRem(s.ctx, "user-push-tokens:"+previous.UserID, token.ExpoPushToken)
			}
			pipe.Set(s.ctx, key, body, 0)
			pipe.SAdd(s.ctx, "user-push-tokens:"+token.UserID, token.ExpoPushToken)
			return nil
		})
		return err
	}, key)
}

func (s *RedisStore) watchPush(fn func(*redis.Tx) error, keys ...string) error {
	var err error
	for i := 0; i < 8; i++ {
		err = s.client.Watch(s.ctx, fn, keys...)
		if err != redis.TxFailedErr {
			return err
		}
	}
	return err
}

func (s *RedisStore) ListPushTokens(userID string) ([]models.PushToken, error) {
	values, err := s.client.SMembers(s.ctx, "user-push-tokens:"+userID).Result()
	if err != nil {
		return nil, err
	}
	tokens := make([]models.PushToken, 0, len(values))
	for _, value := range values {
		var token models.PushToken
		body, getErr := s.client.Get(s.ctx, "push-token:"+value).Bytes()
		if getErr == nil && json.Unmarshal(body, &token) == nil && token.UserID == userID {
			tokens = append(tokens, token)
		}
	}
	return tokens, nil
}

func (s *RedisStore) DeletePushToken(userID, token string) error {
	return s.deletePushToken(userID, token, nil)
}

// A late APNs failure cannot delete a token registered again or reassigned since
// the original send. Logout and account cleanup also preserve a new owner.
func (s *RedisStore) DeletePushTokenIfCurrent(token models.PushToken) error {
	return s.deletePushToken(token.UserID, token.ExpoPushToken, &token.UpdatedAt)
}
func (s *RedisStore) deletePushToken(userID, token string, updatedAt *time.Time) error {
	key := "push-token:" + token
	return s.watchPush(func(tx *redis.Tx) error {
		var stored models.PushToken
		body, err := tx.Get(s.ctx, key).Bytes()
		if err != nil && err != redis.Nil {
			return err
		}
		if err == nil {
			if err = json.Unmarshal(body, &stored); err != nil {
				return err
			}
			if stored.UserID != userID || updatedAt != nil && !stored.UpdatedAt.Equal(*updatedAt) {
				return nil
			}
		}
		_, err = tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			pipe.Del(s.ctx, key)
			pipe.SRem(s.ctx, "user-push-tokens:"+userID, token)
			return nil
		})
		return err
	}, key)
}

func (s *RedisStore) MarkPushOnce(key string) (bool, error) {
	return s.client.SetNX(s.ctx, "push-once:"+key, "1", 30*24*time.Hour).Result()
}

func (s *RedisStore) RevokeAllUserPushTokens(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return nil
	}
	values, err := s.client.SMembers(s.ctx, "user-push-tokens:"+userID).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	for _, token := range values {
		if err := s.DeletePushToken(userID, token); err != nil {
			return err
		}
	}
	return nil
}

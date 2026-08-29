package store

import (
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
)

func (s *RedisStore) SavePushToken(token models.PushToken) error {
	key := "push-token:" + token.ExpoPushToken
	var previous models.PushToken
	if body, err := s.client.Get(s.ctx, key).Bytes(); err == nil {
		_ = json.Unmarshal(body, &previous)
	}
	body, err := json.Marshal(token)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	if previous.UserID != "" && previous.UserID != token.UserID {
		pipe.SRem(s.ctx, "user-push-tokens:"+previous.UserID, token.ExpoPushToken)
	}
	pipe.Set(s.ctx, key, body, 0)
	pipe.SAdd(s.ctx, "user-push-tokens:"+token.UserID, token.ExpoPushToken)
	_, err = pipe.Exec(s.ctx)
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
	var stored models.PushToken
	body, err := s.client.Get(s.ctx, "push-token:"+token).Bytes()
	if err != nil && err != redis.Nil {
		return err
	}
	if err == nil && (json.Unmarshal(body, &stored) != nil || stored.UserID != userID) {
		return nil
	}
	pipe := s.client.TxPipeline()
	pipe.Del(s.ctx, "push-token:"+token)
	pipe.SRem(s.ctx, "user-push-tokens:"+userID, token)
	_, err = pipe.Exec(s.ctx)
	return err
}

func (s *RedisStore) MarkPushOnce(key string) (bool, error) {
	return s.client.SetNX(s.ctx, "push-once:"+key, "1", 30*24*time.Hour).Result()
}

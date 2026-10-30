package store

import (
	"encoding/json"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"strconv"
	"time"
)

type PushReceipt struct {
	ID          string           `json:"id"`
	Token       models.PushToken `json:"token"`
	CreatedAt   time.Time        `json:"createdAt"`
	NextCheckAt time.Time        `json:"nextCheckAt"`
}

func (s *RedisStore) SavePushReceipt(r PushReceipt) error {
	body, err := json.Marshal(r)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	// Keep the record long enough to report unavailable receipts after 24 hours.
	ttl := time.Until(r.CreatedAt.Add(48 * time.Hour))
	if ttl <= 0 {
		ttl = time.Hour
	}
	pipe.Set(s.ctx, "push-receipt:"+r.ID, body, ttl)
	pipe.ZAdd(s.ctx, "push-receipts-due", redis.Z{Score: float64(r.NextCheckAt.Unix()), Member: r.ID})
	_, err = pipe.Exec(s.ctx)
	return err
}
func (s *RedisStore) DuePushReceipts(now time.Time) ([]PushReceipt, error) {
	ids, err := s.client.ZRangeByScore(s.ctx, "push-receipts-due", &redis.ZRangeBy{Min: "-inf", Max: strconv.FormatInt(now.Unix(), 10), Count: 1000}).Result()
	if err != nil {
		return nil, err
	}
	records := make([]PushReceipt, 0, len(ids))
	for _, id := range ids {
		body, e := s.client.Get(s.ctx, "push-receipt:"+id).Bytes()
		if e == redis.Nil {
			if e = s.FinishPushReceipt(id); e != nil {
				return nil, e
			}
			continue
		}
		if e != nil {
			return nil, e
		}
		var r PushReceipt
		if e = json.Unmarshal(body, &r); e != nil {
			return nil, e
		}
		records = append(records, r)
	}
	return records, nil
}
func (s *RedisStore) FinishPushReceipt(id string) error {
	pipe := s.client.TxPipeline()
	pipe.Del(s.ctx, "push-receipt:"+id)
	pipe.ZRem(s.ctx, "push-receipts-due", id)
	_, err := pipe.Exec(s.ctx)
	return err
}

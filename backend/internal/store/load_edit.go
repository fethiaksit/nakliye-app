package store

import (
	"encoding/json"
	"errors"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"reflect"
)

// SaveLoadIfUnchanged protects non-status edits against overwriting an accepted,
// cancelled or completed job and its commission snapshot with a stale load.
func (s *RedisStore) SaveLoadIfUnchanged(expected, updated models.Load) error {
	if expected.ID == "" || expected.ID != updated.ID || expected.CustomerID != updated.CustomerID {
		return ErrLoadStatusConflict
	}
	key := "load:" + expected.ID
	err := s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		b, e := tx.Get(s.ctx, key).Bytes()
		if e != nil {
			return e
		}
		var stored models.Load
		if e = json.Unmarshal(b, &stored); e != nil {
			return e
		}
		stored.Status = models.CanonicalLoadStatus(stored.Status)
		if stored.DeletedAt != nil || !reflect.DeepEqual(stored, expected) {
			return ErrLoadStatusConflict
		}
		b, e = json.Marshal(updated)
		if e != nil {
			return e
		}
		_, e = tx.TxPipelined(s.ctx, func(p redis.Pipeliner) error { p.Set(s.ctx, key, b, 0); return nil })
		return e
	}, key)
	if errors.Is(err, redis.TxFailedErr) {
		return ErrLoadStatusConflict
	}
	return err
}

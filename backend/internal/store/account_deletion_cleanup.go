package store

import (
	"encoding/json"
	"fmt"
	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
	"strings"
)

// Only operational credentials and unreferenced uploads are removed. Historical
// job/message/complaint, verified document and financial evidence stays intact.
func (s *RedisStore) CleanupAccountTransientData(u models.User) error {
	current, err := s.GetUser(u.ID)
	if err != nil {
		return err
	}
	if current.AccountStatus != models.AccountStatusDeleting {
		return ErrAccountUnavailable
	}
	retained := map[string]bool{}
	docs, err := s.AccountDeletionDocuments(u.ID)
	if err != nil {
		return err
	}
	for _, d := range docs {
		if d.FileURL != "" {
			retained[strings.TrimPrefix(d.FileURL, "/api/photos/")] = true
		}
	}
	var cursor uint64
	for {
		keys, next, err := s.client.Scan(s.ctx, cursor, "photo:*", 100).Result()
		if err != nil {
			return err
		}
		for _, key := range keys {
			fields, err := s.client.HMGet(s.ctx, key, "ownerID", "loadID").Result()
			if err != nil {
				return err
			}
			if len(fields) != 2 || fields[0] != u.ID {
				continue
			}
			pid := strings.TrimPrefix(key, "photo:")
			if retained[pid] || (fields[1] != nil && fields[1] != "") {
				continue
			}
			claimed, err := s.client.Exists(s.ctx, "message-attachment:"+pid).Result()
			if err != nil {
				return err
			}
			if claimed != 0 {
				continue
			}
			if err := s.client.Del(s.ctx, key).Err(); err != nil {
				return err
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	// Reset codes and bearer reset tokens are not legal/financial evidence.
	if err := s.client.Del(s.ctx, "pwdreset:code:"+strings.ToLower(u.Email)).Err(); err != nil {
		return err
	}
	cursor = 0
	for {
		keys, next, err := s.client.Scan(s.ctx, cursor, "pwdreset:token:*", 100).Result()
		if err != nil {
			return err
		}
		for _, key := range keys {
			b, err := s.client.Get(s.ctx, key).Bytes()
			if err == redis.Nil {
				continue
			}
			if err != nil {
				return err
			}
			var r PasswordResetTokenRecord
			if err = json.Unmarshal(b, &r); err != nil {
				return fmt.Errorf("unreadable reset token: %w", err)
			}
			if r.UserID == u.ID {
				if err := s.client.Del(s.ctx, key).Err(); err != nil {
					return err
				}
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return nil
}

// Deletion uses strict reads; an unreadable referenced file must not become an orphan.
func (s *RedisStore) AccountDeletionDocuments(id string) ([]models.DriverDocument, error) {
	ids, err := s.client.SMembers(s.ctx, "driver-documents:driver:"+id).Result()
	if err != nil {
		return nil, err
	}
	out := make([]models.DriverDocument, 0, len(ids))
	for _, did := range ids {
		d, err := s.GetDriverDocument(did)
		if err != nil {
			return nil, err
		}
		if d.ID == "" || d.DriverID != id {
			return nil, fmt.Errorf("invalid driver document")
		}
		out = append(out, d)
	}
	return out, nil
}
func (s *RedisStore) AccountDeletionVehicles(id string) ([]models.Vehicle, error) {
	ids, err := s.client.SMembers(s.ctx, "vehicles:driver:"+id).Result()
	if err != nil {
		return nil, err
	}
	out := make([]models.Vehicle, 0, len(ids))
	for _, vid := range ids {
		v, err := s.GetVehicle(vid)
		if err != nil {
			return nil, err
		}
		if v.ID == "" || v.DriverID != id {
			return nil, fmt.Errorf("invalid vehicle")
		}
		out = append(out, v)
	}
	return out, nil
}

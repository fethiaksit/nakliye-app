package store

import (
	"encoding/json"
	"fmt"
	"nakliye-api/internal/models"
)

// Unlike a best-effort listing, deletion must not silently skip unreadable jobs.
func (s *RedisStore) AccountDeletionLoads(userID string) ([]models.Load, error) {
	ids, err := s.client.ZRange(s.ctx, "loads", 0, -1).Result()
	if err != nil {
		return nil, err
	}
	result := make([]models.Load, 0)
	for _, id := range ids {
		raw, err := s.client.Get(s.ctx, "load:"+id).Bytes()
		if err != nil {
			return nil, err
		}
		var l models.Load
		if err := json.Unmarshal(raw, &l); err != nil {
			return nil, err
		}
		if l.ID == "" {
			return nil, fmt.Errorf("invalid load record")
		}
		if l.CustomerID == userID || l.AssignedDriver == userID || (l.PaymentApproval != nil && l.PaymentApproval.DriverID == userID && l.PaymentApproval.Status == "pending") {
			result = append(result, l)
		}
	}
	// Pending bids on open jobs must be withdrawn before the driver closes.
	offerIDs, err := s.client.SMembers(s.ctx, "offers:driver:"+userID).Result()
	if err != nil {
		return nil, err
	}
	for _, id := range offerIDs {
		raw, err := s.client.Get(s.ctx, "offer:"+id).Bytes()
		if err != nil {
			return nil, err
		}
		var offer models.Offer
		if err := json.Unmarshal(raw, &offer); err != nil {
			return nil, err
		}
		if offer.Status != "pending" {
			continue
		}
		load, err := s.GetLoad(offer.LoadID)
		if err != nil {
			return nil, err
		}
		if models.CanonicalLoadStatus(load.Status) == models.LoadStatusPublished {
			result = append(result, load)
		}
	}

	return result, nil
}

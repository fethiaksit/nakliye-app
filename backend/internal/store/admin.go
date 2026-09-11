package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
)

func (s *RedisStore) scanKeys(pattern string) ([]string, error) {
	keys := make([]string, 0)
	var cursor uint64
	for {
		batch, next, err := s.client.Scan(s.ctx, cursor, pattern, 200).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 {
			return keys, nil
		}
	}
}

func (s *RedisStore) ListAllUsers() ([]models.User, error) {
	keys, err := s.scanKeys("user:*")
	if err != nil {
		return nil, err
	}
	users := make([]models.User, 0, len(keys))
	for _, key := range keys {
		body, getErr := s.client.Get(s.ctx, key).Bytes()
		if getErr != nil {
			continue
		}
		var user models.User
		if json.Unmarshal(body, &user) == nil && user.ID != "" {
			users = append(users, user)
		}
	}
	sort.Slice(users, func(i, j int) bool { return users[i].CreatedAt.After(users[j].CreatedAt) })
	return users, nil
}

func (s *RedisStore) ListAllLoads() ([]models.Load, error) {
	keys, err := s.scanKeys("load:*")
	if err != nil {
		return nil, err
	}
	loads := make([]models.Load, 0, len(keys))
	for _, key := range keys {
		body, getErr := s.client.Get(s.ctx, key).Bytes()
		if getErr != nil {
			continue
		}
		var load models.Load
		if json.Unmarshal(body, &load) == nil && load.ID != "" {
			load.Status = models.CanonicalLoadStatus(load.Status)
			loads = append(loads, load)
		}
	}
	sort.Slice(loads, func(i, j int) bool { return loads[i].CreatedAt.After(loads[j].CreatedAt) })
	return loads, nil
}

func (s *RedisStore) ListAllVehicles() ([]models.Vehicle, error) {
	keys, err := s.scanKeys("vehicle:*")
	if err != nil {
		return nil, err
	}
	vehicles := make([]models.Vehicle, 0, len(keys))
	for _, key := range keys {
		body, getErr := s.client.Get(s.ctx, key).Bytes()
		if getErr != nil {
			continue
		}
		var vehicle models.Vehicle
		if json.Unmarshal(body, &vehicle) == nil && vehicle.ID != "" {
			vehicles = append(vehicles, vehicle)
		}
	}
	sort.Slice(vehicles, func(i, j int) bool { return vehicles[i].CreatedAt.After(vehicles[j].CreatedAt) })
	return vehicles, nil
}

func (s *RedisStore) SaveDriverDocument(document models.DriverDocument) error {
	body, err := json.Marshal(document)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	pipe.Set(s.ctx, "driver-document:"+document.ID, body, 0)
	pipe.SAdd(s.ctx, "driver-documents:driver:"+document.DriverID, document.ID)
	_, err = pipe.Exec(s.ctx)
	return err
}

func (s *RedisStore) GetDriverDocument(id string) (models.DriverDocument, error) {
	var document models.DriverDocument
	body, err := s.client.Get(s.ctx, "driver-document:"+id).Bytes()
	if err != nil {
		return document, err
	}
	return document, json.Unmarshal(body, &document)
}

func (s *RedisStore) ListDriverDocuments(driverID string) ([]models.DriverDocument, error) {
	ids, err := s.client.SMembers(s.ctx, "driver-documents:driver:"+driverID).Result()
	if err != nil {
		return nil, err
	}
	documents := make([]models.DriverDocument, 0, len(ids))
	for _, id := range ids {
		document, getErr := s.GetDriverDocument(id)
		if getErr == nil {
			documents = append(documents, document)
		}
	}
	sort.Slice(documents, func(i, j int) bool { return documents[i].CreatedAt.After(documents[j].CreatedAt) })
	return documents, nil
}

func (s *RedisStore) SaveComplaint(complaint models.MessageComplaint) error {
	body, err := json.Marshal(complaint)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	pipe.Set(s.ctx, "complaint:"+complaint.ID, body, 0)
	pipe.ZAdd(s.ctx, "complaints", redis.Z{Score: float64(complaint.CreatedAt.UnixMilli()), Member: complaint.ID})
	pipe.SAdd(s.ctx, "complaints:reporter:"+complaint.ReporterID, complaint.ID)
	if complaint.LoadID != "" {
		pipe.SAdd(s.ctx, "complaints:load:"+complaint.LoadID, complaint.ID)
	}
	if complaint.MessageID != "" {
		pipe.SAdd(s.ctx, "complaints:message:"+complaint.MessageID, complaint.ID)
	}
	_, err = pipe.Exec(s.ctx)
	return err
}

func (s *RedisStore) GetComplaint(id string) (models.MessageComplaint, error) {
	var complaint models.MessageComplaint
	body, err := s.client.Get(s.ctx, "complaint:"+id).Bytes()
	if err != nil {
		return complaint, err
	}
	return complaint, json.Unmarshal(body, &complaint)
}

func (s *RedisStore) ListComplaints() ([]models.MessageComplaint, error) {
	ids, err := s.client.ZRevRange(s.ctx, "complaints", 0, -1).Result()
	if err != nil {
		return nil, err
	}
	complaints := make([]models.MessageComplaint, 0, len(ids))
	for _, id := range ids {
		complaint, getErr := s.GetComplaint(id)
		if getErr == nil {
			complaints = append(complaints, complaint)
		}
	}
	return complaints, nil
}

func (s *RedisStore) ListComplaintsByReporter(reporterID string) ([]models.MessageComplaint, error) {
	complaints, err := s.ListComplaints()
	if err != nil {
		return nil, err
	}
	owned := make([]models.MessageComplaint, 0)
	for _, complaint := range complaints {
		if complaint.ReporterID == reporterID {
			owned = append(owned, complaint)
		}
	}
	return owned, nil
}

func (s *RedisStore) FindComplaint(messageID, loadID, reporterID string) (models.MessageComplaint, error) {
	key := "complaints:message:" + messageID
	if messageID == "" {
		key = "complaints:load:" + loadID
	}
	ids, err := s.client.SMembers(s.ctx, key).Result()
	if err != nil {
		return models.MessageComplaint{}, err
	}
	for _, id := range ids {
		complaint, getErr := s.GetComplaint(id)
		if getErr == nil && complaint.MessageID == messageID && complaint.ReporterID == reporterID && complaint.Status != models.ComplaintStatusRejected {
			return complaint, nil
		}
	}
	return models.MessageComplaint{}, redis.Nil
}

func (s *RedisStore) SaveLoadStatusEvent(event models.LoadStatusEvent) error {
	event = normalizeLoadStatusEvent(event)
	if event.ID == "" || event.LoadID == "" || event.ToStatus == "" || event.ChangedAt.IsZero() ||
		event.ChangedByUserID == "" || event.ChangedByRole == "" || event.Source == "" {
		return ErrInvalidLoadStatusTransition
	}
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	pipe.SetNX(s.ctx, "load-status-event:"+event.ID, body, 0)
	pipe.ZAdd(s.ctx, "load-status-history:"+event.LoadID, redis.Z{Score: float64(event.ChangedAt.UnixMicro()), Member: event.ID})
	_, err = pipe.Exec(s.ctx)
	return err
}

func normalizeLoadStatusEvent(event models.LoadStatusEvent) models.LoadStatusEvent {
	if event.ChangedAt.IsZero() {
		event.ChangedAt = event.CreatedAt
	}
	if event.ChangedByUserID == "" {
		event.ChangedByUserID = event.ActorID
	}
	if event.ChangedByRole == "" {
		event.ChangedByRole = event.ActorRole
	}
	// Response aliases are populated for existing clients. Canonical fields
	// above are the persistence contract for all new records.
	event.ActorID = event.ChangedByUserID
	event.ActorRole = event.ChangedByRole
	event.CreatedAt = event.ChangedAt
	return event
}

func (s *RedisStore) TransitionLoadStatus(expectedStatus string, updated models.Load, event models.LoadStatusEvent) error {
	expectedStatus = models.CanonicalLoadStatus(expectedStatus)
	event = normalizeLoadStatusEvent(event)
	if updated.ID == "" || event.LoadID != updated.ID || models.CanonicalLoadStatus(event.FromStatus) != expectedStatus ||
		updated.Status != event.ToStatus || event.ChangedByUserID == "" || event.ChangedByRole == "" || event.Source == "" || event.ChangedAt.IsZero() || !models.CanTransition(expectedStatus, updated.Status) {
		return ErrInvalidLoadStatusTransition
	}
	loadBody, err := json.Marshal(updated)
	if err != nil {
		return err
	}
	eventBody, err := json.Marshal(event)
	if err != nil {
		return err
	}
	loadKey := "load:" + updated.ID
	eventKey := "load-status-event:" + event.ID
	err = s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		storedBody, getErr := tx.Get(s.ctx, loadKey).Bytes()
		if getErr != nil {
			return getErr
		}
		var stored models.Load
		if unmarshalErr := json.Unmarshal(storedBody, &stored); unmarshalErr != nil {
			return unmarshalErr
		}
		currentStatus := models.CanonicalLoadStatus(stored.Status)
		if currentStatus != expectedStatus {
			return ErrLoadStatusConflict
		}
		if !models.CanTransition(currentStatus, updated.Status) {
			return ErrInvalidLoadStatusTransition
		}
		if exists, existsErr := tx.Exists(s.ctx, eventKey).Result(); existsErr != nil {
			return existsErr
		} else if exists != 0 {
			return ErrLoadStatusConflict
		}
		_, txErr := tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(s.ctx, loadKey, loadBody, 0)
			pipe.Set(s.ctx, eventKey, eventBody, 0)
			pipe.ZAdd(s.ctx, "load-status-history:"+updated.ID, redis.Z{Score: float64(event.ChangedAt.UnixMicro()), Member: event.ID})
			return nil
		})
		return txErr
	}, loadKey, eventKey)
	if errors.Is(err, redis.TxFailedErr) {
		return ErrLoadStatusConflict
	}
	return err
}

func (s *RedisStore) ListLoadStatusHistory(loadID string) ([]models.LoadStatusEvent, error) {
	ids, err := s.client.ZRange(s.ctx, "load-status-history:"+loadID, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	history := make([]models.LoadStatusEvent, 0, len(ids))
	for _, id := range ids {
		body, getErr := s.client.Get(s.ctx, "load-status-event:"+id).Bytes()
		if getErr != nil {
			continue
		}
		var event models.LoadStatusEvent
		if json.Unmarshal(body, &event) == nil {
			history = append(history, normalizeLoadStatusEvent(event))
		}
	}
	sort.SliceStable(history, func(i, j int) bool {
		if history[i].ChangedAt.Equal(history[j].ChangedAt) {
			return history[i].ID < history[j].ID
		}
		return history[i].ChangedAt.Before(history[j].ChangedAt)
	})
	return history, nil
}

func (s *RedisStore) RecordAdminActivity(eventType, actorID, aggregateID string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.client.XAdd(s.ctx, &redis.XAddArgs{Stream: "admin-activity", Values: map[string]any{
		"type": eventType, "actorId": actorID, "aggregateId": aggregateID,
		"payload": string(body), "createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}}).Err()
}

func activityString(values map[string]any, key string) string {
	value, ok := values[key]
	if !ok {
		return ""
	}
	return fmt.Sprint(value)
}

func decodeActivity(stream string, message redis.XMessage) models.ActivityEvent {
	createdAt, _ := time.Parse(time.RFC3339Nano, activityString(message.Values, "createdAt"))
	if createdAt.IsZero() {
		milliseconds, _ := strconv.ParseInt(strings.SplitN(message.ID, "-", 2)[0], 10, 64)
		createdAt = time.UnixMilli(milliseconds).UTC()
	}
	var payload any
	_ = json.Unmarshal([]byte(activityString(message.Values, "payload")), &payload)
	actorID := activityString(message.Values, "actorId")
	if stream == "domain-events" && actorID == "" {
		actorID = "system"
	}
	return models.ActivityEvent{
		ID: message.ID, Type: activityString(message.Values, "type"), ActorID: actorID,
		AggregateID: activityString(message.Values, "aggregateId"), Payload: payload, CreatedAt: createdAt,
	}
}

func (s *RedisStore) ListActivityEvents(limit int64) ([]models.ActivityEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	events := make([]models.ActivityEvent, 0, limit*2)
	for _, stream := range []string{"admin-activity", "domain-events"} {
		messages, err := s.client.XRevRangeN(s.ctx, stream, "+", "-", limit).Result()
		if err != nil && err != redis.Nil {
			return nil, err
		}
		for _, message := range messages {
			events = append(events, decodeActivity(stream, message))
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].CreatedAt.After(events[j].CreatedAt) })
	if int64(len(events)) > limit {
		events = events[:limit]
	}
	return events, nil
}

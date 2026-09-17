package store

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"nakliye-api/internal/models"
)

var (
	ErrUserExists                  = errors.New("user already exists")
	ErrLoadStatusConflict          = errors.New("load status changed concurrently")
	ErrInvalidLoadStatusTransition = errors.New("invalid load status transition")
)

type RedisStore struct {
	client *redis.Client
	ctx    context.Context
}

// LoadFilter mirrors persisted structured attributes. Keeping filtering out of
// presentation text makes the same fields usable by driver search and reports.
type LoadFilter struct {
	Status                    string
	Query                     string
	UrgencyType               models.UrgencyType
	CargoType                 models.CargoType
	VehicleType               models.VehicleType
	ScheduledFrom             *time.Time
	ScheduledTo               *time.Time
	PickupElevatorAvailable   *bool
	DeliveryElevatorAvailable *bool
	HelperNeeded              *bool
}

func New(url string) (*RedisStore, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return &RedisStore{client: redis.NewClient(opts), ctx: context.Background()}, nil
}
func (s *RedisStore) Ping() error { return s.client.Ping(s.ctx).Err() }
func (s *RedisStore) SaveLoad(load models.Load) error {
	b, err := json.Marshal(load)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	pipe.Set(s.ctx, "load:"+load.ID, b, 0)
	pipe.ZAdd(s.ctx, "loads", redis.Z{Score: float64(load.CreatedAt.Unix()), Member: load.ID})
	_, err = pipe.Exec(s.ctx)
	return err
}
func (s *RedisStore) GetLoad(id string) (models.Load, error) {
	var l models.Load
	b, err := s.client.Get(s.ctx, "load:"+id).Bytes()
	if err != nil {
		return l, err
	}
	if err = json.Unmarshal(b, &l); err != nil {
		return l, err
	}
	l.Status = models.CanonicalLoadStatus(l.Status)
	return l, nil
}
func (s *RedisStore) ListOpenLoads() ([]models.Load, error) {
	ids, err := s.client.ZRevRange(s.ctx, "loads", 0, -1).Result()
	if err != nil {
		return nil, err
	}
	loads := make([]models.Load, 0)
	for _, id := range ids {
		l, e := s.GetLoad(id)
		if e == nil && l.Status == models.LoadStatusPublished && l.DeletedAt == nil {
			loads = append(loads, l)
		}
	}
	return loads, nil
}
func (s *RedisStore) ListLoads(customerID, driverID string, filter LoadFilter, offset, limit int) ([]models.Load, int, error) {
	ids, err := s.client.ZRevRange(s.ctx, "loads", 0, -1).Result()
	if err != nil {
		return nil, 0, err
	}
	all := make([]models.Load, 0)
	for _, id := range ids {
		l, e := s.GetLoad(id)
		if e != nil || l.DeletedAt != nil {
			continue
		}
		if customerID != "" && l.CustomerID != customerID {
			continue
		}
		if driverID != "" && l.AssignedDriver != driverID {
			continue
		}
		if !matchesLoadFilter(l, filter) {
			continue
		}
		all = append(all, l)
	}
	total := len(all)
	if offset < 0 {
		offset = 0
	}
	if offset > total {
		offset = total
	}
	end := offset + limit
	if limit <= 0 || end > total {
		end = total
	}
	return all[offset:end], total, nil
}

func (s *RedisStore) ListDriverLoads(driverID string, filter LoadFilter, offset, limit int) ([]models.Load, int, error) {
	ids, err := s.client.ZRevRange(s.ctx, "loads", 0, -1).Result()
	if err != nil {
		return nil, 0, err
	}
	all := make([]models.Load, 0, len(ids))
	for _, id := range ids {
		load, getErr := s.GetLoad(id)
		if getErr != nil || load.DeletedAt != nil {
			continue
		}
		offerable := load.Status == models.LoadStatusPublished
		if !offerable && load.AssignedDriver != driverID {
			continue
		}
		if !matchesLoadFilter(load, filter) {
			continue
		}
		all = append(all, load)
	}
	total := len(all)
	if offset < 0 {
		offset = 0
	}
	if offset > total {
		offset = total
	}
	end := offset + limit
	if limit <= 0 || end > total {
		end = total
	}
	return all[offset:end], total, nil
}

func matchesLoadFilter(load models.Load, filter LoadFilter) bool {
	if filter.Status != "" && load.Status != filter.Status {
		return false
	}
	if filter.UrgencyType != "" && load.UrgencyType != filter.UrgencyType {
		return false
	}
	if filter.CargoType != "" && load.CargoType != filter.CargoType {
		return false
	}
	if filter.VehicleType != "" && load.VehicleType != filter.VehicleType {
		return false
	}
	if filter.ScheduledFrom != nil && (load.ScheduledAt == nil || load.ScheduledAt.Before(*filter.ScheduledFrom)) {
		return false
	}
	if filter.ScheduledTo != nil && (load.ScheduledAt == nil || load.ScheduledAt.After(*filter.ScheduledTo)) {
		return false
	}
	if filter.PickupElevatorAvailable != nil && load.PickupElevatorAvailable != *filter.PickupElevatorAvailable {
		return false
	}
	if filter.DeliveryElevatorAvailable != nil && load.DeliveryElevatorAvailable != *filter.DeliveryElevatorAvailable {
		return false
	}
	if filter.HelperNeeded != nil && load.HelperNeeded != *filter.HelperNeeded {
		return false
	}
	query := strings.ToLower(strings.TrimSpace(filter.Query))
	if query == "" {
		return true
	}
	searchable := strings.Join([]string{
		load.Title,
		load.Description,
		load.CargoTypeNote,
		load.Pickup.Address,
		load.Delivery.Address,
	}, " ")
	return strings.Contains(strings.ToLower(searchable), query)
}
func (s *RedisStore) SaveUser(u models.User) error {
	b, err := json.Marshal(u)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	pipe.Set(s.ctx, "user:"+u.ID, b, 0)
	pipe.Set(s.ctx, "user-email:"+strings.ToLower(u.Email), u.ID, 0)
	pipe.Set(s.ctx, "user-phone:"+u.Phone, u.ID, 0)
	_, err = pipe.Exec(s.ctx)
	return err
}

func (s *RedisStore) CreateUser(u models.User) error {
	body, err := json.Marshal(u)
	if err != nil {
		return err
	}
	script := redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[3], ARGV[1])
return 1`)
	created, err := script.Run(s.ctx, s.client, []string{
		"user-email:" + strings.ToLower(u.Email),
		"user-phone:" + u.Phone,
		"user:" + u.ID,
	}, body, u.ID).Int64()
	if err != nil {
		return err
	}
	if created != 1 {
		return ErrUserExists
	}
	return nil
}
func (s *RedisStore) UpdateUser(previous, updated models.User) error {
	b, err := json.Marshal(updated)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	pipe.Set(s.ctx, "user:"+updated.ID, b, 0)
	if previous.Email != updated.Email {
		pipe.Del(s.ctx, "user-email:"+strings.ToLower(previous.Email))
	}
	if previous.Phone != updated.Phone {
		pipe.Del(s.ctx, "user-phone:"+previous.Phone)
	}
	pipe.Set(s.ctx, "user-email:"+strings.ToLower(updated.Email), updated.ID, 0)
	pipe.Set(s.ctx, "user-phone:"+updated.Phone, updated.ID, 0)
	_, err = pipe.Exec(s.ctx)
	return err
}
func (s *RedisStore) GetUserByPhone(phone string) (models.User, error) {
	id, err := s.client.Get(s.ctx, "user-phone:"+phone).Result()
	if err != nil {
		return models.User{}, err
	}
	return s.GetUser(id)
}
func (s *RedisStore) GetUser(id string) (models.User, error) {
	var u models.User
	b, err := s.client.Get(s.ctx, "user:"+id).Bytes()
	if err != nil {
		return u, err
	}
	return u, json.Unmarshal(b, &u)
}
func (s *RedisStore) GetUserByEmail(email string) (models.User, error) {
	id, err := s.client.Get(s.ctx, "user-email:"+strings.ToLower(email)).Result()
	if err != nil {
		return models.User{}, err
	}
	return s.GetUser(id)
}
func (s *RedisStore) SaveRefresh(token, userID string, ttl time.Duration) error {
	return s.client.Set(s.ctx, "refresh:"+token, userID, ttl).Err()
}
func (s *RedisStore) ConsumeRefresh(token string) (string, error) {
	return s.client.GetDel(s.ctx, "refresh:"+token).Result()
}
func (s *RedisStore) SaveOffer(o models.Offer) error {
	b, err := json.Marshal(o)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	pipe.Set(s.ctx, "offer:"+o.ID, b, 0)
	pipe.SAdd(s.ctx, "offers:load:"+o.LoadID, o.ID)
	pipe.SAdd(s.ctx, "offers:driver:"+o.DriverID, o.ID)
	_, err = pipe.Exec(s.ctx)
	return err
}
func (s *RedisStore) GetOffer(id string) (models.Offer, error) {
	var o models.Offer
	b, err := s.client.Get(s.ctx, "offer:"+id).Bytes()
	if err != nil {
		return o, err
	}
	return o, json.Unmarshal(b, &o)
}
func (s *RedisStore) ListOffers(loadID, driverID string) ([]models.Offer, error) {
	key := "offers:load:" + loadID
	if driverID != "" {
		key = "offers:driver:" + driverID
	}
	ids, err := s.client.SMembers(s.ctx, key).Result()
	if err != nil {
		return nil, err
	}
	out := make([]models.Offer, 0, len(ids))
	for _, id := range ids {
		o, e := s.GetOffer(id)
		if e == nil {
			out = append(out, o)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
func (s *RedisStore) FindPendingOffer(loadID, driverID string) (models.Offer, error) {
	offers, err := s.ListOffers(loadID, "")
	if err != nil {
		return models.Offer{}, err
	}
	for _, offer := range offers {
		if offer.DriverID == driverID && offer.Status == "pending" {
			return offer, nil
		}
	}
	return models.Offer{}, redis.Nil
}
func (s *RedisStore) FindOfferByLoadDriver(loadID, driverID string) (models.Offer, error) {
	offers, err := s.ListOffers(loadID, "")
	if err != nil {
		return models.Offer{}, err
	}
	for _, offer := range offers {
		if offer.DriverID == driverID {
			return offer, nil
		}
	}
	return models.Offer{}, redis.Nil
}
func (s *RedisStore) AcceptOffer(load models.Load, accepted models.Offer, allOffers []models.Offer, conversation models.Conversation, event models.LoadStatusEvent, delivery models.DeliveryVerification) error {
	event = normalizeLoadStatusEvent(event)
	expected := models.CanonicalLoadStatus(event.FromStatus)
	if load.ID == "" || accepted.ID == "" || event.LoadID != load.ID || load.Status != event.ToStatus || event.ChangedByUserID == "" || event.ChangedByRole == "" || event.Source == "" || event.ChangedAt.IsZero() ||
		delivery.LoadID != load.ID || delivery.CustomerID != load.CustomerID || delivery.DriverID != load.AssignedDriver || delivery.CodeHash == "" || delivery.CodeCiphertext == "" || delivery.CreatedAt.IsZero() ||
		!models.CanTransition(expected, load.Status) {
		return ErrInvalidLoadStatusTransition
	}
	loadBytes, err := json.Marshal(load)
	if err != nil {
		return err
	}
	conversationBytes, err := json.Marshal(conversation)
	if err != nil {
		return err
	}
	eventBytes, err := json.Marshal(event)
	if err != nil {
		return err
	}
	deliveryBytes, err := json.Marshal(delivery)
	if err != nil {
		return err
	}
	deliveryKey := "load-delivery-verification:" + load.ID
	watchKeys := []string{"load:" + load.ID, "load-status-event:" + event.ID, deliveryKey}
	for _, offer := range allOffers {
		watchKeys = append(watchKeys, "offer:"+offer.ID)
	}
	err = s.client.Watch(s.ctx, func(tx *redis.Tx) error {
		storedLoadBytes, getErr := tx.Get(s.ctx, "load:"+load.ID).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedLoad models.Load
		if unmarshalErr := json.Unmarshal(storedLoadBytes, &storedLoad); unmarshalErr != nil {
			return unmarshalErr
		}
		currentStatus := models.CanonicalLoadStatus(storedLoad.Status)
		if currentStatus != expected {
			return ErrLoadStatusConflict
		}
		if !models.CanTransition(currentStatus, load.Status) {
			return ErrInvalidLoadStatusTransition
		}
		storedAcceptedBytes, getErr := tx.Get(s.ctx, "offer:"+accepted.ID).Bytes()
		if getErr != nil {
			return getErr
		}
		var storedAccepted models.Offer
		if unmarshalErr := json.Unmarshal(storedAcceptedBytes, &storedAccepted); unmarshalErr != nil {
			return unmarshalErr
		}
		if storedAccepted.Status != "pending" {
			return ErrLoadStatusConflict
		}
		if exists, existsErr := tx.Exists(s.ctx, deliveryKey).Result(); existsErr != nil {
			return existsErr
		} else if exists != 0 {
			return ErrLoadStatusConflict
		}

		offerBodies := make(map[string][]byte, len(allOffers))
		for _, listedOffer := range allOffers {
			storedOfferBytes, offerErr := tx.Get(s.ctx, "offer:"+listedOffer.ID).Bytes()
			if offerErr != nil {
				return offerErr
			}
			var storedOffer models.Offer
			if unmarshalErr := json.Unmarshal(storedOfferBytes, &storedOffer); unmarshalErr != nil {
				return unmarshalErr
			}
			if storedOffer.ID == accepted.ID {
				storedOffer = accepted
			} else if storedOffer.Status == "pending" {
				storedOffer.Status = "rejected"
				storedOffer.UpdatedAt = accepted.UpdatedAt
			}
			offerBodies[storedOffer.ID], getErr = json.Marshal(storedOffer)
			if getErr != nil {
				return getErr
			}
		}

		_, txErr := tx.TxPipelined(s.ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(s.ctx, "load:"+load.ID, loadBytes, 0)
			pipe.Set(s.ctx, deliveryKey, deliveryBytes, 0)
			// A load can have only one assigned driver. Persisting the
			// conversation under the load ID preserves that invariant.
			pipe.Set(s.ctx, "conversation:"+conversation.ID, conversationBytes, 0)
			for offerID, body := range offerBodies {
				pipe.Set(s.ctx, "offer:"+offerID, body, 0)
			}
			pipe.SetNX(s.ctx, "load-status-event:"+event.ID, eventBytes, 0)
			pipe.ZAdd(s.ctx, "load-status-history:"+event.LoadID, redis.Z{Score: float64(event.ChangedAt.UnixMicro()), Member: event.ID})
			return nil
		})
		return txErr
	}, watchKeys...)
	if errors.Is(err, redis.TxFailedErr) {
		return ErrLoadStatusConflict
	}
	return err
}
func (s *RedisStore) SavePhoto(id string, data []byte, contentType, ownerID, loadID string) error {
	return s.client.HSet(s.ctx, "photo:"+id, "data", data, "contentType", contentType, "ownerID", ownerID, "loadID", loadID).Err()
}
func (s *RedisStore) GetPhoto(id string) ([]byte, string, string, string, error) {
	values, err := s.client.HMGet(s.ctx, "photo:"+id, "data", "contentType", "ownerID", "loadID").Result()
	if err != nil {
		return nil, "", "", "", err
	}
	if len(values) != 4 || values[0] == nil {
		return nil, "", "", "", redis.Nil
	}
	data, _ := values[0].(string)
	contentType, _ := values[1].(string)
	ownerID, _ := values[2].(string)
	loadID, _ := values[3].(string)
	return []byte(data), contentType, ownerID, loadID, nil
}
func (s *RedisStore) DeletePhoto(id string) error { return s.client.Del(s.ctx, "photo:"+id).Err() }
func (s *RedisStore) SaveConversation(c models.Conversation) error {
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	return s.client.Set(s.ctx, "conversation:"+c.ID, b, 0).Err()
}

func (s *RedisStore) GetConversation(id string) (models.Conversation, error) {
	var c models.Conversation
	b, err := s.client.Get(s.ctx, "conversation:"+id).Bytes()
	if err != nil {
		return c, err
	}
	return c, json.Unmarshal(b, &c)
}

func (s *RedisStore) ClaimMessageAttachment(photoID, userID, conversationID string) error {
	return s.client.Set(s.ctx, "message-attachment:"+photoID, userID+":"+conversationID, 0).Err()
}

func (s *RedisStore) MessageAttachmentClaim(photoID string) (string, error) {
	return s.client.Get(s.ctx, "message-attachment:"+photoID).Result()
}

func normalizeMessage(m *models.Message) {
	if m.Type == "" {
		m.Type = "text"
	}
	if m.Status == "" {
		m.Status = "sent"
	}
	if m.UpdatedAt.IsZero() {
		m.UpdatedAt = m.CreatedAt
	}
}

// CreateMessage writes the idempotency key, ID index and list item together in
// one Redis script. Retrying a request with the same clientMessageId returns
// the original server message rather than appending a duplicate.
func (s *RedisStore) CreateMessage(m models.Message) (models.Message, bool, error) {
	normalizeMessage(&m)
	b, err := json.Marshal(m)
	if err != nil {
		return models.Message{}, false, err
	}
	listKey := "messages:" + m.LoadID
	indexKey := "message-index:" + m.ID
	if m.ClientMessageID == "" {
		pipe := s.client.TxPipeline()
		pipe.Set(s.ctx, indexKey, m.LoadID, 0)
		pipe.RPush(s.ctx, listKey, b)
		_, err = pipe.Exec(s.ctx)
		return m, false, err
	}
	idempotencyKey := "message-client:" + m.LoadID + ":" + m.SenderID + ":" + m.ClientMessageID
	script := redis.NewScript(`
local existing = redis.call('GET', KEYS[1])
if existing then return {0, existing} end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
redis.call('RPUSH', KEYS[3], ARGV[3])
return {1, ARGV[1]}`)
	result, err := script.Run(s.ctx, s.client, []string{idempotencyKey, indexKey, listKey}, m.ID, m.LoadID, b).Result()
	if err != nil {
		return models.Message{}, false, err
	}
	values, ok := result.([]interface{})
	if !ok || len(values) != 2 {
		return models.Message{}, false, errors.New("message idempotency response invalid")
	}
	created, _ := values[0].(int64)
	if created == 1 {
		return m, false, nil
	}
	existingID, _ := values[1].(string)
	existing, err := s.GetMessage(existingID)
	return existing, true, err
}

func (s *RedisStore) SaveMessage(m models.Message) error {
	_, _, err := s.CreateMessage(m)
	return err
}

func (s *RedisStore) Messages(loadID string) ([]models.Message, error) {
	raw, err := s.client.LRange(s.ctx, "messages:"+loadID, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	out := make([]models.Message, 0, len(raw))
	for _, v := range raw {
		var m models.Message
		if json.Unmarshal([]byte(v), &m) == nil {
			normalizeMessage(&m)
			out = append(out, m)
		}
	}
	// RFC3339 timestamps can be equal (especially in system/batch messages).
	// Keep ordering deterministic so cursor pagination never skips or reorders
	// messages between requests.
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out, nil
}

// MessagesPage returns messages in chronological order. The cursor is the ID
// of the earliest already-loaded message, making prepend pagination stable for
// React Native FlatList clients.
func (s *RedisStore) MessagesPage(loadID, cursor string, limit int) ([]models.Message, string, bool, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	all, err := s.Messages(loadID)
	if err != nil {
		return nil, "", false, err
	}
	end := len(all)
	if cursor != "" {
		for index, message := range all {
			if message.ID == cursor {
				end = index
				break
			}
		}
	}
	start := end - limit
	if start < 0 {
		start = 0
	}
	page := append([]models.Message(nil), all[start:end]...)
	nextCursor := ""
	if start > 0 && len(page) > 0 {
		nextCursor = page[0].ID
	}
	return page, nextCursor, start > 0, nil
}

func (s *RedisStore) GetMessage(id string) (models.Message, error) {
	loadID, err := s.client.Get(s.ctx, "message-index:"+id).Result()
	if err != nil {
		return models.Message{}, err
	}
	return s.GetMessageInLoad(loadID, id)
}

func (s *RedisStore) GetMessageInLoad(loadID, id string) (models.Message, error) {
	messages, err := s.Messages(loadID)
	if err != nil {
		return models.Message{}, err
	}
	for _, message := range messages {
		if message.ID == id {
			return message, nil
		}
	}
	return models.Message{}, redis.Nil
}

func (s *RedisStore) updateMessage(loadID, id string, update func(*models.Message)) (models.Message, error) {
	raw, err := s.client.LRange(s.ctx, "messages:"+loadID, 0, -1).Result()
	if err != nil {
		return models.Message{}, err
	}
	for index, value := range raw {
		var message models.Message
		if json.Unmarshal([]byte(value), &message) != nil || message.ID != id {
			continue
		}
		normalizeMessage(&message)
		update(&message)
		body, marshalErr := json.Marshal(message)
		if marshalErr != nil {
			return models.Message{}, marshalErr
		}
		if err = s.client.LSet(s.ctx, "messages:"+loadID, int64(index), body).Err(); err != nil {
			return models.Message{}, err
		}
		return message, nil
	}
	return models.Message{}, redis.Nil
}

func (s *RedisStore) SoftDeleteMessage(loadID, id, userID string, now time.Time) (models.Message, error) {
	return s.updateMessage(loadID, id, func(message *models.Message) {
		message.DeletedAt = &now
		message.DeletedBy = userID
		message.Body = ""
		message.AttachmentURL = ""
		message.AttachmentMimeType = ""
		message.Latitude = nil
		message.Longitude = nil
		message.LocationAddress = ""
		message.UpdatedAt = now
	})
}

func (s *RedisStore) MarkMessagesDelivered(loadID, readerID string, now time.Time) error {
	raw, err := s.client.LRange(s.ctx, "messages:"+loadID, 0, -1).Result()
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	for index, value := range raw {
		var message models.Message
		if json.Unmarshal([]byte(value), &message) != nil {
			continue
		}
		normalizeMessage(&message)
		if message.SenderID == readerID || message.DeletedAt != nil || message.Status != "sent" {
			continue
		}
		message.Status, message.DeliveredAt, message.UpdatedAt = "delivered", &now, now
		body, marshalErr := json.Marshal(message)
		if marshalErr != nil {
			return marshalErr
		}
		pipe.LSet(s.ctx, "messages:"+loadID, int64(index), body)
	}
	_, err = pipe.Exec(s.ctx)
	return err
}

func (s *RedisStore) MarkMessagesRead(loadID, readerID string, now time.Time) (int, error) {
	raw, err := s.client.LRange(s.ctx, "messages:"+loadID, 0, -1).Result()
	if err != nil {
		return 0, err
	}
	count := 0
	pipe := s.client.TxPipeline()
	for index, value := range raw {
		var message models.Message
		if json.Unmarshal([]byte(value), &message) != nil {
			continue
		}
		normalizeMessage(&message)
		if message.SenderID == readerID || message.DeletedAt != nil || message.ReadAt != nil {
			continue
		}
		message.Status, message.DeliveredAt, message.ReadAt, message.UpdatedAt = "read", &now, &now, now
		body, marshalErr := json.Marshal(message)
		if marshalErr != nil {
			return 0, marshalErr
		}
		pipe.LSet(s.ctx, "messages:"+loadID, int64(index), body)
		count++
	}
	_, err = pipe.Exec(s.ctx)
	return count, err
}

// MarkMessageIDsRead marks only messages that the client has actually loaded
// and displayed. It avoids turning an entire conversation read merely because
// its detail screen was opened.
func (s *RedisStore) MarkMessageIDsRead(loadID, readerID string, messageIDs []string, now time.Time) (int, error) {
	allowed := make(map[string]struct{}, len(messageIDs))
	for _, id := range messageIDs {
		if id != "" {
			allowed[id] = struct{}{}
		}
	}
	if len(allowed) == 0 {
		return 0, nil
	}
	raw, err := s.client.LRange(s.ctx, "messages:"+loadID, 0, -1).Result()
	if err != nil {
		return 0, err
	}
	count := 0
	pipe := s.client.TxPipeline()
	for index, value := range raw {
		var message models.Message
		if json.Unmarshal([]byte(value), &message) != nil {
			continue
		}
		normalizeMessage(&message)
		if _, wanted := allowed[message.ID]; !wanted || message.SenderID == readerID || message.DeletedAt != nil || message.ReadAt != nil {
			continue
		}
		message.Status, message.DeliveredAt, message.ReadAt, message.UpdatedAt = "read", &now, &now, now
		body, marshalErr := json.Marshal(message)
		if marshalErr != nil {
			return 0, marshalErr
		}
		pipe.LSet(s.ctx, "messages:"+loadID, int64(index), body)
		count++
	}
	_, err = pipe.Exec(s.ctx)
	return count, err
}

func (s *RedisStore) UnreadMessageCount(loadID, userID string) (int, error) {
	messages, err := s.Messages(loadID)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, message := range messages {
		if message.SenderID != userID && message.DeletedAt == nil && message.ReadAt == nil {
			count++
		}
	}
	return count, nil
}

func (s *RedisStore) TouchUserLastSeen(id string, now time.Time) error {
	user, err := s.GetUser(id)
	if err != nil {
		return err
	}
	if !user.LastSeenAt.IsZero() && now.Sub(user.LastSeenAt) < time.Minute {
		return nil
	}
	user.LastSeenAt = now
	b, err := json.Marshal(user)
	if err != nil {
		return err
	}
	return s.client.Set(s.ctx, "user:"+id, b, 0).Err()
}

func (s *RedisStore) RecordDomainEvent(eventType, aggregateID string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.client.XAdd(s.ctx, &redis.XAddArgs{Stream: "domain-events", Values: map[string]any{
		"type": eventType, "aggregateId": aggregateID, "payload": string(body), "createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}}).Err()
}

func (s *RedisStore) SaveVehicle(v models.Vehicle) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	pipe := s.client.TxPipeline()
	pipe.Set(s.ctx, "vehicle:"+v.ID, b, 0)
	pipe.SAdd(s.ctx, "vehicles:driver:"+v.DriverID, v.ID)
	_, err = pipe.Exec(s.ctx)
	return err
}

func (s *RedisStore) GetVehicle(id string) (models.Vehicle, error) {
	var v models.Vehicle
	b, err := s.client.Get(s.ctx, "vehicle:"+id).Bytes()
	if err != nil {
		return v, err
	}
	return v, json.Unmarshal(b, &v)
}

func (s *RedisStore) ListVehicles(driverID string) ([]models.Vehicle, error) {
	ids, err := s.client.SMembers(s.ctx, "vehicles:driver:"+driverID).Result()
	if err != nil {
		return nil, err
	}
	out := make([]models.Vehicle, 0, len(ids))
	for _, id := range ids {
		v, e := s.GetVehicle(id)
		if e == nil {
			out = append(out, v)
		}
	}
	return out, nil
}

func (s *RedisStore) GetActiveVehicle(driverID string) (models.Vehicle, error) {
	vehicles, err := s.ListVehicles(driverID)
	if err != nil {
		return models.Vehicle{}, err
	}
	for _, v := range vehicles {
		if v.IsActive {
			return v, nil
		}
	}
	return models.Vehicle{}, redis.Nil
}

func (s *RedisStore) DeleteVehicle(driverID, id string) error {
	pipe := s.client.TxPipeline()
	pipe.Del(s.ctx, "vehicle:"+id)
	pipe.SRem(s.ctx, "vehicles:driver:"+driverID, id)
	_, err := pipe.Exec(s.ctx)
	return err
}

func (s *RedisStore) SetActiveVehicle(driverID, vehicleID string) error {
	vehicles, err := s.ListVehicles(driverID)
	if err != nil {
		return err
	}
	found := false
	pipe := s.client.TxPipeline()
	for _, v := range vehicles {
		if v.ID == vehicleID {
			if !v.IsActive {
				v.IsActive = true
				v.UpdatedAt = time.Now().UTC()
				b, _ := json.Marshal(v)
				pipe.Set(s.ctx, "vehicle:"+v.ID, b, 0)
				found = true
			}
		} else if v.IsActive {
			v.IsActive = false
			v.UpdatedAt = time.Now().UTC()
			b, _ := json.Marshal(v)
			pipe.Set(s.ctx, "vehicle:"+v.ID, b, 0)
		}
	}
	if !found {
		return redis.Nil
	}
	_, err = pipe.Exec(s.ctx)
	return err
}

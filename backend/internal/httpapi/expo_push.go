package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"nakliye-api/internal/models"
	"nakliye-api/internal/store"
)

const expoPushURL = "https://exp.host/--/api/v2/push/"

type expoPushSender struct {
	store       *store.RedisStore
	client      *http.Client
	accessToken string
}
type expoPushResult struct {
	Status  string `json:"status"`
	ID      string `json:"id"`
	Message string `json:"message"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

func newExpoPushSender(s *store.RedisStore) PushSender {
	return &expoPushSender{store: s, client: &http.Client{Timeout: 5 * time.Second}, accessToken: os.Getenv("EXPO_ACCESS_TOKEN")}
}

func (s *expoPushSender) post(path string, payload, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, expoPushURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.accessToken)
	}
	response, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("expo push transport: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("expo push HTTP %d", response.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(result); err != nil {
		return fmt.Errorf("expo push response: %w", err)
	}
	return nil
}

func (s *expoPushSender) Send(userID, title, body string, data map[string]string) error {
	tokens, err := s.store.ListPushTokens(userID)
	if err != nil {
		return err
	}
	// Expo rejects a batch mixing EAS projects. Old tokens without project metadata
	// are sent individually; new registrations can be grouped by explicit project.
	groups := map[string][]models.PushToken{}
	for _, token := range tokens {
		key := token.ProjectID
		if key == "" {
			key = token.ExpoPushToken
		}
		groups[key] = append(groups[key], token)
	}
	var failures []error
	for _, group := range groups {
		for start := 0; start < len(group); start += 100 {
			end := start + 100
			if end > len(group) {
				end = len(group)
			}
			batch := group[start:end]
			messages := make([]map[string]any, 0, len(batch))
			for _, token := range batch {
				messages = append(messages, map[string]any{"to": token.ExpoPushToken, "sound": "default", "title": title, "body": body, "data": data, "channelId": "default"})
			}
			var response struct {
				Data   []expoPushResult  `json:"data"`
				Errors []json.RawMessage `json:"errors"`
			}
			if err = s.post("send", messages, &response); err != nil {
				failures = append(failures, err)
				continue
			}
			if len(response.Errors) > 0 || len(response.Data) != len(batch) {
				failures = append(failures, errors.New("expo push ticket count/top-level error"))
			}
			for i, ticket := range response.Data {
				if i >= len(batch) {
					break
				}
				token := batch[i]
				switch {
				case ticket.Status == "ok" && ticket.ID != "":
					now := time.Now().UTC()
					err = s.store.SavePushReceipt(store.PushReceipt{ID: ticket.ID, Token: token, CreatedAt: now, NextCheckAt: now.Add(15 * time.Minute)})
					if err != nil {
						failures = append(failures, err)
					}
				case ticket.Status == "error":
					if ticket.Details.Error == "DeviceNotRegistered" {
						if err = s.store.DeletePushTokenIfCurrent(token); err != nil {
							failures = append(failures, err)
						}
					}
					failures = append(failures, fmt.Errorf("expo push ticket error: %s", ticket.Details.Error))
				default:
					failures = append(failures, errors.New("expo push ticket missing status/id"))
				}
			}
		}
	}
	return errors.Join(failures...)
}

func (s *expoPushSender) CheckReceipts(now time.Time) error {
	records, err := s.store.DuePushReceipts(now)
	if err != nil || len(records) == 0 {
		return err
	}
	ids := make([]string, 0, len(records))
	for _, r := range records {
		ids = append(ids, r.ID)
	}
	var response struct {
		Data   map[string]expoPushResult `json:"data"`
		Errors []json.RawMessage         `json:"errors"`
	}
	requestErr := s.post("getReceipts", map[string]any{"ids": ids}, &response)
	if len(response.Errors) > 0 {
		requestErr = errors.New("expo push receipts top-level error")
	}
	failures := []error{}
	if requestErr != nil {
		failures = append(failures, requestErr)
	}
	for _, record := range records {
		receipt, ok := response.Data[record.ID]
		if requestErr != nil || !ok || (receipt.Status != "ok" && receipt.Status != "error") {
			if now.Sub(record.CreatedAt) >= 24*time.Hour {
				failures = append(failures, errors.New("expo push receipt expired after 24h"))
				err = s.store.FinishPushReceipt(record.ID)
			} else {
				record.NextCheckAt = now.Add(15 * time.Minute)
				err = s.store.SavePushReceipt(record)
			}
		} else {
			if receipt.Status == "error" {
				failures = append(failures, fmt.Errorf("expo push receipt error: %s", receipt.Details.Error))
				if receipt.Details.Error == "DeviceNotRegistered" {
					if e := s.store.DeletePushTokenIfCurrent(record.Token); e != nil {
						failures = append(failures, e)
						continue
					}
				}
			}
			err = s.store.FinishPushReceipt(record.ID)
		}
		if err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

// Receipts are persisted in Redis, so restart does not lose pending APNs errors.
// This worker never retries shipment operations or resends an accepted push.
func (a *API) StartPushReceiptWorker(ctx context.Context) {
	checker, ok := a.push.(interface{ CheckReceipts(time.Time) error })
	if !ok {
		return
	}
	go func() {
		check := func() {
			if err := checker.CheckReceipts(time.Now().UTC()); err != nil {
				log.Printf("push receipt check failed: %v", err)
			}
		}
		check()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				check()
			}
		}
	}()
}

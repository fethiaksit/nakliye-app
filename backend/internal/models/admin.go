package models

import (
	"encoding/json"
	"time"
)

const (
	AccountStatusActive  = "active"
	AccountStatusBlocked = "blocked"
)

const (
	VerificationPending  = "pending"
	VerificationVerified = "verified"
	VerificationRejected = "rejected"
)

const (
	ComplaintStatusOpen      = "open"
	ComplaintStatusReviewing = "reviewing"
	ComplaintStatusResolved  = "resolved"
	ComplaintStatusRejected  = "rejected"
)

const complaintStatusDismissedLegacy = "dismissed"

type DriverDocument struct {
	ID         string     `json:"id"`
	DriverID   string     `json:"driverId"`
	Kind       string     `json:"kind"`
	Title      string     `json:"title"`
	FileURL    string     `json:"fileUrl"`
	Status     string     `json:"status"`
	ReviewNote string     `json:"reviewNote,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ReviewedAt *time.Time `json:"reviewedAt,omitempty"`
	ReviewedBy string     `json:"reviewedBy,omitempty"`
}

type MessageComplaint struct {
	ID             string     `json:"id"`
	ReporterID     string     `json:"reporterUserId"`
	ReportedUserID string     `json:"reportedUserId"`
	LoadID         string     `json:"loadId"`
	ConversationID string     `json:"conversationId"`
	MessageID      string     `json:"messageId,omitempty"`
	Reason         string     `json:"reason"`
	Detail         string     `json:"description,omitempty"`
	Status         string     `json:"status"`
	ResolutionNote string     `json:"adminNote,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	ResolvedAt     *time.Time `json:"resolvedAt,omitempty"`
	ResolvedBy     string     `json:"resolvedBy,omitempty"`
}

func (c *MessageComplaint) UnmarshalJSON(data []byte) error {
	type complaintAlias MessageComplaint
	value := struct {
		*complaintAlias
		LegacyReporterID     string `json:"reporterId"`
		LegacyDetail         string `json:"detail"`
		LegacyResolutionNote string `json:"resolutionNote"`
	}{complaintAlias: (*complaintAlias)(c)}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if c.ReporterID == "" {
		c.ReporterID = value.LegacyReporterID
	}
	if c.Detail == "" {
		c.Detail = value.LegacyDetail
	}
	if c.ResolutionNote == "" {
		c.ResolutionNote = value.LegacyResolutionNote
	}
	if c.ConversationID == "" {
		c.ConversationID = c.LoadID
	}
	if c.Status == complaintStatusDismissedLegacy {
		c.Status = ComplaintStatusRejected
	}
	return nil
}

type LoadStatusEvent struct {
	ID              string    `json:"id"`
	LoadID          string    `json:"loadId"`
	FromStatus      string    `json:"fromStatus,omitempty"`
	ToStatus        string    `json:"toStatus"`
	ChangedAt       time.Time `json:"changedAt"`
	ChangedByUserID string    `json:"changedByUserId"`
	ChangedByRole   string    `json:"changedByRole"`
	Source          string    `json:"source"`
	Note            string    `json:"note,omitempty"`

	// Deprecated response aliases keep existing admin/API consumers working
	// while old persisted history records are read into the canonical fields.
	ActorID   string    `json:"actorId,omitempty"`
	ActorRole string    `json:"actorRole,omitempty"`
	CreatedAt time.Time `json:"createdAt,omitempty"`
}

type ActivityEvent struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	ActorID     string    `json:"actorId,omitempty"`
	AggregateID string    `json:"aggregateId,omitempty"`
	Payload     any       `json:"payload,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

func ValidAccountStatus(status string) bool {
	return status == AccountStatusActive || status == AccountStatusBlocked
}

func ValidVerificationStatus(status string) bool {
	return status == VerificationPending || status == VerificationVerified || status == VerificationRejected
}

func ValidComplaintStatus(status string) bool {
	switch status {
	case ComplaintStatusOpen, ComplaintStatusReviewing, ComplaintStatusResolved, ComplaintStatusRejected:
		return true
	default:
		return false
	}
}

func ValidComplaintReason(reason string) bool {
	switch reason {
	case "payment_dispute", "behavior", "damage", "no_show", "incorrect_load_info", "safety", "other":
		return true
	default:
		return false
	}
}

func ValidLoadStatus(status string) bool {
	return ValidCanonicalLoadStatus(status) || IsLegacyLoadStatus(status)
}

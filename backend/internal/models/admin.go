package models

import "time"

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
	ComplaintStatusDismissed = "dismissed"
)

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
	MessageID      string     `json:"messageId"`
	LoadID         string     `json:"loadId"`
	ReporterID     string     `json:"reporterId"`
	ReportedUserID string     `json:"reportedUserId"`
	Reason         string     `json:"reason"`
	Detail         string     `json:"detail,omitempty"`
	Status         string     `json:"status"`
	ResolutionNote string     `json:"resolutionNote,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	ResolvedAt     *time.Time `json:"resolvedAt,omitempty"`
	ResolvedBy     string     `json:"resolvedBy,omitempty"`
}

type LoadStatusEvent struct {
	ID         string    `json:"id"`
	LoadID     string    `json:"loadId"`
	FromStatus string    `json:"fromStatus,omitempty"`
	ToStatus   string    `json:"toStatus"`
	ActorID    string    `json:"actorId,omitempty"`
	ActorRole  string    `json:"actorRole"`
	Note       string    `json:"note,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
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
	case ComplaintStatusOpen, ComplaintStatusReviewing, ComplaintStatusResolved, ComplaintStatusDismissed:
		return true
	default:
		return false
	}
}

func ValidLoadStatus(status string) bool {
	switch status {
	case LoadStatusDraft, LoadStatusPublished, LoadStatusOffersReceived, LoadStatusDriverSelected,
		LoadStatusInTransit, LoadStatusCompleted, LoadStatusCancelled, LoadStatusOpenLegacy:
		return true
	default:
		return false
	}
}

package models

import "time"

const (
	DeliveryVerificationMethodCodePhoto     = "code_photo"
	DeliveryVerificationMethodAdminOverride = "admin_override"
)

// DeliveryVerification is stored separately from Load so secret verification
// material can never be serialized by ordinary load API responses. The method
// and actor fields also leave a narrow persistence contract for a future admin
// override without enabling one in the current phase.
type DeliveryVerification struct {
	LoadID             string     `json:"loadId"`
	CustomerID         string     `json:"customerId"`
	DriverID           string     `json:"driverId"`
	CodeHash           string     `json:"codeHash"`
	CodeCiphertext     string     `json:"codeCiphertext,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	Verified           bool       `json:"verified"`
	VerifiedAt         *time.Time `json:"verifiedAt,omitempty"`
	VerifiedByUserID   string     `json:"verifiedByUserId,omitempty"`
	VerifiedByRole     string     `json:"verifiedByRole,omitempty"`
	VerificationMethod string     `json:"verificationMethod,omitempty"`
	PhotoURL           string     `json:"photoUrl,omitempty"`
}

package models

import "time"

const (
	RoleCustomer  = "customer"
	RoleDriver    = "driver"
	RoleCorporate = "corporate"
	RoleAdmin     = "admin"
)

const (
	LoadStatusDraft          = "draft"
	LoadStatusPublished      = "published"
	LoadStatusOffersReceived = "offers_received"
	LoadStatusDriverSelected = "driver_selected"
	LoadStatusInTransit      = "in_transit"
	LoadStatusCompleted      = "completed"
	LoadStatusCancelled      = "cancelled"
	// LoadStatusOpenLegacy is read-only compatibility for records created by
	// the first mobile client. New listings use LoadStatusPublished.
	LoadStatusOpenLegacy = "open"
)

func ValidRole(role string) bool {
	switch role {
	case RoleCustomer, RoleDriver, RoleCorporate, RoleAdmin:
		return true
	default:
		return false
	}
}

type Location struct {
	Address      string  `json:"address"`
	Latitude     float64 `json:"latitude"`
	Longitude    float64 `json:"longitude"`
	PlaceID      string  `json:"placeId,omitempty"`
	Street       string  `json:"street,omitempty"`
	StreetNumber string  `json:"streetNumber,omitempty"`
	Neighborhood string  `json:"neighborhood,omitempty"`
	District     string  `json:"district,omitempty"`
	City         string  `json:"city,omitempty"`
	Province     string  `json:"province,omitempty"`
	PostalCode   string  `json:"postalCode,omitempty"`
	Country      string  `json:"country,omitempty"`
	CountryCode  string  `json:"countryCode,omitempty"`
}

type Coordinate struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type Dimensions struct {
	LengthCM float64 `json:"lengthCm"`
	WidthCM  float64 `json:"widthCm"`
	HeightCM float64 `json:"heightCm"`
	WeightKG float64 `json:"weightKg"`
}

type Load struct {
	ID                   string       `json:"id"`
	CustomerID           string       `json:"customerId"`
	Title                string       `json:"title"`
	Description          string       `json:"description"`
	PhotoURLs            []string     `json:"photoUrls"`
	Dimensions           Dimensions   `json:"dimensions"`
	Pickup               Location     `json:"pickup"`
	Delivery             Location     `json:"delivery"`
	RouteDistanceMeters  int          `json:"routeDistanceMeters"`
	RouteDurationSeconds int          `json:"routeDurationSeconds"`
	PricePerKM           float64      `json:"pricePerKm"`
	RouteEncodedPolyline string       `json:"routeEncodedPolyline,omitempty"`
	RouteProvider        string       `json:"routeProvider,omitempty"`
	RouteCoordinates     []Coordinate `json:"routeCoordinates,omitempty"`
	EstimatedKM          float64      `json:"estimatedKm"`
	BasePriceTL          float64      `json:"basePriceTl"`
	AgreedPriceTL        float64      `json:"agreedPriceTl"`
	OfferCount           int          `json:"offerCount"`
	LastOfferTL          float64      `json:"lastOfferTl,omitempty"`
	Status               string       `json:"status"`
	AssignedDriver       string       `json:"assignedDriverId,omitempty"`
	CreatedAt            time.Time    `json:"createdAt"`
	UpdatedAt            time.Time    `json:"updatedAt"`
	DeletedAt            *time.Time   `json:"deletedAt,omitempty"`

	// Structured listing attributes. Scheduling is stored as one UTC instant;
	// presentation clients render it in the user's local time zone.
	UrgencyType UrgencyType `json:"urgencyType"`
	ScheduledAt *time.Time  `json:"scheduledAt,omitempty"`

	CargoType     CargoType   `json:"cargoType"`
	CargoTypeNote string      `json:"cargoTypeNote,omitempty"`
	VehicleType   VehicleType `json:"vehicleType"`

	// Pickup and delivery access can differ, so their operational attributes
	// are kept independently rather than in one ambiguous "floor" field.
	PickupFloor               *int `json:"pickupFloor,omitempty"`
	DeliveryFloor             *int `json:"deliveryFloor,omitempty"`
	PickupElevatorAvailable   bool `json:"pickupElevatorAvailable"`
	DeliveryElevatorAvailable bool `json:"deliveryElevatorAvailable"`
	HelperNeeded              bool `json:"helperNeeded"`
	HelperCount               int  `json:"helperCount"`
}

type User struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	Email         string        `json:"email"`
	Phone         string        `json:"phone"`
	Role          string        `json:"role"`
	DriverProfile DriverProfile `json:"driverProfile,omitempty"`
	// User is never returned directly by the HTTP handlers; keeping this field
	// serializable is required for the Redis persistence layer to authenticate
	// a user after registration.
	PasswordHash string    `json:"passwordHash"`
	CreatedAt    time.Time `json:"createdAt"`
	// LastSeenAt records a real authenticated API activity. It deliberately does
	// not imply a live socket connection, so clients must present it as
	// "son görülme" rather than "çevrimiçi".
	LastSeenAt    time.Time  `json:"lastSeenAt,omitempty"`
	AccountStatus string     `json:"accountStatus,omitempty"`
	BlockedAt     *time.Time `json:"blockedAt,omitempty"`
	BlockedReason string     `json:"blockedReason,omitempty"`
}

type DriverProfile struct {
	VehicleType        string     `json:"vehicleType,omitempty"`
	VehicleModel       string     `json:"vehicleModel,omitempty"`
	LicensePlate       string     `json:"licensePlate,omitempty"`
	CapacityKG         float64    `json:"capacityKg,omitempty"`
	ServiceArea        string     `json:"serviceArea,omitempty"`
	LicenseStatus      string     `json:"licenseStatus,omitempty"`
	CompletedJobs      int        `json:"completedJobs"`
	Rating             float64    `json:"rating"`
	VerificationStatus string     `json:"verificationStatus,omitempty"`
	VerificationNote   string     `json:"verificationNote,omitempty"`
	VerifiedAt         *time.Time `json:"verifiedAt,omitempty"`
	VerifiedBy         string     `json:"verifiedBy,omitempty"`
}

type Vehicle struct {
	ID                 string     `json:"id"`
	DriverID           string     `json:"driverId"`
	VehicleType        string     `json:"vehicleType"`
	Brand              string     `json:"brand"`
	Model              string     `json:"model"`
	LicensePlate       string     `json:"licensePlate"`
	CapacityKG         float64    `json:"capacityKg"`
	LengthCM           float64    `json:"lengthCm"`
	WidthCM            float64    `json:"widthCm"`
	HeightCM           float64    `json:"heightCm"`
	PhotoURL           string     `json:"photoUrl,omitempty"`
	IsActive           bool       `json:"isActive"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
	VerificationStatus string     `json:"verificationStatus,omitempty"`
	VerificationNote   string     `json:"verificationNote,omitempty"`
	VerifiedAt         *time.Time `json:"verifiedAt,omitempty"`
	VerifiedBy         string     `json:"verifiedBy,omitempty"`
}

type Offer struct {
	ID                      string    `json:"id"`
	LoadID                  string    `json:"loadId"`
	DriverID                string    `json:"driverId"`
	AmountTL                float64   `json:"amountTl"`
	Note                    string    `json:"note"`
	EstimatedArrivalMinutes int       `json:"estimatedArrivalMinutes,omitempty"`
	Status                  string    `json:"status"`
	CreatedAt               time.Time `json:"createdAt"`
	UpdatedAt               time.Time `json:"updatedAt"`
}

type Conversation struct {
	ID               string             `json:"id"`
	LoadID           string             `json:"loadId"`
	CustomerID       string             `json:"-"`
	DriverID         string             `json:"-"`
	LoadTitle        string             `json:"loadTitle"`
	PickupAddress    string             `json:"pickupAddress"`
	DeliveryAddress  string             `json:"deliveryAddress"`
	LoadStatus       string             `json:"loadStatus"`
	EstimatedKM      float64            `json:"estimatedKm"`
	EstimatedPriceTL float64            `json:"estimatedPriceTl"`
	OtherParty       ConversationMember `json:"otherParty"`
	LastMessage      string             `json:"lastMessage,omitempty"`
	LastMessageType  string             `json:"lastMessageType,omitempty"`
	LastMessageAt    time.Time          `json:"lastMessageAt,omitempty"`
	UnreadCount      int                `json:"unreadCount"`
	UpdatedAt        time.Time          `json:"updatedAt"`
}

type ConversationMember struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Role       string    `json:"role"`
	LastSeenAt time.Time `json:"lastSeenAt,omitempty"`
	Vehicle    *Vehicle  `json:"vehicle,omitempty"`
}

type Message struct {
	ID                 string        `json:"id"`
	LoadID             string        `json:"loadId"`
	SenderID           string        `json:"senderId"`
	SenderRole         string        `json:"senderRole"`
	Type               string        `json:"type"`
	Body               string        `json:"body,omitempty"`
	AttachmentURL      string        `json:"attachmentUrl,omitempty"`
	AttachmentMimeType string        `json:"attachmentMimeType,omitempty"`
	Latitude           *float64      `json:"latitude,omitempty"`
	Longitude          *float64      `json:"longitude,omitempty"`
	LocationAddress    string        `json:"locationAddress,omitempty"`
	OfferID            string        `json:"offerId,omitempty"`
	OfferAmountTL      float64       `json:"offerAmountTl,omitempty"`
	OfferBasePriceTL   float64       `json:"offerBasePriceTl,omitempty"`
	OfferStatus        string        `json:"offerStatus,omitempty"`
	OfferNote          string        `json:"offerNote,omitempty"`
	ReplyToMessageID   string        `json:"replyToMessageId,omitempty"`
	ReplyTo            *MessageReply `json:"replyTo,omitempty"`
	ClientMessageID    string        `json:"clientMessageId,omitempty"`
	Status             string        `json:"status"`
	DeliveredAt        *time.Time    `json:"deliveredAt,omitempty"`
	ReadAt             *time.Time    `json:"readAt,omitempty"`
	DeletedAt          *time.Time    `json:"deletedAt,omitempty"`
	DeletedBy          string        `json:"deletedBy,omitempty"`
	CreatedAt          time.Time     `json:"createdAt"`
	UpdatedAt          time.Time     `json:"updatedAt"`
}

type MessageReply struct {
	ID            string     `json:"id"`
	SenderID      string     `json:"senderId"`
	SenderRole    string     `json:"senderRole"`
	Type          string     `json:"type"`
	Body          string     `json:"body,omitempty"`
	AttachmentURL string     `json:"attachmentUrl,omitempty"`
	DeletedAt     *time.Time `json:"deletedAt,omitempty"`
}

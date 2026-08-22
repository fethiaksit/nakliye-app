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

	// FAZ 1 - Ilan Modeli Genişletme Alanları
	UrgencyType             string     `json:"urgency_type"`                     
	ScheduledDate           *time.Time `json:"scheduled_date,omitempty"`        
	ScheduledTime           *string    `json:"scheduled_time,omitempty"`        

	CargoType               string     `json:"cargo_type"`                         
	CargoTypeNote           *string    `json:"cargo_type_note,omitempty"`           

	VehicleType             string     `json:"vehicle_type"`                      

	WeightKg                *float64   `json:"weightKg,omitempty"`                 
	DimensionLengthCm       *float64   `json:"dimensionLengthCm,omitempty"`       
	DimensionWidthCm        *float64   `json:"dimensionWidthCm,omitempty"`        
	DimensionHeightCm       *float64   `json:"dimensionHeightCm,omitempty"`       

	FloorInfo               *int       `json:"floorInfo,omitempty"`               
	ElevatorAvailable       bool       `json:"elevatorAvailable,omitempty"`       
	HelperNeeded            bool       `json:"helperNeeded,omitempty"`          
	HelperCount             *int       `json:"helperCount,omitempty"`             
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
	LastSeenAt time.Time `json:"lastSeenAt,omitempty"`
}

type DriverProfile struct {
	VehicleType   string  `json:"vehicleType,omitempty"`
	VehicleModel  string  `json:"vehicleModel,omitempty"`
	LicensePlate  string  `json:"licensePlate,omitempty"`
	CapacityKG    float64 `json:"capacityKg,omitempty"`
	ServiceArea   string  `json:"serviceArea,omitempty"`
	LicenseStatus string  `json:"licenseStatus,omitempty"`
	CompletedJobs int     `json:"completedJobs"`
	Rating        float64 `json:"rating"`
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

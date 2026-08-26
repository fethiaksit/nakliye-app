package models

const (
	LoadStatusSourceCustomerApp     = "customer_app"
	LoadStatusSourceDriverApp       = "driver_app"
	LoadStatusSourceAdmin           = "admin"
	LoadStatusSourceSystem          = "system"
	LoadStatusSourceOfferAcceptance = "offer_acceptance"
)

var nextLoadStatus = map[string]string{
	LoadStatusDraft:             LoadStatusPublished,
	LoadStatusPublished:         LoadStatusDriverSelected,
	LoadStatusDriverSelected:    LoadStatusDriverEnRoute,
	LoadStatusDriverEnRoute:     LoadStatusAtPickup,
	LoadStatusAtPickup:          LoadStatusPickedUp,
	LoadStatusPickedUp:          LoadStatusEnRouteToDelivery,
	LoadStatusEnRouteToDelivery: LoadStatusDelivered,
	LoadStatusDelivered:         LoadStatusCompleted,
}

// CanonicalLoadStatus converts persisted legacy values to the closest known
// canonical state. It deliberately does not create history: no reliable
// actor, timestamp, or intermediate events can be inferred from old records.
func CanonicalLoadStatus(status string) string {
	switch status {
	case LoadStatusOpenLegacy, LoadStatusOffersReceived:
		return LoadStatusPublished
	case LoadStatusInTransit:
		return LoadStatusEnRouteToDelivery
	default:
		return status
	}
}

func ValidCanonicalLoadStatus(status string) bool {
	switch status {
	case LoadStatusDraft, LoadStatusPublished, LoadStatusDriverSelected,
		LoadStatusDriverEnRoute, LoadStatusAtPickup, LoadStatusPickedUp,
		LoadStatusEnRouteToDelivery, LoadStatusDelivered, LoadStatusCompleted,
		LoadStatusCancelled:
		return true
	default:
		return false
	}
}

func IsLegacyLoadStatus(status string) bool {
	return status == LoadStatusOpenLegacy || status == LoadStatusOffersReceived || status == LoadStatusInTransit
}

func NextLoadStatus(status string) (string, bool) {
	next, ok := nextLoadStatus[CanonicalLoadStatus(status)]
	return next, ok
}

// CanTransition is the single operational transition policy used by mobile,
// admin, offer acceptance, and the Redis persistence boundary. Cancellation
// is a terminal side transition from any non-terminal known state.
func CanTransition(from, to string) bool {
	from = CanonicalLoadStatus(from)
	if !ValidCanonicalLoadStatus(from) || !ValidCanonicalLoadStatus(to) || from == to {
		return false
	}
	if from == LoadStatusCompleted || from == LoadStatusCancelled {
		return false
	}
	if to == LoadStatusCancelled {
		return true
	}
	next, ok := nextLoadStatus[from]
	return ok && next == to
}

func IsActiveLoadStatus(status string) bool {
	status = CanonicalLoadStatus(status)
	return status != LoadStatusDraft && status != LoadStatusCompleted && status != LoadStatusCancelled && ValidCanonicalLoadStatus(status)
}

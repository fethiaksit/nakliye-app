package models

import "testing"

func TestLoadStatusStateMachine(t *testing.T) {
	normal := []string{
		LoadStatusPublished,
		LoadStatusDriverSelected,
		LoadStatusDriverEnRoute,
		LoadStatusAtPickup,
		LoadStatusPickedUp,
		LoadStatusEnRouteToDelivery,
		LoadStatusDelivered,
		LoadStatusCompleted,
	}
	for index := 0; index < len(normal)-1; index++ {
		if !CanTransition(normal[index], normal[index+1]) {
			t.Fatalf("expected transition %s -> %s", normal[index], normal[index+1])
		}
	}
	for _, transition := range [][2]string{
		{LoadStatusPublished, LoadStatusPickedUp},
		{LoadStatusDriverSelected, LoadStatusDelivered},
		{LoadStatusPickedUp, LoadStatusCompleted},
		{LoadStatusDriverEnRoute, LoadStatusDriverSelected},
		{LoadStatusCompleted, LoadStatusDelivered},
		{LoadStatusCancelled, LoadStatusPublished},
	} {
		if CanTransition(transition[0], transition[1]) {
			t.Fatalf("unexpected transition %s -> %s", transition[0], transition[1])
		}
	}
	if !CanTransition(LoadStatusPublished, LoadStatusCancelled) || !CanTransition(LoadStatusDelivered, LoadStatusCancelled) {
		t.Fatal("non-terminal statuses must support the terminal cancellation side transition")
	}
}

func TestLegacyLoadStatusCompatibility(t *testing.T) {
	for legacy, canonical := range map[string]string{
		LoadStatusOpenLegacy:     LoadStatusPublished,
		LoadStatusOffersReceived: LoadStatusPublished,
		LoadStatusInTransit:      LoadStatusEnRouteToDelivery,
	} {
		if got := CanonicalLoadStatus(legacy); got != canonical {
			t.Fatalf("CanonicalLoadStatus(%q)=%q want %q", legacy, got, canonical)
		}
	}
	if !CanTransition(LoadStatusOffersReceived, LoadStatusDriverSelected) {
		t.Fatal("legacy offers_received must continue through canonical offer acceptance")
	}
	if !CanTransition(LoadStatusInTransit, LoadStatusDelivered) {
		t.Fatal("legacy in_transit must continue at the delivery stage")
	}
}

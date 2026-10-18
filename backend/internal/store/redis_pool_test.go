package store

import (
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"nakliye-api/internal/models"
)

func TestRedisStorePoolAndBatchOperations(t *testing.T) {
	mr := miniredis.RunT(t)
	s, err := New("redis://" + mr.Addr())
	if err != nil {
		t.Fatalf("New store failed: %v", err)
	}
	if err := s.Ping(); err != nil {
		t.Fatalf("Ping failed: %v", err)
	}
	if stats := s.PoolStats(); stats == nil {
		t.Fatal("expected non-nil PoolStats")
	}

	now := time.Now().UTC()
	for i := 0; i < 5; i++ {
		load := models.Load{
			ID:         "load-" + string(rune('a'+i)),
			CustomerID: "cust-1",
			Title:      "Test Load",
			Status:     models.LoadStatusPublished,
			CreatedAt:  now.Add(time.Duration(i) * time.Second),
			UpdatedAt:  now,
		}
		if err := s.SaveLoad(load); err != nil {
			t.Fatalf("SaveLoad(%d) failed: %v", i, err)
		}
	}

	open, err := s.ListOpenLoads()
	if err != nil || len(open) != 5 {
		t.Fatalf("ListOpenLoads expected 5 loads, got %d (err=%v)", len(open), err)
	}

	paged, total, err := s.ListLoads("cust-1", "", LoadFilter{}, 0, 3)
	if err != nil || total != 5 || len(paged) != 3 {
		t.Fatalf("ListLoads expected total=5 len=3, got total=%d len=%d err=%v", total, len(paged), err)
	}

	allLoads, err := s.ListAllLoads()
	if err != nil || len(allLoads) != 5 {
		t.Fatalf("ListAllLoads expected 5, got %d err=%v", len(allLoads), err)
	}
}

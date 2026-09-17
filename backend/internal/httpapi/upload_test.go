package httpapi

import (
	"bytes"
	"mime/multipart"
	"net/textproto"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"nakliye-api/internal/store"
)

func TestSavePhotoUsesFileSignatureInsteadOfClaimedMIME(t *testing.T) {
	redisServer := miniredis.RunT(t)
	redisStore, err := store.New("redis://" + redisServer.Addr() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	api := NewWithOptions(redisStore, Options{Secret: integrationTestSecret, MaxUploadMB: 1})

	invalid := []byte("this is not an image")
	invalidHeader := &multipart.FileHeader{
		Filename: "fake.jpg", Size: int64(len(invalid)),
		Header: textproto.MIMEHeader{"Content-Type": []string{"image/jpeg"}},
	}
	if _, err = api.savePhoto(bytes.NewReader(invalid), invalidHeader, "", ""); err == nil || !strings.Contains(err.Error(), "yalnızca JPEG") {
		t.Fatalf("a fake JPEG must be rejected, got %v", err)
	}

	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d}
	pngHeader := &multipart.FileHeader{
		Filename: "valid.png", Size: int64(len(png)),
		Header: textproto.MIMEHeader{"Content-Type": []string{"application/octet-stream"}},
	}
	url, err := api.savePhoto(bytes.NewReader(png), pngHeader, "", "")
	if err != nil {
		t.Fatal(err)
	}
	id := strings.TrimPrefix(url, "/api/photos/")
	_, contentType, _, _, err := redisStore.GetPhoto(id)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "image/png" {
		t.Errorf("expected image/png, got %s", contentType)
	}

	pathHeader := &multipart.FileHeader{Filename: "../escape.png", Size: int64(len(png))}
	if _, err = api.savePhoto(bytes.NewReader(png), pathHeader, "", ""); err == nil || !strings.Contains(err.Error(), "dosya adı") {
		t.Fatalf("path traversal filename must be rejected, got %v", err)
	}

	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xDB, 0, 0, 0, 0}
	jpegHeader := &multipart.FileHeader{Filename: "valid.jpeg", Size: int64(len(jpeg))}
	jpegURL, err := api.savePhoto(bytes.NewReader(jpeg), jpegHeader, "", "")
	if err != nil {
		t.Fatal(err)
	}
	_, cType, _, _, _ := redisStore.GetPhoto(strings.TrimPrefix(jpegURL, "/api/photos/"))
	if cType != "image/jpeg" {
		t.Errorf("jpeg failed")
	}
}

func TestSavePhotoRejectsPathTraversal(t *testing.T) {
	redisServer := miniredis.RunT(t)
	redisStore, _ := store.New("redis://" + redisServer.Addr() + "/0")
	api := NewWithOptions(redisStore, Options{Secret: integrationTestSecret, MaxUploadMB: 1})

	header := &multipart.FileHeader{Filename: "../../../etc/passwd", Size: 10, Header: textproto.MIMEHeader{"Content-Type": []string{"image/jpeg"}}}
	if _, err := api.savePhoto(bytes.NewReader(make([]byte, 10)), header, "", ""); err == nil || !strings.Contains(err.Error(), "geçersiz") {
		t.Errorf("path traversal must be rejected")
	}
}

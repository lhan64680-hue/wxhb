package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadGRSAIDrawRequestAllowsResultPollingWithoutModel(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/local-ai/grsai/draw/result", strings.NewReader(`{"id":"task-123"}`))
	req.Header.Set("Content-Type", "application/json")

	body, contentType, err := readGRSAIDrawRequest(req)
	if err != nil {
		t.Fatalf("readGRSAIDrawRequest() error = %v", err)
	}
	if got := string(body); got != `{"id":"task-123"}` {
		t.Fatalf("body = %q", got)
	}
	if contentType != "application/json" {
		t.Fatalf("content type = %q", contentType)
	}
}

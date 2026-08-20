package handler

import (
	"net/http"
	"net/http/httptest"
	"reflect"
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

func TestDirectGRSAIAddressesIgnoreProxyVirtualIPs(t *testing.T) {
	response := grsaiDNSResponse{
		Status: 0,
		Answer: []grsaiDNSAnswer{
			{Type: 1, Data: "198.18.0.139"},
			{Type: 1, Data: "114.66.59.231"},
			{Type: 1, Data: "110.42.111.33"},
		},
	}

	if got, want := directGRSAIAddresses(response), []string{"114.66.59.231", "110.42.111.33"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("directGRSAIAddresses() = %v, want %v", got, want)
	}
}

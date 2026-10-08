package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalGRSAIBillingRejectsRemoteOrInvalidProvider(t *testing.T) {
	for _, test := range []struct {
		addr, base string
		status     int
	}{
		{"203.0.113.1:1234", "https://grsai.dakka.com.cn", http.StatusForbidden},
		{"127.0.0.1:1234", "https://untrusted.example", http.StatusBadRequest},
		{"127.0.0.1:1234", "http://grsai.dakka.com.cn", http.StatusBadRequest},
	} {
		request := httptest.NewRequest(http.MethodPost, "/api/local-ai/grsai/billing", nil)
		request.RemoteAddr = test.addr
		request.Header.Set(localGRSAIBaseURLHeader, test.base)
		response := httptest.NewRecorder()
		LocalGRSAIBilling(response, request)
		if response.Code != test.status {
			t.Errorf("address %s provider %s: status %d, want %d", test.addr, test.base, response.Code, test.status)
		}
	}
}

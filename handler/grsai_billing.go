package handler

import (
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

func LocalGRSAIBilling(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		FailWithStatus(w, http.StatusForbidden, "仅允许本机查询 GRS 积分")
		return
	}
	baseURL, ok := normalizeLocalGRSAIBaseURL(r.Header.Get(localGRSAIBaseURLHeader))
	if !ok {
		FailWithStatus(w, http.StatusBadRequest, "GRS 平台地址无效")
		return
	}
	transport := newDirectGRSAITransport()
	defer transport.CloseIdleConnections()
	apiKey := strings.TrimSpace(r.Header.Get(localGRSAIAPIKeyHeader))
	w.Header().Set("Cache-Control", "no-store")
	OK(w, service.FetchGRSAIBilling(r.Context(), baseURL, apiKey, transport))
}

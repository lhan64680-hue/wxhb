package handler

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

const userModelChannelHeader = "X-User-Model-Channel-ID"
const localKimiAPIKeyHeader = "X-Local-Kimi-API-Key"
const localKimiBaseURLHeader = "X-Local-Kimi-Base-URL"
const localGRSAIAPIKeyHeader = "X-Local-GRSAI-API-Key"
const localGRSAIBaseURLHeader = "X-Local-GRSAI-Base-URL"
const grsaiDirectDNSName = "dns.alidns.com"
const grsaiDirectDNSBootstrapIP = "223.5.5.5"

type grsaiDNSAnswer struct {
	Type int    `json:"type"`
	Data string `json:"data"`
}

type grsaiDNSResponse struct {
	Status int              `json:"Status"`
	Answer []grsaiDNSAnswer `json:"Answer"`
}

type grsaiDirectAddressCacheEntry struct {
	addresses []string
	expiresAt time.Time
}

var grsaiDirectAddressCache = struct {
	sync.Mutex
	entries map[string]grsaiDirectAddressCacheEntry
}{entries: make(map[string]grsaiDirectAddressCacheEntry)}

func selectAIRequestChannel(user model.AuthUser, modelName string, channelID string, userChannelID string) (model.ModelChannel, string, error) {
	userChannelID = strings.TrimSpace(userChannelID)
	if userChannelID != "" {
		channel, err := service.SelectUserLocalModelChannelForModel(user.ID, modelName, userChannelID)
		return channel, userChannelID, err
	}
	if !service.UserCanUseRemoteModelChannel(user) {
		return model.ModelChannel{}, "", fmt.Errorf("当前账号未开放云端渠道")
	}
	channel, err := service.SelectModelChannelForModel(modelName, channelID)
	return channel, "", err
}

func failAIChannelSelect(w http.ResponseWriter, err error, fallback string) {
	message := strings.TrimSpace(err.Error())
	switch message {
	case "当前账号未开放云端渠道", "请先登录", "缺少模型名称", "缺少模型渠道", "本地渠道不存在", "本地渠道配置不完整", "本地渠道不支持该模型", "指定模型渠道不可用":
		Fail(w, message)
	default:
		Fail(w, fallback)
	}
}

func AIImagesGenerations(w http.ResponseWriter, r *http.Request) {
	proxyAIRequest(w, r, "/images/generations")
}

func AIImagesEdits(w http.ResponseWriter, r *http.Request) {
	proxyAIRequest(w, r, "/images/edits")
}

func AIChatCompletions(w http.ResponseWriter, r *http.Request) {
	proxyAIRequest(w, r, "/chat/completions")
}

// LocalKimiChatCompletions lets a single-machine install use Kimi without an
// application account. It only accepts loopback requests and Moonshot's
// official endpoint, so it cannot be used as a generic anonymous HTTP proxy.
func LocalKimiChatCompletions(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		FailWithStatus(w, http.StatusForbidden, "仅允许本机访问 Kimi 本地通道")
		return
	}

	apiKey := strings.TrimSpace(r.Header.Get(localKimiAPIKeyHeader))
	baseURL, ok := normalizeLocalKimiBaseURL(r.Header.Get(localKimiBaseURLHeader))
	if apiKey == "" || !ok {
		FailWithStatus(w, http.StatusBadRequest, "Kimi 本地通道配置不完整")
		return
	}

	body, contentType, modelName, err := readAIRequest(r)
	if err != nil || !strings.EqualFold(strings.TrimSpace(modelName), "kimi-k3") {
		FailWithStatus(w, http.StatusBadRequest, "Kimi 本地通道仅支持 kimi-k3")
		return
	}

	request, err := http.NewRequest(http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		Fail(w, "Kimi 本地请求创建失败")
		return
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", firstNonEmpty(contentType, "application/json"))

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	response, err := (&http.Client{Timeout: 600 * time.Second, Transport: transport}).Do(request)
	if err != nil {
		log.Printf("local Kimi request failed: %v", err)
		Fail(w, "Kimi 本地直连失败")
		return
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 256*1024))
		FailWithStatus(w, response.StatusCode, readUpstreamAIErrorMessage(payload, response.StatusCode))
		return
	}

	for key, values := range response.Header {
		if strings.EqualFold(key, "Content-Length") || strings.EqualFold(key, "Content-Encoding") || strings.EqualFold(key, "Transfer-Encoding") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	copyAIResponseBody(w, response.Body)
}

// LocalGRSAIDraw forwards only the two documented GRS draw endpoints from the
// local application. Keeping the request on the same origin avoids browser CORS
// failures while the outbound request remains a direct connection with proxies
// explicitly disabled.
func LocalGRSAIDraw(w http.ResponseWriter, r *http.Request, action string) {
	if !isLoopbackRequest(r) {
		FailWithStatus(w, http.StatusForbidden, "仅允许本机访问 GRS AI 本地通道")
		return
	}

	action = strings.ToLower(strings.TrimSpace(action))
	if action != "completions" && action != "result" {
		FailWithStatus(w, http.StatusNotFound, "不支持的 GRS 图像接口")
		return
	}

	apiKey := strings.TrimSpace(r.Header.Get(localGRSAIAPIKeyHeader))
	baseURL, ok := normalizeLocalGRSAIBaseURL(r.Header.Get(localGRSAIBaseURLHeader))
	if apiKey == "" || !ok {
		FailWithStatus(w, http.StatusBadRequest, "GRS AI 本地通道配置不完整")
		return
	}

	body, contentType, err := readGRSAIDrawRequest(r)
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "GRS 图像请求读取失败")
		return
	}

	request, err := http.NewRequest(http.MethodPost, baseURL+"/v1/draw/"+action, bytes.NewReader(body))
	if err != nil {
		Fail(w, "GRS 图像请求创建失败")
		return
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", firstNonEmpty(contentType, "application/json"))

	transport := newDirectGRSAITransport()
	response, err := (&http.Client{Timeout: 180 * time.Second, Transport: transport}).Do(request)
	if err != nil {
		log.Printf("local GRS draw request failed: %v", err)
		Fail(w, "GRS AI 国内直连失败")
		return
	}
	defer response.Body.Close()

	for key, values := range response.Header {
		if strings.EqualFold(key, "Content-Length") || strings.EqualFold(key, "Content-Encoding") || strings.EqualFold(key, "Transfer-Encoding") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	copyAIResponseBody(w, response.Body)
}

// newDirectGRSAITransport bypasses system fake-IP DNS mappings (such as
// 198.18.0.0/15) while keeping TLS validation bound to GRS's official hostname.
func newDirectGRSAITransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil || (host != "grsai.dakka.com.cn" && host != "grsaiapi.com") {
			return dialer.DialContext(ctx, network, address)
		}

		addresses, err := resolveDirectGRSAIAddresses(ctx, host)
		if err != nil {
			return nil, err
		}
		var lastErr error
		for _, ip := range addresses {
			connection, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip, port))
			if err == nil {
				return connection, nil
			}
			lastErr = err
		}
		return nil, fmt.Errorf("GRS AI 国内直连地址不可达: %w", lastErr)
	}
	return transport
}

func resolveDirectGRSAIAddresses(ctx context.Context, host string) ([]string, error) {
	grsaiDirectAddressCache.Lock()
	entry, cached := grsaiDirectAddressCache.entries[host]
	grsaiDirectAddressCache.Unlock()
	if cached && time.Now().Before(entry.expiresAt) {
		return entry.addresses, nil
	}

	lookupContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(lookupContext, http.MethodGet, "https://"+grsaiDirectDNSName+"/resolve?name="+url.QueryEscape(host)+"&type=A", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/dns-json")
	bootstrapTransport := http.DefaultTransport.(*http.Transport).Clone()
	bootstrapTransport.Proxy = nil
	bootstrapTransport.TLSClientConfig = &tls.Config{ServerName: grsaiDirectDNSName, MinVersion: tls.VersionTLS12}
	bootstrapDialer := &net.Dialer{Timeout: 10 * time.Second}
	bootstrapTransport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		_, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		return bootstrapDialer.DialContext(ctx, network, net.JoinHostPort(grsaiDirectDNSBootstrapIP, port))
	}
	response, err := (&http.Client{Timeout: 10 * time.Second, Transport: bootstrapTransport}).Do(request)
	if err != nil {
		return nil, fmt.Errorf("GRS AI 直连 DNS 查询失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GRS AI 直连 DNS 查询返回 HTTP %d", response.StatusCode)
	}
	var payload grsaiDNSResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&payload); err != nil {
		return nil, fmt.Errorf("GRS AI 直连 DNS 响应无效: %w", err)
	}
	addresses := directGRSAIAddresses(payload)
	if payload.Status != 0 || len(addresses) == 0 {
		return nil, fmt.Errorf("GRS AI 直连 DNS 未返回公网地址")
	}
	grsaiDirectAddressCache.Lock()
	grsaiDirectAddressCache.entries[host] = grsaiDirectAddressCacheEntry{addresses: addresses, expiresAt: time.Now().Add(5 * time.Minute)}
	grsaiDirectAddressCache.Unlock()
	return addresses, nil
}

func directGRSAIAddresses(payload grsaiDNSResponse) []string {
	addresses := make([]string, 0, len(payload.Answer))
	for _, answer := range payload.Answer {
		ip := net.ParseIP(answer.Data)
		if answer.Type != 1 || ip == nil || isGRSAIFakeIP(ip) {
			continue
		}
		addresses = append(addresses, ip.String())
	}
	return addresses
}

func isGRSAIFakeIP(ip net.IP) bool {
	v4 := ip.To4()
	return v4 != nil && v4[0] == 198 && (v4[1] == 18 || v4[1] == 19)
}

func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func normalizeLocalKimiBaseURL(value string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || !strings.EqualFold(parsed.Hostname(), "api.moonshot.cn") {
		return "", false
	}
	path := strings.TrimRight(parsed.Path, "/")
	if path != "" && !strings.EqualFold(path, "/v1") {
		return "", false
	}
	return "https://api.moonshot.cn/v1", true
}

func normalizeLocalGRSAIBaseURL(value string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "grsai.dakka.com.cn" && host != "grsaiapi.com" {
		return "", false
	}
	path := strings.TrimRight(parsed.Path, "/")
	if path != "" && !strings.EqualFold(path, "/v1") {
		return "", false
	}
	return "https://" + host, true
}

func AIResponses(w http.ResponseWriter, r *http.Request) {
	proxyAIRequest(w, r, "/responses")
}

func AIVideos(w http.ResponseWriter, r *http.Request) {
	proxyAIVideoTaskRequest(w, r)
}

func AIVideo(w http.ResponseWriter, r *http.Request, id string) {
	if serveAIVideoTask(w, r, id) {
		return
	}
	if isClientVideoTaskID(id) {
		OK(w, map[string]any{"id": id, "task_id": id, "object": "video", "status": "queued", "progress": 0})
		return
	}
	proxyAIGetRequest(w, r, "/videos/"+id)
}

func AIVideoContent(w http.ResponseWriter, r *http.Request, id string) {
	proxyAIGetRequest(w, r, "/videos/"+id+"/content")
}

func AIAudioSpeech(w http.ResponseWriter, r *http.Request) {
	proxyAIRequest(w, r, "/audio/speech")
}

func proxyAIGetRequest(w http.ResponseWriter, r *http.Request, path string) {
	startedAt := time.Now()
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	modelName := r.URL.Query().Get("model")
	if strings.TrimSpace(modelName) == "" {
		modelName = "Agnes-Video-V2.0"
	}
	channel, _, err := selectAIRequestChannel(user, modelName, r.Header.Get("X-Model-Channel-ID"), r.Header.Get(userModelChannelHeader))
	if err != nil {
		log.Printf("AI proxy select channel failed: model=%s err=%v", modelName, err)
		failAIChannelSelect(w, err, "AI 接口请求失败")
		return
	}
	upstreamPath := resolveAIProxyPath(channel, modelName, path)
	request, err := http.NewRequest(http.MethodGet, resolveAIProxyURL(channel, modelName, upstreamPath), nil)
	if err != nil {
		Fail(w, "AI 接口请求失败")
		return
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	copyAIResponse(w, request, channel, aiLogContext{StartedAt: startedAt, Endpoint: path, Method: http.MethodGet, Model: modelName, Channel: channel, UserID: user.ID, UserDisplayName: firstNonEmpty(user.DisplayName, user.Username), RequestBody: summarizeQueryParams(r.URL.Query())}, nil)
}

func proxyAIRequest(w http.ResponseWriter, r *http.Request, path string) {
	startedAt := time.Now()
	body, contentType, modelName, err := readAIRequest(r)
	if err != nil {
		log.Printf("AI proxy request read failed: %v", err)
		Fail(w, "AI 接口请求失败")
		return
	}
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	channel, userChannelID, err := selectAIRequestChannel(user, modelName, r.Header.Get("X-Model-Channel-ID"), r.Header.Get(userModelChannelHeader))
	if err != nil {
		log.Printf("AI proxy select channel failed: model=%s err=%v", modelName, err)
		failAIChannelSelect(w, err, "AI 接口请求失败")
		return
	}
	credits := 0
	if userChannelID == "" {
		credits, err = service.ModelCost(modelName)
		if err != nil {
			log.Printf("AI proxy read model cost failed: model=%s err=%v", modelName, err)
			Fail(w, "AI 接口请求失败")
			return
		}
		credits *= readAIRequestCount(body, contentType)
	}
	upstreamPath := resolveAIProxyPath(channel, modelName, path)
	if isKIEChannel(channel, modelName) && upstreamPath == "/jobs/createTask" {
		body, contentType, err = normalizeKIEVideoBody(body, contentType, modelName, channel)
		if err != nil {
			log.Printf("AI proxy normalize KIE request failed: model=%s err=%v", modelName, err)
			Fail(w, "AI 接口请求失败")
			return
		}
	} else if isAPIMartChannel(channel, modelName) && upstreamPath == "/videos/generations" {
		body, contentType, err = normalizeAPIMartVideoBody(body, contentType, modelName, channel)
		if err != nil {
			log.Printf("AI proxy normalize APIMart video request failed: model=%s err=%v", modelName, err)
			Fail(w, "AI 接口请求失败")
			return
		}
	} else if isAPIMartChannel(channel, modelName) && (upstreamPath == "/images/generations" || upstreamPath == "/images/edits") {
		body, contentType, err = normalizeAPIMartImageBody(body, contentType, modelName, channel)
		if err != nil {
			log.Printf("AI proxy normalize APIMart image request failed: model=%s err=%v", modelName, err)
			Fail(w, "AI 接口请求失败")
			return
		}
	}
	request, err := http.NewRequest(http.MethodPost, service.BuildModelChannelURL(channel, upstreamPath), bytes.NewReader(body))
	if err != nil {
		log.Printf("AI proxy build request failed: url=%s err=%v", service.BuildModelChannelURL(channel, upstreamPath), err)
		Fail(w, "AI 接口请求失败")
		return
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if credits > 0 {
		if err := service.ConsumeUserCredits(user.ID, modelName, credits, upstreamPath); err != nil {
			FailError(w, err)
			return
		}
	}
	copyAIResponse(w, request, channel, aiLogContext{
		StartedAt:       startedAt,
		Endpoint:        path,
		Method:          http.MethodPost,
		Model:           modelName,
		Channel:         channel,
		UserID:          user.ID,
		UserDisplayName: firstNonEmpty(user.DisplayName, user.Username),
		Credits:         credits,
		RequestBody:     summarizeAIRequest(body, contentType),
	}, func() {
		if credits > 0 {
			if err := service.RefundUserCredits(user.ID, modelName, credits, upstreamPath); err != nil {
				log.Printf("AI proxy refund credits failed: user=%s model=%s credits=%d err=%v", user.ID, modelName, credits, err)
			}
		}
	})
}

type aiLogContext struct {
	StartedAt       time.Time
	Endpoint        string
	Method          string
	Model           string
	Channel         model.ModelChannel
	UserID          string
	UserDisplayName string
	Credits         int
	RequestBody     string
}

func copyAIResponse(w http.ResponseWriter, request *http.Request, channel model.ModelChannel, logContext aiLogContext, onFailure func()) {
	response, err := service.HTTPClientForChannel(channel).Do(request)
	if err != nil {
		log.Printf("AI proxy request failed: url=%s err=%v", request.URL.String(), err)
		if onFailure != nil {
			onFailure()
		}
		saveAIProxyLog(logContext, 0, "", err.Error())
		Fail(w, "AI 接口请求失败")
		return
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 256*1024))
		log.Printf("AI upstream error: url=%s status=%d body=%s", request.URL.String(), response.StatusCode, strings.TrimSpace(string(payload)))
		if onFailure != nil {
			onFailure()
		}
		saveAIProxyLog(logContext, response.StatusCode, string(payload), strings.TrimSpace(string(payload)))
		Fail(w, readUpstreamAIErrorMessage(payload, response.StatusCode))
		return
	}

	if copyKIEVideoResponse(w, response, request, channel, logContext, onFailure) {
		return
	}
	if isAPIMartChannel(channel, logContext.Model) {
		if copyAPIMartImageResponse(w, response, request, channel, logContext, onFailure) {
			return
		}
		if copyAPIMartVideoResponse(w, response, request, channel, logContext) {
			return
		}
	}

	for key, values := range response.Header {
		if strings.EqualFold(key, "Content-Length") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	responseBody := copyAIResponseBody(w, response.Body)
	saveAIProxyLog(logContext, response.StatusCode, responseBody, "")
}

func copyAIResponseBody(w http.ResponseWriter, body io.Reader) string {
	flusher, canFlush := w.(http.Flusher)
	buffer := make([]byte, 32*1024)
	var logBuffer strings.Builder
	for {
		n, err := body.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				return logBuffer.String()
			}
			if logBuffer.Len() < 64*1024 {
				_, _ = logBuffer.Write(buffer[:min(n, 64*1024-logBuffer.Len())])
			}
			if canFlush {
				flusher.Flush()
			}
		}
		if err != nil {
			return logBuffer.String()
		}
	}
}

func saveAIProxyLog(context aiLogContext, status int, responseBody string, errorMessage string) {
	if context.StartedAt.IsZero() {
		context.StartedAt = time.Now()
	}
	service.SaveAICallLog(service.AICallLogInput{
		UserID:          context.UserID,
		UserDisplayName: context.UserDisplayName,
		Endpoint:        context.Endpoint,
		Method:          context.Method,
		Model:           context.Model,
		ChannelID:       context.Channel.ID,
		ChannelName:     context.Channel.Name,
		Status:          status,
		DurationMs:      time.Since(context.StartedAt).Milliseconds(),
		Credits:         context.Credits,
		RequestBody:     context.RequestBody,
		ResponseBody:    responseBody,
		Error:           errorMessage,
	})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func summarizeAIRequest(body []byte, contentType string) string {
	if strings.HasPrefix(contentType, "multipart/form-data") {
		return summarizeMultipartAIRequest(body, contentType)
	}
	var payload any
	if err := json.Unmarshal(body, &payload); err == nil {
		redactLargeImages(&payload)
		if encoded, err := json.MarshalIndent(payload, "", "  "); err == nil {
			return string(encoded)
		}
	}
	return string(body)
}

func summarizeQueryParams(values map[string][]string) string {
	if len(values) == 0 {
		return ""
	}
	encoded, _ := json.MarshalIndent(values, "", "  ")
	return string(encoded)
}

func summarizeMultipartAIRequest(body []byte, contentType string) string {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return "multipart/form-data"
	}
	form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
	if err != nil {
		return "multipart/form-data"
	}
	defer form.RemoveAll()
	summary := map[string]any{"fields": form.Value}
	files := []map[string]any{}
	for field, headers := range form.File {
		for _, header := range headers {
			files = append(files, map[string]any{"field": field, "filename": header.Filename, "size": header.Size, "contentType": header.Header.Get("Content-Type")})
		}
	}
	summary["files"] = files
	encoded, _ := json.MarshalIndent(summary, "", "  ")
	return string(encoded)
}

func readUpstreamAIErrorMessage(body []byte, statusCode int) string {
	var payload struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Msg     string `json:"msg"`
		Message string `json:"message"`
	}
	if len(body) > 0 && json.Unmarshal(body, &payload) == nil {
		if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
			return payload.Error.Message
		}
		if strings.TrimSpace(payload.Msg) != "" {
			return payload.Msg
		}
		if strings.TrimSpace(payload.Message) != "" {
			return payload.Message
		}
	}
	if statusCode > 0 {
		return fmt.Sprintf("AI 接口请求失败：%d", statusCode)
	}
	return "AI 接口请求失败"
}

func redactLargeImages(value *any) {
	switch typed := (*value).(type) {
	case map[string]any:
		for key, item := range typed {
			if text, ok := item.(string); ok && (strings.HasPrefix(text, "data:image/") || strings.HasPrefix(text, "data:video/") || strings.HasPrefix(text, "data:audio/") || len(text) > 2048 && looksLikeBase64(text)) {
				typed[key] = fmt.Sprintf("[redacted media/string len=%d]", len(text))
				continue
			}
			redactLargeImages(&item)
			typed[key] = item
		}
	case []any:
		for index, item := range typed {
			redactLargeImages(&item)
			typed[index] = item
		}
	}
}

func looksLikeBase64(value string) bool {
	for _, char := range value[:min(len(value), 200)] {
		if !(char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '+' || char == '/' || char == '=') {
			return false
		}
	}
	return true
}

func readAIRequest(r *http.Request) ([]byte, string, string, error) {
	contentType := r.Header.Get("Content-Type")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, "", "", err
	}
	modelName := ""
	if strings.HasPrefix(contentType, "multipart/form-data") {
		modelName = readMultipartModel(body, contentType)
	} else {
		var payload struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &payload)
		modelName = payload.Model
	}
	if strings.TrimSpace(modelName) == "" {
		return nil, "", "", errMissingModel
	}
	return body, contentType, modelName, nil
}

// GRS creates require a model, but /draw/result only accepts a task ID.
// Do not use readAIRequest here: its shared model requirement rejects normal
// result polling before the request reaches the GRS service.
func readGRSAIDrawRequest(r *http.Request) ([]byte, string, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, "", err
	}
	return body, r.Header.Get("Content-Type"), nil
}

func readMultipartModel(body []byte, contentType string) string {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return ""
	}
	reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
	form, err := reader.ReadForm(32 << 20)
	if err != nil {
		return ""
	}
	defer form.RemoveAll()
	if values := form.Value["model"]; len(values) > 0 {
		return values[0]
	}
	return ""
}

func readAIRequestCount(body []byte, contentType string) int {
	count := 1
	if strings.HasPrefix(contentType, "multipart/form-data") {
		_, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			return count
		}
		form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
		if err != nil {
			return count
		}
		defer form.RemoveAll()
		if values := form.Value["n"]; len(values) > 0 {
			_, _ = fmt.Sscan(values[0], &count)
		}
	} else {
		var payload struct {
			N int `json:"n"`
		}
		_ = json.Unmarshal(body, &payload)
		count = payload.N
	}
	if count < 1 {
		return 1
	}
	return count
}

func resolveAIProxyURL(channel model.ModelChannel, modelName string, path string) string {
	if videoID, ok := agnesVideoQueryID(modelName, path); ok {
		baseURL := strings.TrimRight(strings.TrimSpace(channel.BaseURL), "/")
		if strings.HasSuffix(strings.ToLower(baseURL), "/v1") {
			baseURL = strings.TrimRight(baseURL[:len(baseURL)-len("/v1")], "/")
		}
		values := url.Values{}
		values.Set("video_id", videoID)
		values.Set("model_name", modelName)
		return baseURL + "/agnesapi?" + values.Encode()
	}
	return service.BuildModelChannelURL(channel, path)
}

func agnesVideoQueryID(modelName string, path string) (string, bool) {
	if !isAgnesVideoModel(modelName) || !strings.HasPrefix(path, "/videos/") || strings.HasSuffix(path, "/content") {
		return "", false
	}
	id := strings.TrimPrefix(path, "/videos/")
	if strings.HasPrefix(id, "video_") {
		return id, true
	}
	return "", false
}

func resolveAIProxyPath(channel model.ModelChannel, modelName string, path string) string {
	if isKIEChannel(channel, modelName) {
		if path == "/videos" || path == "/images/generations" || path == "/images/edits" {
			return "/jobs/createTask"
		}
		if strings.HasPrefix(path, "/videos/") && !strings.HasSuffix(path, "/content") {
			taskID := strings.TrimSpace(strings.TrimPrefix(path, "/videos/"))
			if taskID != "" && !strings.Contains(taskID, "/") {
				return "/jobs/recordInfo?taskId=" + url.QueryEscape(taskID)
			}
		}
		return path
	}
	if isAPIMartChannel(channel, modelName) {
		if path == "/videos" {
			return "/videos/generations"
		}
		if path == "/images/edits" {
			model := normalizeAPIMartModelName(modelName)
			if strings.Contains(model, "grok-imagine") && strings.Contains(model, "edit") {
				return path
			}
			return "/images/generations"
		}
		if strings.HasPrefix(path, "/videos/") && !strings.HasSuffix(path, "/content") {
			taskID := strings.TrimSpace(strings.TrimPrefix(path, "/videos/"))
			if taskID != "" && !strings.Contains(taskID, "/") {
				return "/tasks/" + url.PathEscape(taskID) + "?language=zh"
			}
		}
		return path
	}
	if isArkSeedanceVideo(channel.BaseURL, modelName) {
		if path == "/videos" {
			return "/contents/generations/tasks"
		}
		if strings.HasPrefix(path, "/videos/") && !strings.HasSuffix(path, "/content") {
			return "/contents/generations/tasks/" + strings.TrimPrefix(path, "/videos/")
		}
	}
	return path
}

func isArkSeedanceVideo(baseURL string, modelName string) bool {
	base := strings.ToLower(baseURL)
	model := strings.ToLower(modelName)
	return strings.Contains(model, "seedance") || strings.Contains(model, "doubao-seedance") || strings.Contains(base, "/api/plan/v3")
}

func isAgnesVideoModel(modelName string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(modelName)), "agnes-video")
}

var errMissingModel = &aiError{"缺少模型名称"}

type aiError struct {
	message string
}

func (err *aiError) Error() string {
	return err.message
}

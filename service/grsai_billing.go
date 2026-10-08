package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type GRSAIImagePrice struct {
	Name            string   `json:"name"`
	Credits         *float64 `json:"credits"`
	Description     string   `json:"description"`
	Unavailable     bool     `json:"unavailable"`
	Maintenance     string   `json:"maintenance"`
	ErrorReturn     bool     `json:"errorReturn"`
	ViolationReturn bool     `json:"violationReturn"`
}

type GRSAIBilling struct {
	Balance       *float64          `json:"balance"`
	BalanceSource string            `json:"balanceSource"`
	BalanceError  string            `json:"balanceError,omitempty"`
	Models        []GRSAIImagePrice `json:"models"`
	ModelsError   string            `json:"modelsError,omitempty"`
	UpdatedAt     int64             `json:"updatedAt"`
}

// Resolve the account balance using the generation key. Key-specific quota is
// not the account balance. Only the server uses the provider's documented query
// parameter; never return or log the upstream URL (it contains a credential).
func FetchGRSAIBilling(ctx context.Context, baseURL, apiKey string, transport http.RoundTripper) GRSAIBilling {
	client := &http.Client{Timeout: 18 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	result := GRSAIBilling{BalanceSource: "account", Models: []GRSAIImagePrice{}}
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		if apiKey == "" {
			result.BalanceError = "请先在配置中保存 GRS API Key"
			return
		}
		var data struct {
			Credits *float64 `json:"credits"`
		}
		endpoint := baseURL + "/client/common/getCredits?" + url.Values{"apikey": {apiKey}}.Encode()
		if err := grsaiBillingRequest(ctx, client, http.MethodGet, endpoint, nil, &data); err != nil {
			result.BalanceError = strings.ReplaceAll(err.Error(), apiKey, "[已隐藏]")
		} else if data.Credits == nil || *data.Credits < 0 {
			result.BalanceError = "平台未返回有效的可用积分"
		} else {
			result.Balance = data.Credits
		}
	}()
	go func() {
		defer workers.Done()
		var data struct {
			List []struct {
				Name            string   `json:"name"`
				Type            string   `json:"type"`
				Cost            *float64 `json:"cost"`
				CostType        *int     `json:"costType"`
				Description     string   `json:"desc"`
				CloseModel      bool     `json:"closeModel"`
				Maintenance     string   `json:"maintenance"`
				ErrorReturn     bool     `json:"errorReturn"`
				ViolationReturn bool     `json:"violationReturn"`
			} `json:"list"`
		}
		if err := grsaiBillingRequest(ctx, client, http.MethodPost, baseURL+"/client/serverGrsai/getModelListV2", struct{}{}, &data); err != nil {
			result.ModelsError = err.Error()
			return
		}
		for _, item := range data.List {
			if item.Type != "image" || item.Name == "" {
				continue
			}
			credits := item.Cost
			if item.CostType == nil || *item.CostType != 0 || credits != nil && *credits < 0 {
				credits = nil
			}
			result.Models = append(result.Models, GRSAIImagePrice{
				Name: item.Name, Credits: credits, Description: item.Description,
				Unavailable: item.CloseModel, Maintenance: item.Maintenance,
				ErrorReturn: item.ErrorReturn, ViolationReturn: item.ViolationReturn,
			})
		}
		if len(result.Models) == 0 {
			result.ModelsError = "平台未返回图片模型价格"
		}
	}()
	workers.Wait()
	result.UpdatedAt = time.Now().UnixMilli()
	return result
}

func grsaiBillingRequest(ctx context.Context, client *http.Client, method, endpoint string, body any, data any) error {
	var requestBody io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("积分查询参数无效")
		}
		requestBody = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, requestBody)
	if err != nil {
		return fmt.Errorf("积分查询请求创建失败")
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("GRS 积分服务连接失败，请稍后刷新")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GRS 积分查询失败：HTTP %d", response.StatusCode)
	}
	var payload struct {
		Code *int            `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&payload); err != nil || payload.Code == nil {
		return fmt.Errorf("GRS 积分查询响应无效")
	}
	if *payload.Code != 0 {
		if payload.Msg != "" {
			return fmt.Errorf("GRS：%s", payload.Msg)
		}
		return fmt.Errorf("GRS 积分查询失败")
	}
	if err := json.Unmarshal(payload.Data, data); err != nil {
		return fmt.Errorf("GRS 积分数据无效")
	}
	return nil
}

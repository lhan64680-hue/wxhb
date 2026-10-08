package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

type billingTestTransport func(*http.Request) (*http.Response, error)

func (f billingTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func billingTestResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func TestGRSAIBillingUsesAccountBalanceNotKeyQuota(t *testing.T) {
	transport := billingTestTransport(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/client/common/getCredits":
			return billingTestResponse(200, `{"code":0,"data":{"credits":5000}}`), nil
		case "/client/openapi/getAPIKeyCredits":
			return billingTestResponse(200, `{"code":0,"data":{"credits":0}}`), nil
		default:
			return billingTestResponse(200, billingTestModels), nil
		}
	})
	result := FetchGRSAIBilling(context.Background(), "https://grsai.dakka.com.cn", "test-key", transport)
	if result.Balance == nil || *result.Balance != 5000 {
		if result.Balance == nil {
			t.Fatal("账户余额未返回")
		}
		t.Fatalf("账户积分应为 5000，不能显示 Key 额度 0；实际 balance=%v", *result.Balance)
	}
	if result.BalanceSource != "account" {
		t.Fatal("must explicitly identify the balance as account balance")
	}
}

const billingTestModels = `{"code":0,"data":{"list":[
{"name":"gpt-image-2","type":"image","cost":600,"costType":0,"desc":"标准","errorReturn":true,"violationReturn":true},
{"name":"paused","type":"image","cost":2000,"costType":0,"closeModel":true,"maintenance":"维护中"},
{"name":"token-priced","type":"image","cost":10,"costType":1},
{"name":"missing-price","type":"image","costType":0},
{"name":"missing-unit","type":"image","cost":10},
{"name":"negative-price","type":"image","cost":-1,"costType":0},
{"name":"video","type":"video","cost":3000,"costType":0}]}}`

func TestGRSAIBillingReadsBalanceAndImagePrices(t *testing.T) {
	var calls atomic.Int32
	transport := billingTestTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.URL.Path == "/client/common/getCredits" {
			if r.Method != http.MethodGet || r.URL.Query().Get("apikey") != "test-key" || len(r.URL.Query()) != 1 {
				t.Errorf("must use documented account balance endpoint and parameter")
			}
			return billingTestResponse(200, `{"code":0,"data":{"credits":12345.5}}`), nil
		}
		if r.URL.Path != "/client/serverGrsai/getModelListV2" || r.Method != http.MethodPost || r.URL.RawQuery != "" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected model endpoint %q", r.URL.Path)
		}
		return billingTestResponse(200, billingTestModels), nil
	})
	result := FetchGRSAIBilling(context.Background(), "https://grsai.dakka.com.cn", "test-key", transport)
	if calls.Load() != 2 || result.Balance == nil || *result.Balance != 12345.5 || result.BalanceError != "" || result.ModelsError != "" || result.UpdatedAt <= 0 {
		t.Fatalf("unexpected billing response: %+v", result)
	}
	if len(result.Models) != 6 || result.Models[0].Credits == nil || *result.Models[0].Credits != 600 || !result.Models[0].ErrorReturn || !result.Models[0].ViolationReturn || !result.Models[1].Unavailable {
		t.Fatalf("image prices or availability incorrect: %+v", result.Models)
	}
	for _, item := range result.Models[2:] {
		if item.Credits != nil {
			t.Errorf("unknown/non-per-call price incorrectly treated as per-call: %s", item.Name)
		}
	}
}

func TestGRSAIBillingNeverTreatsMissingOrFailedBalanceAsZero(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
		validZero  bool
	}{
		{"zero", `{"code":0,"data":{"credits":0}}`, 200, true},
		{"missing", `{"code":0,"data":{}}`, 200, false},
		{"negative", `{"code":0,"data":{"credits":-1}}`, 200, false},
		{"denied", `{"code":1,"msg":"invalid test-key"}`, 200, false},
		{"non-json", `data: not JSON`, 200, false},
		{"http-error", `{}`, 502, false},
		{"missing-code", `{"data":{"credits":0}}`, 200, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			transport := billingTestTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/client/common/getCredits" {
					return billingTestResponse(test.status, test.body), nil
				}
				return billingTestResponse(200, billingTestModels), nil
			})
			result := FetchGRSAIBilling(context.Background(), "https://grsai.dakka.com.cn", "test-key", transport)
			if test.validZero {
				if result.Balance == nil || *result.Balance != 0 || result.BalanceError != "" {
					t.Fatalf("valid zero rejected: %+v", result)
				}
			} else if result.Balance != nil || result.BalanceError == "" || strings.Contains(result.BalanceError, "test-key") {
				t.Fatalf("error lost or credential exposed: %+v", result)
			}
			if len(result.Models) == 0 {
				t.Fatal("balance failure must not hide public prices")
			}
		})
	}
}

func TestGRSAIBillingEmptyKeyStillLoadsPrices(t *testing.T) {
	var calls atomic.Int32
	transport := billingTestTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if !strings.HasSuffix(r.URL.Path, "getModelListV2") {
			t.Error("must not send empty key to balance endpoint")
		}
		return billingTestResponse(200, billingTestModels), nil
	})
	result := FetchGRSAIBilling(context.Background(), "https://grsai.dakka.com.cn", "", transport)
	if calls.Load() != 1 || result.Balance != nil || result.BalanceError == "" || len(result.Models) == 0 {
		t.Fatalf("empty key handling incorrect: %+v", result)
	}
}

func TestGRSAIBillingDoesNotForwardKeyOnRedirect(t *testing.T) {
	transport := billingTestTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "grsai.dakka.com.cn" {
			t.Error("credentials forwarded to another host")
		}
		response := billingTestResponse(307, "")
		response.Header.Set("Location", "https://untrusted.example/")
		return response, nil
	})
	result := FetchGRSAIBilling(context.Background(), "https://grsai.dakka.com.cn", "test-key", transport)
	if result.Balance != nil || result.BalanceError == "" || result.ModelsError == "" {
		t.Fatal("redirect must fail safely")
	}
}

---
title: 接口响应约定
description: 业务接口统一响应结构与前端处理约定
---

# 接口响应约定

后端业务接口统一返回 JSON：

```json
{
  "code": 0,
  "data": {},
  "msg": "ok"
}
```

- `code`: 业务状态码，`0` 表示成功，非 `0` 表示失败。
- `data`: 业务数据。失败时通常为 `null`。
- `msg`: 响应消息。成功默认为 `ok`，失败时放错误原因。

前端请求逻辑以 `code` 判断业务是否成功。当前后端业务失败也会返回 HTTP 200，前端不要只依赖 HTTP 状态码判断结果。

接口连接失败、服务不可达、返回体不是约定 JSON 时，前端按网络或接口异常处理。

## 本机 GRS 生图积分查询

`POST /api/local-ai/grsai/billing` 仅允许 loopback 请求。请求头 `X-Local-GRSAI-Base-URL` 为既有 GRS 渠道地址（仅允许 HTTPS 的 `grsai.dakka.com.cn`、`grsaiapi.com`），`X-Local-GRSAI-API-Key` 为该渠道 Key；缺少 Key 时仍查询公开模型价格。后端禁用代理并拒绝上游重定向，不持久化 Key，响应禁止缓存。

`data` 包含 `balance`（当前 Key 所属账户的积分余额，未查询成功为 `null`，不能当作 0）、`balanceSource`（固定为 `account`）、`balanceError`、`models`、`modelsError` 和 `updatedAt`（毫秒时间戳）。前端仅使用 `balanceSource=account` 的值显示账户余额和判断账户积分不足，避免旧 Key 额度缓存混入。余额和价格独立查询，一项失败不会隐藏另一项。`models` 仅包含图片模型，字段为 `name`、`credits`（积分/调用，未知或非按次计价为 `null`）、`description`、`unavailable`、`maintenance`、`errorReturn`、`violationReturn`。

对应上游接口为官方文档中的 `GET /client/common/getCredits?apikey=...` 和 `POST /client/serverGrsai/getModelListV2`；`/client/openapi/getAPIKeyCredits` 查询的是 Key 单独额度，不能用于账户余额。账户余额查询只由本机后端按官方协议构造 URL，Key 不进入浏览器请求 URL；错误信息不包含上游 URL，应用不记录该 URL，并禁止重定向。上游未提供已验证的逐任务实际扣费字段，前端只按提交时模型单价保存 `billing.estimatedCredits`，明确标注“消耗估算”；不使用账户余额差值归因单张费用，也不假定失败已经返还积分。

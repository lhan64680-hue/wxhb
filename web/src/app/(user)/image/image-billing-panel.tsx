"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Coins, RefreshCw } from "lucide-react";
import { formatCredits, grsaiBillingChannel } from "@/services/api/grsai-billing";
import { billingEntryForConfig, useImageBillingStore } from "@/stores/use-image-billing-store";
import { useEffectiveConfig } from "@/stores/use-config-store";

export function ImageBillingPanel() {
    const config = useEffectiveConfig();
    const channel = grsaiBillingChannel(config);
    useImageBillingStore((state) => state.entries);
    const refresh = useImageBillingStore((state) => state.refresh);
    const entry = billingEntryForConfig(config);
    const [expanded, setExpanded] = useState(false);
    const model = config.imageModel || config.model;
    const price = entry?.data?.models.find((item) => item.name === model);
    const count = Math.max(1, Math.min(10, Math.floor(Number(config.count) || 1)));
    const estimated = price?.credits == null ? null : price.credits * count;
    const balance = entry?.data?.balance;

    useEffect(() => {
        if (!channel) return;
        const refreshVisible = () => {
            if (!document.hidden) void refresh(config);
        };
        refreshVisible();
        const timer = window.setInterval(refreshVisible, 60000);
        document.addEventListener("visibilitychange", refreshVisible);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", refreshVisible);
        };
    }, [channel?.id, channel?.baseUrl, channel?.apiKey, refresh]);

    if (!channel) return <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">当前平台暂未接入积分查询</div>;
    return (
        <section aria-label="生图积分与模型价格" className="shrink-0 border-b border-border bg-card px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="inline-flex items-center gap-2"><Coins className="size-4 text-muted-foreground" />GRS 可用积分 <strong className="tabular-nums">{balance == null ? "—" : formatCredits(balance)}</strong></span>
                <span className="text-muted-foreground">单次调用 <strong className="font-medium text-foreground">{price?.credits == null ? "价格未确认" : `${formatCredits(price.credits)} 积分`}</strong></span>
                <span className="text-muted-foreground">本批次预计 <strong className="font-medium text-foreground">{estimated == null ? "—" : `${formatCredits(estimated)} 积分 / ${count} 次`}</strong></span>
                <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><ChevronDown className={`size-3.5 ${expanded ? "rotate-180" : ""}`} />模型与价格</button>
                <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={entry?.loading} onClick={() => void refresh(config)} aria-label="刷新平台积分和模型价格"><RefreshCw className={`size-3.5 ${entry?.loading ? "animate-spin" : ""}`} />{entry?.loading ? "查询中" : "刷新"}</button>
            </div>
            {entry?.error || entry?.data?.balanceError || entry?.data?.modelsError ? <p role="status" className="mt-2 text-xs text-muted-foreground">{[entry?.error, entry?.data?.balanceError, entry?.data?.modelsError].filter(Boolean).join("；")}</p> : null}
            {balance != null && estimated != null && balance < estimated ? <p className="mt-2 text-xs text-destructive">可用积分不足以覆盖本批次预计消耗，请减少数量或切换模型。</p> : null}
            {price?.unavailable ? <p className="mt-2 text-xs text-destructive">当前模型暂不可用：{price.maintenance || "平台维护中"}</p> : null}
            {expanded ? (
                <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-left text-xs">
                        <caption className="p-2 text-left text-muted-foreground">GRS 实时目录；展示平台全部生图模型，实际生成使用配置中已接入的模型。按次计费，最终扣费以平台账单为准。</caption>
                        <thead className="sticky top-0 bg-card"><tr><th className="p-2">模型</th><th className="p-2">积分 / 次</th><th className="p-2">异常返还</th><th className="p-2">违规返还</th><th className="p-2">说明</th></tr></thead>
                        <tbody>{entry?.data?.models.map((item) => <tr key={item.name} className={`border-t border-border ${item.name === model ? "bg-accent" : ""}`}><td className="p-2 font-medium">{item.name}{item.name === model ? " · 当前" : ""}{item.unavailable ? " · 维护中" : ""}</td><td className="whitespace-nowrap p-2 tabular-nums">{item.credits == null ? "未提供" : formatCredits(item.credits)}</td><td className="p-2">{item.errorReturn ? "是" : "否"}</td><td className="p-2">{item.violationReturn ? "是" : "否"}</td><td className="min-w-40 p-2 text-muted-foreground">{item.maintenance || item.description}</td></tr>)}</tbody>
                    </table>
                    {!entry?.data?.models.length ? <p className="p-3 text-xs text-muted-foreground">{entry?.loading ? "正在读取模型价格…" : "暂无价格信息，请刷新重试"}</p> : null}
                </div>
            ) : null}
            <p className="mt-2 text-[11px] text-muted-foreground">余额来自当前 API Key，可用额度以平台返回为准；每分钟及生成结束后自动刷新。{entry?.data ? `更新于 ${new Date(entry.data.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : ""}</p>
        </section>
    );
}

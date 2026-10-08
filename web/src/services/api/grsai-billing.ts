import { localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";

export type ImageModelPrice = {
    name: string;
    credits: number | null;
    description: string;
    unavailable: boolean;
    maintenance: string;
    errorReturn: boolean;
    violationReturn: boolean;
};

export type GRSAIBilling = {
    balance: number | null;
    balanceError?: string;
    models: ImageModelPrice[];
    modelsError?: string;
    updatedAt: number;
};

export type ImageGenerationBilling = {
    provider: "GRS AI";
    estimatedCredits: number | null;
    priceUpdatedAt: number;
    errorReturn: boolean;
    violationReturn: boolean;
};

export function grsaiBillingChannel(config: AiConfig) {
    const imageConfig = { ...config, model: config.imageModel || config.model, activeChannelId: config.imageChannelId || config.activeChannelId };
    const channel = localChannelForActiveModel(imageConfig);
    const baseUrl = channel?.baseUrl || config.baseUrl;
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        if (config.channelMode !== "local" || !["grsai.dakka.com.cn", "grsaiapi.com"].includes(host)) return null;
    } catch {
        return null;
    }
    return { id: channel?.id || baseUrl, baseUrl, apiKey: channel ? channel.apiKey : config.apiKey || "" };
}

export async function fetchGRSAIBilling(channel: NonNullable<ReturnType<typeof grsaiBillingChannel>>) {
    const response = await fetch("/api/local-ai/grsai/billing", {
        method: "POST",
        headers: { "X-Local-GRSAI-Base-URL": channel.baseUrl, "X-Local-GRSAI-API-Key": channel.apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(22000),
    });
    const payload = await response.json() as { code: number; data: GRSAIBilling; msg?: string };
    if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.msg || "积分查询失败，请刷新重试");
    return payload.data;
}

export function formatCredits(value: number) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

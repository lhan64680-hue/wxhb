"use client";

import { create } from "zustand";
import { fetchGRSAIBilling, grsaiBillingChannel, type GRSAIBilling, type ImageGenerationBilling } from "@/services/api/grsai-billing";
import type { AiConfig } from "@/stores/use-config-store";

type BillingEntry = { data?: GRSAIBilling; loading: boolean; error?: string };
// Credentials are only used for request identity in memory, never persisted or
// included in history. A changed key must not display the old key's balance.
const requests = new Map<string, { baseUrl: string; apiKey: string; promise: Promise<void> }>();

export const useImageBillingStore = create<{
    entries: Record<string, BillingEntry>;
    refresh: (config: AiConfig) => Promise<void>;
}>((set) => ({
    entries: {},
    refresh: (config) => {
        const channel = grsaiBillingChannel(config);
        if (!channel) return Promise.resolve();
        const previous = requests.get(channel.id);
        const sameCredentials = previous?.baseUrl === channel.baseUrl && previous.apiKey === channel.apiKey;
        if (sameCredentials && useImageBillingStore.getState().entries[channel.id]?.loading) return previous.promise;
        const lastData = sameCredentials ? useImageBillingStore.getState().entries[channel.id]?.data : undefined;
        const request = { baseUrl: channel.baseUrl, apiKey: channel.apiKey, promise: Promise.resolve() };
        requests.set(channel.id, request);
        set((state) => ({ entries: { ...state.entries, [channel.id]: { data: lastData, loading: true } } }));
        request.promise = fetchGRSAIBilling(channel).then(
            (data) => {
                if (requests.get(channel.id) === request) set((state) => ({ entries: { ...state.entries, [channel.id]: { data, loading: false } } }));
            },
            () => {
                if (requests.get(channel.id) === request) set((state) => ({ entries: { ...state.entries, [channel.id]: { data: lastData, loading: false, error: lastData ? "刷新失败，当前显示上次查询结果，请稍后重试" : "积分信息读取失败，请刷新重试" } } }));
            },
        );
        return request.promise;
    },
}));

export function billingEntryForConfig(config: AiConfig) {
    const channel = grsaiBillingChannel(config);
    if (!channel) return undefined;
    const request = requests.get(channel.id);
    if (request?.baseUrl !== channel.baseUrl || request.apiKey !== channel.apiKey) return undefined;
    return useImageBillingStore.getState().entries[channel.id];
}

export function imageBillingSnapshot(config: AiConfig): ImageGenerationBilling | undefined {
    if (!grsaiBillingChannel(config)) return undefined;
    const data = billingEntryForConfig(config)?.data;
    const price = data?.models.find((item) => item.name === (config.imageModel || config.model));
    const fresh = data && Date.now() - data.updatedAt <= 5 * 60 * 1000;
    return { provider: "GRS AI", estimatedCredits: fresh ? price?.credits ?? null : null, priceUpdatedAt: data?.updatedAt || 0, errorReturn: price?.errorReturn || false, violationReturn: price?.violationReturn || false };
}

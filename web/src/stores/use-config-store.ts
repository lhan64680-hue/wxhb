"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export type LocalModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
};

export type VideoMultiPromptItem = { prompt: string; duration: string };
export type VideoElementReference = { id: string; kind: "image" | "video" | "audio"; name: string; type: string; dataUrl?: string; url?: string; storageKey?: string; bytes?: number; width?: number; height?: number; durationMs?: number };
export type VideoElementItem = { name: string; description: string; references: VideoElementReference[] };

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    videoMode: string;
    videoNegativePrompt: string;
    videoMultiShot: string;
    videoShotType: string;
    videoMultiPrompt: VideoMultiPromptItem[];
    videoElementList: VideoElementItem[];
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoCharacterOrientation: string;
    h3GenerationMode?: "standard" | "multi-reference" | "turbo-4step";
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    videoSize: string;
    count: string;
    canvasImageCount: string;
    timeout: string;
    apiMode: string;
    streamImages: string;
    streamPartialImages: string;
    responseFormatB64Json: string;
    codexCli: string;
    systemPrompts: {
        image: string;
        video: string;
        text: string;
        workflow: string;
        workflowAgent: string;
    };
    localChannels: LocalModelChannel[];
    publicChannels: Array<{ id?: string; name?: string; baseUrl?: string; models?: string[]; weight?: number; timeout?: number; enabled?: boolean; remark?: string }>;
    syncStorageConfig: boolean;
    syncWebDAVStorageConfig: boolean;
    activeChannelId: string;
    imageChannelId: string;
    videoChannelId: string;
    textChannelId: string;
    audioChannelId: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
export const MINIMAX_H3_TEXT_TO_VIDEO_MODEL = "minimax-h3/text-to-video";
export const MINIMAX_H3_IMAGE_TO_VIDEO_MODEL = "minimax-h3/image-to-video";
export const MINIMAX_H3_REFERENCE_TO_VIDEO_MODEL = "minimax-h3/reference-to-video";
export const MINIMAX_H3_FL2VA_CHANNEL_ID = "local-minimax-h3-fl2va";
export const MINIMAX_H3_REF2VA_CHANNEL_ID = "local-minimax-h3-ref2va";
export const GRSAI_GPT_IMAGE_2_MODEL = "gpt-image-2";
export const GRSAI_GPT_IMAGE_2_CHANNEL_ID = "local-grsai-gpt-image-2";
export const KIMI_K3_MODEL = "kimi-k3";
export const KIMI_K3_CHANNEL_ID = "local-kimi-k3";
const LEGACY_OPENAI_GPT_IMAGE_2_CHANNEL_ID = "local-openai-gpt-image-2";
const MINIMAX_H3_LOCAL_API_KEY = "local-h3";

function defaultMinimaxH3LocalChannels(): LocalModelChannel[] {
    return [
        {
            id: MINIMAX_H3_FL2VA_CHANNEL_ID,
            name: "MiniMax H3 本地 FL2VA",
            baseUrl: "http://127.0.0.1:7860",
            apiKey: MINIMAX_H3_LOCAL_API_KEY,
            models: [MINIMAX_H3_TEXT_TO_VIDEO_MODEL, MINIMAX_H3_IMAGE_TO_VIDEO_MODEL],
        },
        {
            id: MINIMAX_H3_REF2VA_CHANNEL_ID,
            name: "MiniMax H3 本地 Ref2VA",
            baseUrl: "http://127.0.0.1:7860",
            apiKey: MINIMAX_H3_LOCAL_API_KEY,
            models: [MINIMAX_H3_REFERENCE_TO_VIDEO_MODEL],
        },
    ];
}

function minimaxH3ModelList() {
    return defaultMinimaxH3LocalChannels().flatMap((channel) => channel.models);
}

function defaultGrsaiGptImage2Channel(): LocalModelChannel {
    return {
        id: GRSAI_GPT_IMAGE_2_CHANNEL_ID,
        name: "GRS AI GPT Image 2（国内直连）",
        baseUrl: "https://grsai.dakka.com.cn",
        apiKey: "",
        models: [GRSAI_GPT_IMAGE_2_MODEL],
    };
}

function defaultKimiK3Channel(): LocalModelChannel {
    return {
        id: KIMI_K3_CHANNEL_ID,
        name: "Kimi K3（Moonshot 国内直连）",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "",
        models: [KIMI_K3_MODEL],
    };
}

function defaultLocalChannels() {
    return [...defaultMinimaxH3LocalChannels(), defaultGrsaiGptImage2Channel(), defaultKimiK3Channel()];
}

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: "http://127.0.0.1:7860",
    apiKey: MINIMAX_H3_LOCAL_API_KEY,
    model: GRSAI_GPT_IMAGE_2_MODEL,
    imageModel: GRSAI_GPT_IMAGE_2_MODEL,
    videoModel: MINIMAX_H3_TEXT_TO_VIDEO_MODEL,
    textModel: KIMI_K3_MODEL,
    audioModel: "gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "5",
    videoMode: "std",
    videoNegativePrompt: "",
    videoMultiShot: "false",
    videoShotType: "intelligence",
    videoMultiPrompt: [{ prompt: "", duration: "1" }],
    videoElementList: [{ name: "", description: "", references: [] }],
    vquality: "768",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoCharacterOrientation: "video",
    systemPrompt: "",
    models: defaultLocalChannels().flatMap((channel) => channel.models),
    imageModels: [GRSAI_GPT_IMAGE_2_MODEL],
    videoModels: minimaxH3ModelList(),
    textModels: [KIMI_K3_MODEL],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    videoSize: "1280x720",
    count: "1",
    canvasImageCount: "1",
    timeout: "600",
    apiMode: "images",
    streamImages: "",
    streamPartialImages: "1",
    responseFormatB64Json: "",
    codexCli: "",
    systemPrompts: {
        image: "",
        video: "",
        text: "",
        workflow: "",
        workflowAgent: "",
    },
    localChannels: defaultLocalChannels(),
    publicChannels: [],
    syncStorageConfig: false,
    syncWebDAVStorageConfig: false,
    activeChannelId: "",
    imageChannelId: GRSAI_GPT_IMAGE_2_CHANNEL_ID,
    videoChannelId: "",
    textChannelId: KIMI_K3_CHANNEL_ID,
    audioChannelId: "",
};

type ConfigStore = {
    config: AiConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null, canUseRemoteChannel: boolean) {
    const channelMode = canUseRemoteChannel ? (modelChannel?.allowCustomChannel ? config.channelMode : "remote") : "local";
    if (channelMode === "local" || !modelChannel) {
        const localChannels = normalizeLocalChannels(config);
        return {
            ...config,
            channelMode,
            localChannels,
            models: normalizeModelList(localChannels.flatMap((channel) => channel.models)),
            publicChannels: modelChannel?.channels || [],
        };
    }
    const models = modelChannel.availableModels;
    const textModels = filterModelsByCapability(models, "text");
    const imageModels = filterModelsByCapability(models, "image");
    const videoModels = filterModelsByCapability(models, "video");
    const audioModels = filterModelsByCapability(models, "audio");
    const fallbackTextModel = validDefault(modelChannel.defaultTextModel, textModels) || preferredModel(textModels, isTextModelName);
    const fallbackModel = validDefault(modelChannel.defaultModel, textModels) || fallbackTextModel;
    const fallbackImageModel = validDefault(modelChannel.defaultImageModel, imageModels) || preferredModel(imageModels, isImageModelName);
    const fallbackVideoModel = validDefault(modelChannel.defaultVideoModel, videoModels) || preferredModel(videoModels, isVideoModelName);
    const fallbackAudioModel = preferredModel(audioModels, isAudioModelName);
    return {
        ...config,
        channelMode,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        model: textModels.includes(config.model) ? config.model : fallbackModel,
        imageModel: imageModels.includes(config.imageModel) ? config.imageModel : fallbackImageModel,
        videoModel: videoModels.includes(config.videoModel) ? config.videoModel : fallbackVideoModel,
        textModel: textModels.includes(config.textModel) ? config.textModel : fallbackTextModel || fallbackModel,
        audioModel: audioModels.includes(config.audioModel) ? config.audioModel : fallbackAudioModel,
        systemPrompt: modelChannel.systemPrompt,
        publicChannels: modelChannel.channels || [],
    };
}

function validDefault(model: string, models: string[]) {
    return models.includes(model) ? model : "";
}

function preferredModel(models: string[], predicate: (model: string) => boolean) {
    return models.find(predicate) || "";
}

function isVideoModelName(model: string) {
    const value = model.toLowerCase();
    return (
        value.includes("video") ||
        value.includes("seedance") ||
        value.includes("sora") ||
        value.includes("veo") ||
        value.includes("kling") ||
        value.includes("hailuo") ||
        value.includes("minimax") ||
        value.includes("skyreels") ||
        value.includes("happyhorse") ||
        value.includes("runway") ||
        value.includes("aleph") ||
        value.includes("vidu") ||
        value.includes("pixverse") ||
        value.includes("omni-flash") ||
        value.includes("gemini-omni-video") ||
        value.includes("veo3.1") ||
        value.includes("veo-3.1") ||
        value.includes("infinitalk") ||
        value.includes("wan2-5") ||
        value.includes("wan2.5") ||
        value.includes("wan2-6") ||
        value.includes("wan2.6") ||
        value.includes("wan2-7") ||
        value.includes("wan2.7") ||
        value.includes("wan2-7-r2v") ||
        value.includes("wan2.7-r2v") ||
        value.includes("wan2-7-videoedit") ||
        value.includes("wan2.7-videoedit") ||
        value.includes("wan/2-5") ||
        value.includes("wan/2-6") ||
        value.includes("wan/2-7-text-to-video") ||
        value.includes("wan/2-7-image-to-video") ||
        value.includes("wan/2-7-videoedit") ||
        value.includes("wan/2-7-r2v") ||
        (value.includes("grok-imagine") && (value.includes("/upscale") || value.includes("/extend")))
    );
}

function isImageModelName(model: string) {
    const value = model.toLowerCase();
    return (
        !isVideoModelName(model) &&
        !isAudioModelName(model) &&
        (value.includes("image") ||
            value.includes("nano-banana") ||
            value.includes("seedream") ||
            value.includes("gpt-image") ||
            value.includes("dall-e") ||
            value.includes("dalle") ||
            value.includes("imagen") ||
            value.includes("gemini-2.5-flash") ||
            value.includes("gemini-3-pro") ||
            value.includes("gemini-3.1-flash") ||
            value.includes("flux") ||
            value.includes("kontext") ||
            value.includes("4o-image") ||
            value.includes("4o image") ||
            value.includes("gpt-4o-image") ||
            value.includes("z-image") ||
            value.includes("qwen/image") ||
            value.includes("qwen2/image") ||
            value.includes("qwen/text-to-image") ||
            value.includes("qwen2/text-to-image") ||
            value.includes("ideogram") ||
            value.includes("recraft") ||
            value.includes("sdxl") ||
            value.includes("stable-diffusion") ||
            value.includes("midjourney") ||
            value.includes("wan2-7-image") ||
            value.includes("wan2.7-image") ||
            value.includes("wan/2-7-image") ||
            value.includes("topaz/image") ||
            value.includes("gemini-omni-character") ||
            (value.includes("grok-imagine") && !value.includes("video")))
    );
}

function isAudioModelName(model: string) {
    const value = model.toLowerCase();
    return (
        value.includes("audio") ||
        value.includes("tts") ||
        value.includes("speech") ||
        value.includes("voice") ||
        value.includes("music") ||
        value.includes("sound") ||
        value.includes("elevenlabs") ||
        value.includes("suno") ||
        value.includes("lyrics") ||
        value.includes("vocal") ||
        value.includes("midi") ||
        value.includes("wav")
    );
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability)) : models;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    return filterModelsByCapability(config.models, capability);
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = localChannelForActiveModel({ ...config, model });
    return Boolean(model.trim()) && (config.channelMode === "remote" || Boolean(channel?.baseUrl.trim() && channel?.apiKey.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            publicSettings: null,
            isPublicSettingsLoading: false,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            loadPublicSettings: async () => {
                if (get().isPublicSettingsLoading) return;
                set({ isPublicSettingsLoading: true });
                try {
                    set({ publicSettings: await apiGet<AdminPublicSettings>("/api/settings") });
                } finally {
                    set({ isPublicSettingsLoading: false });
                }
            },
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                const localChannels = ensureKimiK3Channel(ensureGrsaiGptImage2Channel(normalizeLocalChannels(config)));
                const localModels = normalizeModelList(localChannels.flatMap((channel) => channel.models));
                const h3VideoModelAvailable = localModels.includes(MINIMAX_H3_TEXT_TO_VIDEO_MODEL);
                const fallbackVideoModel = h3VideoModelAvailable ? MINIMAX_H3_TEXT_TO_VIDEO_MODEL : filterModelsByCapability(localModels, "video")[0] || config.videoModel || "";
                const videoModel = localModels.includes(config.videoModel || "") && config.videoModel !== "grok-imagine-video" ? config.videoModel || "" : fallbackVideoModel;
                const fallbackImageModel = localModels.includes(GRSAI_GPT_IMAGE_2_MODEL) ? GRSAI_GPT_IMAGE_2_MODEL : filterModelsByCapability(localModels, "image")[0] || "";
                const imageModel = localModels.includes(config.imageModel || "") ? config.imageModel || "" : fallbackImageModel;
                const fallbackTextModel = localModels.includes(KIMI_K3_MODEL) ? KIMI_K3_MODEL : filterModelsByCapability(localModels, "text")[0] || "";
                const textModel = localModels.includes(config.textModel || "") ? config.textModel || "" : fallbackTextModel;
                const videoChannelId = localChannelIdForModel(localChannels, videoModel, config.videoChannelId || MINIMAX_H3_FL2VA_CHANNEL_ID);
                const imageChannelId = localChannelIdForModel(localChannels, imageModel, config.imageChannelId === LEGACY_OPENAI_GPT_IMAGE_2_CHANNEL_ID ? GRSAI_GPT_IMAGE_2_CHANNEL_ID : config.imageChannelId || GRSAI_GPT_IMAGE_2_CHANNEL_ID);
                const textChannelId = localChannelIdForModel(localChannels, textModel, config.textChannelId || KIMI_K3_CHANNEL_ID);
                return {
                    ...current,
                    config: {
                        ...config,
                        localChannels,
                        models: localModels,
                        baseUrl: localChannels[0]?.baseUrl || config.baseUrl,
                        apiKey: localChannels[0]?.apiKey || config.apiKey,
                        imageChannelId,
                        videoChannelId,
                        textChannelId,
                        audioChannelId: config.audioChannelId || localChannels[0]?.id || "",
                        activeChannelId: config.activeChannelId || "",
                        syncStorageConfig: config.syncStorageConfig === true,
                        syncWebDAVStorageConfig: config.syncWebDAVStorageConfig === true,
                        channelMode: config.channelMode || "remote",
                        imageModel,
                        videoModel,
                        textModel,
                        audioModel: config.audioModel || defaultConfig.audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        systemPrompts: config.systemPrompts?.image ? config.systemPrompts : defaultConfig.systemPrompts,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "5",
                        videoMode: config.videoMode || "std",
                        videoNegativePrompt: config.videoNegativePrompt || "",
                        videoMultiShot: config.videoMultiShot || "false",
                        videoShotType: config.videoShotType || "intelligence",
                        videoMultiPrompt: Array.isArray(config.videoMultiPrompt) && config.videoMultiPrompt.length ? config.videoMultiPrompt : defaultConfig.videoMultiPrompt,
                        videoElementList: Array.isArray(config.videoElementList) && config.videoElementList.length ? config.videoElementList : defaultConfig.videoElementList,
                        vquality: config.vquality || "768",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        videoCharacterOrientation: config.videoCharacterOrientation === "image" ? "image" : "video",
                        canvasImageCount: config.canvasImageCount || "1",
                        imageModels: filterModelsByCapability(localModels, "image"),
                        videoModels: filterModelsByCapability(localModels, "video"),
                        textModels: filterModelsByCapability(localModels, "text"),
                        audioModels: filterModelsByCapability(localModels, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

function localChannelIdForModel(channels: LocalModelChannel[], model: string, currentId: string) {
    if (!channels.length) return "";
    if (currentId && channels.some((channel) => channel.id === currentId && (!model || channel.models.includes(model)))) return currentId;
    return channels.find((channel) => model && channel.models.includes(model))?.id || channels[0].id;
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const modelChannel = useConfigStore((state) => state.publicSettings?.modelChannel || null);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const canUseRemoteChannel = Boolean(token && user && (user.role === "admin" || modelChannel?.allowUserRemoteChannel === true));
    return useMemo(() => resolveEffectiveConfig(config, modelChannel, canUseRemoteChannel), [canUseRemoteChannel, config, modelChannel]);
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}

export function normalizeLocalChannels(config: Partial<AiConfig>) {
    const channels = Array.isArray(config.localChannels) ? config.localChannels : [];
    const normalized = channels.map((channel, index) =>
        upgradeMinimaxH3LocalChannel({
            id: channel.id || `local-${index + 1}`,
            name: typeof channel.name === "string" ? channel.name : `本地渠道 ${index + 1}`,
            baseUrl: channel.baseUrl || "",
            apiKey: channel.apiKey || "",
            models: Array.isArray(channel.models) ? channel.models.filter(Boolean) : [],
        }),
    );
    if (!normalized.length) return defaultLocalChannels();
    return ensureKimiK3Channel(normalized);
}

function ensureGrsaiGptImage2Channel(channels: LocalModelChannel[]) {
    const migrated = channels.map((channel) => (channel.id === LEGACY_OPENAI_GPT_IMAGE_2_CHANNEL_ID && !channel.apiKey.trim() ? defaultGrsaiGptImage2Channel() : channel));
    if (migrated.some((channel) => channel.id === GRSAI_GPT_IMAGE_2_CHANNEL_ID)) return migrated;
    return [...migrated, defaultGrsaiGptImage2Channel()];
}

function ensureKimiK3Channel(channels: LocalModelChannel[]) {
    if (channels.some((channel) => channel.id === KIMI_K3_CHANNEL_ID)) return channels;
    return [...channels, defaultKimiK3Channel()];
}

function upgradeMinimaxH3LocalChannel(channel: LocalModelChannel): LocalModelChannel {
    const text = [channel.id, channel.name, channel.baseUrl, ...channel.models].join(" ").toLowerCase();
    if (!text.includes("minimax-h3") && !text.includes("127.0.0.1:30010") && !text.includes("127.0.0.1:30011")) {
        return channel;
    }
    return {
        ...channel,
        baseUrl: "http://127.0.0.1:7860",
        apiKey: channel.apiKey || MINIMAX_H3_LOCAL_API_KEY,
    };
}

export function channelIdForActiveModel(config: AiConfig) {
    // `gpt-image-2` is provided by the dedicated GRS channel. Earlier saved
    // configurations can retain a remote-mode flag even after a GRS key has
    // been supplied, so this must not depend on channelMode.
    // Older saved configurations can still point the image selector at the H3
    // video adapter, which would send `/v1/images/generations` to port 7860.
    if (config.model === GRSAI_GPT_IMAGE_2_MODEL) {
        const grsaiChannel = normalizeLocalChannels(config).find((channel) => channel.id === GRSAI_GPT_IMAGE_2_CHANNEL_ID && channel.models.includes(config.model));
        if (grsaiChannel) return grsaiChannel.id;
    }
    if (modelMatchesCapability(config.model, "image") && config.imageChannelId) return config.imageChannelId;
    if (modelMatchesCapability(config.model, "video") && config.videoChannelId) return config.videoChannelId;
    if (modelMatchesCapability(config.model, "audio") && config.audioChannelId) return config.audioChannelId;
    if (modelMatchesCapability(config.model, "text") && config.textChannelId) return config.textChannelId;
    if (config.activeChannelId) return config.activeChannelId;
    if (config.model === config.videoModel) return config.videoChannelId;
    if (config.model === config.textModel) return config.textChannelId;
    if (config.model === config.audioModel) return config.audioChannelId;
    return config.imageChannelId;
}

export function resolveModelChannelId(config: AiConfig, model: string, ...preferredIds: Array<string | undefined>) {
    const channels = config.channelMode === "remote" ? config.publicChannels.map((channel) => ({ id: channel.id || "", models: channel.models || [] })) : normalizeLocalChannels(config).map((channel) => ({ id: channel.id, models: channel.models }));
    for (const id of preferredIds) {
        const channelId = (id || "").trim();
        if (channelId && channels.some((channel) => channel.id === channelId && channel.models.includes(model))) return channelId;
    }
    return channels.find((channel) => channel.models.includes(model))?.id || "";
}

export function isKimiK3Model(model: string) {
    return model.trim().toLowerCase() === KIMI_K3_MODEL;
}

export function localChannelForActiveModel(config: AiConfig) {
    const channels = normalizeLocalChannels(config);
    const preferredId = channelIdForActiveModel(config);
    return channels.find((channel) => channel.id === preferredId && channel.models.includes(config.model)) || channels.find((channel) => channel.models.includes(config.model)) || channels.find((channel) => channel.id === preferredId) || channels[0];
}

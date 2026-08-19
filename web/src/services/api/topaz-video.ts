"use client";

import { apiDelete, apiGet, apiPost } from "@/services/api/request";
import { getProxyUrl } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";

export type TopazVideoModel = { id: string; name: string; description: string };

export type TopazVideoCapabilities = {
    installed: boolean;
    ready: boolean;
    version?: string;
    models: TopazVideoModel[];
    defaultModel?: string;
    error?: string;
};

export type TopazVideoTask = {
    id: string;
    status: "queued" | "probing" | "running" | "canceling" | "succeeded" | "failed" | "canceled";
    progress: number;
    message?: string;
    error?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    outputUrl?: string;
    outputWidth?: number;
    outputHeight?: number;
    outputBytes?: number;
    outputMimeType?: string;
};

export type TopazVideoOptions = {
    model: string;
    target: "1080p" | "1440p" | "2160p";
    quality: "high" | "balanced" | "compact";
    interpolation: "none" | "2x" | "4x";
    slowdown: "1x" | "2x" | "4x";
};

type TopazUpload = { id: string; name: string; bytes: number; mimeType: string };

export function getTopazVideoCapabilities() {
    return apiGet<TopazVideoCapabilities>("/api/local-topaz-video/capabilities");
}

export async function createTopazVideoTask(source: { url: string; storageKey?: string; name?: string; mimeType?: string; width?: number; height?: number; durationMs?: number }, options: TopazVideoOptions) {
    const blob = await getTopazSourceBlob(source.url, source.storageKey);
    const filename = source.name || "canvas-video.mp4";
    const uploaded = await uploadTopazVideo(blob, filename);
    const metadata = await readTopazVideoMetadata(blob, { width: source.width, height: source.height, durationMs: source.durationMs });
    return apiPost<TopazVideoTask>("/api/local-topaz-video/tasks", { inputId: uploaded.id, sourceWidth: metadata.width, sourceHeight: metadata.height, sourceDurationMs: metadata.durationMs, ...options });
}

export function getTopazVideoTask(id: string) {
    return apiGet<TopazVideoTask>(`/api/local-topaz-video/tasks/${encodeURIComponent(id)}`);
}

export function cancelTopazVideoTask(id: string) {
    return apiDelete<TopazVideoTask>(`/api/local-topaz-video/tasks/${encodeURIComponent(id)}`);
}

async function uploadTopazVideo(blob: Blob, filename: string) {
    const formData = new FormData();
    formData.append("file", blob, filename);
    const response = await fetch("/api/local-topaz-video/uploads", { method: "POST", body: formData });
    const payload = (await response.json().catch(() => null)) as { code?: number; msg?: string; data?: TopazUpload } | null;
    if (!response.ok || payload?.code !== 0 || !payload.data) throw new Error(payload?.msg || "Topaz 输入视频上传失败");
    return payload.data;
}

async function getTopazSourceBlob(url: string, storageKey?: string) {
    const stored = storageKey && !storageKey.startsWith("server:") ? await getMediaBlob(storageKey).catch(() => null) : null;
    if (stored) return stored;
    const source = await resolveMediaUrl(storageKey, url);
    const response = await fetchTopazSource(source);
    if (!response.ok) throw new Error(`读取连接的视频失败：${response.status}`);
    const blob = await response.blob();
    if (!blob.size || blob.type.includes("json") || blob.type.startsWith("text/")) throw new Error("连接的视频内容无效");
    return blob;
}

async function fetchTopazSource(source: string) {
    if (/^https?:\/\//i.test(source)) {
        const proxied = await fetch(getProxyUrl(source));
        if (proxied.ok) return proxied;
    }
    return fetch(source);
}

function readTopazVideoMetadata(blob: Blob, fallback: { width?: number; height?: number; durationMs?: number }) {
    if (fallback.width && fallback.height) return Promise.resolve({ width: fallback.width, height: fallback.height, durationMs: fallback.durationMs || 0 });
    return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(blob);
        const done = () => URL.revokeObjectURL(url);
        video.preload = "metadata";
        video.onloadedmetadata = () => {
            done();
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!width || !height) {
                reject(new Error("无法读取输入视频分辨率"));
                return;
            }
            resolve({ width, height, durationMs: Math.max(0, Math.round((video.duration || 0) * 1000)) });
        };
        video.onerror = () => {
            done();
            reject(new Error("无法读取输入视频信息"));
        };
        video.src = url;
    });
}

import { aiApiUrl, aiHeaders, type ChatCompletionMessage } from "@/services/api/image";
import { KIMI_K3_CHANNEL_ID, KIMI_K3_MODEL, localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type H3PromptOptimizationInput = {
    prompt: string;
    seconds: string;
    h3GenerationMode: "standard" | "multi-reference" | "turbo-4step";
    referenceImages: ReferenceImage[];
    firstFrame: ReferenceImage | null;
    lastFrame: ReferenceImage | null;
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
};

export type H3PromptOptimizationResult = {
    prompt: string;
    source: "kimi-k3" | "template";
    mode: H3PromptMode;
    warning?: string;
};

type H3PromptMode = "T2VA" | "I2VA" | "FL2VA" | "L2VA" | "Ref2VA";

// Moonshot 的 kimi-k3 接口目前仅接受 temperature=1。
// H3 每次提交都会默认调用此优化器；这里必须保持该固定值，
// 否则请求会失败并降级为本地模板。
export const KIMI_K3_OPTIMIZER_TEMPERATURE = 1;

type ChatCompletionPayload = {
    code?: number;
    msg?: string;
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | null } }>;
    data?: { choices?: Array<{ message?: { content?: string | null } }> };
};

export async function optimizeMiniMaxH3Prompt(config: AiConfig, input: H3PromptOptimizationInput): Promise<H3PromptOptimizationResult> {
    const mode = resolveH3PromptMode(input);
    const fallback = buildH3TemplatePrompt(input, mode);
    const kimiConfig = h3KimiConfig(config);
    const channel = localChannelForActiveModel(kimiConfig);
    if (!channel?.apiKey.trim()) {
        return { prompt: fallback, source: "template", mode, warning: "未配置 Kimi K3 Key，已使用 H3 合规模板。" };
    }

    try {
        const response = await fetch(aiApiUrl(kimiConfig, "/chat/completions"), {
            method: "POST",
            headers: aiHeaders(kimiConfig, "application/json"),
            body: JSON.stringify({
                model: KIMI_K3_MODEL,
                stream: false,
                temperature: KIMI_K3_OPTIMIZER_TEMPERATURE,
                messages: [{ role: "system", content: h3PromptSystemInstruction(mode) }, h3PromptUserMessage(input, mode)],
            }),
        });
        const text = await response.text();
        const payload = parseChatPayload(text);
        if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
            throw new Error(payload.error?.message || payload.msg || `Kimi 请求失败：${response.status}`);
        }
        const rawPrompt = payload.choices?.[0]?.message?.content || payload.data?.choices?.[0]?.message?.content || "";
        const prompt = cleanH3Prompt(rawPrompt);
        if (!isValidH3Prompt(prompt, mode)) throw new Error("Kimi 没有返回符合 H3 结构的提示词");
        return { prompt, source: "kimi-k3", mode };
    } catch (error) {
        const reason = error instanceof Error ? error.message : "Kimi 提示词优化失败";
        return { prompt: fallback, source: "template", mode, warning: `${reason}，已改用 H3 合规模板。` };
    }
}

function h3KimiConfig(config: AiConfig): AiConfig {
    return {
        ...config,
        model: KIMI_K3_MODEL,
        textModel: KIMI_K3_MODEL,
        activeChannelId: KIMI_K3_CHANNEL_ID,
        textChannelId: KIMI_K3_CHANNEL_ID,
    };
}

function resolveH3PromptMode(input: H3PromptOptimizationInput): H3PromptMode {
    if (input.h3GenerationMode === "multi-reference") return "Ref2VA";
    if (input.firstFrame && input.lastFrame) return "FL2VA";
    if (input.firstFrame) return "I2VA";
    if (input.lastFrame) return "L2VA";
    if (input.referenceImages.length >= 2) return "FL2VA";
    if (input.referenceImages.length === 1) return "I2VA";
    return "T2VA";
}

function h3PromptSystemInstruction(mode: H3PromptMode) {
    if (mode === "Ref2VA") {
        return [
            "You are MiniMax H3 Context-IR prompt writer. Convert the user's intent and supplied references into one final English Ref2VA prompt.",
            "Output plain text only: no Markdown, explanation, code fence, or negative_prompt field.",
            "Use exactly this six-section order: subject_definitions:, summary:, retention_analysis:, detailed_description:, overall_soundscape:, non_diegetic_music:.",
            "Keep every <Picture N>, <Video N>, and <Audio N> label exactly aligned with the supplied order. Never invent a reference label.",
            "Turn prohibitions into visible positive constraints. Preserve dialogue, lyrics, and visible text in the user's original language.",
        ].join("\n");
    }
    return [
        "You are MiniMax H3 Context-IR prompt writer. Convert the user's intent and supplied keyframes into one final English H3 Base prompt.",
        "Output plain text only: no Markdown, explanation, code fence, or negative_prompt field.",
        "Use the exact field order: optional first keyframe-alignment line, integrated_multimodal_description:, overall_soundscape:, non_diegetic_music:.",
        "The description begins with [Shot 1] and must describe style, composition, subjects, continuous action, camera movement, and observable constraints.",
        "For I2VA align <Picture 1> to 0.00s; for FL2VA align <Picture 1> to 0.00s and <Picture 2> to the target duration; for L2VA align <Picture 1> to the target duration.",
        "Turn prohibitions into visible positive constraints. Preserve dialogue, lyrics, and visible text in the user's original language.",
    ].join("\n");
}

function h3PromptUserMessage(input: H3PromptOptimizationInput, mode: H3PromptMode): ChatCompletionMessage {
    const duration = normalizedSeconds(input.seconds);
    const labels = referenceLabels(input, mode);
    const text = [
        `H3 task: ${mode}. Target duration: ${duration.toFixed(2)} seconds.`,
        `Supplied references in order: ${labels.length ? labels.join(", ") : "none"}.`,
        "Original user intent (do not discard it):",
        input.prompt.trim() || "Create a coherent short video.",
        "Return only the final H3 prompt.",
    ].join("\n\n");
    const content: Exclude<ChatCompletionMessage["content"], string> = [{ type: "text", text }];
    visualReferences(input, mode).forEach(({ label, image }) => {
        content.push({ type: "text", text: `${label} visual reference:` });
        content.push({ type: "image_url", image_url: { url: image.dataUrl } });
    });
    return { role: "user", content };
}

function referenceLabels(input: H3PromptOptimizationInput, mode: H3PromptMode) {
    const images = visualReferences(input, mode).map(({ label }) => label);
    if (mode !== "Ref2VA") return images;
    return [...images, ...input.referenceVideos.map((_, index) => `<Video ${index + 1}>`), ...input.referenceAudios.map((_, index) => `<Audio ${index + 1}>`)];
}

function visualReferences(input: H3PromptOptimizationInput, mode: H3PromptMode) {
    if (mode === "Ref2VA") return input.referenceImages.slice(0, 9).map((image, index) => ({ label: `<Picture ${index + 1}>`, image }));
    const keyframes = input.firstFrame || input.lastFrame ? [input.firstFrame, input.lastFrame].filter((image): image is ReferenceImage => Boolean(image)) : input.referenceImages.slice(0, 2);
    return keyframes.map((image, index) => ({ label: `<Picture ${index + 1}>`, image }));
}

function buildH3TemplatePrompt(input: H3PromptOptimizationInput, mode: H3PromptMode) {
    const duration = normalizedSeconds(input.seconds).toFixed(2);
    const intent = input.prompt.trim() || "Create a coherent short video with stable subjects and clear motion.";
    if (mode === "Ref2VA") {
        const pictures = input.referenceImages
            .slice(0, 9)
            .map((_, index) => `<Picture ${index + 1}>: visual reference.`)
            .join(" ");
        const videos = input.referenceVideos
            .slice(0, 3)
            .map((_, index) => `<Video ${index + 1}>: temporal reference.`)
            .join(" ");
        const audios = input.referenceAudios
            .slice(0, 3)
            .map((_, index) => `<Audio ${index + 1}>: audio reference.`)
            .join(" ");
        const retention = [
            ...input.referenceImages.slice(0, 9).map((_, index) => `<Picture ${index + 1}>: fully_preserved.`),
            ...input.referenceVideos.slice(0, 3).map((_, index) => `<Video ${index + 1}>: reference.`),
            ...input.referenceAudios.slice(0, 3).map((_, index) => `<Audio ${index + 1}>: reference.`),
        ].join(" ");
        return [
            `subject_definitions: ${pictures} ${videos} ${audios}`.trim(),
            `summary: ${intent}`,
            `retention_analysis: ${retention || "No external reference needs retention."}`,
            `detailed_description: [Shot 1] ${intent} Preserve the supplied reference identity, composition, and important visible attributes. Use one coherent camera movement over ${duration} seconds.`,
            "overall_soundscape: Natural diegetic ambience appropriate to the described setting, with synchronized action sounds.",
            "non_diegetic_music: N/A",
        ].join("\n");
    }
    const alignment =
        mode === "I2VA"
            ? "<Picture 1> is perfectly aligned with 0.00s."
            : mode === "FL2VA"
              ? `<Picture 1> is perfectly aligned with 0.00s. <Picture 2> is perfectly aligned with ${duration}s.`
              : mode === "L2VA"
                ? `<Picture 1> is perfectly aligned with ${duration}s.`
                : "";
    return [
        alignment,
        `integrated_multimodal_description: [Shot 1] ${intent} Keep the subject identity, wardrobe, spatial position, and essential composition stable. The camera moves smoothly and deliberately through one continuous, observable action over ${duration} seconds.`,
        "overall_soundscape: Natural diegetic ambience appropriate to the described setting, with synchronized action sounds.",
        "non_diegetic_music: N/A",
    ]
        .filter(Boolean)
        .join("\n");
}

function cleanH3Prompt(value: string) {
    return value
        .trim()
        .replace(/^```(?:text|markdown)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
}

function isValidH3Prompt(prompt: string, mode: H3PromptMode) {
    const lower = prompt.toLowerCase();
    if (lower.includes("negative_prompt:")) return false;
    if (mode === "Ref2VA") {
        return ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"].every((field) => lower.includes(field));
    }
    return ["integrated_multimodal_description:", "overall_soundscape:", "non_diegetic_music:"].every((field) => lower.includes(field));
}

function normalizedSeconds(value: string) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.max(4, Math.min(15, seconds)) : 5;
}

function parseChatPayload(text: string): ChatCompletionPayload {
    try {
        return JSON.parse(text) as ChatCompletionPayload;
    } catch {
        throw new Error("Kimi 返回了无法解析的响应");
    }
}

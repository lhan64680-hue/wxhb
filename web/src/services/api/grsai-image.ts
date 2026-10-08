import type { AiConfig } from "@/stores/use-config-store";

const BANANA_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"];
const GPT_1K_SIZES: Record<string, string> = { "1:1": "1024x1024", "16:9": "1672x941", "9:16": "941x1672", "4:3": "1443x1090", "3:4": "1090x1443", "3:2": "1536x1024", "2:3": "1024x1536", "5:4": "1408x1120", "4:5": "1120x1408", "21:9": "1920x832", "9:21": "832x1920", "1:2": "896x1792", "2:1": "1792x896" };

export function grsaiDrawEndpoint(model: string) {
    return model.startsWith("nano-banana") ? "/draw/nano-banana" : "/draw/completions";
}

export function grsaiImageParameters(config: Pick<AiConfig, "model" | "size" | "quality">) {
    if (!["nano-banana-2.1", "nano-banana-2", "nano-banana-fast", "nano-banana-2-lite", "gpt-image-2", "gpt-image-2.5"].includes(config.model)) return undefined;
    const banana = config.model.startsWith("nano-banana");
    const fullBanana = ["nano-banana-2.1", "nano-banana-2"].includes(config.model);
    const ratios = banana ? [...BANANA_RATIOS, ...(fullBanana ? ["1:4", "4:1", "1:8", "8:1"] : [])] : Object.keys(GPT_1K_SIZES);
    const size = config.size.trim() || "auto";
    const pixels = /^(\d+)x(\d+)$/.exec(size);
    const ratio = pixels ? ratios.find((item) => {
        const [width, height] = item.split(":").map(Number);
        return Math.abs(Number(pixels[1]) / Number(pixels[2]) - width / height) < 0.01;
    }) : size;
    if (!ratio || ratio !== "auto" && !ratios.includes(ratio)) throw new Error("当前 GRS 模型不支持该尺寸，请选择自动或常用宽高比");
    if (!banana) return { aspectRatio: ratio === "auto" ? "auto" : GPT_1K_SIZES[ratio], quality: "auto" };
    const edge = pixels ? Math.max(Number(pixels[1]), Number(pixels[2])) : 0;
    const quality = config.quality.toLowerCase();
    const imageSize = edge ? (edge >= 2880 ? "4K" : edge >= 2048 ? "2K" : "1K") : ["high", "4k"].includes(quality) ? "4K" : ["medium", "hd", "2k"].includes(quality) ? "2K" : "1K";
    return { aspectRatio: ratio, imageSize: fullBanana ? imageSize : "1K" };
}

export function grsaiImageSettingsNote(model: string) {
    if (["nano-banana-2.1", "nano-banana-2"].includes(model)) return "该模型支持 1K / 2K / 4K；质量低 / 中 / 高对应 1K / 2K / 4K，选择像素尺寸时以尺寸为准。";
    if (["nano-banana-fast", "nano-banana-2-lite"].includes(model)) return "该模型按 1K 生成，保留所选宽高比；不支持通过质量选项升级到 2K / 4K。";
    if (["gpt-image-2", "gpt-image-2.5"].includes(model)) return "该模型仅支持 1K、自动质量；所选尺寸会按宽高比转换为平台支持的 1K 尺寸。";
    return "";
}

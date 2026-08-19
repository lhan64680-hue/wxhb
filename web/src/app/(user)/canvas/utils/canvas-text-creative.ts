import type { CanvasTextCreativeMode } from "../types";

export type CanvasTextCreativeOption = {
    value: CanvasTextCreativeMode;
    label: string;
    description: string;
};

export const canvasTextCreativeOptions: CanvasTextCreativeOption[] = [
    { value: "write", label: "自由写作", description: "自己编写内容" },
    { value: "video-prompt", label: "文生视频", description: "生成视频提示词" },
    { value: "image-reverse-prompt", label: "图片反推", description: "反推图片提示词" },
    { value: "music-prompt", label: "文字生音乐", description: "生成音乐提示词" },
];

export function canvasTextCreativeLabel(mode?: CanvasTextCreativeMode) {
    return canvasTextCreativeOptions.find((option) => option.value === mode)?.label || "自由写作";
}

export function buildCanvasTextCreativePrompt(mode: CanvasTextCreativeMode | undefined, request: string) {
    const task = request.trim();
    const shared = "你是无限画布中的 Kimi K3 多模态文本创作节点。请综合用户文字，以及消息中附带的图片和视频参考完成任务；不要虚构没有提供的视觉细节。";

    if (mode === "video-prompt") {
        return `${shared}\n\n任务：把需求整理为一段可直接交给视频生成模型的中文提示词。写清主体、动作、场景、镜头、运镜、光线、风格、节奏与时长倾向。只输出提示词正文，不要解释。\n\n用户需求：\n${task}`;
    }
    if (mode === "image-reverse-prompt") {
        return `${shared}\n\n任务：根据附带图片反推一段可直接用于 AI 生图的中文提示词。覆盖主体、构图、镜头、风格、光线、色彩、材质与氛围；没有图片时，明确请用户连接图片节点。只输出提示词正文，不要解释。\n\n用户需求：\n${task}`;
    }
    if (mode === "music-prompt") {
        return `${shared}\n\n任务：把需求整理成可直接交给音乐生成模型的中文音乐提示词。输出音乐风格、情绪、速度/BPM、调性或配器、段落结构、人声要求与禁忌项；如用户需要歌词，再单列“歌词”。这只生成音乐提示词，不直接生成音频。\n\n用户需求：\n${task}`;
    }
    return `${shared}\n\n任务：按用户要求创作或改写文本。直接给出完成内容；除非用户明确要求，否则不要解释创作过程。\n\n用户需求：\n${task}`;
}

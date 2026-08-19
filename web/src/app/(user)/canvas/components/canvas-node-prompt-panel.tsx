"use client";

import { useEffect, useState } from "react";
import { ArrowUp, FileText, Image as ImageIcon, LoaderCircle, Music2, Video } from "lucide-react";
import { Button } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasCameraControl } from "./canvas-camera-control";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover, type CanvasVideoFrameOption, type CanvasVideoResourceOption } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasTextCreativeMode } from "../types";
import { isCanvasImageNodeType, isPanoramaNodeType } from "../utils/canvas-panorama";
import { buildCanvasNodeConfig, canvasAudioConfigPatch, canvasVideoConfigPatch } from "../utils/canvas-node-config";
import { canvasTextCreativeOptions, canvasTextCreativeLabel } from "../utils/canvas-text-creative";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

export type { CanvasVideoFrameOption };

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    mentionReferences?: CanvasResourceReference[];
    videoFrameOptions?: CanvasVideoFrameOption[];
    videoResourceOptions?: CanvasVideoResourceOption[];
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, mentionReferences = [], videoFrameOptions = [], videoResourceOptions = [], onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const modelCosts = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildCanvasNodeConfig(globalConfig, node, mode);
    const isPanorama = isPanoramaNodeType(node.type);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = isCanvasImageNodeType(node.type) && Boolean(node.metadata?.content);
    const textCreativeMode = node.metadata?.textCreativeMode || "write";
    const sourcePrompt = isPanorama ? node.metadata?.panoramaSourcePrompt || "" : node.metadata?.prompt || "";
    const [prompt, setPrompt] = useState(sourcePrompt);
    const credits = requestCreditCost({ channelMode: config.channelMode, modelCosts, model: config.model, count: mode === "image" ? config.count : 1 });

    useEffect(() => {
        setPrompt(sourcePrompt);
    }, [node.id, sourcePrompt]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        onPromptChange(node.id, value);
    };

    const canSubmit = Boolean(prompt.trim()) || (isPanorama && (hasImageContent || mentionReferences.length > 0));

    const submit = () => {
        const text = prompt.trim();
        if (!canSubmit || isRunning) return;
        onGenerate(node.id, mode, text);
        if (!isPanorama) setPrompt("");
    };

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-40 w-full resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={isPanorama ? "描述想生成的全景，或上传/连接图片作为参考" : promptPlaceholder(mode, hasImageContent, hasTextContent, textCreativeMode)}
            />

            {mode === "text" ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Kimi K3 文本创作模式">
                    <span className="mr-1 text-xs opacity-60">Kimi K3 · {canvasTextCreativeLabel(textCreativeMode)}</span>
                    {canvasTextCreativeOptions.map((option) => {
                        const Icon = textCreativeModeIcon(option.value);
                        const active = option.value === textCreativeMode;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                title={option.description}
                                className="inline-flex h-8 items-center gap-1 rounded-full border px-2 text-xs transition"
                                style={{ background: active ? theme.toolbar.activeBg : "transparent", borderColor: active ? theme.toolbar.activeText : theme.node.stroke, color: active ? theme.toolbar.activeText : theme.node.text }}
                                onClick={() => onConfigChange(node.id, { textCreativeMode: option.value })}
                            >
                                <Icon className="size-3.5" />
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker
                                className="!w-[180px] !min-w-0 !shrink-0"
                                config={config}
                                value={config.model}
                                channelId={config.imageChannelId}
                                onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })}
                                capability="image"
                                onMissingConfig={() => openConfigDialog(true)}
                            />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !w-[148px] !shrink-0 !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                                showSize={!isPanorama}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker
                                className="!w-[180px] !min-w-0 !shrink-0"
                                config={config}
                                value={config.model}
                                channelId={config.videoChannelId}
                                onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })}
                                capability="video"
                                onMissingConfig={() => openConfigDialog(true)}
                            />
                            <CanvasVideoSettingsPopover
                                config={config}
                                buttonClassName="!h-10 !w-[148px] !shrink-0 !justify-start !rounded-full !px-3"
                                frameOptions={videoFrameOptions}
                                resourceOptions={videoResourceOptions}
                                metadata={node.metadata}
                                firstFrameNodeId={node.metadata?.firstFrameNodeId}
                                lastFrameNodeId={node.metadata?.lastFrameNodeId}
                                onFrameChange={(patch) => onConfigChange(node.id, patch)}
                                onMetadataChange={(patch) => onConfigChange(node.id, patch)}
                                onConfigChange={(key, value) => onConfigChange(node.id, canvasVideoConfigPatch(key, value))}
                            />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={config.model}
                                channelId={config.audioChannelId || config.activeChannelId}
                                onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })}
                                capability="audio"
                                onMissingConfig={() => openConfigDialog(true)}
                            />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, canvasAudioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} channelId={config.textChannelId} onChange={(model, channelId) => onConfigChange(node.id, { model, channelId })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                    {mode === "video" || (mode === "image" && !isPanorama) ? (
                        <CanvasCameraControl value={node.metadata?.cameraControl} onChange={(cameraControl) => onConfigChange(node.id, { cameraControl })} buttonClassName="!h-10 !min-w-[92px] !justify-start !rounded-full !px-3" />
                    ) : null}
                </div>
                <Button type="primary" className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3" disabled={isRunning || !canSubmit} onClick={submit} aria-label="生成">
                    <span className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                            <CreditSymbol />
                            {credits.toLocaleString()}
                        </span>
                        {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                    </span>
                </Button>
            </div>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean, textCreativeMode: CanvasTextCreativeMode) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    if (textCreativeMode === "video-prompt") return "描述你想生成的视频，或连接图片、视频作为参考";
    if (textCreativeMode === "image-reverse-prompt") return "连接图片后反推提示词；也可补充风格或用途";
    if (textCreativeMode === "music-prompt") return "描述歌曲主题、情绪、风格或歌词方向";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "写下故事、场景、角色或创作要求";
}

function textCreativeModeIcon(mode: CanvasTextCreativeMode) {
    if (mode === "video-prompt") return Video;
    if (mode === "image-reverse-prompt") return ImageIcon;
    if (mode === "music-prompt") return Music2;
    return FileText;
}

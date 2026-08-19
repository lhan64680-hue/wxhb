"use client";

import type { ReactNode } from "react";
import { CircleHelp, LoaderCircle, Play, Sparkles } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { TopazVideoCapabilities } from "@/services/api/topaz-video";
import type { CanvasNodeData, CanvasNodeMetadata } from "../types";

type CanvasTopazVideoPanelProps = {
    node: CanvasNodeData;
    capabilities: TopazVideoCapabilities | null;
    isRunning: boolean;
    hasVideoInput: boolean;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
};

const targets = [
    { value: "1080p", label: "1080P" },
    { value: "1440p", label: "2K" },
    { value: "2160p", label: "4K" },
] as const;

export function CanvasTopazVideoPanel({ node, capabilities, isRunning, hasVideoInput, onConfigChange, onGenerate }: CanvasTopazVideoPanelProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const model = node.metadata?.topazModel || capabilities?.defaultModel || "prob-4";
    const target = node.metadata?.topazTarget || "1080p";
    const interpolation = node.metadata?.topazInterpolation || "none";
    const slowdown = node.metadata?.topazSlowdown || "1x";
    const ready = Boolean(capabilities?.ready);
    const controlStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const hint = !hasVideoInput ? "请先连接一个视频输出节点" : capabilities && !ready ? capabilities.error || "本机 Topaz Video 尚未就绪" : "本机 Topaz Video · 本地直连";

    return (
        <section
            className="rounded-[22px] border p-5 shadow-2xl backdrop-blur-xl"
            style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <h3 className="mb-5 text-xl font-semibold">视频高清</h3>
            <div className="space-y-3.5">
                <PanelField label="模型选择">
                    <select className="h-12 w-full rounded-xl border px-3 text-base outline-none" style={controlStyle} value={model} onChange={(event) => onConfigChange(node.id, { topazModel: event.target.value })}>
                        {(capabilities?.models?.length ? capabilities.models : [{ id: model, name: "Topazlabs", description: "" }]).map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name || item.id}
                            </option>
                        ))}
                    </select>
                </PanelField>
                <PanelField label="分辨率">
                    <div className="grid grid-cols-3 gap-2">
                        {targets.map((item) => {
                            const active = target === item.value;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    className="h-12 rounded-xl border text-base font-medium transition"
                                    style={active ? { background: theme.toolbar.activeBg, borderColor: theme.toolbar.activeBg, color: theme.toolbar.activeText } : controlStyle}
                                    onClick={() => onConfigChange(node.id, { topazTarget: item.value })}
                                >
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>
                </PanelField>
                <PanelField label="补帧模式">
                    <select className="h-12 w-full rounded-xl border px-3 text-base outline-none" style={controlStyle} value={interpolation} onChange={(event) => onConfigChange(node.id, { topazInterpolation: event.target.value as "none" | "2x" | "4x" })}>
                        <option value="none">不补帧</option>
                        <option value="2x">AI 补帧 2x</option>
                        <option value="4x">AI 补帧 4x</option>
                    </select>
                </PanelField>
                <PanelField
                    label={
                        <span className="inline-flex items-center gap-1.5">
                            慢放倍数 <CircleHelp className="size-4 opacity-55" aria-label="慢放会通过 Topaz AI 补充中间帧" />
                        </span>
                    }
                >
                    <select className="h-12 w-full rounded-xl border px-3 text-base outline-none" style={controlStyle} value={slowdown} onChange={(event) => onConfigChange(node.id, { topazSlowdown: event.target.value as "1x" | "2x" | "4x" })}>
                        <option value="1x">1x</option>
                        <option value="2x">2x</option>
                        <option value="4x">4x</option>
                    </select>
                </PanelField>
            </div>
            <footer className="mt-5 flex items-center justify-between gap-4">
                <span className="min-w-0 text-xs leading-5" style={{ color: hasVideoInput && ready ? theme.node.muted : "#f87171" }}>
                    {hint}
                </span>
                <button
                    type="button"
                    className="grid size-12 shrink-0 place-items-center rounded-2xl transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}
                    disabled={!ready || !hasVideoInput || isRunning}
                    onClick={() => onGenerate(node.id)}
                    title="开始本机高清处理"
                    aria-label="开始本机高清处理"
                >
                    {isRunning ? <LoaderCircle className="size-5 animate-spin" /> : <Play className="size-5 fill-current" />}
                </button>
            </footer>
            <div className="mt-3 flex items-center gap-1.5 text-[11px]" style={{ color: theme.node.muted }}>
                <Sparkles className="size-3.5" />
                串行处理，避免与本机视频生成抢占显存。
            </div>
        </section>
    );
}

function PanelField({ label, children }: { label: ReactNode; children: ReactNode }) {
    return (
        <label className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 text-base font-medium">
            <span>{label}</span>
            {children}
        </label>
    );
}

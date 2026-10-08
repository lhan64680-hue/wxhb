"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Cpu } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { filterModelsByCapability, normalizeLocalChannels, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { compareImageCredits, formatCredits, grsaiBillingChannel } from "@/services/api/grsai-billing";
import { billingEntryForConfig, useImageBillingStore } from "@/stores/use-image-billing-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    channelId?: string;
    capability?: ModelCapability;
    onChange: (model: string, channelId?: string) => void;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, channelId, capability, onChange, className, fullWidth = false, placeholder = "选择模型", onMissingConfig }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    useImageBillingStore((state) => state.entries);
    const refreshBilling = useImageBillingStore((state) => state.refresh);
    const optionCredits = (model: string, selectedChannelId?: string) => {
        if (capability !== "image") return undefined;
        const selectedConfig = { ...config, model, imageModel: model, activeChannelId: selectedChannelId || "", imageChannelId: selectedChannelId || "" };
        if (!grsaiBillingChannel(selectedConfig)) return undefined;
        const price = billingEntryForConfig(selectedConfig)?.data?.models.find((item) => item.name === model);
        return price?.credits ?? null;
    };
    const optionPrice = (model: string, selectedChannelId?: string) => {
        const credits = optionCredits(model, selectedChannelId);
        return credits === undefined ? undefined : credits === null ? "价格未确认" : `${formatCredits(credits)} 积分/次`;
    };
    const channelOptions = useMemo(() => {
        const channels =
            config.channelMode === "remote"
                ? config.publicChannels.map((channel) => ({ id: channel.id, name: channel.name || "云端渠道", baseUrl: channel.baseUrl, models: channel.models }))
                : normalizeLocalChannels(config).map((channel) => ({ id: channel.id, name: channel.name || "本地渠道", baseUrl: channel.baseUrl, models: channel.models }));
        const models = channels.flatMap((channel) => (channel.models ?? []).map((model) => ({ key: `${channel.id}::${model}`, channelId: channel.id, channelName: channel.name, model })));
        if (!capability) return models;
        return models.filter((item) => filterModelsByCapability([item.model], capability).length > 0);
    }, [capability, config]);
    const currentOption = useMemo(() => {
        if (!value) return undefined;
        return channelOptions.find((item) => item.model === value && item.channelId === channelId) || channelOptions.find((item) => item.model === value);
    }, [channelId, channelOptions, value]);
    const options = capability === "image" ? [...channelOptions].sort((left, right) => compareImageCredits(optionCredits(left.model, left.channelId), optionCredits(right.model, right.channelId))) : channelOptions;
    const current = value || "";
    const currentValue = current && currentOption ? currentOption.key : "";

    useEffect(() => {
        if (value && currentOption?.channelId && channelId !== currentOption.channelId) onChange(value, currentOption.channelId);
    }, [channelId, currentOption?.channelId, onChange, value]);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current ? currentValue : ""}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") {
                    onMissingConfig?.();
                    return;
                }
                if (nextOpen) {
                    window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                    if (capability === "image") {
                        for (const option of options.filter((item, index, all) => all.findIndex((other) => other.channelId === item.channelId) === index)) {
                            const selectedConfig = { ...config, model: option.model, imageModel: option.model, activeChannelId: option.channelId || "", imageChannelId: option.channelId || "" };
                            if (!billingEntryForConfig(selectedConfig)?.data) void refreshBilling(selectedConfig);
                        }
                    }
                }
                setOpen(nextOpen);
            }}
            onValueChange={(nextValue) => {
                const option = options.find((item) => item.key === nextValue);
                if (option) onChange(option.model, option.channelId);
            }}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current || placeholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current || placeholder}</span>
                {current && optionPrice(current, currentOption?.channelId) ? <span className="shrink-0 text-[11px] text-muted-foreground">{optionPrice(current, currentOption?.channelId)}</span> : null}
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((option) => (
                        <SelectItem key={option.key} value={option.key} textValue={`${option.model} ${option.channelName}`}>
                            <ModelLabel model={option.model} channelName={option.channelName} price={optionPrice(option.model, option.channelId)} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {config.channelMode === "remote" ? "暂无可用模型" : "请先到配置里拉取模型列表"}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function ModelLabel({ model, channelName, price }: { model: string; channelName?: string; price?: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="min-w-0 flex-1 truncate">{model}{channelName ? <span className="block truncate text-[11px] opacity-50">{channelName}</span> : null}</span>
            {price ? <span className="shrink-0 text-[11px] text-muted-foreground">{price}</span> : null}
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(model);
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google") || name.includes("nano-banana")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}

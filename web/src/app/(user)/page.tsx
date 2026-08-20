"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ImagePlus, Images, Maximize2, Network, Plus, Video } from "lucide-react";
import { useRouter } from "next/navigation";

import { useCanvasStore } from "./canvas/stores/use-canvas-store";

const orbitTools = [
    { id: "canvas", href: "/canvas", label: "我的画布", description: "管理项目与创作流程", icon: Maximize2, phase: 0.65 },
    { id: "image", href: "/image", label: "生图工作台", description: "生成与编辑图片", icon: ImagePlus, phase: 1.9 },
    { id: "video", href: "/video", label: "视频创作台", description: "文生视频与图生视频", icon: Video, phase: 3.15 },
    { id: "prompts", href: "/prompts", label: "提示词库", description: "沉淀灵感与提示词", icon: BookOpen, phase: 4.4 },
    { id: "assets", href: "/assets", label: "我的素材", description: "管理图片、视频与音频", icon: Images, phase: 5.6 },
] as const;

// Each cubic section meets with a matching tangent.  This keeps the outer turns
// perfectly round instead of forming a visible corner where two curves join.
const orbitRibbonPath = "M 500 270 C 365 68, 100 68, 100 270 C 100 472, 365 472, 500 270 C 635 68, 900 68, 900 270 C 900 472, 635 472, 500 270";
const orbitFrontLoopPath = "M 500 270 C 635 68, 900 68, 900 270 C 900 472, 635 472, 500 270";

function orbitPoint(progress: number) {
    const sin = Math.sin(progress);
    const cos = Math.cos(progress);
    const denominator = 1 + cos * cos;
    return {
        left: 50 + (39 * sin) / denominator,
        top: 50 + (55 * sin * cos) / denominator,
    };
}

export default function IndexPage() {
    const router = useRouter();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const [orbitProgress, setOrbitProgress] = useState(0);
    const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);

    useEffect(() => {
        if (hoveredToolId) return;
        let frame = 0;
        let previous = performance.now();
        const animate = (now: number) => {
            setOrbitProgress((current) => (current + ((now - previous) / 1000) * 0.32) % (Math.PI * 2));
            previous = now;
            frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frame);
    }, [hoveredToolId]);

    const createAndEnter = () => {
        const id = createProject(`无限画布 ${projects.length + 1}`);
        router.push(`/canvas/${id}`);
    };

    return (
        <main className="flex h-full overflow-hidden bg-[#fbfbff] text-stone-950 dark:bg-[#090a10] dark:text-stone-100">
            <aside className="hidden w-56 shrink-0 flex-col border-r border-violet-100/80 bg-white/65 lg:flex dark:border-white/10 dark:bg-white/[.025] xl:w-60">
                <div className="flex items-center justify-between px-5 pb-4 pt-6">
                    <div>
                        <p className="text-sm font-semibold">历史项目</p>
                        <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">本机自动保存</p>
                    </div>
                    <button
                        type="button"
                        onClick={createAndEnter}
                        disabled={!hydrated}
                        className="inline-flex size-8 items-center justify-center rounded-full border border-violet-200 text-violet-600 transition hover:border-cyan-300 hover:text-cyan-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-400/40 dark:text-violet-300"
                        aria-label="新建项目"
                        title="新建项目"
                    >
                        <Plus className="size-4" />
                    </button>
                </div>

                <div className="hide-scrollbar min-h-0 space-y-1 overflow-y-auto px-3 pb-6">
                    {!hydrated ? <p className="px-2 py-4 text-xs text-stone-400">正在读取项目...</p> : null}
                    {hydrated && !projects.length ? (
                        <button
                            type="button"
                            onClick={createAndEnter}
                            className="w-full rounded-xl border border-dashed border-violet-200 px-3 py-5 text-left text-xs leading-5 text-stone-500 transition hover:border-cyan-300 hover:text-stone-700 dark:border-violet-400/30 dark:text-stone-400 dark:hover:text-stone-200"
                        >
                            创建第一个画布项目
                        </button>
                    ) : null}
                    {projects.map((project, index) => (
                        <Link
                            key={project.id}
                            href={`/canvas/${project.id}`}
                            className={`group relative flex gap-2.5 rounded-xl px-2.5 py-3 transition hover:bg-white hover:shadow-[0_8px_24px_rgba(112,81,180,.09)] dark:hover:bg-white/[.06] ${index === 0 ? "bg-[linear-gradient(90deg,rgba(236,72,153,.10),rgba(34,211,238,.08))]" : ""}`}
                        >
                            {index === 0 ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-gradient-to-b from-pink-400 via-violet-400 to-cyan-400" /> : null}
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-violet-100 bg-white text-violet-500 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">
                                <Network className="size-3.5" />
                            </span>
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{project.title}</span>
                                <span className="mt-1 block truncate text-[11px] text-stone-400 dark:text-stone-500">
                                    {project.nodes.length} 节点 · {project.connections.length} 连接
                                </span>
                            </span>
                        </Link>
                    ))}
                </div>
            </aside>

            <section className="relative min-w-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,rgba(111,99,190,.16)_1px,transparent_0)] [background-size:20px_20px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(215,205,255,.15)_1px,transparent_0)]">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(238,222,255,.68),transparent_58%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(81,46,126,.20),transparent_62%)]" />
                <div className="relative mx-auto flex min-h-full max-w-[1480px] flex-col px-5 py-10 sm:px-10 lg:py-14">
                    <div className="text-center">
                        <p className="text-sm font-medium text-stone-500 dark:text-stone-400">选择一个工具，开始创作</p>
                        <h1 className="mt-3 bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">创作，从灵感开始</h1>
                    </div>

                    <div className="relative mx-auto mt-4 hidden min-h-[620px] w-full max-w-[1120px] flex-1 lg:block" aria-label="创作工具莫比乌斯轨道">
                        <svg viewBox="0 0 1000 540" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
                            <defs>
                                <linearGradient id="home-orbit-ribbon" x1="-120" y1="270" x2="1120" y2="270" gradientUnits="userSpaceOnUse">
                                    <stop offset="0" stopColor="#f7c95f" />
                                    <stop offset="0.25" stopColor="#ec4899" />
                                    <stop offset="0.5" stopColor="#a855f7" />
                                    <stop offset="0.75" stopColor="#4f46e5" />
                                    <stop offset="1" stopColor="#22d3ee" />
                                    {!hoveredToolId ? <animateTransform attributeName="gradientTransform" type="rotate" from="0 500 270" to="360 500 270" dur="24s" repeatCount="indefinite" /> : null}
                                </linearGradient>
                                <linearGradient id="home-orbit-side" x1="-120" y1="270" x2="1120" y2="270" gradientUnits="userSpaceOnUse">
                                    <stop offset="0" stopColor="#b96c17" />
                                    <stop offset="0.25" stopColor="#b51e69" />
                                    <stop offset="0.5" stopColor="#6d22ad" />
                                    <stop offset="0.75" stopColor="#2822ad" />
                                    <stop offset="1" stopColor="#087fa5" />
                                    {!hoveredToolId ? <animateTransform attributeName="gradientTransform" type="rotate" from="0 500 270" to="360 500 270" dur="24s" repeatCount="indefinite" /> : null}
                                </linearGradient>
                                <linearGradient id="home-orbit-bevel" x1="-120" y1="270" x2="1120" y2="270" gradientUnits="userSpaceOnUse">
                                    <stop offset="0" stopColor="#fff8dd" stopOpacity=".82" />
                                    <stop offset="0.33" stopColor="#fff" stopOpacity=".74" />
                                    <stop offset="0.66" stopColor="#f6edff" stopOpacity=".7" />
                                    <stop offset="1" stopColor="#dfffff" stopOpacity=".78" />
                                    {!hoveredToolId ? <animateTransform attributeName="gradientTransform" type="rotate" from="0 500 270" to="360 500 270" dur="24s" repeatCount="indefinite" /> : null}
                                </linearGradient>
                                <linearGradient id="home-orbit-glow" x1="120" y1="270" x2="880" y2="270" gradientUnits="userSpaceOnUse">
                                    <stop offset="0" stopColor="#fff" stopOpacity="0" />
                                    <stop offset="0.5" stopColor="#fff" stopOpacity=".9" />
                                    <stop offset="1" stopColor="#fff" stopOpacity="0" />
                                </linearGradient>
                                <filter id="home-orbit-shadow" x="-20%" y="-45%" width="140%" height="190%" colorInterpolationFilters="sRGB">
                                    <feDropShadow dx="0" dy="20" stdDeviation="18" floodColor="#7c3aed" floodOpacity=".19" />
                                    <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#312e81" floodOpacity=".15" />
                                </filter>
                            </defs>
                            <g filter="url(#home-orbit-shadow)">
                                {!hoveredToolId ? <animateTransform attributeName="transform" type="rotate" values="-0.35 500 270;0.35 500 270;-0.35 500 270" dur="16s" repeatCount="indefinite" /> : null}
                                <path d={orbitRibbonPath} transform="translate(0 22)" fill="none" stroke="url(#home-orbit-side)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="86" />
                                <path d={orbitRibbonPath} fill="none" stroke="url(#home-orbit-ribbon)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="78" />
                                <path d={orbitFrontLoopPath} transform="translate(0 22)" fill="none" stroke="url(#home-orbit-side)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="86" />
                                <path d={orbitFrontLoopPath} fill="none" stroke="url(#home-orbit-ribbon)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="78" />
                                <path d={orbitRibbonPath} transform="translate(0 -27)" fill="none" stroke="url(#home-orbit-bevel)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="9" />
                                <path d={orbitFrontLoopPath} transform="translate(0 -27)" fill="none" stroke="url(#home-orbit-bevel)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="9" />
                                <path d={orbitRibbonPath} fill="none" stroke="url(#home-orbit-glow)" strokeLinecap="round" strokeWidth="9" strokeDasharray="118 1100">
                                    {!hoveredToolId ? <animate attributeName="stroke-dashoffset" from="0" to="-1218" dur="9s" repeatCount="indefinite" /> : null}
                                </path>
                            </g>
                        </svg>

                        {orbitTools.map((tool) => {
                            const position = orbitPoint(orbitProgress + tool.phase);
                            const Icon = tool.icon;
                            const active = hoveredToolId === tool.id;
                            return (
                                <div key={tool.id} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${position.left}%`, top: `${position.top}%` }}>
                                    <Link
                                        href={tool.href}
                                        onMouseEnter={() => setHoveredToolId(tool.id)}
                                        onMouseLeave={() => setHoveredToolId(null)}
                                        onFocus={() => setHoveredToolId(tool.id)}
                                        onBlur={() => setHoveredToolId(null)}
                                        className={`group relative grid size-16 place-items-center rounded-full border border-white/70 bg-white/80 text-violet-600 shadow-[0_14px_30px_rgba(109,72,167,.22)] backdrop-blur-xl transition duration-300 hover:scale-110 focus-visible:scale-110 dark:border-white/25 dark:bg-[#16182a]/85 dark:text-violet-300 dark:shadow-[0_14px_34px_rgba(0,0,0,.40)] sm:size-[72px] ${active ? "scale-110 ring-2 ring-pink-300/70 dark:ring-cyan-300/60" : ""}`}
                                        aria-label={`${tool.label}：${tool.description}`}
                                    >
                                        <Icon className="size-7 sm:size-8" strokeWidth={1.8} />
                                        {active ? (
                                            <span className="pointer-events-none absolute left-1/2 top-[calc(100%+14px)] z-20 w-52 -translate-x-1/2 rounded-2xl border border-white/70 bg-white/95 p-3 text-left text-stone-800 shadow-[0_16px_40px_rgba(86,64,143,.18)] backdrop-blur-xl dark:border-white/10 dark:bg-[#181a2e]/95 dark:text-stone-100 dark:shadow-[0_16px_40px_rgba(0,0,0,.45)]">
                                                <span className="block text-sm font-semibold">{tool.label}</span>
                                                <span className="mt-1 block text-xs leading-5 text-stone-500 dark:text-stone-400">{tool.description}</span>
                                            </span>
                                        ) : null}
                                    </Link>
                                </div>
                            );
                        })}

                        <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-xs text-stone-400 dark:text-stone-500">工具沿创作轨道缓慢运行，悬停即可暂停并查看说明</div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-3 lg:hidden">
                        {orbitTools.map((tool) => {
                            const Icon = tool.icon;
                            return (
                                <Link key={tool.id} href={tool.href} className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-white/80 p-4 text-sm font-medium shadow-sm dark:border-white/10 dark:bg-white/5">
                                    <Icon className="size-5 text-violet-500" />
                                    {tool.label}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </section>
        </main>
    );
}

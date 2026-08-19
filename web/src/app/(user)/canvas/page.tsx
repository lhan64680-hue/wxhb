"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { App, Button } from "antd";
import { Download, FileUp, Network, Plus, Sparkles } from "lucide-react";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "./components/canvas-project-card";
import type { CanvasExportFile } from "./export-types";
import { useCanvasStore } from "./stores/use-canvas-store";
import { useCanvasUiStore } from "./stores/use-canvas-ui-store";
import { exportCanvasProjects } from "./utils/canvas-export";

export default function CanvasPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const enterProject = (id: string) => {
        router.push(`/canvas/${id}`);
    };
    const createAndEnter = () => enterProject(createProject(`无限画布 ${projects.length + 1}`));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    return (
        <main className="dark relative h-full overflow-auto bg-[#111110] text-stone-100">
            <div className="pointer-events-none absolute inset-0 opacity-35" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.24) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
            <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-7 lg:px-10">
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
                    <div className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-xl bg-cyan-300 text-stone-950">
                            <Network className="size-5" />
                        </span>
                        <div>
                            <p className="text-xs font-medium tracking-[0.18em] text-stone-500">CANVAS STUDIO</p>
                            <h1 className="mt-1 text-lg font-semibold">无限画布</h1>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button className="!border-white/15 !bg-white/5 !text-stone-200" disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `无限画布-${selectedIds.length}个项目`)}>
                                    导出选中
                                </Button>
                                <Button className="!border-white/15 !bg-white/5 !text-stone-200" disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    删除选中
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button className="!border-white/15 !bg-white/5 !text-stone-200" disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                删除全部
                            </Button>
                        ) : null}
                        <Button className="!border-white/15 !bg-white/5 !text-stone-200" disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            导入画布
                        </Button>
                        <Button className="!border-0 !bg-cyan-300 !font-medium !text-stone-950 hover:!bg-cyan-200" disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            新建项目
                        </Button>
                    </div>
                </header>

                <section className="grid gap-6 rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,.13),rgba(255,255,255,.025)_42%,rgba(255,255,255,.055))] p-7 md:grid-cols-[1fr_auto] md:items-end md:p-10">
                    <div className="max-w-2xl">
                        <p className="text-sm text-cyan-200">本地创作工作区</p>
                        <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">从一个节点开始，串起完整创作流程。</h2>
                        <p className="mt-4 max-w-xl text-sm leading-7 text-stone-400">新建项目后，双击任意空白处添加节点；拖动节点两侧的连接点，即可把文本、图片、视频和音频串联起来。</p>
                    </div>
                    <Button className="!h-12 !border-0 !bg-cyan-300 !px-5 !font-medium !text-stone-950 hover:!bg-cyan-200" disabled={!hydrated} type="primary" icon={<Sparkles className="size-4" />} onClick={createAndEnter}>
                        开始新项目
                    </Button>
                </section>

                {!hydrated ? (
                    <section className="flex min-h-[300px] items-center justify-center rounded-3xl border border-white/10 bg-white/[.035] text-sm text-stone-500">正在加载项目...</section>
                ) : projects.length ? (
                    <section>
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium">我的项目</p>
                                <p className="mt-1 text-xs text-stone-500">{projects.length} 个本地画布，自动保存</p>
                            </div>
                            <p className="hidden text-xs text-stone-500 sm:block">双击项目名称可以重命名</p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                        </div>
                    </section>
                ) : (
                    <section className="flex min-h-[300px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[.025] px-6 text-center">
                        <span className="grid size-12 place-items-center rounded-2xl bg-white/10 text-cyan-200"><Plus className="size-6" /></span>
                        <h2 className="mt-5 text-xl font-medium">创建第一个项目</h2>
                        <p className="mt-3 max-w-md text-sm leading-6 text-stone-500">项目会在本机自动保存。进入画布后，直接双击空白处即可添加第一个创作节点。</p>
                        <Button type="primary" className="mt-6 !border-0 !bg-cyan-300 !font-medium !text-stone-950 hover:!bg-cyan-200" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            新建项目
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}

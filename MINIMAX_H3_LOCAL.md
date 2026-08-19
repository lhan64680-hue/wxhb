# MiniMax-H3 本地直连

无限画布已接入当前可用的 MiniMax-H3 本地视频服务：

- `minimax-h3/text-to-video`: `http://127.0.0.1:7860/v1/videos`
- `minimax-h3/image-to-video`: `http://127.0.0.1:7860/v1/videos`

前端会把画布视频请求转换成本地 H3 服务使用的 JSON：

- 文生视频：`task: "t2va"`
- 首帧/尾帧生视频：`task: "fl2va"`
- 多参考：`task: "ref2va"`，可接收最多 9 张图片、3 个视频和 3 段音频（总计 12 项）。

## 画布 H3 运行模式

在 H3 视频节点的“视频设置 → H3 运行模式”中可直接切换：

- **标准**：864×480、20 步采样，适合画面稳定与细节优先的任务。
- **多参考**：Ref2VA、736×416、20 步采样；关联图片、视频、音频节点后可作为统一参考输入。
- **4 步 Turbo**：864×480、4 步采样，使用本地 `minimax_h3_turbo_v4_step600_ema.safetensors` 与 MiniMax-H3 Turbo 双流采样器。当前机器默认启用低显存合并路径，优先保证 16GB 显存稳定完成任务；该模式只支持文生视频和首尾帧。

Turbo LoRA 从国内镜像入口直连下载并校验 SHA-256；运行时访问仅在 `127.0.0.1:7860` 与 `127.0.0.1:8188` 之间进行，不走应用代理。

本机可用服务与模型权重均位于项目目录的 `.runtime/h3-runtime/work`。无限画布默认直连 `127.0.0.1:7860`，不会走外部代理。

## 启动服务

启动无限画布时会静默拉起 H3 本地服务。也可以单独启动：

```powershell
.\start-minimax-h3-fl2va.cmd
```

通用脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-minimax-h3.ps1
```

## 当前硬件状态

当前机器检测到 `NVIDIA GeForce RTX 5060 Ti 16GB`。已切换到可在当前配置运行的 MiniMax-H3 Comfy 本地后端，默认使用轻量档位生成 5 秒视频，首轮加载会比较慢。

如果后续把服务部署到另一台本地机器，只需要把无限画布配置里的 H3 渠道 Base URL 改成那台机器地址即可。

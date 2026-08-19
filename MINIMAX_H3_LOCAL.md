# MiniMax-H3 本地直连

无限画布已接入当前可用的 MiniMax-H3 本地视频服务：

- `minimax-h3/text-to-video`: `http://127.0.0.1:7860/v1/videos`
- `minimax-h3/image-to-video`: `http://127.0.0.1:7860/v1/videos`

前端会把画布视频请求转换成本地 H3 服务使用的 JSON：

- 文生视频：`task: "t2va"`
- 首帧/尾帧生视频：`task: "fl2va"`
- 图片参考会按首尾帧关键帧发送；当前本机服务暂不支持视频/音频参考。

本机可用服务与模型权重均位于项目目录的 `.runtime/h3-runtime/work`，模型通过 ModelScope 国内镜像下载到本地 ComfyUI 模型目录。无限画布默认直连 `127.0.0.1:7860`，不会走外部代理。

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

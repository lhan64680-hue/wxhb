# 本地开发

## 启动与停止

- 双击 `start-infinite-canvas.cmd`，应用会在浏览器中打开 `http://127.0.0.1:3000`。
- 启动无限画布时会静默拉起 MiniMax-H3 本地服务 `http://127.0.0.1:7860`。
- 双击 `stop-infinite-canvas.cmd`，停止本地前后端服务。
- 运行日志位于 `.runtime/`。启动失败时优先查看其中的 `*.err.log` 文件。

首次打开后台时，默认账号和密码均为 `admin` / `infinite-canvas`。仅建议用于本机开发；如需对外提供访问，请先从 `.env.example` 创建 `.env` 并更换管理员凭据。

## 修改代码

- 前端页面与画布功能：`web/src/app/(user)/canvas/`
- 前端通用组件、状态和请求：`web/src/components/`、`web/src/stores/`、`web/src/services/api/`
- 后端 HTTP 接口：`handler/` 和 `router/`
- 后端业务逻辑与数据访问：`service/`、`repository/`、`model/`

前端在运行时会自动热更新。修改 Go 后端后，先运行停止脚本，再重新运行启动脚本。

## 依赖说明

- Node.js 使用系统安装版本；前端依赖保存在 `web/node_modules/`。
- Go 1.25 继续使用共享工具链 `E:\codex\tools\go\`；无限画布自己的 Go 缓存位于 `.runtime/go-mod-cache` 与 `.runtime/go-build-cache`，不再写入 `E:\codex` 根目录。
- 项目源码使用 Git 管理；本地辅助脚本与源码放在同一项目中，便于继续比较和修改。

## MiniMax-H3 本地视频模型

- MiniMax-H3 接入说明见 `MINIMAX_H3_LOCAL.md`。
- 无限画布默认视频模型已设为 `minimax-h3/text-to-video`，本地直连渠道为 `http://127.0.0.1:7860`。
- 当前机器为 RTX 5060 Ti 16GB，已接入可在本机运行的 MiniMax-H3 Comfy 本地后端；默认轻量档位生成 5 秒视频。
- H3 引擎、模型、适配器及运行日志均放在 `.runtime/h3-runtime/work`；移动整个项目目录时不再依赖用户文档目录。

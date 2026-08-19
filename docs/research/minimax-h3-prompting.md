# MiniMax H3 提示词规则调研

> 仅依据 MiniMax 官方开源仓库及其随仓发布的 `h3-prompt-writing` 指南整理。本文用于本地 H3 Base 的提示词预处理；不涉及 API Key 或模型配置。

## 结论

本地部署的 H3 Base 不包含官方托管的 H3-Context-IR。官方将 Context-IR 定义为把自由的多模态输入转换为 H3 Base 可理解的结构化表示，并明确建议开发者接入它，或按 Prompting Guidance 自建预处理。因此，画布在把用户的中文自然语言、首尾帧或多参考图交给本地 H3 前，先由多模态 LLM 改写为官方结构，是合理且必要的补足，而不是把原始短提示词直接送入工作流。来源：[MiniMax H3 README](https://github.com/MiniMax-AI/MiniMax-H3#h3-context-ir)。

## 选择正确模式

| 画布输入 | H3 模式 | LLM 输出格式 |
| --- | --- | --- |
| 纯文字 | T2VA | 三段基础格式 |
| 一张首帧图 | I2VA | 首帧对齐行 + 三段基础格式 |
| 首帧和尾帧 | FL2VA | 首尾帧对齐行 + 三段基础格式 |
| 一张尾帧图 | L2VA | 尾帧对齐行 + 三段基础格式 |
| 多张参考图，或参考图/视频/音频的组合 | Ref2VA（全能参考） | 六段全参考格式 |

FL2VA 最多接受两张图片；Ref2VA 最多 9 张图片、3 段视频和 3 段音频，视频/音频单段均为 2–15 秒、同类总时长均不超过 15 秒，所有参考文件合计最多 12 个。输出视频时长为 4–15 秒。来源：[MiniMax H3 README：输入规格](https://github.com/MiniMax-AI/MiniMax-H3#model-variants-and-input-specifications)。

## 基础模式（文字、首帧、首尾帧）

基础模式的结构固定为以下顺序，并使用英文键名：

```text
<仅 I2VA / FL2VA / L2VA 需要的帧对齐首行>

integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: ...
```

- **T2VA** 不写帧对齐行。
- **I2VA** 的第一行必须说明 `<Picture 1>` 在 `0.00` 秒完全对齐；正文先锚定画面中的风格、主体、构图与空间关系，再写连续动作。
- **FL2VA** 的第一行必须同时把 Picture 1 对齐到 `0.00` 秒、Picture 2 对齐到实际时长的 `S.SS` 秒；正文重点是可观察的中间运动和镜头/光线变化，而非重复描述两张静帧。通常应优先单镜头，确保能连续插值到尾帧。
- **L2VA** 的第一行把 Picture 1 对齐到最后一镜的 `S.SS` 秒；正文从合理的前置状态开始，逐步落到尾帧。

每个 `[Shot 1]` 应明确样式、初始构图、主体位置/外观、场景与道具、连续动作、镜头、对白及画内声。后续镜头用严格递增的 `[Shot N] At MM:SS.mmm` 表示切点。来源：[官方基础提示词指南](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/base-en.txt)。

## 全能参考（Ref2VA）

Ref2VA 的改写结果必须按下列顺序输出六段英文内容：

```text
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:
```

其中：

- `<Subject N>` 表示需要复用/变化的人物、物体、场景、服装、风格或姿势；`<Picture N>` 是具体关键帧或构图锚点；`<Video N>` 用于编辑、延续或借用视频结构；`<Audio N>` 用于复制或参考声音。
- 一个标签一旦分配，在全部六段内不得改变含义；LLM 必须按画布上传顺序编号，不能跳号或凭空创建不存在的引用。
- `retention_analysis` 对视觉引用使用 `fully_preserved`、`partially_preserved`、`attribute_transfer`、`weak_reference`；音频使用 `fully_copy`、`partially_copy`、`reference`、`weak_reference`。
- `detailed_description` 是主要生成体：先用一两句定风格，再按播放顺序写镜头；首处出现的主体必须交代可见特征、位置、动作与引用标签。普通生成任务通常为 350–500 英文词，应服从实际时长而非凑字数。

来源：[官方 Ref2VA 提示词指南](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/ref-en.txt)。

## 镜头、音频与语言规则

- 镜头运动写成自然英文句子，按“运动类型 +（必要时）幅度 +（必要时）速度”表达，例如 `The camera pushes in with small amplitude at slow speed ...`。可用类型包括 push/pull、pan、truck、tilt、pedestal、arc、tracking、static、shake、POV 与 roll；不要在句尾堆叠标签。
- 画内环境声、动作声、非语言人声写入 `overall_soundscape`（1–4 个英文句子）；观众才听到的配乐写入 `non_diegetic_music`（1–3 个英文句子）。无配乐才使用 `N/A`；除非用户要求全片静音，不应把环境声填为 `N/A`。
- 对白/歌词只在正文以 `<d>[Language] ...</d>` 保留原语言；同一说话者使用稳定 `(S1)`、`(S2)`。屏幕可见文字使用英文双引号保留原文。

来源：[官方基础提示词指南：镜头与声音](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/base-en.txt)。

## 负面提示词处理

官方五种模式的正式输出字段只包含上述三段或六段，未定义 `negative_prompt` 字段；官方工作流还要求保留精确字段名、段落顺序、标签和时间格式。**因此画布的 LLM 改写器不应产生 Stable Diffusion 式的 `negative_prompt:` 段，也不应把一串否定词附在 H3 提示词末尾。**

这是基于官方格式规则作出的实现推断：把“不要抖动、不要换人、不要改服装”等用户意图改写成正文中的正向、可观察约束，例如“the camera holds a static shot”、“preserving her identity, clothing and spatial position”。这会让约束落在 H3 要求的镜头与引用保留字段中。来源：[官方 H3 Prompt Writing Skill](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/SKILL.md)、[官方基础提示词指南](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/base-en.txt)。

## 给画布 LLM 改写器的可执行约束

1. 先依据画布实际素材判定 T2VA、I2VA、FL2VA、L2VA 或 Ref2VA；不得让 3 张及以上参考图走 FL2VA。
2. 只输出最终 H3 英文提示词，不加 Markdown、解释、标题或代码围栏；对白、歌词和可见文字保持用户原文及其语言。
3. 保留用户的目标、主体、动作和引用优先级；缺失的风格、动作衔接、环境声可补足，但不得编造不存在的参考资源。
4. I2VA/FL2VA/L2VA 必须先输出对应的帧对齐行；Ref2VA 必须严格输出六段，且所有 `<Subject N>` / `<Picture N>` / `<Video N>` / `<Audio N>` 编号与上传素材一致。
5. 把相机要求写进当前镜头的完整句子；把“避免事项”转换为可验收的正向画面或运动约束，不输出独立负面提示词。
6. 生成时长要与全部镜头和切点一致：H3 官方建议遵循 4–15 秒的目标时长。

以上约束来自官方随仓 `h3-prompt-writing` skill；该 skill 明确用于把多模态请求重写为 H3 所需结构，并规定了各模式的字段、顺序、标签及时间格式。来源：[官方 Skill](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/SKILL.md)。

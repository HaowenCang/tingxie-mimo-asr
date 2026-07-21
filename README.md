# 听写

一个 Windows 桌面转写工具：上传音频或视频，自动提取视频音轨并调用 MiMo-V2.5-ASR 转为可编辑文本。

## 功能

- 支持批量添加 MP3、WAV、M4A、AAC、FLAC、OGG、WMA、MP4、MOV、MKV、AVI、WebM 等音视频文件。
- MP3 音轨直接复制；超出整段上传上限的其他编码使用最高质量 VBR MP3，并保持常见采样率和声道数，大幅减少长音视频的请求数量。
- 使用静音感知切分将音频控制在 MiMo Base64 10MB 限制以内；优先选择较长的自然停顿，找不到停顿时自动加入上下文重叠，并在合并时去除重复文字。
- 转写结果默认按 3–6 句话聚合为易读段落；可在个性化设置中选择紧凑、标准或长段落，新设置应用于之后生成的转写。
- 支持自动检测、中文和英文识别。
- 可在设置中选择按量计费 API 或 Token Plan（中国区）入口；两套 API Key 分别加密保存，互不覆盖。
- 默认启用延迟感知的自适应并发识别：不设固定并发上限，以 90 RPM 起步并在无压力时最高恢复到 92 RPM；遇到 429/503 时并发减半，并按 `Retry-After` 或指数退避重试。429 限流等待不消耗切片错误重试额度。可在设置中关闭并恢复顺序识别。
- 转写完成后可收起新增转写区域，并在右侧使用 AI 对话边栏分析录音、解释概念和梳理逻辑；对话按转写记录独立保存。
- AI 对话原生支持小米按量 API、Token Plan、`mimo-v2.5` 和 `mimo-v2.5-pro`，并支持多个 OpenAI Chat Completions 兼容 Provider。
- 可分别配置 AI Provider 的 Base URL、Model ID、上下文长度、最大输出 Token 和系统提示词；API Key 均使用 Windows 安全存储加密。
- 支持队列进度、取消、重试、历史记录、结果编辑、复制和 TXT/Markdown 导出。
- 媒体库支持多级文件夹、拖放整理、文件夹重命名/移动/安全删除，以及录音显示名称与关联转写标题同步修改。
- 新建转写页面使用全宽工作区；转写完成后直接进入结果详情，队列长进度会换行、自动跟随并可展开查看。
- 全应用下拉控件使用可键盘操作的 Liquid Glass 组件，并适配深色、减少透明度和高对比度模式。
- API Key 使用 Electron `safeStorage` 调用 Windows 安全存储加密，仅由主进程解密。

## 使用

1. 运行 `release/` 中最新的 `Tingxie-*-Setup.exe` 安装程序。
2. 打开“听写”，进入“设置”。
3. 选择“按量计费 API”或“Token Plan（中国区）”，填入对应的 `sk-` 或 `tp-` API Key，选择默认语言，并可使用“测试连接”。
4. 拖入音视频或点击“选择文件”，等待转写完成。
5. 在右侧编辑结果，或复制、导出文本。
6. 点击转写结果顶部的“AI 对话”收起上传区域并打开对话边栏；AI Provider 可在“设置 → AI 对话”中管理。

MiMo 官方文档：[语音识别（MiMo-V2.5-ASR）](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/Speech-Recognition)

## 设计与待开发

- [转写详情、智能速览与同步播放完整方案](./docs/TRANSCRIPT_DETAIL_PLAN.md)
- [待开发功能](./docs/PENDING_FEATURES.md)
- [设置项联动审查](./docs/SETTINGS_LINKAGE_AUDIT.md)

## 开发

需要 Node.js 20 或更高版本。

```powershell
npm install
npm run dev
```

质量检查与打包：

```powershell
npm test
npm run build
npm run dist
```

构建产物位于 `release/`。安装包当前未做代码签名，正式分发时建议配置 Windows 代码签名证书。

## 数据与限制

- 转写历史与加密设置保存在 Electron 用户数据目录中，不会上传到其他服务。
- AI 对话消息按转写 ID 保存在本地 `ai-chats.json`；转写正文不会在对话文件中重复存储，但发起 AI 请求时会连同当前问题发送给所选 Provider。
- 音频内容会按用户操作发送至 `https://api.xiaomimimo.com` 完成识别。
- 选择 Token Plan 时，音频会发送至 `https://token-plan-cn.xiaomimimo.com`；Token Plan 的 `tp-` Key 与按量 API 的 `sk-` Key 独立，不能混用。
- MiMo 当前仅接受 WAV/MP3，Base64 字符串上限 10MB；应用以约 6.4MiB 为目标、7.0MiB 为硬上限，并对 Base64 长度做最终检查。
- 切分默认寻找 `-35dB`、持续至少 450ms 的静音，并在目标点前后 15 秒内优先选择较长停顿；没有可靠静音时在边界两侧各保留最多 800ms 音频上下文。
- 未提供 API Key 时，应用不会发起转写请求。
- 所有识别请求（含重试）共用严格滚动 RPM 防线；真实请求延迟用于快速推导所需并发，结果始终按原片段顺序合并。
- 小米 `mimo-v2.5` / `mimo-v2.5-pro` 智能速览使用原生 JSON mode；无效结构会自动修复一次，自定义 OpenAI 兼容 Provider 不支持 JSON mode 时自动降级。
- AI 上下文超限时只移除最早的对话轮次，不会静默裁剪转写正文；若正文自身超限，应用会提示调整上下文或最大输出长度。
- Token Plan 官方限定于 Coding 场景。首次使用 Token Plan 进行转写 AI 对话时，应用会展示使用范围警告并要求确认。

# v0.12.0-rc.2 媒体库与新建转写体验修复

最后更新：2026-07-22（Asia/Shanghai）

## 状态

- 🟢 已完成并发布 `v0.12.0-rc.2`
- 实现分支：`codex/fix-library-queue-glass-selects`
- 回退基线：`main` / `9eefa34`
- 实现提交：`caca99b`
- 合并提交：`3483621`
- Pull Request：[#15](https://github.com/HaowenCang/tingxie-mimo-asr/pull/15)
- 目标版本：`v0.12.0-rc.2`
- 参考截图：`C:\Users\20659\AppData\Local\Temp\codex-clipboard-cd525ac8-f4e2-40b0-8a02-4f6b9c6a84c0.png`

## 执行清单

### 1. 媒体库文件夹与录音管理

- [x] 嵌套文件夹树、路径与后代计数。
- [x] 创建子文件夹、文件夹重命名与移动。
- [x] 阻止移动到自身或后代目录。
- [x] 安全删除文件夹：保留内容移到上级，或明确递归删除媒体。
- [x] 录音显式重命名，并同步关联转写标题。
- [x] 主进程、preload、Renderer 类型与 IPC 联动。
- [x] 旧媒体索引兼容、原子写入与回归测试。

### 2. 新建转写与队列

- [x] 删除空白转写结果栏和不可达的旧 `TranscriptPanel`。
- [x] 新建工作区横跨全部剩余宽度。
- [x] 队列填满剩余高度并与侧栏底部对齐。
- [x] 进度信息换行，长错误可展开。
- [x] 自动跟随最近更新任务；用户手动滚动后暂停并提供恢复按钮。
- [x] 小窗口响应式布局、键盘和辅助技术状态提示。

### 3. Liquid Glass 下拉控件

- [x] 建立统一、可访问的 `GlassSelect`。
- [x] 支持键盘、类型查找、禁用、碰撞避让和长列表滚动。
- [x] 适配浅色、深色、减少透明度和高对比度模式。
- [x] 迁移当前 19 个原生 `<select>`。
- [x] 加入禁止新增裸 `<select>` 的回归检查。

### 4. 验证与发布

- [x] 全量自动化测试（127 项）、TypeScript、Vite/Electron 构建与生产依赖审计（0 漏洞）。
- [x] 1424×856、1280×720 与 1080×700 真实界面验收，无横向溢出或控制台 warning/error。
- [x] 对照参考截图检查布局、密度、玻璃材质、控件与文字；空结果栏已移除，队列与侧栏底部精确对齐。
- [x] NSIS 安装包、隔离用户目录的 `win-unpacked` 启动、FFmpeg/FFprobe 与 SHA-256。
- [x] 独立实现提交、PR 与首轮 Windows `test-and-build`。
- [x] 状态提交 CI、PR 合并和 `v0.12.0-rc.2` prerelease。

## 本地产物

- 文件：`release/Tingxie-0.12.0-rc.2-Setup.exe`
- 大小：197,363,737 B
- SHA-256：`ABC7F58CF4536194CFC9F2C3484DFC3148CB37774FE46D02014749AC6D6295B8`
- `win-unpacked`：使用隔离临时用户目录启动成功；测试完成后仅终止本次测试进程。
- FFmpeg / FFprobe：随包资源存在。
- 代码签名：未配置，构建器明确跳过签名。

## GitHub RC2 产物

- Release：[v0.12.0-rc.2](https://github.com/HaowenCang/tingxie-mimo-asr/releases/tag/v0.12.0-rc.2)
- 文件：`Tingxie-0.12.0-rc.2-Setup.exe`
- 大小：197,363,750 B
- SHA-256：`BB830A69DE46D71609FE06F0A272B679765818F10920B23798F22D4975C77CC7`
- Windows Runner 工作流：`29856072894`，3 分 39 秒完成测试、NSIS、SHA、artifact 与 prerelease 发布。
- 公开 `SHA256SUMS.txt` 与 GitHub 记录的安装包摘要一致。
- 本机与 Runner 的安装包哈希不同，原因是 NSIS 包含构建时间等非确定性元数据；公开校验以同一 Runner 生成并上传的 SHA 清单为准。

## 数据安全规则

- 删除文件夹默认保留媒体并把直接内容移到上级。
- 递归删除媒体必须展示数量并二次确认。
- 删除媒体不静默删除已有转写；转写保留在“历史转写”。
- 录音重命名只修改显示名称和关联转写标题；受管媒体的 UUID 文件路径保持不变。
- 所有索引修改继续使用原子写入；真实用户数据不用于自动化测试。

## 版本管理

- 不移动或覆盖现有 `v0.12.0-rc.1` 标签与 Release。
- 本阶段使用独立 PR，受保护 `main` 必须通过 `test-and-build`。
- PR #15 的实现和状态提交均通过 Windows `test-and-build`，并 squash merge 为 `3483621`。
- 注释标签 `v0.12.0-rc.2` 指向该实现提交；RC1 标签与 Release 保持不变。
- 严重问题可整体回退本 PR，不重写 `main` 历史。

# v0.12.0-rc.4 媒体库、上下文菜单与活动布局

最后更新：2026-07-22（Asia/Shanghai）

## 状态

- 🟢 已完成并发布 GitHub prerelease
- 实现分支：`codex/library-context-resizable-rc4`
- 回退基线：`main` / `8e5a00a`
- 实现提交：`d7328b0`
- Pull Request：[PR #19](https://github.com/HaowenCang/tingxie-mimo-asr/pull/19)
- 合并提交：`cda9ad8`
- 发布工作流：[`29912720848`](https://github.com/HaowenCang/tingxie-mimo-asr/actions/runs/29912720848)
- 目标版本：`v0.12.0-rc.4`

## 已批准范围

- [x] 文件夹移动选择器适配长路径。
- [x] 根文件夹与系统分组处于同一视觉层级，仅子文件夹缩进。
- [x] 纯文字转写支持分组、多选、移动、重命名、导出和删除。
- [x] 媒体与纯文字转写支持混合批量操作，并明确区分媒体删除与转写删除。
- [x] 文件夹、媒体及转写提供 Liquid Glass 右键菜单，同时保留现有内联操作。
- [x] 文件夹、媒体和转写提供右键快捷操作；文本输入与编辑区域保留系统右键菜单。
- [x] 导航栏、媒体库文件夹栏、详情栏、上传区/队列和正文/AI 支持一级布局调整。
- [x] 内部控件使用响应式尺寸，不为按钮、输入框和内容卡增加独立拖拽。
- [x] 消除媒体库四角和新建转写页面的暗角、暗边。

## 数据安全

- 旧转写无 `folderId` 时按未分组读取，不做破坏性批量迁移。
- 删除媒体默认保留转写；删除转写默认保留媒体。
- 同时删除媒体与转写必须显式选择并二次确认。
- 布局尺寸使用版本化偏好设置并提供恢复默认值。

## 验证计划

- [x] 关键数据行为建立回归测试后完成实现。
- [x] 旧设置和旧转写记录兼容；无 `folderId` 时继续按未分组处理。
- [x] 1440×920、1280×720、1080×700 真实界面验收，无横向溢出。
- [x] 键盘调整、右键菜单、窗口边缘避让和自动紧凑布局验收。
- [x] 141/141 测试、TypeScript、Vite/Electron 和生产依赖审计通过。
- [x] NSIS、隔离用户目录的解包版启动与安装包校验通过。
- [x] 独立 PR 与首轮 Windows `test-and-build` 通过（1m28s）。
- [x] 状态提交 Windows `test-and-build` 通过（1m26s），PR #19 已 squash merge。
- [x] 注释标签、Windows Runner NSIS/SHA 校验与 GitHub prerelease 已完成。

## 本地验收证据

- 1440×920：队列与侧栏下沿同为 870px；上传区和队列仅保留内高光，无外部暗影。
- 1280×720：媒体库根文件夹图标与系统分组横坐标差为 0；仅挂载 16 行。
- 1080×700：自动隐藏主区域分隔线和详情栏；页面 `scrollWidth` 等于 1080px。
- 10,000 条媒体演示数据仅挂载 16–19 行；右键菜单和多级移动菜单均在视口内。
- 浏览器控制台：0 条 warning/error。

## 本地 RC4 产物

- 文件：`release/Tingxie-0.12.0-rc.4-Setup.exe`
- 大小：197,418,063 B
- SHA-256：`0569D26924959E3E747A544F7A82E3389BC5F375541981EB3A55DA053F4D348E`
- `win-unpacked` 使用隔离临时用户目录启动成功；测试进程已精确终止。
- 随包 FFmpeg、FFprobe x64 均存在。
- 未配置商业代码签名；构建日志明确跳过签名。

## GitHub RC4 产物

- Release：[v0.12.0-rc.4](https://github.com/HaowenCang/tingxie-mimo-asr/releases/tag/v0.12.0-rc.4)
- 文件：`Tingxie-0.12.0-rc.4-Setup.exe`
- 大小：197,417,931 B
- SHA-256：`CD8AE1EF3AAA74748C06482C88D875C61D668D7E234DB016137F1DCE70192AE9`
- Release 为非草稿 prerelease；安装包摘要与 Runner 生成的 SHA 清单一致。
- 本机与 Runner 的 NSIS 哈希可能因构建时间等非确定性元数据不同；公开校验以 GitHub Release 中的 Runner 产物为准。

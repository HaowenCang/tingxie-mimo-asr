# v0.12.0 发布验证

最后更新：2026-07-21（Asia/Shanghai）

## 状态

- 🟡 RC.1 进行中
- 分支：`codex/release-v0.12.0-rc1`
- 性能阶段基线：`main` / `cc92c28`

## RC.1 清单

- [x] 版本更新为 `0.12.0-rc.1`，未提前创建标签。
- [x] 新增可重复的 Windows 安装包工作流，包含测试、NSIS、SHA-256 和产物上传。
- [x] 本机 115 项测试与生产依赖审计通过（0 个生产依赖漏洞）。
- [x] 本机构建 NSIS 安装包。
- [x] 从 `win-unpacked` 使用隔离临时用户目录启动成品并验证进程，随后仅终止本次测试进程。
- [x] 核对安装包大小、SHA-256、FFmpeg/FFprobe 和动态前端块。
- [x] 浏览器回归新建转写、媒体库、详情/搜索、AI/Markdown、设置；0 横向溢出，0 warning/error。
- [ ] PR 与 Windows `test-and-build` 通过并合并。
- [ ] 创建注释标签 `v0.12.0-rc.1`。
- [ ] 标签触发的 Windows Release Candidate 工作流通过。
- [ ] 创建 GitHub prerelease，附安装包、SHA-256、性能报告、迁移和回退说明。

## 发布边界

- RC 阶段不修改真实用户历史、媒体库、聊天或设置。
- 不调用真实 MiMo ASR/AI 接口，不消耗用户额度。
- 安装包仍未配置商业代码签名，SmartScreen 可能显示未知发布者。
- RC 验收通过前不创建正式 `v0.12.0` 标签。

## 本机 RC.1 产物

- 文件：`release/Tingxie-0.12.0-rc.1-Setup.exe`
- 大小：197,199,182 B
- SHA-256：`8D0555A72E222EE20EA26FD3BEBCBCF576D2247CE1295E24E65DABC7878EC800`
- FFmpeg：存在于解包资源目录。
- FFprobe x64：存在于解包资源目录。
- 代码签名：未配置；构建日志明确跳过签名。

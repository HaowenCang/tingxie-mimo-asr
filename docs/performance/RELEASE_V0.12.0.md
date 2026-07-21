# v0.12.0 发布验证

最后更新：2026-07-21（Asia/Shanghai）

## 状态

- 🟡 RC.1 已发布，等待用户实机验收
- RC 标签：`v0.12.0-rc.1` → `4367dba`
- 性能实现回滚点：`4b6dbe9`（PR #9）
- RC 准备回滚点：`d16b0df`（PR #11）
- 发布工作流回滚点：`4367dba`（PR #13）

## RC.1 清单

- [x] 版本更新为 `0.12.0-rc.1`，未提前创建标签。
- [x] 新增可重复的 Windows 安装包工作流，包含测试、NSIS、SHA-256 和产物上传。
- [x] 本机 115 项测试与生产依赖审计通过（0 个生产依赖漏洞）。
- [x] 本机构建 NSIS 安装包。
- [x] 从 `win-unpacked` 使用隔离临时用户目录启动成品并验证进程，随后仅终止本次测试进程。
- [x] 核对安装包大小、SHA-256、FFmpeg/FFprobe 和动态前端块。
- [x] 浏览器回归新建转写、媒体库、详情/搜索、AI/Markdown、设置；0 横向溢出，0 warning/error。
- [x] PR #11、#12、#13 的 Windows `test-and-build` 通过并合并。
- [x] 创建注释标签 `v0.12.0-rc.1`。
- [x] 标签触发的 Windows Release Candidate 工作流 `29837569301` 通过（3m28s）。
- [x] 创建 GitHub prerelease，附安装包、SHA-256、性能、迁移和回退说明。
- [ ] 用户使用真实长转写、批量媒体、AI 对话和长时间播放完成 RC 实机验收。
- [ ] RC 验收通过后创建正式 `v0.12.0` 标签与 Release。

## RC 工作流诊断

- 首次标签运行 `29834132987` 在 NSIS 和 blockmap 已生成后失败。
- 根因：electron-builder 检测到 tag 后自动尝试发布，但 runner 未配置 GitHub Personal Access Token。
- 修复：工作流显式使用 `npm run dist -- --publish never`，将构建与发布职责分离；安装包只由 artifact 步骤收集，Release 后续由受控命令创建。
- 本机已使用完全相同的 `npm run dist -- --publish never` 命令复验成功。
- PR #12 将修复合并为 `0c1f8c0`，标签工作流 `29834679517` 随后通过构建、校验和 artifact 上传。
- 本地上传 Release 附件因上行带宽约 0.3 MiB/s 多次超过命令时限；GitHub 草稿始终保持未公开。
- PR #13 将受控 Release 上传加入 Windows Runner；标签重新指向 `4367dba` 后，工作流 `29837569301` 完整通过并公开 RC。

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

## GitHub RC.1 产物

- Release：https://github.com/HaowenCang/tingxie-mimo-asr/releases/tag/v0.12.0-rc.1
- 安装包：`Tingxie-0.12.0-rc.1-Setup.exe`
- 大小：197,199,241 B
- SHA-256：`4CAAE95B41FCCC3BC770BA7A7DEE373BC96BEAABC3A08C3A3DC3DEBC1ACE50B4`
- SHA 清单与 GitHub 记录的安装包摘要一致。
- 本机与 GitHub Runner 的 NSIS 哈希不同，原因是安装包包含构建时间等非确定性元数据；发布校验以同一 Runner 生成并上传的公开 SHA 清单为准。

## RC 实机验收清单

- [ ] 安装或覆盖安装后，旧设置、历史转写和媒体库均可读取。
- [ ] 打开最长转写，滚动、编辑、搜索、播放跟随无明显卡顿或空白。
- [ ] 批量导入媒体、分组、重命名、移动及队列进度正常。
- [ ] AI 长对话流式输出平滑，完成后 Markdown、表格和代码块显示正常。
- [ ] 长时间播放期间，播放器、自动跟随和跳过静音稳定。
- [ ] 真实使用期间无数据丢失、崩溃或无法恢复的迁移问题。

通过以上验收前，不创建正式 `v0.12.0` 标签。若发现严重问题，优先回滚对应独立 PR；整体回滚可从上一正式版本重新安装，并保留当前用户数据备份。

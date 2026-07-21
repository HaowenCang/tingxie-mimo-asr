# 性能优化续作日志

最后更新：2026-07-21（Asia/Shanghai）

## 当前稳定基线

- 阶段 0–5 已通过独立 PR、受保护分支和 GitHub Windows CI。
- 阶段 5 对应 PR #9，squash merge 为 `4b6dbe9`。
- `v0.12.0-rc.1` 已由 Windows Runner 构建并发布为 GitHub prerelease。
- 当前正式发布门槛是用户实机 RC 验收；尚未创建正式 `v0.12.0` 标签。

## 当前阶段

阶段 5 已完成。RC 准备、构建修复和 Runner 发布分别通过 PR #11、#12、#13；当前标签 `v0.12.0-rc.1` 指向 `4367dba`。标签工作流 `29837569301` 以 3m28s 完成测试、NSIS、SHA、artifact 和 GitHub prerelease 发布。公开安装包 SHA-256 为 `4CAAE95B41FCCC3BC770BA7A7DEE373BC96BEAABC3A08C3A3DC3DEBC1ACE50B4`。详细状态见 `docs/performance/RELEASE_V0.12.0.md`。

## 下一次从哪里继续

下一次会话从 `docs/performance/RELEASE_V0.12.0.md` 的 RC 实机验收清单继续：

```powershell
git switch main
git pull --ff-only origin main
git status --short --branch
```

先安装 GitHub prerelease，在不删除用户数据的前提下验证旧数据兼容、真实长转写、批量媒体、AI 长对话和长时间播放。RC 通过前不创建正式 `v0.12.0` 标签。

## GitHub 与回滚点

- RC Release：https://github.com/HaowenCang/tingxie-mimo-asr/releases/tag/v0.12.0-rc.1
- 性能阶段：`4b6dbe9`（PR #9）
- RC 准备：`d16b0df`（PR #11）
- 禁止 electron-builder 自动发布：`0c1f8c0`（PR #12）
- Runner 受控发布：`4367dba`（PR #13）
- 发现阶段性问题时优先 revert 对应 squash merge；不要重写 `main` 历史。

## 重要约束

- `main` 已启用管理员同样适用的分支保护，必须通过 PR 和 `test-and-build`。
- 每个阶段使用独立分支、独立 PR、独立 squash merge，便于 `git revert`。
- 不用开发/迁移脚本改写真实用户历史、媒体库或设置。
- 保持现有 429/RPM 等待不占切片错误重试次数的语义。
- 保持 Apple Liquid Glass 设计；不引入鼠标跟随或持续 WebGL。

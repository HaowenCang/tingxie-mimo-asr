# 性能优化续作日志

最后更新：2026-07-21（Asia/Shanghai）

## 当前稳定基线

- 阶段 0–4 已通过独立 PR、受保护分支和 GitHub Windows CI。
- 阶段 4 对应 PR #8；其 squash merge 是本次会话的最后一个仓库操作。
- 本次任务已按用户要求在阶段 4 后停止，没有开始阶段 5，也没有升级版本号或构建安装包。

## 当前阶段

阶段 5 已完成并通过 PR #9 squash merge 为 `4b6dbe9`。v0.12.0-rc.1 本机验证和 PR #11 已通过。首次标签工作流在 NSIS 生成后因 electron-builder 自动发布缺少令牌而失败；失败标签已删除，当前在 `codex/fix-release-workflow` 通过 `--publish never` 分离构建与发布。修复合并前不会重建标签。详细状态见 `docs/performance/RELEASE_V0.12.0.md`。

## 下一次从哪里继续

若中途暂停，下一次会话从 `docs/performance/RELEASE_V0.12.0.md` 的首个未完成项继续：

```powershell
git switch main
git pull --ff-only origin main
git switch codex/release-v0.12.0-rc1
```

先确认工作区与远端分支状态，再继续 RC 验证；RC 通过前不创建正式 `v0.12.0` 标签。

## 重要约束

- `main` 已启用管理员同样适用的分支保护，必须通过 PR 和 `test-and-build`。
- 每个阶段使用独立分支、独立 PR、独立 squash merge，便于 `git revert`。
- 不用开发/迁移脚本改写真实用户历史、媒体库或设置。
- 保持现有 429/RPM 等待不占切片错误重试次数的语义。
- 保持 Apple Liquid Glass 设计；不引入鼠标跟随或持续 WebGL。

# 性能优化续作日志

最后更新：2026-07-21（Asia/Shanghai）

## 当前稳定基线

- 阶段 0–4 已通过独立 PR、受保护分支和 GitHub Windows CI。
- 阶段 4 对应 PR #8；其 squash merge 是本次会话的最后一个仓库操作。
- 本次任务已按用户要求在阶段 4 后停止，没有开始阶段 5，也没有升级版本号或构建安装包。

## 当前阶段

阶段 5 的实现与本地验证已完成，回退基线为 `main` / `1323462`。实现提交 `28701cd` 已推送到 PR #9；115/115 测试、构建、生产依赖审计、性能基准和真实浏览器验收通过，首屏主 JavaScript 下降 50.97%，首轮 Windows `test-and-build` 通过（1m45s）。下一步等待状态文档提交 CI 后合并 PR #9。

## 下一次从哪里继续

下一次会话从 `docs/PERFORMANCE_OPTIMIZATION_PLAN.md` 的“阶段 5：AI、搜索、启动包与 Liquid Glass”开始：

```powershell
git switch main
git pull --ff-only origin main
git switch -c codex/perf-bundle-and-glass
```

先将阶段 5 标记为进行中，再按 TDD 和浏览器验收流程执行。阶段 5 完成前不要升级版本号或构建安装包。

## 重要约束

- `main` 已启用管理员同样适用的分支保护，必须通过 PR 和 `test-and-build`。
- 每个阶段使用独立分支、独立 PR、独立 squash merge，便于 `git revert`。
- 不用开发/迁移脚本改写真实用户历史、媒体库或设置。
- 保持现有 429/RPM 等待不占切片错误重试次数的语义。
- 保持 Apple Liquid Glass 设计；不引入鼠标跟随或持续 WebGL。

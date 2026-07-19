# 性能优化续作日志

最后更新：2026-07-19（Asia/Shanghai）

## 当前稳定基线

- `main` 最新稳定提交：`a538ed1`，阶段 3（历史分离存储）已合并。
- 阶段 0–3 已完成并通过受保护分支的 GitHub Windows CI。
- 当前工作分支：`codex/perf-media-library`。
- 当前任务只完成阶段 4 后停止；不要在本次继续阶段 5。

## 当前阶段

阶段 4 的本地实现、111 项测试、生产构建、依赖审计、性能基准和真实浏览器验收均已通过。剩余流程：

1. 提交阶段 4 代码。
2. 推送 `codex/perf-media-library`。
3. 创建独立 PR，等待必需检查 `test-and-build`。
4. CI 通过后，在主方案中将阶段 4 标为完成并记录 CI 时间。
5. 再次提交文档状态、等待 CI，通过后 squash merge。
6. 切回 `main` 并确认工作区干净，然后停止本次工作。

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

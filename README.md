# Pi Extensions

Pi 插件的 monorepo。每个 `packages/` 子目录仍是独立的 npm 包，保留自己的版本、依赖和 Pi 配置。

## 开发

```bash
bun install --frozen-lockfile
bun run test:release
bun run check:packages
```

`check:packages` 运行各包已有的类型检查和测试，并检查 npm 包是否包含声明的 Pi 入口。单独运行某个包的脚本：

```bash
bun run --cwd packages/pi-persona test
```

## 自动发布

`.github/workflows/release.yml` 在推送 `main` 后检查自上一次发布提交以来发生变化的包，分别发布到 npm。首次推送不会发布；为了让第一次发布的基线准确，首次推送应当只包含一个初始提交。

- 已发布的版本默认自动递增 patch；如果手动将包版本设为比 npm 上所有稳定版本更高的稳定版本，则使用手动指定的版本。
- 版本提交由 workflow 自动推送，提交信息带 `[skip ci]`。只改根目录文件不会发布包；改动包内 README、测试或其他文件也会触发该包发布。
- 发布前会执行检查，并查询 npm，避免重复发布已有版本。包发布失败时，在有新的推送之前通过 GitHub Actions 的 **Re-run jobs** 重试；已发布的包会跳过。若失败后已有新提交，流程会停止以防遗漏未发布的包，需先排查并恢复上次发布。
- 多个推送会串行处理；如果推送发生在 workflow 写回版本的同时，写回可能因远程有新提交而失败。后续排队的 workflow 会重新检查自上次发布以来的变更；没有后续运行时可重试失败的 workflow。

### 一次性配置

1. 在 GitHub 创建 `smoosex/pi-extensions` 仓库并关联本地仓库。若实际仓库名不同，要同步更新各包 `package.json` 的 `repository`、`homepage` 和 `bugs`。
2. 为每个已有的 `@smoose/pi-*` npm 包，在 npm 包设置的 **Trusted Publisher** 中配置 GitHub Actions：仓库所有者 `smoosex`，仓库 `pi-extensions`，workflow 文件名 `release.yml`。不需要配置 npm token。新包需要先按照 npm 的 Trusted Publishing 指引配置首次发布。
3. GitHub 仓库的 Actions 设置须允许 workflow 写入仓库；若 `main` 有分支保护，还须允许 GitHub Actions 推送版本提交，否则发布会在写回阶段停止。
4. 完成以上配置后，提交整个 monorepo 并首次推送。确认包含 `pi-persona` 原来未跟踪的源码；首次推送不发布。之后对插件的改动推送到 `main` 即会触发发布。

此流程依赖 npm Trusted Publishing（OIDC）及 provenance；使用 Node 24 自带的 npm，且 npm 包和 GitHub 仓库须满足 npm 的相关要求。无需把凭据写入仓库。

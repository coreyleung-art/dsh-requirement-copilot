# 分发与上架手册

> 目标：把「帮我说 / Say It For Me」从私有源码变成可被 DSH 生态发现、安装、验证的公开插件。
> 本文是操作清单，不代表已经发布。**当前状态见文末。**

## 1. 包名

公开包名：`dsh-requirement-copilot`。源码仓库、profile 的 `link:` 依赖、`cordis.patch.yml`、client module id 都使用同一个名字，避免社区静态检查与本地安装不一致。

`scripts/build-dist.mjs` 只负责生成一个干净的发布包（去掉 tests/evals/docs、保留运行文件），不改变包身份。

## 2. 生成本地分发包

```bash
node scripts/build-dist.mjs        # 只生成 dist/dsh-requirement-copilot/
node scripts/build-dist.mjs --pack # 再生成 dist/dsh-requirement-copilot-<version>.tgz
```

输出：

```text
dist/
├─ dsh-requirement-copilot/          # 可检查的 staging 目录
└─ dsh-requirement-copilot-<version>.tgz
```

打包前应确认：

- `package.json.name = dsh-requirement-copilot`，无 `private`；
- `cordis.patch.yml` 的 name 已替换；
- `client.js` 的 `__ModuleLoader__.load({ id: 'dsh-requirement-copilot' })`；
- 包内只包含运行所需文件（index/client/locale/icon/README/CHANGELOG/LICENSE），不含 tests/evals。

## 3. 发布到 npm

当前机器 **未登录 npm**（`npm whoami` 返回 `ENEEDAUTH`）。先由账号持有人完成登录或提供 CI token：

```bash
npm login
npm whoami
npm publish dist/dsh-requirement-copilot-<version>.tgz --access public
```

验证：

```bash
npm view dsh-requirement-copilot version
npm view dsh-requirement-copilot dist.tarball
```

注意：

- 不要把 `.npmrc` / `NPM_TOKEN` 提交到仓库；
- 发布后不可覆盖同版本，修 bug 需升版本；
- 若发现严重问题：`npm deprecate dsh-requirement-copilot@<version> "reason"`，必要时 `npm unpublish`（24 小时内）。

## 4. 建 GitHub 公开镜像（dshbase 必需）

dshbase 收录要求 **GitHub 仓库**；Gitee 私有仓库不能直接作为公开索引源。

1. 在 GitHub 账号 `coreyleung-art` 下创建公开仓库 `dsh-requirement-copilot`；
2. 推送 `main` 与全部 tag；
3. 仓库 description 用 `docs/MARKETPLACE_LISTING.md` 的英文短描述；
4. Topics 至少包含：

```text
dsh-plugin
deepseek-harness
prompt-engineering
requirements
specification
```

5. 确认 `package.json` 的 repository/homepage 指向 GitHub（当前源码里是 Gitee，需要改或由镜像覆盖）。

> 截至本文，GitHub 镜像尚未创建；这是上架 dshbase 的硬前提。

## 5. 提交 dshbase

入口：<https://github.com/ylwl1997/dshbase/issues/new?template=plugin-submission.yml>

按模板填写：

| 字段 | 值 |
|---|---|
| 插件名称 | `dsh-requirement-copilot` |
| GitHub 仓库 | `https://github.com/coreyleung-art/dsh-requirement-copilot` |
| npm 包名 | `dsh-requirement-copilot` |
| 功能描述 | 见 `docs/MARKETPLACE_LISTING.md` 的短描述 |
| 分类 | Developer（开发）或 Productivity（效率） |
| 需要外部账号/服务 | 否，开箱即用（使用 DSH 已配置的默认模型） |
| 确认 | 已加 `dsh-plugin` topic；有 `dsh.bundle`；有 LICENSE |

## 6. 提交 dsh-plugins.tech

入口：<https://dsh-plugins.tech/submit>

当前该站点显示「提交入口尚未连接身份服务」，无法直接提交；先完成 npm + GitHub + dshbase，再关注其开放状态。其分类目录已包含「需求澄清与规格沉淀」，可作为上架后的类目参考。

## 7. 发布后验证

```bash
# 1) npm 元数据
npm view dsh-requirement-copilot version

# 2) DSH 安装（DSH 提供 CLI 时）
dsh plugin add dsh-requirement-copilot

# 3) 或 Plugin Manager / plugin_manager install_bundle，target 传包名
```

在干净 profile 中确认：

- 输入框工具行出现 ✨；
- 空输入框点开面板；
- `/` 目录里有 `refine-prompt`；
- 生成一次，质量卡/确认门/历史/续写可用；
- 卸载后命令、工具、skill、按钮全部撤销。

## 8. CI 发布（GitHub Actions）

仓库已提供 `.github/workflows/publish.yml`（GitHub 镜像中使用）：

- tag `v*` 或手动触发；
- `npm test`；
- `node scripts/build-dist.mjs --pack`；
- `npm publish dist/dsh-requirement-copilot-*.tgz --access public`；
- 使用仓库 secret `NPM_TOKEN`。

## 9. 回滚

| 场景 | 操作 |
|---|---|
| npm 版本有问题 | `npm deprecate`；必要时 `npm unpublish dsh-requirement-copilot@<version>` |
| GitHub 镜像 | 保留 tag，revert 提交；不要删除已发布 tag |
| dshbase 条目 | 在提交 issue 下说明撤回 |
| DSH 安装 | 卸载 bundle；源码回滚用 `git checkout <tag>` |

## 10. 当前状态（2026-11-05）

- [x] 公开包名确定：`dsh-requirement-copilot`
- [x] 源码/包/bundle/client id 统一为公开名
- [x] 构建脚本与 staging 目录
- [x] `npm pack` tarball（10 files，约 60 KB）
- [x] 上架文案（`docs/MARKETPLACE_LISTING.md`）
- [ ] npm 登录 / 发布（缺凭据）
- [ ] GitHub 公开镜像与 `dsh-plugin` topic（需确认后创建）
- [ ] dshbase issue 提交
- [ ] dsh-plugins.tech（站点入口未开放）
- [ ] 真实模型质量基线（`evals/run-eval.mjs --live`，缺端点/额度）

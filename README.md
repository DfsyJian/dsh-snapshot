# dsh-snapshot

> English: [README.en.md](README.en.md)

DeepSeek Harness 插件:在 agent 每次执行 `write`/`edit` 之前自动快照目标文件内容,提供 `/rollback` 命令列出历史并恢复到任意快照。浏览器侧提供侧边栏"快照时间线"面板与设置页插件配置卡片,UI 跟随 web 界面的语言(中/英)与浅/深主题。

## 功能

- **自动快照**:每次 `write`/`edit` 前保存目标文件的当前内容,追加进该会话的 `snapshots.jsonl`,并记录触发快照的用户消息开头文字作为标注。
- **快照时间线**:侧边栏底部入口(按钮与下方设置按钮同风格)。点击打开面板,列出当前会话全部快照,主行显示触发快照的用户消息预览(回滚记录显示"回滚至快照 #N"),副行显示工具与文件路径,可逐条回滚;头部提供"清空"按钮,点击后需二次确认再删除该会话全部快照;面板标题显示当前会话标题。
- **配置卡片**:设置页「插件配置」中提供 snapshot 卡片,外观与内置 bash/agent-loop/web-search 卡片一致,编辑保留策略并即时生效;布尔字段为二态开关,数字字段留空或"恢复默认"回退到插件默认值。
- **命令**:
  - `/rollback list` 列出快照
  - `/rollback <seq> --yes` 恢复到指定快照(恢复前会先记录当前状态,可再回滚)
  - `/rollback --call <callId> --yes` 按工具调用回滚
  - `/rollback clear --yes` 清空该会话全部快照

## 安装

插件通过 pnpm 安装(必需,用于解析 peer 依赖):

```sh
pnpm add dsh-snapshot
```

然后把它加入 profile 的 bundle 列表。以 `web` profile 为例,编辑 `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": { "dsh-snapshot": "^0.2.0" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-snapshot"] } }
}
```

插件的 `cordis.patch.yml` 负责把 `snapshot` 条目注入 profile 配置树。本地开发时构建源码目录,并在 profile 里用 `link:` 指向它代替 registry 版本,见下文「开发」。

## 用法

```sh
/rollback list          # 列出本会话的全部快照
/rollback <seq> --yes   # 把文件恢复到某条快照(恢复前会先记录当前状态,可再回滚)
/rollback clear --yes   # 清空本会话全部快照
```

## 配置(均可选,零配置可用)

| key | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关,关闭后不再捕获新的写入/编辑,已有快照保留(回滚仍可用) |
| `storeDir` | `$DSH_HOME/snapshots` | 快照存储根目录,每会话一个子目录 |
| `maxRetain` | `100` | 每会话最大保留条数,`0` 为不限 |
| `maxProjectRetain` | `100` | 项目级总量控制:同一工作区(会话 cwd)所有会话共享该配额,超限按捕获时间最旧优先清理,`0` 为不限 |
| `pruneOrphans` | `true` | 孤儿清理:某会话所属工作区目录已不存在时,自动删除该会话全部快照(不可回滚,仅占空间),`false` 为保留 |

配置经宿主 settings 服务写入 `settings.yaml`(namespace `snapshot`),或直接在 profile 的 `cordis.yml` 中配置。设置页「插件配置」会显示 snapshot 卡片:当前 DSH 版本未向配置客户端暴露第三方命名空间时,卡片显示说明而非表单;要启用表单,把 `snapshot` 加入宿主 `dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES` 白名单后重启即可。

## 开发

```sh
pnpm install && pnpm typecheck && pnpm build
```

`pnpm build` 依次运行 `tsc`(服务端逐文件编译)与 `tsdown`(浏览器端打成单个 `lib/client.js`,由 loader 模块表加载)。

- 类型与构建完全自包含:所有 `@deepseek-ai/*` SDK 包(含 `react`)在 devDependencies 中显式声明并解析自 npm registry,tsconfig 不引用任何 harness 源码 checkout。
- 运行时依赖:`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-settings`(与 `@deepseek-ai/cordis`)以 peer 形式声明,由 harness 宿主提供;其余 `@deepseek-ai/*` 均为 `import type`,编译后擦除。client bundle 仅 external `react`、`@deepseek-ai/dsh-client-runtime/client`(快照存储引擎)与 `@deepseek-ai/dsh-client-ui-primitives`(图标组件,运行时均由 loader 模块表提供),其余全部内联。

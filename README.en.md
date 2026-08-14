# dsh-snapshot

A DeepSeek Harness plugin that snapshots the target file contents before every `write`/`edit` the agent performs, and offers the `/rollback` command to list the history and restore any earlier snapshot. The browser half ships a sidebar "snapshot timeline" panel and a plugin settings card; the UI follows the web app language (Chinese/English) and light/dark theme.

## Features

- **Automatic snapshots**: before each `write`/`edit`, the current contents of the target file are saved and appended to the session's `snapshots.jsonl`, annotated with the opening text of the user message that triggered the snapshot.
- **Snapshot timeline**: an entry at the bottom of the sidebar, styled to match the settings button below it. Clicking it opens a panel listing every snapshot of the current session: the primary line shows the user-message preview that triggered the snapshot (rollback records read "Rollback to snapshot #N"), the secondary line shows the tool and the file path, and each row can be rolled back individually. The header offers a "Clear" button that asks for confirmation before deleting all snapshots of the session, and shows the current session title.
- **Settings card**: the plugin config page shows a snapshot card styled like the built-in bash/agent-loop/web-search cards, with edits applied immediately. Boolean fields are two-state switches; number fields fall back to the plugin default when left blank or restored.
- **Commands**:
  - `/rollback list` lists the snapshots
  - `/rollback <seq> --yes` restores a snapshot (the current state is recorded first, so you can roll back again)
  - `/rollback --call <callId> --yes` rolls back by tool call
  - `/rollback clear --yes` clears all snapshots of this session

## Install

Install via pnpm (required, to resolve peer dependencies):

```sh
pnpm add dsh-snapshot
```

Then add the plugin to your profile's bundle list. For the `web` profile, edit `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": { "dsh-snapshot": "^0.2.0" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-snapshot"] } }
}
```

The plugin's `cordis.patch.yml` injects the `snapshot` entry into the profile config tree. For local development you can use a `link:` dependency pointing at the source directory instead of the registry version (you must then provide resolvable peer dependencies yourself, see "Development").

## Usage

```sh
/rollback list          # list all snapshots of this session
/rollback <seq> --yes   # restore files to a snapshot (current state is recorded first, so it can be rolled back again)
/rollback clear --yes   # clear all snapshots of this session
```

## Configuration (all optional; works with zero config)

| key | default | description |
|---|---|---|
| `enabled` | `true` | Master switch; when off, new writes/edits are no longer captured, existing snapshots are kept (rollback still works) |
| `storeDir` | `$DSH_HOME/snapshots` | Snapshot root directory, one subdirectory per session |
| `maxRetain` | `100` | Max snapshots kept per session; `0` means unlimited |
| `maxProjectRetain` | `100` | Project-wide cap: all sessions sharing a workspace (session cwd) share this quota; on overflow the oldest by capture time is pruned; `0` means unlimited |
| `pruneOrphans` | `true` | Orphan pruning: when the workspace directory of a session no longer exists, all its snapshots are deleted (unrollbackable, space only); `false` keeps them |

Configuration is written through the host settings service into `settings.yaml` (namespace `snapshot`), or set directly in the profile's `cordis.yml`. The plugin config page shows the snapshot card: when the current DSH version does not expose third-party namespaces to the settings client, the card shows a note instead of the form; to enable the form, add `snapshot` to the `WEB_SETTINGS_NAMESPACES` allow-list of the host `dsh-host-apiproxy` and restart.

## Development

```sh
pnpm install && pnpm typecheck && pnpm build
```

`pnpm build` runs `tsc` (server half, file-by-file emit) followed by `tsdown` (browser half bundled into a single `lib/client.js`, loaded by the loader module table).

- During development, type checking resolves through tsconfig `paths` to build artifacts of the deepseek-harness repo; `tsdown` and `typescript` are declared in devDependencies.
- Runtime dependencies: `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-settings` (with `@deepseek-ai/cordis`) are declared as peers and provided by the harness host; the other `@deepseek-ai/*` imports are all `import type` and erased at compile time. The client bundle only externals `react`, `@deepseek-ai/dsh-client-runtime/client` (snapshot storage engine) and `@deepseek-ai/dsh-client-ui-primitives` (icon components, both provided at runtime by the loader module table); everything else is inlined.

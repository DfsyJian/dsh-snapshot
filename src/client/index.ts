/**
 * dsh-snapshot, browser half: the sidebar snapshot timeline
 * (`sidebar.footer.action`) and the plugin settings card. Both talk to the
 * host through the existing `/rollback` command Remote, so no new server API
 * is needed.
 * @module dsh-snapshot/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and the `ctx.remote.commands`
// merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the footer.action seat).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the settings-surface SlotMap merge and the ctx.settingsScope
// Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { TimelineEntry } from './TimelineEntry.js'
import type { SnapshotClientInjected } from './types.js'
import { SnapshotConfigCard, SnapshotConfigCardController, type SnapshotSettings } from './SnapshotConfigCard.js'
import { en, zh, type SnapshotCardKey } from './snapshot-card-locale.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** snapshot settings-card copy. */
    snapshot: SnapshotCardKey
  }

  interface SlotMap {
    /**
     * The plugin configuration section's card seat, declared by
     * ui-plugin-config. Spelled here with the same shape so this package can
     * register its card without depending on the sibling UI package.
     */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/** Dictionary namespace owned by this plugin. */
const NS = 'snapshot'

/** Settings namespace the snapshot card edits (the Host plugin registers it). */
const SNAPSHOT_NS = 'snapshot'

/** Required services: slots, the settings scope, locale, and the commands Remote channel. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote', 'remote.commands'] as const

/**
 * Client plugin body: register the sidebar snapshot timeline and the plugin
 * settings card. The timeline executes `/rollback` through the commands
 * Remote; the card stages the retention settings over the `snapshot`
 * namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-snapshot: dictionaries')

  // 侧边栏快照时间线:列出当前会话快照并逐条回滚。
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'snapshot-timeline',
      order: 20,
      locale: NS,
      inject: (): SnapshotClientInjected => ({
        runRollback: (sid, line) => ctx.remote.commands.execute(sid, line),
      }),
    }, TimelineEntry))

  // 插件配置卡片:一个对 `snapshot` settings 命名空间的暂存表单,挂到
  // 插件配置区段。namespace 未暴露给配置客户端时卡片渲染说明而非表单。
  const snapshotConfig = new SnapshotConfigCardController(
    ctx.settingsScope.bind<SnapshotSettings>({ namespace: SNAPSHOT_NS }),
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'snapshot',
    order: 30,
    locale: NS,
    inject: () => snapshotConfig.inject(),
  }, SnapshotConfigCard))
}

/**
 * dsh-snapshot: snapshot every write/edit the agent makes, then roll back to
 * any earlier state. Zero-config by design — every Config key is optional.
 * The same section is registered as the `snapshot` settings namespace, so a
 * configuration surface can edit it per installation while the entry config
 * stays the base layer.
 * @module dsh-snapshot
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { dshHome, SnapshotStore } from './snapshot-store.js'
import { applyCapture } from './capture.js'
import { applyRollback } from './rollback.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'snapshot'

/** Services this plugin joins: the filesystem and the human-command registry. */
export const inject = ['fs', 'commands'] as const

/** Deployment-varying choices, all optional: the plugin works zero-config. */
export interface Config {
  /** Master switch; defaults to enabled. */
  enabled?: boolean
  /** Root directory holding per-session snapshot stores; defaults to `$DSH_HOME/snapshots`. */
  storeDir?: string
  /** Maximum retained snapshots per session; 0 means unlimited; defaults to 100. */
  maxRetain?: number
  /**
   * Project-wide cap over all sessions of one workspace folder; once exceeded,
   * the oldest records by capture time are dropped first, across sessions.
   * 0 means unlimited; defaults to 100, matching the per-session cap.
   */
  maxProjectRetain?: number
  /**
   * Remove whole session stores whose workspace folder no longer exists on
   * disk; their snapshots can never be rolled back again. Defaults to true.
   */
  pruneOrphans?: boolean
  /**
   * Fold the timeline on rollback: restoring a snapshot also drops that
   * snapshot and everything after it (the rollback record included), so the
   * list keeps only the history before the rollback point. Defaults to true;
   * set false to keep the superseded snapshots and the rollback record.
   */
  collapseOnRollback?: boolean
}

/** Schema the `snapshot` settings namespace resolves through (the plugin Config). */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  storeDir: z.string().default(join(dshHome(), 'snapshots')),
  maxRetain: z.number().step(1).min(0).default(100),
  maxProjectRetain: z.number().step(1).min(0).default(100),
  pruneOrphans: z.boolean().default(true),
  collapseOnRollback: z.boolean().default(true),
})

/** Settings namespace carrying this plugin's configuration section. */
export const SNAPSHOT_SETTINGS_NAMESPACE = settingsNamespace('snapshot')

/**
 * Install the snapshot and rollback plugin.
 * @param ctx - plugin context that owns the hooks and the command.
 * @param config - plugin configuration; every key optional.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // The authoritative section while a settings service is attached; the entry
  // config otherwise. Store factories read it per call, so committed changes
  // to storeDir / quotas apply from the next store creation on.
  let current: () => Config = () => config
  let disposeCapture: (() => void) | undefined
  const makeStore = (sessionId: string, project?: string) => new SnapshotStore(sessionId, {
    storeDir: current().storeDir,
    maxRetain: current().maxRetain,
    maxProjectRetain: current().maxProjectRetain,
    pruneOrphans: current().pruneOrphans,
    project,
  })
  // `enabled` gates only the capture hook; rollback stays available so stored
  // snapshots remain restorable even while capture is off.
  const syncCapture = (): void => {
    const on = current().enabled !== false
    if (on && disposeCapture === undefined) disposeCapture = applyCapture(ctx, makeStore)
    if (!on && disposeCapture !== undefined) {
      disposeCapture()
      disposeCapture = undefined
    }
  }
  installSettingsSection(ctx, SNAPSHOT_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: syncCapture,
  })
  // Without a settings service installSettingsSection never runs its body, so
  // the entry-config default still has to arm capture here.
  syncCapture()
  applyRollback(ctx, makeStore, () => current().collapseOnRollback !== false)
}

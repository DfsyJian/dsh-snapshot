/**
 * The /rollback command: list a session's snapshots or restore a file to an
 * earlier snapshot. A restore first snapshots the current state, so every
 * rollback can itself be rolled back. Restores require an explicit `--yes`.
 * A restore may target a snapshot sequence (`<seq>`) or the latest mutation
 * of one tool call (`--call <callId>`), the form the web UI's per-message
 * undo button uses.
 *
 * When the `collapseOnRollback` flag is on, a successful restore additionally
 * drops the restored snapshot and everything after it (the rollback record
 * included), so the timeline folds back to the history before the rollback
 * point instead of keeping the superseded branch.
 * @module dsh-snapshot/rollback
 */

import { unlink } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-fs'
import type { SnapshotRecord } from './types.js'
import type { SnapshotStore } from './snapshot-store.js'

/**
 * Restore one snapshot: record the current state (so this rollback can itself
 * be rolled back), then write the snapshot's content back — or delete the
 * file when the snapshot captured a creation. With `collapseOnRollback` on,
 * the restored snapshot and everything after it are dropped afterwards.
 * @param ctx - plugin context with the fs service.
 * @param agent - the receiving agent (cwd source for the fs sandbox policy).
 * @param store - the session's snapshot store.
 * @param record - the snapshot to restore.
 * @param collapse - whether the rollback folds the history past this point.
 * @returns the settled restore result.
 */
async function restoreOne(
  ctx: Context,
  agent: Agent,
  store: SnapshotStore,
  record: SnapshotRecord,
  collapse: () => boolean,
): Promise<CommandResult> {
  try {
    const target = await ctx.fs.resolve(record.path, { cwd: agent.session.header.cwd })
    let current: string | null = null
    try {
      current = await ctx.fs.readText(target)
    } catch (error: unknown) {
      // A missing or unreadable file is recorded as absent before restore.
      current = null
    }
    // Record the pre-restore state first, so this rollback can itself be rolled back.
    // The prompt preview labels the timeline row as a rollback of its target.
    await store.append({
      tool: 'rollback',
      path: record.path,
      before: current,
      after: null,
      prompt: `回滚至快照 #${record.seq}`,
    })
    // With collapse on, a successful restore drops the restored snapshot and
    // everything after it — the rollback record just appended included.
    const collapseHistory = async (): Promise<void> => {
      if (collapse()) await store.truncateFrom(record.seq)
    }
    if (record.before === null) {
      // Snapshot captured a file creation; restoring it removes the file.
      // The fs service exposes no removal API, so deletion uses Node's
      // unlink directly — valid for the local backend where displayPath
      // is an absolute path; remote backends fail with an explicit error.
      if (current !== null) await unlink(target.displayPath)
      await collapseHistory()
      return { kind: 'success', text: `Removed ${record.path} (restored snapshot #${record.seq} creation).` }
    }
    // Rollback is a human-invoked, --yes-confirmed operation: it restores
    // the user's own files, so it writes under danger-full-access like an
    // IDE revert, never under the model-facing sandbox mode. workspaceRoot
    // is required by the type but unused at that mode.
    await ctx.fs.writeText(target, record.before, undefined, undefined, {
      mode: 'danger-full-access',
      workspaceRoot: agent.session.header.cwd ?? '',
    })
    await collapseHistory()
    return { kind: 'success', text: `Restored ${record.path} to snapshot #${record.seq}.` }
  } catch (error: unknown) {
    return { kind: 'error', text: `Restore failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Install the /rollback command on the receiving agent.
 * @param ctx - plugin context that owns the command.
 * @param makeStore - per-session snapshot store factory; the workspace cwd tags
 * the store's project for the project-wide quota.
 * @param collapse - whether a successful restore folds the history past the
 * restored snapshot (read per call, so config changes apply immediately).
 */
export function applyRollback(
  ctx: Context,
  makeStore: (sessionId: string, project?: string) => SnapshotStore,
  collapse: () => boolean = () => true,
): void {
  ctx.commands.register({
    name: 'rollback',
    description: 'List, clear, or restore file snapshots',
    input: { hint: 'list | clear --yes | <seq> --yes | --call <callId> --yes' },
    async handler({ agent, rawInput }): Promise<CommandResult> {
      const args = rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
      const store = makeStore(agent.session.id, agent.session.header.cwd)
      if (args.length === 0 || args[0] === 'list') {
        const records = await store.list()
        if (records.length === 0) {
          return { kind: 'success', text: 'No snapshots recorded in this session yet.' }
        }
        return {
          kind: 'success',
          text: records.map(record => {
            const size = record.before === null ? 'create' : `${record.before.length} bytes`
            // The prompt preview (when present) trails the size; the timeline
            // reads it as everything after the parenthesized size.
            const prompt = record.prompt === undefined ? '' : ` ${record.prompt}`
            return `#${record.seq} ${record.time} ${record.tool} ${record.path} (${size})${prompt}`
          }).join('\n'),
        }
      }
      // Clear every snapshot of this session; the web timeline's clear button
      // drives this form after its own in-panel confirmation.
      if (args[0] === 'clear') {
        if (!args.includes('--yes')) {
          return { kind: 'error', text: 'Clear every snapshot of this session? Re-run with --yes to confirm.' }
        }
        await store.clear()
        return { kind: 'success', text: 'Cleared every snapshot of this session.' }
      }
      // Restore by tool call: --call <callId> [--yes] rolls the file back to
      // the latest write/edit snapshot of that call.
      const callIndex = args.indexOf('--call')
      if (callIndex >= 0) {
        const callId = args[callIndex + 1]
        if (callId === undefined || callId.length === 0) {
          return { kind: 'error', text: 'Missing call id after --call.' }
        }
        const records = await store.list()
        const record = [...records].reverse().find(candidate =>
          candidate.tool !== 'rollback' && candidate.callId === callId)
        if (record === undefined) {
          return { kind: 'error', text: `No write/edit snapshot for call ${callId} in this session.` }
        }
        if (!args.includes('--yes')) {
          return {
            kind: 'error',
            text: `Restore "${record.path}" to snapshot #${record.seq} (${record.time})? Re-run with --yes to confirm.`,
          }
        }
        return restoreOne(ctx, agent, store, record, collapse)
      }
      const seq = Number(args[0])
      if (!Number.isInteger(seq)) {
        return { kind: 'error', text: `Invalid snapshot sequence: ${args[0]}` }
      }
      const record = await store.get(seq)
      if (record === undefined) {
        return { kind: 'error', text: `No snapshot #${seq} in this session.` }
      }
      if (!args.includes('--yes')) {
        return {
          kind: 'error',
          text: `Restore "${record.path}" to snapshot #${seq} (${record.time})? Re-run with --yes to confirm.`,
        }
      }
      return restoreOne(ctx, agent, store, record, collapse)
    },
  })
}

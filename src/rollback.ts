/**
 * The /rollback command: list a session's snapshot groups or restore files to
 * an earlier state. Every write/edit/delete of one user message is snapshotted
 * individually but grouped under that message's durable id, so the timeline
 * shows one entry per message and one restore reverts all of the message's
 * changes. A restore first snapshots the current state, so every rollback can
 * itself be rolled back. Restores require an explicit `--yes`. A restore may
 * target a group sequence (`<seq>`) or the latest mutation of one tool call
 * (`--call <callId>`), the form the web UI's per-message undo button uses.
 *
 * When the `collapseOnRollback` flag is on, a successful restore additionally
 * drops the restored group and everything after it (the rollback records
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

/** One restore target: the record plus its rollback record's label and group tag. */
interface RestoreSpec {
  /** The snapshot to restore. */
  record: SnapshotRecord
  /** Prompt preview on the rollback record this restore appends. */
  prompt: string
  /** Group tag on the rollback record; one rollback action shares one tag. */
  group?: string
}

/** One timeline row: one user message's snapshots, or one rollback action's records. */
interface SnapshotGroup {
  /** Sequence of the group's first record; the rollback target. */
  seq: number
  /** Capture time of the group's first record. */
  time: string
  /** Number of records folded into this group (rollback records included). */
  count: number
  /** Number of distinct files this group touches. */
  files: number
  /** File count: files whose first record was a creation. */
  create: number
  /** File count: files whose first record was a write/edit of existing content. */
  modify: number
  /** File count: files whose first record was a shell deletion. */
  delete: number
  /** The first record's mutation kind. */
  tool: SnapshotRecord['tool']
  /** The first record's file path. */
  path: string
  /** The first record's size label. */
  size: string
  /** Each distinct file the group touches and the kind of its first record. */
  paths: Array<{ kind: SnapshotGroupFileKind; path: string }>
  /** The first record's prompt preview, when present. */
  prompt?: string
}

/** The kind label of one file inside a group, derived from its first record. */
type SnapshotGroupFileKind = 'create' | 'modify' | 'delete' | 'rollback'

/**
 * The identity that ties one snapshot to its timeline group. Records without
 * a group (stores written before grouping, single restores) are their own
 * single-entry groups keyed by sequence.
 * @param record - the snapshot record.
 * @returns the record's grouping key.
 */
function groupKey(record: SnapshotRecord): string {
  return record.group ?? `rec:${record.seq}`
}

/**
 * Restore one snapshot: record the current state (so this rollback can itself
 * be rolled back), then write the snapshot's content back — or delete the
 * file when the snapshot captured a creation.
 * @param ctx - plugin context with the fs service.
 * @param agent - the receiving agent (cwd source for the fs sandbox policy).
 * @param store - the session's snapshot store.
 * @param spec - the record to restore plus its rollback record's label and group.
 * @returns the settled restore result.
 */
async function restoreRecord(
  ctx: Context,
  agent: Agent,
  store: SnapshotStore,
  { record, prompt, group }: RestoreSpec,
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
    await store.append({ tool: 'rollback', path: record.path, before: current, after: null, prompt, group })
    if (record.before === null) {
      // Snapshot captured a file creation; restoring it removes the file.
      // The fs service exposes no removal API, so deletion uses Node's
      // unlink directly — valid for the local backend where displayPath
      // is an absolute path; remote backends fail with an explicit error.
      if (current !== null) await unlink(target.displayPath)
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
    return { kind: 'success', text: `Restored ${record.path} to snapshot #${record.seq}.` }
  } catch (error: unknown) {
    return { kind: 'error', text: `Restore failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Restore one snapshot on its own (a lone record or a `--call` target) and,
 * with `collapseOnRollback` on, drop the restored snapshot and everything
 * after it.
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
  const result = await restoreRecord(ctx, agent, store, {
    record,
    prompt: `回滚至快照 #${record.seq}`,
  })
  if (result.kind === 'success' && collapse()) await store.truncateFrom(record.seq)
  return result
}

/**
 * Restore every snapshot of one timeline group — all write/edit records of a
 * user message. Records restore in reverse capture order, so a file written
 * several times within one message ends at its pre-message state. Each
 * restore first records the current state under a shared rollback group, so
 * the whole rollback folds into one timeline row and can itself be rolled
 * back. With `collapseOnRollback` on, the group and everything after it are
 * dropped afterwards.
 * @param ctx - plugin context with the fs service.
 * @param agent - the receiving agent (cwd source for the fs sandbox policy).
 * @param store - the session's snapshot store.
 * @param records - the group's snapshots, in capture order.
 * @param collapse - whether the rollback folds the history past the group.
 * @returns the settled restore result.
 */
async function restoreGroup(
  ctx: Context,
  agent: Agent,
  store: SnapshotStore,
  records: SnapshotRecord[],
  collapse: () => boolean,
): Promise<CommandResult> {
  const first = [...records].sort((a, b) => a.seq - b.seq)[0]
  if (first === undefined) return { kind: 'error', text: 'Nothing to restore.' }
  // One synthetic group per rollback action, so its rollback records stay a
  // single timeline row (and a single rollback) instead of one row per file.
  const rollbackGroup = `rollback:${first.seq}:${Date.now().toString(36)}`
  const failures: string[] = []
  for (const record of [...records].sort((a, b) => b.seq - a.seq)) {
    const result = await restoreRecord(ctx, agent, store, {
      record,
      prompt: `回滚至快照 #${first.seq}`,
      group: rollbackGroup,
    })
    if (result.kind === 'error') failures.push(result.text)
  }
  if (failures.length === 0 && collapse()) await store.truncateFrom(first.seq)
  if (failures.length > 0) return { kind: 'error', text: failures.join('; ') }
  return {
    kind: 'success',
    text: `Restored ${records.length} change${records.length === 1 ? '' : 's'} before message #${first.seq}.`,
  }
}

/** The kind of one file in a group, derived from its first record in capture order. */
function fileKind(record: SnapshotRecord): SnapshotGroupFileKind {
  if (record.tool === 'delete') return 'delete'
  if (record.tool === 'rollback') return 'rollback'
  return record.before === null ? 'create' : 'modify'
}

/** Detail lines order: creations, modifications, deletions, then rollback records. */
const FILE_KIND_RANK: Record<SnapshotGroupFileKind, number> = { create: 0, modify: 1, delete: 2, rollback: 3 }

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
        // One line per group: a user message's snapshots, or one rollback
        // action's records. The numeric tokens after the time — total count,
        // distinct files, and the 创建/修改/删除 file breakdown — let the
        // timeline fold the group into a single row with a per-kind summary.
        const byGroup = new Map<string, SnapshotRecord[]>()
        for (const record of records) {
          const key = groupKey(record)
          const list = byGroup.get(key)
          if (list === undefined) byGroup.set(key, [record])
          else list.push(record)
        }
        const groups: SnapshotGroup[] = []
        for (const groupRecords of byGroup.values()) {
          const first = groupRecords[0]
          if (first === undefined) continue
          // The kind breakdown counts distinct files, one kind per file;
          // rollback bookkeeping folds into its own group and renders as a
          // rollback row instead.
          const mutations = groupRecords.filter(record => record.tool !== 'rollback')
          // The per-kind counts and the hover detail are both per distinct
          // file, so a row's summary always matches the files it lists: a
          // file written twice in one message counts as one modification.
          // Each file takes the kind of its first mutation record in capture
          // order.
          const mutationKinds = new Map<string, SnapshotGroupFileKind>()
          for (const record of mutations) {
            if (!mutationKinds.has(record.path)) mutationKinds.set(record.path, fileKind(record))
          }
          // The detail lines cover every record of the group, rollback rows
          // (all-rollback groups) included, so their hover still lists paths.
          const fileKinds = new Map<string, SnapshotGroupFileKind>()
          for (const record of groupRecords) {
            if (!fileKinds.has(record.path)) fileKinds.set(record.path, fileKind(record))
          }
          const fileKindCounts = { create: 0, modify: 0, delete: 0 }
          for (const kind of mutationKinds.values()) {
            if (kind === 'create' || kind === 'modify' || kind === 'delete') fileKindCounts[kind]++
          }
          const paths = [...fileKinds.entries()]
            .sort((a, b) => FILE_KIND_RANK[a[1]] - FILE_KIND_RANK[b[1]])
            .map(([path, kind]) => ({ kind, path }))
          groups.push({
            seq: first.seq,
            time: first.time,
            count: groupRecords.length,
            files: fileKinds.size,
            create: fileKindCounts.create,
            modify: fileKindCounts.modify,
            delete: fileKindCounts.delete,
            tool: first.tool,
            path: first.path,
            size: first.before === null ? 'create' : `${first.before.length} bytes`,
            paths,
            prompt: first.prompt,
          })
        }
        return {
          kind: 'success',
          text: groups.map(group => {
            // The prompt preview (when present) trails the size; the timeline
            // reads it as everything after the parenthesized size.
            const prompt = group.prompt === undefined ? '' : ` ${group.prompt}`
            const head = `#${group.seq} ${group.time} ${group.count} ${group.files} ${group.create} ${group.modify} ${group.delete} ${group.tool} ${group.path} (${group.size})${prompt}`
            // One indented line per touched file: `  <kind> <path>`, consumed
            // by the timeline for the hover tooltip. Paths may contain spaces;
            // everything after the kind tag is the path.
            const detail = group.paths.map(entry => `  ${entry.kind} ${entry.path}`)
            return [head, ...detail].join('\n')
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
          return { kind: 'error', text: `No write/edit/delete snapshot for call ${callId} in this session.` }
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
      const records = await store.list()
      const record = records.find(candidate => candidate.seq === seq)
      if (record === undefined) {
        return { kind: 'error', text: `No snapshot #${seq} in this session.` }
      }
      if (!args.includes('--yes')) {
        return {
          kind: 'error',
          text: `Restore "${record.path}" to snapshot #${seq} (${record.time})? Re-run with --yes to confirm.`,
        }
      }
      // A grouped record rolls back with its whole message; an ungrouped
      // record (old store, rollback bookkeeping) restores alone.
      const key = groupKey(record)
      const groupRecords = records.filter(candidate => groupKey(candidate) === key)
      if (groupRecords.length === 1) {
        return restoreOne(ctx, agent, store, record, collapse)
      }
      return restoreGroup(ctx, agent, store, groupRecords, collapse)
    },
  })
}

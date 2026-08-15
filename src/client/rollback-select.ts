/**
 * The `/rollback` popupSelect decoration: a bare invocation opens a searchable
 * snapshot picker (the same `/rollback list` data the sidebar timeline
 * renders) instead of the host command's text prompt. Picking a row runs
 * `/rollback <seq> --yes` behind the shared shell's risk gate.
 * @module dsh-snapshot/client/rollback-select
 */

import type { CommandDecoration, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { CommandExecution } from '@deepseek-ai/dsh-commands/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  fmtTime, kindLabel, parseList, rollbackConfirmLabel, rowSubtitle, type TimelineItem,
} from './TimelineEntry.js'

/** Execute one `/rollback` command line against a session's agent. */
export type RollbackExecute = (
  sessionId: SessionId,
  line: string,
  signal?: AbortSignal,
) => Promise<RemoteResult<CommandExecution | undefined>>

/** Option id of the clear-snapshots command row. */
const CLEAR_ID = 'clear'

/**
 * One per-file action summary, e.g. `创建 1.html · 修改 2.html`, so the row
 * states what the snapshot did rather than just counting kinds. Rows without
 * per-file detail lines fall back to the count summary.
 * @param item - the timeline row.
 * @param t - locale reader.
 * @returns the action summary.
 */
function fileSummary(item: TimelineItem, t: TranslateNS<'snapshot'>): string {
  if (item.paths.length > 0) {
    return item.paths.map(entry => `${kindLabel(entry.kind, t)} ${entry.path}`).join(' · ')
  }
  return rowSubtitle(item, t)
}

/**
 * Build one popup row per timeline group, after the clear command row: the
 * primary line states the rollback target (`撤回至快照 #N`), the detail
 * carries the time and one action per file so a search by number, path, or
 * kind all match. Every snapshot row is gated: rolling back overwrites
 * current files.
 * @param items - the parsed timeline rows.
 * @param t - locale reader.
 * @returns the shell option rows.
 */
function optionsOf(items: readonly TimelineItem[], t: TranslateNS<'snapshot'>): SelectOption[] {
  const rows: SelectOption[] = [
    {
      id: CLEAR_ID,
      label: t('select.clear'),
      detail: t('select.clearDetail'),
      confirmation: {
        title: t('select.title'),
        description: t('timeline.clearConfirm'),
        acknowledgeLabel: t('select.acknowledge'),
        cancelLabel: t('timeline.cancel'),
        confirmLabel: t('timeline.clearAction'),
      },
    },
  ]
  rows.push(...items.map(item => ({
    id: String(item.seq),
    label: `${t('select.rollbackTo')}${item.seq}`,
    detail: `${fmtTime(item.time)} · ${fileSummary(item, t)}`,
    confirmation: {
      title: t('select.title'),
      description: rollbackConfirmLabel(item.seq, items, t),
      acknowledgeLabel: t('select.acknowledge'),
      cancelLabel: t('timeline.cancel'),
      confirmLabel: t('timeline.rollbackAction'),
    },
  })))
  return rows
}

/**
 * Build the `/rollback` decoration: options load the session's snapshot
 * listing once; onSelect runs the confirmed rollback line, reusing the same
 * command Remote the sidebar timeline uses.
 * @param t - locale reader for the snapshot namespace.
 * @param execute - the `/rollback` command channel.
 * @returns the decoration to register with `ctx.commandUi`.
 */
export function buildRollbackDecoration(t: TranslateNS<'snapshot'>, execute: RollbackExecute): CommandDecoration {
  return {
    name: 'rollback',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        const result = await execute(session.sessionId, '/rollback list', signal)
        if (!result.ok || result.value === undefined) {
          throw new Error(t('timeline.loadFailed'))
        }
        return optionsOf(parseList(result.value.result.text ?? ''), t)
      },
      onSelect: async (option, session) => {
        const line = option.id === CLEAR_ID
          ? '/rollback clear --yes'
          : `/rollback ${option.id} --yes`
        const result = await execute(session.sessionId, line)
        if (!result.ok) {
          throw new Error(`${t('select.failed')}: ${result.error.code}: ${result.error.message}`)
        }
        if (result.value === undefined) {
          throw new Error(t('select.failed'))
        }
      },
    },
  }
}

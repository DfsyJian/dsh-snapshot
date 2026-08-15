/**
 * Sidebar timeline entry: a `sidebar.footer.action` button that opens a panel
 * listing the current session's snapshot groups — one row per user message
 * (all of its write/edit/delete mutations folded together). Each row can roll that
 * group back with one click (`/rollback <seq> --yes`), and a header action
 * clears every snapshot after an in-panel confirmation (`/rollback clear --yes`).
 * Data comes from the same `/rollback list` command, so the panel needs no
 * dedicated host API.
 * @module dsh-snapshot/client/TimelineEntry
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotClientInjected } from './types.js'
import { UpdatePanel } from './UpdatePanel.js'
import { CURRENT_VERSION } from './update-check.js'

/** Full props: the sidebar footer-action slot share plus the rollback channel. */
type TimelineEntryProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'snapshot'> & InjectFace<SnapshotClientInjected>

/** One parsed timeline row: a user message's snapshots, or one rollback action. */
interface TimelineItem {
  /** Sequence of the row's first record; the rollback target. */
  seq: number
  time: string
  /** Number of mutations folded into this row. */
  count: number
  /** Number of distinct files this row touches. */
  files: number
  /** Created files in this row. */
  create: number
  /** Edited existing files in this row. */
  modify: number
  /** Deleted files in this row (captured from shell delete commands). */
  delete: number
  tool: string
  path: string
  size: string
  /** Each distinct file of the row and the kind of its first record. */
  paths: Array<{ kind: string; path: string }>
  /** User-message preview trailing the row; absent on old or rollback records. */
  prompt?: string
}

/**
 * Matches `/rollback list` rows:
 * `#<seq> <time> <count> <files> <create> <modify> <delete> <tool> <path> (<size>) [<prompt>]`.
 */
const LINE_PATTERN = /^#(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s+\((create|\d+ bytes)\)(?:\s+(.*))?$/u

/** Matches one per-file detail line following a row: `  <kind> <path>`. */
const DETAIL_PATTERN = /^ {2}(create|modify|delete|rollback) (.+)$/u

/**
 * Parse the command's multi-line listing into rows (lenient on noise). Each
 * row's indented detail lines — one per touched file — attach to the row that
 * precedes them.
 */
function parseList(text: string): TimelineItem[] {
  const items: TimelineItem[] = []
  let current: TimelineItem | undefined
  for (const line of text.split('\n')) {
    const match = LINE_PATTERN.exec(line)
    if (match !== null) {
      const prompt = match[11]?.trim()
      current = {
        seq: Number(match[1]),
        time: match[2] ?? '',
        count: Number(match[3] ?? '1'),
        files: Number(match[4] ?? '1'),
        create: Number(match[5] ?? '0'),
        modify: Number(match[6] ?? '0'),
        delete: Number(match[7] ?? '0'),
        tool: match[8] ?? '',
        path: match[9] ?? '',
        size: match[10] ?? '',
        paths: [],
        prompt: prompt === undefined || prompt.length === 0 ? undefined : prompt,
      }
      items.push(current)
      continue
    }
    const detail = DETAIL_PATTERN.exec(line)
    if (detail !== null && current !== undefined) {
      current.paths.push({ kind: detail[1] ?? '', path: detail[2] ?? '' })
    }
  }
  return items
}

/** Render a snapshot's ISO time as a short local `HH:mm` label. */
function fmtTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Render a snapshot's ISO time as a full local `YYYY-MM-DD HH:mm:ss` label. */
function fmtFullTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Matches the host-side rollback record prompt so it can be localized. */
const ROLLBACK_PROMPT = /^回滚至快照 #(\d+)$/u

/** Localized label for a recorded mutation kind, passed through when unknown. */
const toolLabel = (tool: string, t: TimelineEntryProps['t']): string => {
  if (tool === 'write') return t('timeline.toolWrite')
  if (tool === 'edit') return t('timeline.toolEdit')
  if (tool === 'rollback') return t('timeline.toolRollback')
  return tool
}

/** Localized label for a per-file detail kind tag, passed through when unknown. */
const kindLabel = (kind: string, t: TimelineEntryProps['t']): string => {
  if (kind === 'create') return t('timeline.kindCreate')
  if (kind === 'modify') return t('timeline.kindModify')
  if (kind === 'delete') return t('timeline.kindDelete')
  if (kind === 'rollback') return t('timeline.toolRollback')
  return kind
}

/**
 * The hover tooltip for one row: every file it touches with its kind, e.g.
 * `创建 D:\…\1.html\n修改 D:\…\2.html`. Legacy rows without detail lines fall
 * back to the single path.
 * @param item - the timeline row.
 * @param t - locale reader.
 * @returns the tooltip text, or undefined when no path is known.
 */
function rowPathsTitle(item: TimelineItem, t: TimelineEntryProps['t']): string | undefined {
  if (item.paths.length > 0) {
    return item.paths.map(entry => `${kindLabel(entry.kind, t)} ${entry.path}`).join('\n')
  }
  return item.files === 1 ? item.path : undefined
}

/** The primary line for one row: its user-prompt preview, or the rollback note. */
function rowTitle(item: TimelineItem, t: TimelineEntryProps['t']): string {
  if (item.prompt !== undefined) {
    const rollback = ROLLBACK_PROMPT.exec(item.prompt)
    if (rollback !== null) return `${t('timeline.rollbackTo')} #${rollback[1]}`
    return item.prompt
  }
  return item.tool === 'rollback' ? t('timeline.toolRollback') : item.path
}

/**
 * The secondary line for one row: a per-kind summary of the changes it folds
 * together — 创建/修改/删除 counts, showing only the kinds that occurred — and
 * the file path when the row touches a single file. Rollback rows (no
 * mutations) fall back to the tool label and their own record count.
 * @param item - the timeline row.
 * @param t - locale reader.
 * @returns the subtitle.
 */
function rowSubtitle(item: TimelineItem, t: TimelineEntryProps['t']): string {
  const kinds: string[] = []
  if (item.create > 0) kinds.push(`${t('timeline.kindCreate')} ×${item.create}`)
  if (item.modify > 0) kinds.push(`${t('timeline.kindModify')} ×${item.modify}`)
  if (item.delete > 0) kinds.push(`${t('timeline.kindDelete')} ×${item.delete}`)
  if (kinds.length === 0) {
    // Rollback bookkeeping folds into one row per action, not per kind.
    const label = toolLabel(item.tool, t)
    const count = item.count > 1 ? ` ×${item.count}` : ''
    return `${label}${count}${item.files === 1 ? ` · ${item.path}` : ''}`
  }
  const summary = kinds.join(' · ')
  return item.files === 1 ? `${summary} · ${item.path}` : summary
}

/**
 * The rollback confirmation question for one row: a whole message group asks
 * about its changes, a rollback row about undoing that rollback, and a lone
 * snapshot keeps the per-record wording.
 * @param seq - the row being confirmed.
 * @param items - the timeline rows.
 * @param t - locale reader.
 * @returns the confirmation sentence.
 */
function rollbackConfirmLabel(seq: number, items: TimelineItem[], t: TimelineEntryProps['t']): string {
  const item = items.find(candidate => candidate.seq === seq)
  if (item?.tool === 'rollback') return t('timeline.rollbackConfirmRollback')
  if (item !== undefined && item.files > 1) {
    return `${t('timeline.rollbackConfirmCount')}${item.files}${t('timeline.rollbackBeforeGroup')}`
  }
  return `${t('timeline.rollbackConfirm')}${seq}${t('timeline.rollbackBefore')}?`
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  left: 72,
  bottom: 8,
  width: 380,
  maxWidth: 'calc(100vw - 88px)',
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  padding: 10,
  fontSize: 12,
  lineHeight: 1.5,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

/**
 * The timeline button and its overlay panel.
 * @param props - the sidebar wide flag, the global session list hook, and the
 * injected rollback runner.
 * @returns the footer button, plus the panel while open.
 */
export function TimelineEntry({ wide, useSessions, runRollback, t }: TimelineEntryProps) {
  const sessionId = useSessions(state => state.current)
  const currentTitle = useSessions(state => state.current === undefined ? undefined : state.byId[state.current]?.displayTitle)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState<number | null>(null)
  const [confirmRollbackSeq, setConfirmRollbackSeq] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [hover, setHover] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const refresh = useCallback(() => {
    if (sessionId === undefined) return
    setLoading(true)
    setError(null)
    setConfirmRollbackSeq(null)
    void runRollback(sessionId, '/rollback list').then(result => {
      if (!alive.current) return
      setLoading(false)
      if (result.ok && result.value !== undefined) {
        setItems(parseList(result.value.result.text ?? ''))
      } else {
        setError(t('timeline.loadFailed'))
      }
    })
  }, [runRollback, sessionId, t])

  const openPanel = useCallback(() => {
    setOpen(true)
    refresh()
  }, [refresh])

  const rollback = useCallback((seq: number) => {
    if (sessionId === undefined || rollingBack !== null) return
    setRollingBack(seq)
    setConfirmRollbackSeq(null)
    void runRollback(sessionId, `/rollback ${seq} --yes`).then(() => {
      if (!alive.current) return
      setRollingBack(null)
      void refresh()
    })
  }, [refresh, rollingBack, runRollback, sessionId])

  const clear = useCallback(() => {
    if (sessionId === undefined || clearing) return
    setClearing(true)
    void runRollback(sessionId, '/rollback clear --yes').then(() => {
      if (!alive.current) return
      setClearing(false)
      setConfirmClear(false)
      setConfirmRollbackSeq(null)
      void refresh()
    })
  }, [clearing, refresh, runRollback, sessionId])

  return (
    <>
      <div style={{
        display: 'flex',
        gap: 8,
        ...(wide
          ? { width: 'calc(100% + 8px)', margin: '4px -4px' }
          : { justifyContent: 'center', margin: '8px 0 10px' }),
      }}>
        <button
          type="button"
          title={t('timeline.title')}
          aria-label={t('timeline.title')}
          onClick={openPanel}
          onMouseEnter={() => { setHover(true) }}
          onMouseLeave={() => { setHover(false) }}
          style={{
            border: 'none',
            background: hover ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
            cursor: 'pointer',
            color: 'var(--dsw-alias-label-primary)',
            overflow: 'hidden',
            display: 'inline-flex',
            alignItems: 'center',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            fontSize: 14,
            lineHeight: '22px',
            flex: 'none',
            width: wide ? undefined : 36,
            height: wide ? 34 : 36,
            gap: wide ? 8 : 0,
            padding: wide ? '6px 10px' : 0,
            borderRadius: wide ? 12 : '50%',
            justifyContent: wide ? 'flex-start' : 'center',
          }}
        >
          {wide ? <IconRefreshOutline14 size={16} /> : <IconRefreshOutline14 size={18} />}
          {wide && <span style={{ whiteSpace: 'nowrap' }}>{t('timeline.button')}</span>}
        </button>
      </div>
      {open && sessionId !== undefined && (
        <div style={overlayStyle} onClick={() => { setOpen(false) }}>
          <div style={panelStyle} onClick={(event) => { event.stopPropagation() }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong>{t('timeline.title')}</strong>
              {currentTitle !== undefined && currentTitle.length > 0 && (
                <span
                  style={{
                    opacity: 0.6,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                  title={currentTitle}
                >
                  {currentTitle}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => { setConfirmClear(true); setConfirmRollbackSeq(null) }}
                disabled={clearing || confirmClear}
                style={{ ...panelButtonStyle, color: 'var(--dsw-alias-state-error-primary)', borderColor: 'rgba(229, 72, 77, 0.45)' }}
              >
                {t('timeline.clear')}
              </button>
              <button
                type="button"
                onClick={refresh}
                disabled={loading || clearing}
                style={panelButtonStyle}
              >
                {loading ? t('timeline.loading') : t('timeline.refresh')}
              </button>
              <button type="button" onClick={() => { setOpen(false) }} style={panelButtonStyle} aria-label={t('timeline.close')}>
                ✕
              </button>
            </div>
            {confirmClear && (
              <div style={confirmBarStyle}>
                <span style={{ flex: 1 }}>{t('timeline.clearConfirm')}</span>
                <button type="button" onClick={() => { setConfirmClear(false) }} disabled={clearing} style={panelButtonStyle}>
                  {t('timeline.cancel')}
                </button>
                <button type="button" onClick={() => { void clear() }} disabled={clearing} style={{ ...panelButtonStyle, background: '#e5484d', color: '#ffffff', borderColor: '#e5484d' }}>
                  {clearing ? t('timeline.clearing') : t('timeline.clearAction')}
                </button>
              </div>
            )}
            {confirmRollbackSeq !== null && (
              <div style={promptBarStyle}>
                <span style={{ flex: 1 }}>{rollbackConfirmLabel(confirmRollbackSeq, items, t)}</span>
                <button type="button" onClick={() => { setConfirmRollbackSeq(null) }} disabled={rollingBack !== null} style={panelButtonStyle}>
                  {t('timeline.cancel')}
                </button>
                <button type="button" onClick={() => { rollback(confirmRollbackSeq) }} disabled={rollingBack !== null} style={{ ...panelButtonStyle, background: '#e5484d', color: '#ffffff', borderColor: '#e5484d' }}>
                  {t('timeline.rollbackAction')}
                </button>
              </div>
            )}
            {error !== null && <div style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{error}</div>}
            {!error && items.length === 0 && !loading && (
              <div style={{ opacity: 0.6 }}>{t('timeline.empty')}</div>
            )}
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {items.map(item => (
                <div key={item.seq} style={rowStyle} title={rowPathsTitle(item, t)}>
                  <span style={{ minWidth: 28, alignSelf: 'flex-start', paddingTop: 5 }}>#{item.seq}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {rowTitle(item, t)}
                    </div>
                    <div style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rowSubtitle(item, t)}
                    </div>
                  </div>
                  <span style={{ flex: 'none', opacity: 0.7, fontSize: 11 }} title={fmtFullTime(item.time)}>{fmtTime(item.time)}</span>
                  <button
                    type="button"
                    disabled={rollingBack !== null}
                    onClick={() => { setConfirmRollbackSeq(current => current === item.seq ? null : item.seq) }}
                    style={panelButtonStyle}
                  >
                    {rollingBack === item.seq ? t('timeline.rollingBack') : t('timeline.rollback')}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
              <button type="button" onClick={() => { setUpdateOpen(true) }} style={panelButtonStyle}>
                {t('update.check')}
              </button>
              <span style={{ flex: 1 }} />
              <span style={{ opacity: 0.6, flex: 'none' }} title={`${t('timeline.version')} ${CURRENT_VERSION}`}>
                {t('timeline.version')} {CURRENT_VERSION}
              </span>
            </div>
          </div>
        </div>
      )}
      {updateOpen && <UpdatePanel t={t} onClose={() => { setUpdateOpen(false) }} />}
    </>
  )
}

const panelButtonStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'transparent',
  cursor: 'pointer',
  color: 'inherit',
  borderRadius: 4,
  padding: '1px 8px',
  fontSize: 12,
  lineHeight: 1.5,
}

const confirmBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  marginBottom: 6,
  background: 'rgba(229, 72, 77, 0.08)',
  border: '1px solid rgba(229, 72, 77, 0.35)',
  borderRadius: 6,
}

/** Neutral prompt bar: asks before rolling back one snapshot. */
const promptBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  marginBottom: 6,
  background: 'var(--dsw-alias-bg-layer-3)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
}

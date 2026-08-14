/**
 * Sidebar timeline entry: a `sidebar.footer.action` button that opens a panel
 * listing the current session's snapshots. Each row can roll that snapshot
 * back with one click (`/rollback <seq> --yes`), and a header action clears
 * every snapshot after an in-panel confirmation (`/rollback clear --yes`).
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

/** Full props: the sidebar footer-action slot share plus the rollback channel. */
type TimelineEntryProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'snapshot'> & InjectFace<SnapshotClientInjected>

/** One parsed snapshot row from the command's text listing. */
interface TimelineItem {
  seq: number
  time: string
  tool: string
  path: string
  size: string
  /** User-message preview trailing the row; absent on old or rollback records. */
  prompt?: string
}

/** Matches `/rollback list` rows: `#<seq> <time> <tool> <path> (<size>) [<prompt>]`. */
const LINE_PATTERN = /^#(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+\((create|\d+ bytes)\)(?:\s+(.*))?$/u

/** Parse the command's multi-line listing into rows (lenient on noise). */
function parseList(text: string): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const line of text.split('\n')) {
    const match = LINE_PATTERN.exec(line)
    if (match === null) continue
    const prompt = match[6]?.trim()
    items.push({
      seq: Number(match[1]),
      time: match[2] ?? '',
      tool: match[3] ?? '',
      path: match[4] ?? '',
      size: match[5] ?? '',
      prompt: prompt === undefined || prompt.length === 0 ? undefined : prompt,
    })
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

/** Matches the host-side rollback record prompt so it can be localized. */
const ROLLBACK_PROMPT = /^回滚至快照 #(\d+)$/u

/** Localized label for a recorded mutation kind, passed through when unknown. */
const toolLabel = (tool: string, t: TimelineEntryProps['t']): string => {
  if (tool === 'write') return t('timeline.toolWrite')
  if (tool === 'edit') return t('timeline.toolEdit')
  if (tool === 'rollback') return t('timeline.toolRollback')
  return tool
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
          // 几何复刻设置按钮:宽栏撑满整行(100%+8px 扩展)、内容靠左,窄栏为 36x36 圆钮、内容居中。
          flex: 'none',
          width: wide ? 'calc(100% + 8px)' : 36,
          height: wide ? 34 : 36,
          margin: wide ? '4px -4px 4px' : '8px 0 10px',
          gap: wide ? 8 : 0,
          padding: wide ? '6px 2px 6px 10px' : 0,
          borderRadius: wide ? 12 : '50%',
          justifyContent: wide ? 'flex-start' : 'center',
        }}
      >
        {wide ? <IconRefreshOutline14 size={16} /> : <IconRefreshOutline14 size={18} />}
        {wide && <span style={{ whiteSpace: 'nowrap' }}>{t('timeline.button')}</span>}
      </button>
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
                <span style={{ flex: 1 }}>{t('timeline.rollbackConfirm')}{confirmRollbackSeq}{t('timeline.rollbackBefore')}?</span>
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
                <div key={item.seq} style={rowStyle}>
                  <span style={{ minWidth: 28, alignSelf: 'flex-start', paddingTop: 5 }}>#{item.seq}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={item.path}
                    >
                      {rowTitle(item, t)}
                    </div>
                    <div style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {toolLabel(item.tool, t)} · {item.path}
                    </div>
                  </div>
                  <span style={{ flex: 'none', opacity: 0.7, fontSize: 11 }}>{fmtTime(item.time)}</span>
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
          </div>
        </div>
      )}
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

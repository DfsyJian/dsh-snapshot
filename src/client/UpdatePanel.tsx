/**
 * The update-check panel opened from the sidebar action beside the snapshot
 * timeline button. It probes the npm registry once on mount and shows the
 * installed version plus the outcome — detection only, a newer release is
 * reported with its upgrade command, never applied.
 * @module dsh-snapshot/client/UpdatePanel
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { compareVersions, CURRENT_VERSION, fetchLatestVersion } from './update-check.js'
import type { SnapshotCardKey } from './snapshot-card-locale.js'

/** The settled probe outcome; `checking` covers the in-flight request. */
type UpdateState = 'checking' | 'upToDate' | 'outdated' | 'failed'

/** Props for the update-check panel. */
export interface UpdatePanelProps {
  /** Locale reader for this card's copy. */
  t: (key: SnapshotCardKey) => string
  /** Close the panel (overlay click or the close button). */
  onClose: () => void
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
  width: 320,
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

const closeStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'transparent',
  cursor: 'pointer',
  color: 'inherit',
  borderRadius: 4,
  padding: '1px 8px',
  fontSize: 12,
  lineHeight: 1.5,
}

const versionStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  margin: '6px 0',
}

const resultStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
}

const outdatedStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary))',
}

const commandStyle: CSSProperties = {
  fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
}

/**
 * Render the update-check panel and run its single probe.
 * @param props - locale reader and close callback.
 * @returns the overlay panel.
 */
export function UpdatePanel({ t, onClose }: UpdatePanelProps) {
  const [state, setState] = useState<UpdateState>('checking')
  const [latest, setLatest] = useState<string | undefined>(undefined)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void fetchLatestVersion().then((version) => {
      if (!alive.current) return
      if (version === undefined) {
        setState('failed')
        return
      }
      setLatest(version)
      setState(compareVersions(version, CURRENT_VERSION) > 0 ? 'outdated' : 'upToDate')
    })
    return () => { alive.current = false }
  }, [])

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(event) => { event.stopPropagation() }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <strong>{t('update.check')}</strong>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={closeStyle} aria-label={t('timeline.close')}>
            ✕
          </button>
        </div>
        <div style={versionStyle}>{t('update.current')}{CURRENT_VERSION}</div>
        {state === 'checking' ? <div style={resultStyle}>{t('update.checking')}</div> : null}
        {state === 'upToDate' ? <div style={resultStyle}>{t('update.upToDate')}</div> : null}
        {state === 'outdated'
          ? (
            <div style={outdatedStyle}>
              {t('update.found')}{latest} — <code style={commandStyle}>{t('update.command')}{latest}</code>
            </div>
          )
          : null}
        {state === 'failed' ? <div style={resultStyle}>{t('update.failed')}</div> : null}
      </div>
    </div>
  )
}

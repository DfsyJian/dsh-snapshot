/**
 * Shared chrome for the plugin settings card: a disclosure header naming the
 * plugin and what its settings govern, the controls inside, and the save that
 * writes them. Geometry and design tokens mirror the harness's own
 * `PluginCard` (border-l2 shell, layer-3 fill, chevron disclosure, pill
 * badges, footer actions), so the snapshot card reads like the built-in
 * bash/agent-loop/web-search cards. Renders nothing while the namespace is
 * still loading, and an explanation instead of the form while the Host does
 * not expose it.
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CardShell } from './settings-form.js'
import type { SnapshotCardKey } from './snapshot-card-locale.js'

/** Card chrome shared by every plugin settings card. */
export interface PluginSettingsCardProps {
  /** Locale reader for this card's copy. */
  t: (key: SnapshotCardKey) => string
  /** Locale key of the plugin's name. */
  titleKey: SnapshotCardKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: SnapshotCardKey
  /** The card's form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
}

/** Shell of one plugin card, mirroring the harness PluginCard.module.css. */
const cardStyle = (hover: boolean, open: boolean): CSSProperties => ({
  listStyle: 'none',
  border: `1px solid ${hover || open ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-border-l2)'}`,
  borderRadius: 12,
  background: open ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
  transition: 'border-color .16s, background .16s',
})

const headerStyle: CSSProperties = {
  width: '100%',
  appearance: 'none',
  border: 0,
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
}

/** Name over description, both stacked in the header's flexible area. */
const headTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const nameStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'var(--dsw-alias-label-primary)',
}

const descriptionStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const chevronStyle = (open: boolean): CSSProperties => ({
  flex: 'none',
  display: 'inline-flex',
  color: 'var(--dsw-alias-label-tertiary)',
  transform: open ? 'rotate(180deg)' : 'none',
  transition: 'transform .16s',
})

const bodyStyle: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  margin: '0 16px',
  paddingBottom: 8,
}

const noteStyle: CSSProperties = {
  margin: '12px 0 0',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const pendingStyle: CSSProperties = {
  flex: 'none',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 11,
  lineHeight: '17px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
}

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '12px 0 4px',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

const failedStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-state-error-primary)',
}

const footerButtonStyle: CSSProperties = {
  appearance: 'none',
  border: '1px solid transparent',
  borderRadius: 8,
  padding: '5px 14px',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.5,
  cursor: 'pointer',
}

const discardStyle: CSSProperties = {
  ...footerButtonStyle,
  borderColor: 'var(--dsw-alias-border-l2)',
  background: 'none',
  color: 'var(--dsw-alias-label-secondary)',
}

const saveStyle: CSSProperties = {
  ...footerButtonStyle,
  background: 'var(--dsw-alias-label-primary)',
  color: 'var(--dsw-alias-bg-layer-3)',
}

const disabledButtonStyle: CSSProperties = {
  opacity: 0.4,
  cursor: 'default',
}

/**
 * Render one plugin settings card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing while the namespace is still loading.
 */
export function PluginSettingsCard(props: PluginSettingsCardProps) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const { state } = props
  if (!state.available) return null
  const title = props.t(props.titleKey)
  const blocked = !state.dirty || state.invalid || state.saving
  const description = props.t(props.descriptionKey)
  // The namespace exists but the Host does not serve it to this client (the
  // official settings allowlist omits third-party namespaces): show a card
  // that explains the gap instead of vanishing, so a missing card never
  // reads as a missing plugin.
  const exposed = state.exposed
  return (
    <li
      style={cardStyle(hover, open)}
      onMouseEnter={() => { setHover(true) }}
      onMouseLeave={() => { setHover(false) }}
    >
      <button
        type="button"
        style={headerStyle}
        aria-expanded={open}
        aria-label={`${props.t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        title={description}
        onClick={() => { setOpen(!open) }}
      >
        <span style={headTextStyle}>
          <span style={nameStyle}>{title}</span>
          <span style={descriptionStyle}>{description}</span>
        </span>
        {exposed && state.dirty ? <span style={pendingStyle}>{props.t('settings.unsaved')}</span> : null}
        <span style={chevronStyle(open)}><IconChevronDownOutline14 size={14} /></span>
      </button>
      {open
        ? (
          <div style={bodyStyle}>
            {exposed && !state.writable ? <p style={noteStyle} role="status">{props.t('settings.readOnly')}</p> : null}
            {exposed ? props.children : <p style={noteStyle} role="status">{props.t('settings.notExposed')}</p>}
            {exposed
              ? (
                <div style={footerStyle}>
                  {state.failed ? <p style={failedStyle} role="status">{props.t('settings.saveFailed')}</p> : null}
                  <button
                    type="button"
                    style={discardStyle}
                    disabled={!state.dirty || state.saving}
                    onClick={props.onDiscard}
                  >
                    {props.t('settings.discard')}
                  </button>
                  <button
                    type="button"
                    style={blocked ? { ...saveStyle, ...disabledButtonStyle } : saveStyle}
                    disabled={blocked}
                    onClick={props.onSave}
                  >
                    {props.t(!state.saving ? 'settings.save' : 'settings.saving')}
                  </button>
                </div>
              )
              : null}
          </div>
        )
        : null}
    </li>
  )
}

/** Props every field control needs regardless of its value type. */
export interface FieldProps {
  /** Stable id associating the label with its control. */
  id: string
  /** Visible label. */
  label: string
  /** One-line explanation rendered under the control. */
  hint: string
  /** Draft text this control renders. */
  text: string
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** True when the draft is not a value this field accepts. */
  invalid: boolean
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Copy shown in place of the hint while the draft is invalid. */
  invalidLabel: string
  /** Disables every control (read-only document, or an unavailable namespace). */
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

/** Field controls mirror the harness fields.module.css geometry and tokens. */
const fieldStyle = (first: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '12px 0',
  ...(first ? {} : { borderTop: '1px solid var(--dsw-alias-border-l2)' }),
})

const fieldHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const labelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary)',
}

const badgesStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
}

const badgeStyle: CSSProperties = {
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 11,
  lineHeight: '17px',
  whiteSpace: 'nowrap',
  fontWeight: 500,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
}

const resetStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}

const inputStyle: CSSProperties = {
  height: 34,
  padding: '0 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-3)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary)',
}

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const invalidHintStyle: CSSProperties = {
  ...hintStyle,
  color: 'var(--dsw-alias-state-error-primary)',
}

/**
 * A staged value field. `numeric` only hints the keypad: which drafts a field
 * accepts is decided by its spec, so the control never silently rewrites what
 * the user typed.
 */
export function ValueField(props: FieldProps & {
  /** Hints a numeric keypad without narrowing what the control accepts. */
  numeric?: boolean
  /** Placeholder shown while the draft is empty. */
  placeholder?: string
  /** Omit the separator above this field (the card's first control). */
  first?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const borderColor = focused
    ? 'var(--dsw-alias-brand-primary)'
    : props.invalid ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l2)'
  return (
    <div style={fieldStyle(props.first ?? false)}>
      <div style={fieldHeadStyle}>
        <label htmlFor={props.id} style={labelStyle}>{props.label}</label>
        {props.overridden
          ? (
            <span style={badgesStyle}>
              <span style={badgeStyle}>{props.overriddenLabel}</span>
              <button
                type="button"
                style={resetStyle}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        style={{ ...inputStyle, borderColor }}
        type="text"
        {...props.numeric === true ? { inputMode: 'numeric' as const } : {}}
        {...props.invalid ? { 'aria-invalid': true } : {}}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onFocus={() => { setFocused(true) }}
        onBlur={() => { setFocused(false) }}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p style={props.invalid ? invalidHintStyle : hintStyle}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/** A staged boolean field: on or off. */
export function BooleanField(props: FieldProps & {
  /** Copy for the on option. */
  onLabel: string
  /** Copy for the off option. */
  offLabel: string
  /** Omit the separator above this field (the card's first control). */
  first?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const borderColor = focused ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'
  return (
    <div style={fieldStyle(props.first ?? false)}>
      <div style={fieldHeadStyle}>
        <label htmlFor={props.id} style={labelStyle}>{props.label}</label>
        {props.overridden
          ? (
            <span style={badgesStyle}>
              <span style={badgeStyle}>{props.overriddenLabel}</span>
              <button
                type="button"
                style={resetStyle}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <select
        id={props.id}
        style={{ ...inputStyle, borderColor }}
        value={props.text}
        disabled={props.disabled}
        onFocus={() => { setFocused(true) }}
        onBlur={() => { setFocused(false) }}
        onChange={(event) => { props.onEdit(event.target.value) }}
      >
        <option value="true">{props.onLabel}</option>
        <option value="false">{props.offLabel}</option>
      </select>
      <p style={hintStyle}>{props.hint}</p>
    </div>
  )
}

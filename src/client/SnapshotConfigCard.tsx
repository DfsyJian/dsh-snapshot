/**
 * The snapshot settings card: the retention parameters. Registers into the
 * `settings.plugin.item` slot the plugin-configuration section renders, bound
 * to the `snapshot` settings namespace.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, ValueField, BooleanField } from './PluginSettingsCard.js'
import { CardForm, booleanField, numberField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.js'

/** The snapshot fields this card edits (the namespace's full schema). */
export interface SnapshotSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Directory snapshots are stored in. */
  storeDir?: string
  /** Snapshots kept per session. */
  maxRetain?: number
  /** Total snapshots kept per project (workspace). */
  maxProjectRetain?: number
  /** Whether orphan snapshots are pruned. */
  pruneOrphans?: boolean
  /** Whether rolling back folds the history past the restored snapshot. */
  collapseOnRollback?: boolean
}

/** What the snapshot card renders. */
export interface SnapshotConfigCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** Snapshot root directory. */
  storeDir: CardFieldState
  /** Per-session retention. */
  maxRetain: CardFieldState
  /** Project total quota. */
  maxProjectRetain: CardFieldState
  /** Orphan pruning. */
  pruneOrphans: CardFieldState
  /** Rollback folding. */
  collapseOnRollback: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface SnapshotConfigCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useSnapshotCard. */
    snapshotCard: SnapshotStore<SnapshotConfigCardState>
  }
}

/** Bridges the `snapshot` scope onto the card's staged form. */
export class SnapshotConfigCardController {
  private readonly form: CardForm<SnapshotSettings>
  private readonly store: SnapshotStore<SnapshotConfigCardState>

  /** @param scope - the bound settings scope for the `snapshot` namespace. */
  constructor(scope: SettingsScope<SnapshotSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      textField('storeDir'),
      numberField('maxRetain', { integer: true, min: 0 }),
      numberField('maxProjectRetain', { integer: true, min: 0 }),
      booleanField('pruneOrphans'),
      booleanField('collapseOnRollback'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SnapshotConfigCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      storeDir: this.form.field('storeDir'),
      maxRetain: this.form.field('maxRetain'),
      maxProjectRetain: this.form.field('maxProjectRetain'),
      pruneOrphans: this.form.field('pruneOrphans'),
      collapseOnRollback: this.form.field('collapseOnRollback'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): SnapshotConfigCardFace {
    return { hooks: { snapshotCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the snapshot card. */
export type SnapshotConfigCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'snapshot'>
  & InjectFace<SnapshotConfigCardFace>

/**
 * Render the snapshot card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function SnapshotConfigCard(props: SnapshotConfigCardProps) {
  const { t } = props
  const state = props.useSnapshotCard(snapshot => snapshot)
  const disabled = !state.writable
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-snapshot-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        first
        {...fieldProps}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <ValueField
        id="settings-snapshot-store-dir"
        label={t('settings.storeDir')}
        hint={t('settings.storeDirHint')}
        {...fieldProps}
        {...state.storeDir}
        onEdit={(text) => { props.edit('storeDir', text) }}
        onReset={() => { props.resetField('storeDir') }}
      />
      <ValueField
        id="settings-snapshot-max-retain"
        label={t('settings.maxRetain')}
        hint={t('settings.maxRetainHint')}
        numeric
        {...fieldProps}
        {...state.maxRetain}
        onEdit={(text) => { props.edit('maxRetain', text) }}
        onReset={() => { props.resetField('maxRetain') }}
      />
      <ValueField
        id="settings-snapshot-max-project-retain"
        label={t('settings.maxProjectRetain')}
        hint={t('settings.maxProjectRetainHint')}
        numeric
        {...fieldProps}
        {...state.maxProjectRetain}
        onEdit={(text) => { props.edit('maxProjectRetain', text) }}
        onReset={() => { props.resetField('maxProjectRetain') }}
      />
      <BooleanField
        id="settings-snapshot-prune-orphans"
        label={t('settings.pruneOrphans')}
        hint={t('settings.pruneOrphansHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.pruneOrphans}
        onEdit={(text) => { props.edit('pruneOrphans', text) }}
        onReset={() => { props.resetField('pruneOrphans') }}
      />
      <BooleanField
        id="settings-snapshot-collapse-rollback"
        label={t('settings.collapseOnRollback')}
        hint={t('settings.collapseOnRollbackHint')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.collapseOnRollback}
        onEdit={(text) => { props.edit('collapseOnRollback', text) }}
        onReset={() => { props.resetField('collapseOnRollback') }}
      />
    </PluginSettingsCard>
  )
}

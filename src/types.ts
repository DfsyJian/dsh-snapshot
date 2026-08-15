/**
 * Durable snapshot vocabulary shared across the capture hook, the store, and
 * the rollback command.
 * @module dsh-snapshot/types
 */

/**
 * The mutation kind that produced one snapshot. `delete` snapshots are taken
 * from shell deletion commands (`bash` `rm`/`unlink`, `pwsh` `Remove-Item` and
 * its aliases): the target file's content is recorded before the command runs,
 * so a rollback restores the deleted file.
 */
export type SnapshotTool = 'write' | 'edit' | 'rollback' | 'delete'

/** One recorded file snapshot. */
export interface SnapshotRecord {
  /** Monotonic sequence within this session's store. */
  seq: number
  /** ISO 8601 capture time. */
  time: string
  /** The tool that produced the mutation. */
  tool: SnapshotTool
  /** Resolved display path of the mutated file (absolute, workspace-relative, or URI per backend). */
  path: string
  /** File content before the mutation; null when the file did not exist. */
  before: string | null
  /** File content after the mutation; not yet captured in the skeleton. */
  after: string | null
  /**
   * Root tool-call identity that produced this mutation, so the web UI's
   * per-message undo button can map a tool call back to its snapshot.
   * Absent on stores written before 0.2.0.
   */
  callId?: string
  /**
   * Single-line preview of the user message that drove this mutation, so the
   * timeline can label each snapshot with the prompt that produced it. Absent
   * on stores written before the field existed and on rollback bookkeeping.
   */
  prompt?: string
  /**
   * Durable identity of the user message that drove this mutation, so the
   * timeline groups every snapshot of one message into a single row and one
   * rollback restores them all. Rollback bookkeeping tags one rollback action
   * with a synthetic `rollback:`-prefixed id. Absent on stores written before
   * the field existed: each such record is its own single-entry group.
   */
  group?: string
  /**
   * The workspace folder (the session's cwd) this snapshot belongs to, so
   * the project-wide quota can group every session of the same project.
   * Absent when the session had no cwd or on stores written before the
   * field existed.
   */
  project?: string
}

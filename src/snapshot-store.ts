/**
 * Append-only JSONL snapshot store scoped to one session. Lives under
 * `$DSH_HOME/snapshots/<sessionId>/snapshots.jsonl` so it survives process
 * restarts like the durable session log it mirrors.
 * @module dsh-snapshot/snapshot-store
 */

import { access, appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SnapshotRecord } from './types.js'

/** The default DSH home directory when DSH_HOME is unset. */
const DEFAULT_DSH_HOME = join(homedir(), '.dsh')

/**
 * Resolve the DSH home directory: explicit DSH_HOME wins, then the
 * `~/.dsh` default. Mirrors @deepseek-ai/dsh-home-paths without the dependency.
 * @returns the absolute DSH home path.
 */
export function dshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  return env !== undefined && env.length > 0 ? env : DEFAULT_DSH_HOME
}

/** Options controlling one session snapshot store. */
export interface SnapshotStoreOptions {
  /** Root directory holding per-session stores; defaults to `$DSH_HOME/snapshots`. */
  readonly storeDir?: string
  /** Maximum retained snapshots per session; 0 means unlimited; defaults to 100. */
  readonly maxRetain?: number
  /**
   * Project-wide cap over all sessions of the same workspace folder; once
   * exceeded, the oldest records by capture time are dropped first. 0 means
   * unlimited; defaults to 100, matching the per-session cap. Inactive
   * without a `project`.
   */
  readonly maxProjectRetain?: number
  /** The workspace folder (the session's cwd) this store's snapshots belong to. */
  readonly project?: string
  /**
   * Remove whole session stores whose workspace folder no longer exists on
   * disk: their snapshots can never be rolled back, so they only occupy
   * space. Defaults to true; set false to keep orphan stores.
   */
  readonly pruneOrphans?: boolean
}

const STORE_FILE = 'snapshots.jsonl'

/**
 * One session's snapshot store. Appends one JSON line per mutation and caps
 * retention; `append` is best-effort by design so a storage failure never
 * blocks the agent's tool call.
 */
export class SnapshotStore {
  constructor(
    private readonly sessionId: string,
    private readonly options: SnapshotStoreOptions,
  ) {}

  private root(): string {
    return this.options.storeDir ?? join(dshHome(), 'snapshots')
  }

  private dirOf(sessionId: string): string {
    return join(this.root(), sessionId)
  }

  private dir(): string {
    return this.dirOf(this.sessionId)
  }

  private file(): string {
    return join(this.dir(), STORE_FILE)
  }

  /**
   * Record one snapshot with the next monotonic sequence and apply the
   * retention caps.
   * @param record - the snapshot payload without its assigned seq/time/project.
   * @returns the completed record as stored.
   */
  async append(record: Omit<SnapshotRecord, 'seq' | 'time' | 'project'>): Promise<SnapshotRecord> {
    const seq = await this.nextSeq()
    const full: SnapshotRecord = { ...record, project: this.options.project, seq, time: new Date().toISOString() }
    await mkdir(this.dir(), { recursive: true })
    await appendFile(this.file(), `${JSON.stringify(full)}\n`, 'utf8')
    await this.trim()
    await this.pruneProject()
    return full
  }

  /** All snapshots in sequence order (oldest first). */
  async list(): Promise<SnapshotRecord[]> {
    const lines = await this.readLines()
    return lines.map(line => JSON.parse(line) as SnapshotRecord)
  }

  /** One snapshot by sequence, or undefined when absent. */
  async get(seq: number): Promise<SnapshotRecord | undefined> {
    return (await this.list()).find(record => record.seq === seq)
  }

  /**
   * Remove every snapshot of this session, including its store directory. The
   * next append restarts the sequence at 1.
   */
  async clear(): Promise<void> {
    await rm(this.dir(), { recursive: true, force: true })
  }

  private async nextSeq(): Promise<number> {
    const records = await this.list()
    const last = records.at(-1)
    return last === undefined ? 1 : last.seq + 1
  }

  private async readLines(): Promise<string[]> {
    // Any read failure (missing store included) yields an empty list; capture
    // never fails the agent over snapshot bookkeeping.
    try {
      const text = await readFile(this.file(), 'utf8')
      return text.split('\n').filter(line => line.length > 0)
    } catch {
      return []
    }
  }

  private async trim(): Promise<void> {
    const max = this.options.maxRetain ?? 100
    if (max <= 0) return
    const lines = await this.readLines()
    if (lines.length <= max) return
    await writeFile(this.file(), `${lines.slice(-max).join('\n')}\n`, 'utf8')
  }

  /**
   * Enforce the retention policies in one scan of every session store:
   * orphan cleanup removes sessions whose workspace folder no longer exists
   * (their snapshots can never be rolled back), then the project-wide cap
   * drops the oldest records of this store's project across sessions.
   * Corrupt lines are skipped rather than failing the append.
   */
  private async pruneProject(): Promise<void> {
    // Gather every record and each session's projects in one scan.
    const rows: Array<{ sessionId: string; seq: number; time: string; project?: string }> = []
    const sessionProjects = new Map<string, Set<string>>()
    const entries = await readdir(this.root(), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const projects = new Set<string>()
      for (const line of await this.readLinesOf(entry.name)) {
        let record: SnapshotRecord | undefined
        try {
          record = JSON.parse(line) as SnapshotRecord
        } catch {
          record = undefined
        }
        if (record === undefined) continue
        if (record.project !== undefined) projects.add(record.project)
        rows.push({ sessionId: entry.name, seq: record.seq, time: record.time, project: record.project })
      }
      sessionProjects.set(entry.name, projects)
    }
    // Orphan cleanup: a session whose workspace folder(s) no longer exist can
    // never be rolled back, so its store is removed whole. Records without a
    // project tag (pre-0.3.0) are never judged orphan.
    const orphanSessions = new Set<string>()
    if (this.options.pruneOrphans !== false) {
      for (const [sessionId, projects] of sessionProjects) {
        if (projects.size === 0) continue
        let exists = false
        for (const project of projects) {
          if (await pathExists(project)) {
            exists = true
            break
          }
        }
        if (!exists) orphanSessions.add(sessionId)
      }
      for (const sessionId of orphanSessions) {
        await rm(this.dirOf(sessionId), { recursive: true, force: true })
      }
    }
    // Project-wide cap: drop the oldest records of this project, across the
    // sessions that survived orphan cleanup.
    const max = this.options.maxProjectRetain ?? 100
    const project = this.options.project
    if (max <= 0 || project === undefined) return
    const mine = rows.filter(row => row.project === project && !orphanSessions.has(row.sessionId))
    if (mine.length <= max) return
    // Oldest first; equal timestamps fall back to sequence order.
    mine.sort((a, b) => a.time.localeCompare(b.time) || a.seq - b.seq)
    const dropped = mine.slice(0, mine.length - max)
    const bySession = new Map<string, Set<number>>()
    for (const row of dropped) {
      let seqs = bySession.get(row.sessionId)
      if (seqs === undefined) {
        seqs = new Set<number>()
        bySession.set(row.sessionId, seqs)
      }
      seqs.add(row.seq)
    }
    for (const [sessionId, seqs] of bySession) {
      const kept = (await this.readLinesOf(sessionId)).filter(line => {
        let record: SnapshotRecord | undefined
        try {
          record = JSON.parse(line) as SnapshotRecord
        } catch {
          record = undefined
        }
        return record === undefined || !seqs.has(record.seq)
      })
      await this.writeLinesOf(sessionId, kept)
    }
  }

  private async readLinesOf(sessionId: string): Promise<string[]> {
    try {
      const text = await readFile(join(this.root(), sessionId, STORE_FILE), 'utf8')
      return text.split('\n').filter(line => line.length > 0)
    } catch {
      return []
    }
  }

  private async writeLinesOf(sessionId: string, lines: string[]): Promise<void> {
    await writeFile(join(this.root(), sessionId, STORE_FILE), `${lines.join('\n')}\n`, 'utf8')
  }
}

/** True when a filesystem path is accessible. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Pre-mutation snapshot hook: wraps the `tools/execute` waterfall so every
 * top-level model-dispatched write/edit is preceded by a snapshot of the
 * target file's current content, and every shell (`bash`/`pwsh`) command that
 * deletes files is preceded by a snapshot of each deleted file's content.
 * Each snapshot carries the driving user message's durable id, so the
 * timeline groups one message's mutations into a single rollback unit.
 * @module dsh-snapshot/capture
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type { SnapshotStore } from './snapshot-store.js'

/** Tools whose pre-mutation state the plugin snapshots. */
const MUTATING_TOOLS = new Set(['write', 'edit'])

/**
 * Deletion command names per shell tool; a statement must start with one to be
 * treated as a deletion. `pwsh` covers `Remove-Item` and its aliases; `bash`
 * covers `rm` and `unlink`. Statements starting with any other command (e.g.
 * the `Test-Path` half of `Remove-Item x; Test-Path x`) are left alone.
 */
const DELETE_KEYWORDS: Readonly<Record<'bash' | 'pwsh', readonly string[]>> = {
  pwsh: ['remove-item', 'ri', 'rm', 'del', 'erase'],
  bash: ['rm', 'unlink'],
}

/** Longest stored prompt preview; the timeline ellipsizes beyond this. */
const PROMPT_PREVIEW_MAX = 60

/** The driving user message of one mutation: its durable id and bounded preview. */
interface UserMessageRef {
  /**
   * The message's stable id, the timeline's grouping key: every snapshot of
   * one message shares it, so the timeline shows one row per message and one
   * rollback restores all of the message's changes. Absent only on legacy
   * hosts whose user/message events carry no id.
   */
  id?: string
  /**
   * Single-line preview used as the timeline row title; undefined when the
   * message carries no text (the row falls back to the file path).
   */
  preview?: string
}

/**
 * The most recent user-sourced message as a durable id plus a bounded
 * single-line preview, or undefined when the session log holds none. Injected
 * plugin context is skipped: the timeline labels each snapshot with the human
 * prompt that drove the mutation, not with harness bookkeeping.
 * @param session - the agent session whose event log carries the prompt.
 * @returns the message reference, or undefined when no user message is present.
 */
function latestUserMessage(session: { readonly events: readonly unknown[] }): UserMessageRef | undefined {
  const events = session.events as ReadonlyArray<{ type?: string; data?: unknown }>
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event === undefined || event.type !== 'user/message') continue
    const data = event.data as {
      id?: string
      content?: ReadonlyArray<{ type?: string; text?: string }>
      source?: { kind?: string }
    } | undefined
    if (data?.source?.kind !== 'user') continue
    // The first user-sourced message is this turn's driver, even when it
    // carries no text: grouping by an older message would fold this turn's
    // changes into the previous conversation.
    const text = (data.content ?? [])
      .filter(block => block?.type === 'text')
      .map(block => block?.text ?? '')
      .join('')
      .trim()
    if (text.length === 0) return { id: data.id }
    const singleLine = text.replace(/\s+/gu, ' ')
    const preview = singleLine.length <= PROMPT_PREVIEW_MAX
      ? singleLine
      : `${singleLine.slice(0, PROMPT_PREVIEW_MAX - 1)}…`
    return { id: data.id, preview }
  }
  return undefined
}

/**
 * Split a shell command into its statements on `;`, `&&`, `||`, and newlines
 * outside quotes, so a delete keyword is only matched at the start of a real
 * statement (the `Test-Path` half of `Remove-Item x; Test-Path x` stays its
 * own statement).
 * @param text - the shell command text.
 * @returns the trimmed non-empty statements.
 */
function shellStatements(text: string): string[] {
  const statements: string[] = []
  let start = 0
  let quote: '"' | "'" | undefined
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ';' || ch === '\n' || (ch === '&' && text[i + 1] === '&') || (ch === '|' && text[i + 1] === '|')) {
      statements.push(text.slice(start, i))
      if (ch === '&' || ch === '|') i++
      start = i + 1
    }
  }
  statements.push(text.slice(start))
  return statements.map(statement => statement.trim()).filter(statement => statement.length > 0)
}

/**
 * Split one statement into tokens, keeping single- and double-quoted strings
 * (which may contain spaces) as single tokens. Unbalanced quotes degrade
 * gracefully: the run up to the quote is one token.
 * @param statement - one shell statement.
 * @returns the statement's tokens.
 */
function shellTokens(statement: string): string[] {
  return [...statement.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/gu)].map(match => match[0])
}

/** Strip one surrounding quote pair from a shell path token. */
function unquote(token: string): string {
  if (token.length >= 2 && token[0] === token[token.length - 1] && (token[0] === '"' || token[0] === "'")) {
    return token.slice(1, -1)
  }
  return token
}

/**
 * Whether a path is a literal deletion target the snapshot can resolve: no
 * wildcards, no `$`/backtick variable expansion, no `~` home expansion.
 * @param path - the unquoted path text.
 * @returns true when the path is literal.
 */
function isLiteralPath(path: string): boolean {
  return path.length > 0 && !/[*?[]/u.test(path) && !/[$`]/u.test(path) && !path.startsWith('~')
}

/**
 * Install the pre-mutation snapshot hook. Only top-level model-dispatched
 * calls (an owning agent, no enclosing transport) are snapshotted, mirroring
 * the session-checkpoint-policy filter. A capture failure never blocks the
 * agent: it logs a warning and lets the tool run.
 *
 * @param ctx - plugin context that owns the listener.
 * @param makeStore - per-session snapshot store factory; the workspace cwd tags
 * the store's project for the project-wide quota.
 */
export function applyCapture(ctx: Context, makeStore: (sessionId: string, project?: string) => SnapshotStore): () => void {
  return ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    if (exec.agent === undefined || exec.parent !== undefined) return next()
    if (MUTATING_TOOLS.has(exec.name)) {
      const filePath = (exec.arguments as { file_path?: unknown }).file_path
      if (typeof filePath !== 'string' || filePath.length === 0) return next()
      try {
        const target = await ctx.fs.resolve(filePath, {
          cwd: exec.agent.session.header.cwd,
          signal: exec.signal,
        })
        if (exec.signal.aborted) return next()
        let before: string | null = null
        try {
          before = await ctx.fs.readText(target, exec.signal)
        } catch (error: unknown) {
          // ENOENT (or an unreadable file) is recorded as a create.
          before = null
        }
        // 触发本快照的用户消息:其 id 把同一对话的多处修改归为一组,预览作为时间线标题。
        const message = latestUserMessage(exec.agent.session as { readonly events: readonly unknown[] })
        await makeStore(exec.agent.session.id, exec.agent.session.header.cwd).append({
          tool: exec.name === 'edit' ? 'edit' : 'write',
          path: target.displayPath,
          before,
          after: null,
          // 顶层调用即模型请求的根调用;callId 让前端撤回按钮能反查本快照。
          callId: exec.callId,
          group: message?.id,
          prompt: message?.preview,
        })
      } catch (error: unknown) {
        ctx.logger.warn('[dsh-snapshot] failed to snapshot %s: %o', exec.name, error)
      }
      return next()
    }
    // Shell deletion: snapshot each literal target file's content before the
    // command runs, so a rollback can restore the deleted file. Only files
    // that currently exist are recorded — deleting a missing file is a no-op,
    // and a `before: null` record would read as a creation in the timeline.
    if (exec.name === 'bash' || exec.name === 'pwsh') {
      const command = (exec.arguments as { command?: unknown }).command
      if (typeof command !== 'string' || command.length === 0) return next()
      try {
        // 同一对话的删除与写入/编辑共享分组与预览。
        const message = latestUserMessage(exec.agent.session as { readonly events: readonly unknown[] })
        const store = makeStore(exec.agent.session.id, exec.agent.session.header.cwd)
        const keywords = DELETE_KEYWORDS[exec.name]
        for (const statement of shellStatements(command)) {
          const first = shellTokens(statement)[0]?.toLowerCase()
          if (first === undefined || !keywords.includes(first)) continue
          // Collect literal paths: skip flags, break on redirects/pipes, and
          // drop any token that names a path we cannot resolve.
          const paths: string[] = []
          let whatIf = false
          for (const raw of shellTokens(statement).slice(1)) {
            let token = raw
            const lower = token.toLowerCase()
            if (token.startsWith('-')) {
              // pwsh `-WhatIf` only previews the deletion; nothing is removed.
              if (exec.name === 'pwsh' && lower === '-whatif') whatIf = true
              continue
            }
            if (token.includes('>') || token.includes('<') || token === '|' || token === '&') break
            // pwsh lists several paths comma-separated: `a.txt, b.txt`.
            if (token.endsWith(',')) token = token.slice(0, -1)
            if (token.length === 0 || token === ',') continue
            const path = unquote(token)
            if (isLiteralPath(path)) paths.push(path)
          }
          if (whatIf || paths.length === 0) continue
          for (const path of paths) {
            try {
              const target = await ctx.fs.resolve(path, {
                cwd: exec.agent.session.header.cwd,
                signal: exec.signal,
              })
              if (exec.signal.aborted) return next()
              let before: string | null = null
              try {
                before = await ctx.fs.readText(target, exec.signal)
              } catch (error: unknown) {
                // 文件不存在或不可读:删除无从恢复,不记录。
                before = null
              }
              if (before === null) continue
              await store.append({
                tool: 'delete',
                path: target.displayPath,
                before,
                after: null,
                callId: exec.callId,
                group: message?.id,
                prompt: message?.preview,
              })
            } catch (error: unknown) {
              ctx.logger.warn('[dsh-snapshot] failed to snapshot delete of %s: %o', path, error)
            }
          }
        }
      } catch (error: unknown) {
        ctx.logger.warn('[dsh-snapshot] failed to snapshot shell command %s: %o', exec.name, error)
      }
    }
    return next()
  })
}

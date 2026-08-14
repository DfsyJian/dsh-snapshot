/**
 * Pre-mutation snapshot hook: wraps the `tools/execute` waterfall so every
 * top-level model-dispatched write/edit is preceded by a snapshot of the
 * target file's current content.
 * @module dsh-snapshot/capture
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type { SnapshotStore } from './snapshot-store.js'

/** Tools whose pre-mutation state the plugin snapshots. */
const MUTATING_TOOLS = new Set(['write', 'edit'])

/** Longest stored prompt preview; the timeline ellipsizes beyond this. */
const PROMPT_PREVIEW_MAX = 60

/**
 * The most recent user-sourced message text as a single bounded line, or
 * undefined when the session log holds none. Injected plugin context is
 * skipped: the timeline labels each snapshot with the human prompt that
 * drove the mutation, not with harness bookkeeping.
 * @param session - the agent session whose event log carries the prompt.
 * @returns the preview, or undefined when no user message is present.
 */
function latestUserPrompt(session: { readonly events: readonly unknown[] }): string | undefined {
  const events = session.events as ReadonlyArray<{ type?: string; data?: unknown }>
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event === undefined || event.type !== 'user/message') continue
    const data = event.data as {
      content?: ReadonlyArray<{ type?: string; text?: string }>
      source?: { kind?: string }
    } | undefined
    if (data?.source?.kind !== 'user') continue
    const text = (data.content ?? [])
      .filter(block => block?.type === 'text')
      .map(block => block?.text ?? '')
      .join('')
      .trim()
    if (text.length === 0) continue
    const singleLine = text.replace(/\s+/gu, ' ')
    return singleLine.length <= PROMPT_PREVIEW_MAX
      ? singleLine
      : `${singleLine.slice(0, PROMPT_PREVIEW_MAX - 1)}…`
  }
  return undefined
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
    if (!MUTATING_TOOLS.has(exec.name)) return next()
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
      await makeStore(exec.agent.session.id, exec.agent.session.header.cwd).append({
        tool: exec.name === 'edit' ? 'edit' : 'write',
        path: target.displayPath,
        before,
        after: null,
        // 顶层调用即模型请求的根调用;callId 让前端撤回按钮能反查本快照。
        callId: exec.callId,
        // 用户消息预览让时间线能按“触发它的对话”标注每个快照。
        prompt: latestUserPrompt(exec.agent.session as { readonly events: readonly unknown[] }),
      })
    } catch (error: unknown) {
      ctx.logger.warn('[dsh-snapshot] failed to snapshot %s: %o', exec.name, error)
    }
    return next()
  })
}

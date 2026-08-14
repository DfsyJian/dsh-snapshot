/**
 * Browser-half shared types: the injected business face the sidebar snapshot
 * timeline receives. All server communication reuses the existing commands
 * Remote (`/rollback`), so no new host API is needed.
 * @module dsh-snapshot/client/types
 */

import type { CommandExecution } from '@deepseek-ai/dsh-commands/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Injected business face of every snapshot client entry. */
export interface SnapshotClientInjected {
  /**
   * Execute one `/rollback` command line (already confirmed) against a
   * session's agent; resolves with the command's settled result.
   * @param sessionId - target session (and agent) id.
   * @param line - complete slash-command line, e.g. `/rollback --call <callId> --yes`.
   */
  runRollback: (sessionId: SessionId, line: string) => Promise<RemoteResult<CommandExecution | undefined>>
}

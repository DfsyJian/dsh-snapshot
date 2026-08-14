/**
 * Version check for the browser half: the installed version baked into this
 * bundle at build time, plus a probe of the npm registry for the latest
 * release. Detection only — it reports a newer version and the upgrade
 * command, never runs an update itself.
 * @module dsh-snapshot/client/update-check
 */

/** The version tsdown inlines from package.json at build time. */
declare const __DSH_SNAPSHOT_VERSION__: string

/** Installed package version, resolved from the build-time constant. */
export const CURRENT_VERSION: string = __DSH_SNAPSHOT_VERSION__

/** The npm registry endpoint for this package's latest release. */
const LATEST_URL = 'https://registry.npmjs.org/dsh-snapshot/latest'

/**
 * Compare two `x.y.z` versions numerically.
 * @param a - left version.
 * @param b - right version.
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const left = pa[index] ?? 0
    const right = pb[index] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/**
 * Probe the npm registry for the latest published version.
 * @returns the latest version string, or undefined on any failure.
 */
export async function fetchLatestVersion(): Promise<string | undefined> {
  try {
    const response = await fetch(LATEST_URL)
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return undefined
    const version = (body as Record<string, unknown>).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

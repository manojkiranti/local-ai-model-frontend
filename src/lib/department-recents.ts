/**
 * Recently used RAG scopes, kept so the picker can surface the two or three
 * departments a user actually works in instead of an alphabetical wall.
 *
 * This is a local UI preference, not conversation state: the gateway still owns
 * sessions and their department binding, and nothing here is ever sent to it.
 */

export const RECENT_DEPARTMENTS_KEY = 'workspace.recentDepartments'

const MAX_RECENTS = 3

/** Reads the stored codes, newest first. Never throws on unusable storage. */
export function readRecentDepartments(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_DEPARTMENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((code): code is string => typeof code === 'string').slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

/** Records `code` as the most recent scope. `null` (General) is not a recent. */
export function rememberDepartment(code: string | null): void {
  if (!code) return
  try {
    const next = [code, ...readRecentDepartments().filter((entry) => entry !== code)]
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(next.slice(0, MAX_RECENTS)))
  } catch {
    // A full or unavailable localStorage must not break scope selection.
  }
}

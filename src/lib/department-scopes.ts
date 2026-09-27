import type { Department, DepartmentRole } from '@/lib/api'

/**
 * Weakest -> strongest. The INDEX is the rank, which makes "at least editor" one
 * comparison at every call site. This is the only copy of the ordering on the
 * client — rank it here, render it here, and nowhere else; the gateway holds the
 * authoritative copy and remains the security boundary either way.
 */
export const DEPARTMENT_LEVELS: readonly DepartmentRole[] = ['viewer', 'editor', 'owner']

function rankOf(level: string | null | undefined): number | null {
  const rank = DEPARTMENT_LEVELS.indexOf(level as DepartmentRole)
  return rank === -1 ? null : rank
}

/**
 * Is this one of the three levels? `role` is required and closed in the
 * contract, so a value that fails this means the gateway predates
 * per-department roles — worth SAYING, not just failing closed on.
 */
export function isDepartmentRole(level: string | null | undefined): level is DepartmentRole {
  return rankOf(level) !== null
}

/**
 * Does `role` meet or exceed `minimum`?
 *
 * Fails closed on anything that is not a department level: `undefined` (a
 * gateway that predates per-department roles sends no `role`), a global role
 * like `admin`, or a level in the wrong case. None of those may compare as
 * rank 0 and pass the viewer check.
 */
export function atLeast(role: string | null | undefined, minimum: DepartmentRole): boolean {
  const held = rankOf(role)
  const required = rankOf(minimum)
  if (held === null || required === null) return false
  return held >= required
}

/** Does the caller hold `minimum` anywhere? Gates the entry point to the RAG
 *  screen, which is per-department once you are inside it. */
export function hasAnyDepartmentAtLeast(
  departments: Department[],
  minimum: DepartmentRole,
): boolean {
  return departments.some((department) => atLeast(department.role, minimum))
}

/** One selectable chat scope: a department, or `null` for general chat. */
export type ScopeOption = { code: string | null; label: string; hint: string }

export const GENERAL_SCOPE: ScopeOption = {
  code: null,
  label: 'General',
  hint: 'No documents searched',
}

/** Active departments as options, alphabetical so a long list stays scannable. */
export function scopeOptions(departments: Department[]): ScopeOption[] {
  return departments
    .filter((department) => department.is_active)
    .map((department) => ({ code: department.code, label: department.name, hint: department.code }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * NRB directives and circulars are public regulatory documents, so the gateway
 * grants this department to every account. That makes it the one department
 * almost everyone holds, and so the fallback when nothing else says where a
 * user works.
 */
export const LAUNCH_FALLBACK_DEPARTMENT = 'nrb'

/**
 * Active departments in the order a user is most likely to want them: recently
 * used here (newest first), then NRB, then the rest by name. `recents` is only a
 * hint — a code the caller no longer holds, or whose department was disabled,
 * is skipped rather than offered.
 */
export function rankedDepartments(departments: Department[], recents: string[]): ScopeOption[] {
  const options = scopeOptions(departments)
  const ranked: ScopeOption[] = []
  const take = (option: ScopeOption | undefined) => {
    if (option && !ranked.includes(option)) ranked.push(option)
  }
  const byCode = (code: string) => options.find((option) => option.code === code)
  for (const code of recents) take(byCode(code))
  take(byCode(LAUNCH_FALLBACK_DEPARTMENT))
  for (const option of options) take(option)
  return ranked
}

/**
 * The scope a fresh workspace opens in. General chat searches no documents, and
 * most document questions asked there went unanswered, so a user starts in a
 * department and General is chosen only by someone who holds none.
 */
export function launchDepartment(departments: Department[], recents: string[]): string | null {
  return rankedDepartments(departments, recents)[0]?.code ?? null
}

/** Departments are not uniquely named, so a search must also match the code. */
export function scopeMatches(option: ScopeOption, query: string): boolean {
  const needle = query.toLowerCase()
  return (
    option.label.toLowerCase().includes(needle) || (option.code ?? '').toLowerCase().includes(needle)
  )
}

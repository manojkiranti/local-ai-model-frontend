import type { Department } from '@/lib/api'

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

/** Departments are not uniquely named, so a search must also match the code. */
export function scopeMatches(option: ScopeOption, query: string): boolean {
  const needle = query.toLowerCase()
  return (
    option.label.toLowerCase().includes(needle) || (option.code ?? '').toLowerCase().includes(needle)
  )
}

/** Client-side auth form validation. Server remains the source of truth. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emailError(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Email is required.'
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address.'
  return null
}

export function passwordError(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  return null
}

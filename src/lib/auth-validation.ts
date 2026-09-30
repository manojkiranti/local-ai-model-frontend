/** Client-side auth form validation. Server remains the source of truth. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emailError(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Email is required.'
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address.'
  return null
}

// A bare network username, optionally with a Windows domain prefix
// (NICASIA\shristi.b). Mirrors the gateway's app/auth/login_name.py, which maps
// it to `<username>@<LOGIN_EMAIL_DOMAIN>` and stays the source of truth.
const USERNAME_RE = /^(?:[^\s\\@]+\\)?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Sign-in accepts a username OR an email; registration still needs an email. */
export function loginNameError(value: string): string | null {
  const name = value.trim()
  if (!name) return 'Username or email is required.'
  if (name.includes('@')) return emailError(name)
  if (!USERNAME_RE.test(name)) return 'Enter a valid username or email address.'
  return null
}

export function passwordError(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  return null
}

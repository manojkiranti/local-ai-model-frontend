import { describe, expect, it } from 'vitest'
import { emailError, passwordError } from '@/lib/auth-validation'

describe('emailError', () => {
  it('rejects an empty email', () => {
    expect(emailError('')).toBe('Email is required.')
  })
  it('rejects a malformed email', () => {
    expect(emailError('not-an-email')).toBe('Enter a valid email address.')
  })
  it('accepts a valid email (trimmed)', () => {
    expect(emailError('  user@example.com ')).toBeNull()
  })
})

describe('passwordError', () => {
  it('rejects passwords shorter than 8 chars', () => {
    expect(passwordError('short')).toBe('Password must be at least 8 characters.')
  })
  it('accepts an 8-char password', () => {
    expect(passwordError('supersecret123')).toBeNull()
  })
})

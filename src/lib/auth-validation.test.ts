import { describe, expect, it } from 'vitest'
import { emailError, loginNameError, passwordError } from '@/lib/auth-validation'

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

describe('loginNameError', () => {
  it('accepts a bare username', () => {
    expect(loginNameError('shristi.b')).toBeNull()
    expect(loginNameError('  user_01-x ')).toBeNull()
  })
  it('accepts a Windows domain prefix', () => {
    expect(loginNameError('NICASIA\\shristi.b')).toBeNull()
  })
  it('accepts a full email', () => {
    expect(loginNameError('workspace-admin@example.com')).toBeNull()
  })
  it('rejects an empty name', () => {
    expect(loginNameError('  ')).toBe('Username or email is required.')
  })
  it('rejects a malformed email', () => {
    expect(loginNameError('user@')).toBe('Enter a valid email address.')
  })
  it('rejects a username with spaces or slashes', () => {
    expect(loginNameError('shristi b')).toBe('Enter a valid username or email address.')
    expect(loginNameError('shristi/b')).toBe('Enter a valid username or email address.')
  })
})

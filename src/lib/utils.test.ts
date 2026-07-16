import { describe, expect, it, vi } from 'vitest'
import { formatRelativeDate, getErrorMessage } from './utils'

describe('utility functions', () => {
  it('formats recent timestamps for the workspace', () => {
    vi.setSystemTime(new Date('2026-07-16T10:00:00Z'))
    expect(formatRelativeDate('2026-07-16T09:58:00Z')).toBe('2 minutes ago')
    vi.useRealTimers()
  })

  it('sanitizes unknown error values', () => {
    expect(getErrorMessage(new Error('Unavailable'))).toBe('Unavailable')
    expect(getErrorMessage({ detail: 'internal' })).toBe(
      'Something went wrong. Please try again.',
    )
  })
})

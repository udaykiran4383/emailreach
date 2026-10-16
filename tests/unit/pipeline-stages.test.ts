import { describe, expect, it } from 'vitest'
import { STAGES, isStage, nextStage, stageAtLeast } from '@/lib/pipeline/stages'

describe('pipeline stages', () => {
  it('lists stages in board order', () => {
    expect(STAGES).toEqual(['target', 'contacted', 'replied', 'interview', 'offer', 'rejected'])
  })

  it('only moves forward', () => {
    expect(nextStage(null, 'contacted')).toBe('contacted')
    expect(nextStage('target', 'contacted')).toBe('contacted')
    expect(nextStage('interview', 'replied')).toBe('interview')
    expect(nextStage('replied', 'replied')).toBe('replied')
    expect(nextStage('offer', 'interview')).toBe('offer')
    expect(nextStage('contacted', 'offer')).toBe('offer')
  })

  it('treats rejected as reachable from anywhere and terminal', () => {
    expect(nextStage('interview', 'rejected')).toBe('rejected')
    expect(nextStage('target', 'rejected')).toBe('rejected')
    expect(nextStage('rejected', 'replied')).toBe('rejected')
    expect(nextStage('rejected', 'offer')).toBe('rejected')
  })

  it('compares stages', () => {
    expect(stageAtLeast('interview', 'replied')).toBe(true)
    expect(stageAtLeast('contacted', 'replied')).toBe(false)
    expect(stageAtLeast('rejected', 'contacted')).toBe(false)
    expect(isStage('offer')).toBe(true)
    expect(isStage('nope')).toBe(false)
  })
})

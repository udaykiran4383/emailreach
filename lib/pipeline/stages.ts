/**
 * Pure stage-ordering rules for the application pipeline.
 * Stages only move forward automatically; 'rejected' can be reached from any stage.
 */

export type Stage = 'target' | 'contacted' | 'replied' | 'interview' | 'offer' | 'rejected'

export const STAGES: Stage[] = ['target', 'contacted', 'replied', 'interview', 'offer', 'rejected']

export const STAGE_LABELS: Record<Stage, string> = {
  target: 'Target',
  contacted: 'Contacted',
  replied: 'Replied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
}

// Progress order for the forward-only rule ('rejected' handled separately)
const RANK: Record<Exclude<Stage, 'rejected'>, number> = {
  target: 0,
  contacted: 1,
  replied: 2,
  interview: 3,
  offer: 4,
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as string[]).includes(value)
}

/**
 * Stage to store when an automatic event wants to move `current` to `requested`.
 * - rejected is terminal: once rejected, automatic events never revive it
 * - rejected can be requested from any stage
 * - otherwise only forward moves are applied
 */
export function nextStage(current: Stage | null | undefined, requested: Stage): Stage {
  if (!current) return requested
  if (current === 'rejected') return 'rejected'
  if (requested === 'rejected') return 'rejected'
  return RANK[requested] > RANK[current] ? requested : current
}

/** True when stage counts toward "reached at least `min`" (rejected counts as nothing). */
export function stageAtLeast(stage: Stage, min: Exclude<Stage, 'rejected'>): boolean {
  if (stage === 'rejected') return false
  return RANK[stage] >= RANK[min]
}

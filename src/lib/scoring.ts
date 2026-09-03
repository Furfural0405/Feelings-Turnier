import type { ParticipantStats, RoundStats, ScoringWeights } from '../types'

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  kill: 1,
  assist: 1,
  death: 1.5,
  positiveBonus: 3,
  negativePenalty: 3,
}

export const emptyRoundStats = (): RoundStats => ({ kills: 0, assists: 0, deaths: 0 })

export function emptyParticipantStats(roundCount = 3): ParticipantStats {
  const safeCount = Math.max(1, Math.min(7, Math.trunc(roundCount)))
  return {
    rounds: Array.from({ length: safeCount }, emptyRoundStats),
  }
}

export function normalizeParticipantStats(stats: ParticipantStats | undefined, roundCount: number): ParticipantStats {
  const safeCount = Math.max(1, Math.min(7, Math.trunc(roundCount)))
  const existing = Array.isArray(stats?.rounds) ? stats!.rounds : []
  return {
    rounds: Array.from({ length: safeCount }, (_, index) => existing[index] ? { ...existing[index] } : emptyRoundStats()),
  }
}

export function calculateRoundScore(
  stats: RoundStats,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  const base = stats.kills * weights.kill
    + stats.assists * weights.assist
    - stats.deaths * weights.death

  // Ob eine Runde positiv oder negativ ist, richtet sich weiterhin nach den
  // tatsächlichen KDA-Werten und nicht nach der eingestellten Gewichtung.
  const combatBalance = stats.kills + stats.assists - stats.deaths
  const bonus = combatBalance > 0
    ? weights.positiveBonus
    : combatBalance < 0
      ? -weights.negativePenalty
      : 0

  return base + bonus
}

export function calculateTotalScore(
  stats: ParticipantStats,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  return stats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, weights), 0)
}

export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1)
}

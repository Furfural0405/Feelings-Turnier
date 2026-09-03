import type { ParticipantStats, RoundStats } from '../types'

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

export function calculateRoundScore(stats: RoundStats): number {
  const base = stats.kills + stats.assists - stats.deaths * 1.5
  const combatBalance = stats.kills + stats.assists - stats.deaths
  const bonus = combatBalance > 0 ? 3 : combatBalance < 0 ? -3 : 0
  return base + bonus
}

export function calculateTotalScore(stats: ParticipantStats): number {
  return stats.rounds.reduce((sum, round) => sum + calculateRoundScore(round), 0)
}

export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1)
}

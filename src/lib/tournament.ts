import { calculateTotalScore, emptyParticipantStats } from './scoring'
import type {
  KnockoutBracket,
  KnockoutMatch,
  Participant,
  ParticipantStats,
  StandingRow,
  TournamentGroup,
} from '../types'

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function distributeIntoGroups(participants: Participant[], groupCount: number): TournamentGroup[] {
  const safeCount = Math.max(1, Math.min(10, Math.trunc(groupCount)))
  const randomized = shuffle(participants)
  const groups: TournamentGroup[] = Array.from({ length: safeCount }, (_, index) => ({
    id: `group-${index + 1}`,
    name: `Gruppe ${String.fromCharCode(65 + index)}`,
    participantIds: [],
  }))

  randomized.forEach((participant, index) => {
    groups[index % safeCount].participantIds.push(participant.id)
  })

  return groups
}

export function buildStandings(
  group: TournamentGroup,
  participants: Participant[],
  stats: Record<string, ParticipantStats>,
): StandingRow[] {
  const participantMap = new Map(participants.map((participant) => [participant.id, participant]))

  return group.participantIds
    .map((participantId) => {
      const participant = participantMap.get(participantId)
      const participantStats = stats[participantId] ?? emptyParticipantStats()
      const kills = participantStats.rounds.reduce((sum, round) => sum + round.kills, 0)
      const assists = participantStats.rounds.reduce((sum, round) => sum + round.assists, 0)
      const deaths = participantStats.rounds.reduce((sum, round) => sum + round.deaths, 0)

      return {
        participantId,
        name: participant?.name ?? 'Unbekannt',
        totalPoints: calculateTotalScore(participantStats),
        kills,
        assists,
        deaths,
      }
    })
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
      const aParticipation = a.kills + a.assists
      const bParticipation = b.kills + b.assists
      if (bParticipation !== aParticipation) return bParticipation - aParticipation
      if (a.deaths !== b.deaths) return a.deaths - b.deaths
      return a.name.localeCompare(b.name, 'de')
    })
}

export function qualifierCount(groupSize: number): number {
  if (groupSize < 2) return groupSize
  let result = 1
  while (result * 2 <= groupSize) result *= 2
  return result
}

function seededPositions(size: number): number[] {
  if (size <= 1) return [1]
  let seeds = [1, 2]
  let currentSize = 2

  while (currentSize < size) {
    const nextSize = currentSize * 2
    const nextSeeds: number[] = []
    seeds.forEach((seed) => {
      nextSeeds.push(seed, nextSize + 1 - seed)
    })
    seeds = nextSeeds
    currentSize = nextSize
  }

  return seeds
}

export function createKnockoutBracket(groupId: string, orderedQualifierIds: string[]): KnockoutBracket {
  const size = orderedQualifierIds.length
  const rounds: KnockoutMatch[][] = []

  if (size >= 2) {
    const seedOrder = seededPositions(size)
    const firstRound: KnockoutMatch[] = []

    for (let i = 0; i < seedOrder.length; i += 2) {
      const firstSeed = seedOrder[i]
      const secondSeed = seedOrder[i + 1]
      firstRound.push({
        id: `${groupId}-r0-m${i / 2}`,
        player1Id: orderedQualifierIds[firstSeed - 1] ?? null,
        player2Id: orderedQualifierIds[secondSeed - 1] ?? null,
        winnerId: null,
      })
    }
    rounds.push(firstRound)

    let matchesInNextRound = firstRound.length / 2
    let roundIndex = 1
    while (matchesInNextRound >= 1) {
      rounds.push(
        Array.from({ length: matchesInNextRound }, (_, matchIndex) => ({
          id: `${groupId}-r${roundIndex}-m${matchIndex}`,
          player1Id: null,
          player2Id: null,
          winnerId: null,
        })),
      )
      matchesInNextRound /= 2
      roundIndex += 1
    }
  }

  return {
    groupId,
    qualifierIds: orderedQualifierIds,
    createdAt: new Date().toISOString(),
    rounds,
  }
}

export function updateBracketWinner(
  bracket: KnockoutBracket,
  roundIndex: number,
  matchIndex: number,
  winnerId: string | null,
): KnockoutBracket {
  const rounds = bracket.rounds.map((round) => round.map((match) => ({ ...match })))
  const target = rounds[roundIndex]?.[matchIndex]
  if (!target) return bracket

  const allowed = [target.player1Id, target.player2Id].filter(Boolean)
  target.winnerId = winnerId && allowed.includes(winnerId) ? winnerId : null

  for (let r = roundIndex + 1; r < rounds.length; r += 1) {
    const previousRound = rounds[r - 1]
    rounds[r].forEach((match, index) => {
      const player1Id = previousRound[index * 2]?.winnerId ?? null
      const player2Id = previousRound[index * 2 + 1]?.winnerId ?? null
      match.player1Id = player1Id
      match.player2Id = player2Id
      if (match.winnerId !== player1Id && match.winnerId !== player2Id) {
        match.winnerId = null
      }
    })
  }

  return { ...bracket, rounds }
}

export function roundName(totalPlayers: number, roundIndex: number): string {
  const playersInRound = totalPlayers / 2 ** roundIndex
  if (playersInRound === 2) return 'Finale'
  if (playersInRound === 4) return 'Halbfinale'
  if (playersInRound === 8) return 'Viertelfinale'
  if (playersInRound === 16) return 'Achtelfinale'
  return `Runde der letzten ${playersInRound}`
}

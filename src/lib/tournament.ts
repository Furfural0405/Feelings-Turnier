import { calculateTotalScore, emptyParticipantStats } from './scoring'
import type {
  KnockoutBracket,
  KnockoutMatch,
  Participant,
  ParticipantStats,
  QualificationPlan,
  QualifiedPlayer,
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

function isPowerOfTwo(value: number): boolean {
  return value >= 2 && (value & (value - 1)) === 0
}

/**
 * Creates a fair tournament plan that can feed directly into one global KO bracket.
 *
 * Rules:
 * - at least Top 2 per group qualify,
 * - never more than 50% of the smallest group qualify,
 * - total KO field is a power of two (2..32),
 * - if the requested group count cannot produce such a field, the group count is
 *   reduced automatically. This is why 50 players + 10 requested groups becomes
 *   8 groups x Top 2 = 16 qualifiers.
 */
export function createQualificationPlan(participantCount: number, requestedGroupCount: number): QualificationPlan | null {
  const participants = Math.max(0, Math.trunc(participantCount))
  const requested = Math.max(1, Math.min(10, Math.trunc(requestedGroupCount)))

  if (participants < 4) return null

  const maximumGroups = Math.min(requested, participants)

  for (let groupCount = maximumGroups; groupCount >= 1; groupCount -= 1) {
    const smallestGroupSize = Math.floor(participants / groupCount)
    const maxPerGroupByHalfRule = Math.floor(smallestGroupSize / 2)
    const maxPerGroupByBracket = Math.floor(32 / groupCount)
    const maxQualifiersPerGroup = Math.min(maxPerGroupByHalfRule, maxPerGroupByBracket)

    for (let qualifiersPerGroup = maxQualifiersPerGroup; qualifiersPerGroup >= 2; qualifiersPerGroup -= 1) {
      const knockoutSize = groupCount * qualifiersPerGroup
      if (!isPowerOfTwo(knockoutSize) || knockoutSize > 32) continue

      return {
        groupCount,
        qualifiersPerGroup,
        knockoutSize,
        adjustedFromGroupCount: groupCount === requested ? null : requested,
      }
    }
  }

  return null
}

export function createQualificationPlanForExistingGroups(
  participantCount: number,
  groupCount: number,
): QualificationPlan | null {
  const plan = createQualificationPlan(participantCount, groupCount)
  if (!plan || plan.groupCount !== groupCount) return null
  return plan
}

function groupIndex(groupId: string, groups: TournamentGroup[]): number {
  const index = groups.findIndex((group) => group.id === groupId)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function pairFootballStyle(qualifiers: QualifiedPlayer[], groups: TournamentGroup[]): KnockoutMatch[] {
  if (qualifiers.length < 2) return []

  const qualifiersPerGroup = Math.max(...qualifiers.map((qualifier) => qualifier.groupRank))
  const highRankLimit = Math.ceil(qualifiersPerGroup / 2)
  const highSeeds = qualifiers
    .filter((qualifier) => qualifier.groupRank <= highRankLimit)
    .sort((a, b) => a.groupRank - b.groupRank || groupIndex(a.groupId, groups) - groupIndex(b.groupId, groups))
  const lowSeeds = qualifiers
    .filter((qualifier) => qualifier.groupRank > highRankLimit)
    .sort((a, b) => b.groupRank - a.groupRank || groupIndex(a.groupId, groups) - groupIndex(b.groupId, groups))

  // With the allowed plan sizes qualifiersPerGroup is always even. Keep a safe
  // fallback so imported legacy data cannot break the bracket.
  if (highSeeds.length !== lowSeeds.length) {
    const ordered = [...qualifiers].sort(
      (a, b) => a.groupRank - b.groupRank || groupIndex(a.groupId, groups) - groupIndex(b.groupId, groups),
    )
    return Array.from({ length: ordered.length / 2 }, (_, matchIndex) => ({
      id: `ko-r0-m${matchIndex}`,
      player1Id: ordered[matchIndex]?.participantId ?? null,
      player2Id: ordered[ordered.length - 1 - matchIndex]?.participantId ?? null,
      winnerId: null,
    }))
  }

  const unusedLow = [...lowSeeds]
  const matches: KnockoutMatch[] = []

  highSeeds.forEach((highSeed, matchIndex) => {
    const expectedOpponentRank = qualifiersPerGroup + 1 - highSeed.groupRank
    const sourceGroupIndex = groupIndex(highSeed.groupId, groups)

    let bestIndex = -1
    let bestScore = Number.MAX_SAFE_INTEGER

    unusedLow.forEach((lowSeed, candidateIndex) => {
      const sameGroupPenalty = lowSeed.groupId === highSeed.groupId && groups.length > 1 ? 100_000 : 0
      const rankPenalty = Math.abs(lowSeed.groupRank - expectedOpponentRank) * 1_000
      const targetGroupIndex = groups.length > 1 ? (sourceGroupIndex + 1) % groups.length : sourceGroupIndex
      const candidateGroupIndex = groupIndex(lowSeed.groupId, groups)
      const groupDistance = Math.abs(candidateGroupIndex - targetGroupIndex)
      const score = sameGroupPenalty + rankPenalty + groupDistance

      if (score < bestScore) {
        bestScore = score
        bestIndex = candidateIndex
      }
    })

    const opponent = bestIndex >= 0 ? unusedLow.splice(bestIndex, 1)[0] : null
    matches.push({
      id: `ko-r0-m${matchIndex}`,
      player1Id: highSeed.participantId,
      player2Id: opponent?.participantId ?? null,
      winnerId: null,
    })
  })

  return matches
}

export function createGlobalKnockoutBracket(
  groups: TournamentGroup[],
  participants: Participant[],
  stats: Record<string, ParticipantStats>,
  qualifiersPerGroup: number,
): KnockoutBracket {
  const qualifiers: QualifiedPlayer[] = groups.flatMap((group) =>
    buildStandings(group, participants, stats)
      .slice(0, qualifiersPerGroup)
      .map((row, index) => ({
        participantId: row.participantId,
        groupId: group.id,
        groupName: group.name,
        groupRank: index + 1,
      })),
  )

  const rounds: KnockoutMatch[][] = []
  const firstRound = pairFootballStyle(qualifiers, groups)

  if (firstRound.length > 0) {
    rounds.push(firstRound)
    let matchesInNextRound = firstRound.length / 2
    let roundIndex = 1

    while (matchesInNextRound >= 1) {
      rounds.push(
        Array.from({ length: matchesInNextRound }, (_, matchIndex) => ({
          id: `ko-r${roundIndex}-m${matchIndex}`,
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
    qualifierIds: qualifiers.map((qualifier) => qualifier.participantId),
    qualifiers,
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
  if (playersInRound === 32) return 'Sechzehntelfinale'
  return `Runde der letzten ${playersInRound}`
}

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
  return value >= 2 && value <= 32 && (value & (value - 1)) === 0
}

/**
 * Calculates the global football-style KO plan.
 *
 * Rules implemented from the tournament specification:
 * - the requested group count may be reduced automatically until a clean KO field exists,
 * - at least Top 2 of every group advance,
 * - never more than 50% of the smallest group advance,
 * - every group sends the same number of players,
 * - KO field must be 4/8/16/32 players (maximum start: round of 32),
 * - at least two groups are required so the first KO round can be cross-group.
 *
 * Preference order: keep the group count as close as possible to the user's request.
 * For that group count, admit the largest valid Top-X field, up to 32 players.
 */
export function createQualificationPlan(participantCount: number, requestedGroupCount: number): QualificationPlan | null {
  const participants = Math.max(0, Math.trunc(participantCount))
  const requested = Math.max(1, Math.min(10, Math.trunc(requestedGroupCount)))

  // 2 groups x Top 2 with the 50% rule requires at least 8 total players.
  if (participants < 8 || requested < 2) return null

  const maximumGroups = Math.min(requested, 10, Math.floor(participants / 4))

  for (let groupCount = maximumGroups; groupCount >= 2; groupCount -= 1) {
    const smallestGroupSize = Math.floor(participants / groupCount)
    const halfLimit = Math.floor(smallestGroupSize / 2)
    const bracketLimit = Math.floor(32 / groupCount)
    const maxQualifiersPerGroup = Math.min(halfLimit, bracketLimit)

    for (let qualifiersPerGroup = maxQualifiersPerGroup; qualifiersPerGroup >= 2; qualifiersPerGroup -= 1) {
      const knockoutSize = groupCount * qualifiersPerGroup
      if (!isPowerOfTwo(knockoutSize) || knockoutSize < 4) continue

      return {
        requestedGroupCount: requested,
        groupCount,
        qualifiersPerGroup,
        knockoutSize,
        adjusted: groupCount !== requested,
        smallestGroupSize,
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

function orderedGroupIndex(groups: TournamentGroup[]): Map<string, number> {
  return new Map(groups.map((group, index) => [group.id, index]))
}

/**
 * First KO round: high group seeds face low group seeds from a DIFFERENT group.
 * Top 2 example: A1-B2, B1-C2, ..., H1-A2.
 * Top 4 example: rank 1 vs rank 4 cross-group and rank 2 vs rank 3 cross-group.
 */
function pairFootballStyle(qualifiers: QualifiedPlayer[], groups: TournamentGroup[]): KnockoutMatch[] {
  if (groups.length < 2 || qualifiers.length < 4) return []

  const groupOrder = orderedGroupIndex(groups)
  const qualifiersPerGroup = Math.max(...qualifiers.map((qualifier) => qualifier.groupRank))
  const matches: KnockoutMatch[] = []
  const half = qualifiersPerGroup / 2

  for (let rankIndex = 0; rankIndex < half; rankIndex += 1) {
    const highRank = rankIndex + 1
    const lowRank = qualifiersPerGroup - rankIndex
    const highPot = qualifiers
      .filter((qualifier) => qualifier.groupRank === highRank)
      .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0))
    const lowPot = qualifiers
      .filter((qualifier) => qualifier.groupRank === lowRank)
      .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0))

    if (highPot.length !== groups.length || lowPot.length !== groups.length) return []

    // Rotate the lower seed pot. Any non-zero rotation guarantees a different source group.
    const rotation = groups.length === 2 ? 1 : (rankIndex % (groups.length - 1)) + 1

    highPot.forEach((highSeed, index) => {
      const lowSeed = lowPot[(index + rotation) % lowPot.length]
      matches.push({
        id: `ko-r0-m${matches.length}`,
        player1Id: highSeed.participantId,
        player2Id: lowSeed.participantId,
        winnerId: null,
      })
    })
  }

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

  const firstRound = pairFootballStyle(qualifiers, groups)
  const rounds: KnockoutMatch[][] = []

  if (firstRound.length * 2 !== qualifiers.length) {
    return {
      qualifierIds: qualifiers.map((qualifier) => qualifier.participantId),
      qualifiers,
      createdAt: new Date().toISOString(),
      rounds: [],
    }
  }

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

  // Every following round is derived from the previous winners. Changing an earlier
  // result automatically invalidates downstream results that no longer fit.
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

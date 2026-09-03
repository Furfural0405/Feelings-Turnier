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
  return value >= 4 && value <= 32 && (value & (value - 1)) === 0
}

/**
 * KO-Regeln:
 * - 4–7 Teilnehmer: immer vier Qualifikanten.
 *   - bei 1 Gruppe: Top 4 dieser Gruppe,
 *   - bei >=2 gewünschten Gruppen: automatisch 2 Gruppen, Top 2 je Gruppe.
 *   Die 50%-Grenze darf in diesem Sonderfall überschritten werden.
 * - ab 8 Teilnehmern: mindestens Top 2 je Gruppe, höchstens 50% der kleinsten Gruppe,
 *   gleiche Zahl Qualifikanten je Gruppe, KO-Feld 4/8/16/32, maximal Sechzehntelfinale.
 */
export function createQualificationPlan(participantCount: number, requestedGroupCount: number): QualificationPlan | null {
  const participants = Math.max(0, Math.trunc(participantCount))
  const requested = Math.max(1, Math.min(10, Math.trunc(requestedGroupCount)))

  if (participants < 4) return null

  if (participants < 8) {
    if (requested <= 1) {
      return {
        requestedGroupCount: requested,
        groupCount: 1,
        qualifiersPerGroup: 4,
        knockoutSize: 4,
        adjusted: false,
        smallestGroupSize: participants,
        smallTournamentOverride: true,
      }
    }

    return {
      requestedGroupCount: requested,
      groupCount: 2,
      qualifiersPerGroup: 2,
      knockoutSize: 4,
      adjusted: requested !== 2,
      smallestGroupSize: Math.floor(participants / 2),
      smallTournamentOverride: true,
    }
  }

  if (requested === 1) {
    const maxQualifiers = Math.min(32, Math.floor(participants / 2))
    for (const knockoutSize of [32, 16, 8, 4]) {
      if (knockoutSize <= maxQualifiers) {
        return {
          requestedGroupCount: requested,
          groupCount: 1,
          qualifiersPerGroup: knockoutSize,
          knockoutSize,
          adjusted: false,
          smallestGroupSize: participants,
          smallTournamentOverride: false,
        }
      }
    }
    return null
  }

  const maximumGroups = Math.min(requested, 10, Math.floor(participants / 4))

  for (let groupCount = maximumGroups; groupCount >= 2; groupCount -= 1) {
    const smallestGroupSize = Math.floor(participants / groupCount)
    const halfLimit = Math.floor(smallestGroupSize / 2)
    const bracketLimit = Math.floor(32 / groupCount)
    const maxQualifiersPerGroup = Math.min(halfLimit, bracketLimit)

    for (let qualifiersPerGroup = maxQualifiersPerGroup; qualifiersPerGroup >= 2; qualifiersPerGroup -= 1) {
      const knockoutSize = groupCount * qualifiersPerGroup
      if (!isPowerOfTwo(knockoutSize)) continue

      return {
        requestedGroupCount: requested,
        groupCount,
        qualifiersPerGroup,
        knockoutSize,
        adjusted: groupCount !== requested,
        smallestGroupSize,
        smallTournamentOverride: false,
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

function pairSingleGroup(qualifiers: QualifiedPlayer[]): KnockoutMatch[] {
  const sorted = [...qualifiers].sort((a, b) => a.groupRank - b.groupRank)
  const matches: KnockoutMatch[] = []
  for (let index = 0; index < sorted.length / 2; index += 1) {
    const high = sorted[index]
    const low = sorted[sorted.length - 1 - index]
    matches.push({
      id: `ko-r0-m${index}`,
      player1Id: high.participantId,
      player2Id: low.participantId,
      winnerId: null,
    })
  }
  return matches
}

/**
 * Mehrere Gruppen: hohe Gruppenplatzierung gegen niedrige Platzierung aus ANDERER Gruppe.
 * Top 2: A1-B2, B1-C2, ...; bei zwei Gruppen A1-B2 und B1-A2.
 * Top 4: #1 gegen #4 einer anderen Gruppe und #2 gegen #3 einer anderen Gruppe.
 */
function pairCrossGroup(qualifiers: QualifiedPlayer[], groups: TournamentGroup[]): KnockoutMatch[] {
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

  const firstRound = groups.length === 1 ? pairSingleGroup(qualifiers) : pairCrossGroup(qualifiers, groups)
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

  for (let r = roundIndex + 1; r < rounds.length; r += 1) {
    const previousRound = rounds[r - 1]
    rounds[r].forEach((match, index) => {
      const player1Id = previousRound[index * 2]?.winnerId ?? null
      const player2Id = previousRound[index * 2 + 1]?.winnerId ?? null
      match.player1Id = player1Id
      match.player2Id = player2Id
      if (match.winnerId !== player1Id && match.winnerId !== player2Id) match.winnerId = null
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
  return `Top ${playersInRound}`
}

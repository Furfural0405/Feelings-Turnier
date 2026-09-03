export type Participant = {
  id: string
  name: string
}

export type RoundStats = {
  kills: number
  assists: number
  deaths: number
}

export type ParticipantStats = {
  rounds: [RoundStats, RoundStats, RoundStats]
}

export type TournamentGroup = {
  id: string
  name: string
  participantIds: string[]
}

export type StandingRow = {
  participantId: string
  name: string
  totalPoints: number
  kills: number
  assists: number
  deaths: number
}

export type QualificationPlan = {
  requestedGroupCount: number
  groupCount: number
  qualifiersPerGroup: number
  knockoutSize: number
  adjusted: boolean
  smallestGroupSize: number
  smallTournamentException: boolean
}

export type QualifiedPlayer = {
  participantId: string
  groupId: string
  groupName: string
  groupRank: number
}

export type KnockoutMatch = {
  id: string
  player1Id: string | null
  player2Id: string | null
  winnerId: string | null
}

export type KnockoutBracket = {
  qualifierIds: string[]
  qualifiers: QualifiedPlayer[]
  createdAt: string
  rounds: KnockoutMatch[][]
}

export type TournamentState = {
  participants: Participant[]
  groupCount: number
  groups: TournamentGroup[]
  stats: Record<string, ParticipantStats>
  knockoutBracket: KnockoutBracket | null
}

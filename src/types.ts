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

export type KnockoutMatch = {
  id: string
  player1Id: string | null
  player2Id: string | null
  winnerId: string | null
}

export type KnockoutBracket = {
  groupId: string
  qualifierIds: string[]
  createdAt: string
  rounds: KnockoutMatch[][]
}

export type TournamentState = {
  participants: Participant[]
  groupCount: number
  groups: TournamentGroup[]
  stats: Record<string, ParticipantStats>
  brackets: Record<string, KnockoutBracket>
}

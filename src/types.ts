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
  rounds: RoundStats[]
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
  smallTournamentOverride: boolean
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
  kdaRoundCount: number
  stats: Record<string, ParticipantStats>
}

export type KnockoutBracket = {
  qualifierIds: string[]
  qualifiers: QualifiedPlayer[]
  createdAt: string
  rounds: KnockoutMatch[][]
}

export type HeroContent = {
  titleLine1: string
  titleLine2: string
  lead: string
  tags: string[]
}

export type ScoringWeights = {
  kill: number
  assist: number
  death: number
  positiveBonus: number
  negativePenalty: number
}

export type SiteBackgroundSettings = {
  enabled: boolean
  url: string
  path: string
  fit: 'cover' | 'contain'
  position: 'center top' | 'center center' | 'left top' | 'right top'
  repeat: 'no-repeat' | 'repeat' | 'repeat-y'
  opacity: number
  hideDefaultFloral: boolean
}

export type TournamentState = {
  participants: Participant[]
  groupCount: number
  groupRoundCount: number
  groups: TournamentGroup[]
  stats: Record<string, ParticipantStats>
  knockoutBracket: KnockoutBracket | null
}

export type StoredTournamentState = Omit<TournamentState, 'participants'>

export type AccessProfile = {
  id: string
  email: string
  approved: boolean
  role: 'viewer' | 'admin'
  is_creator: boolean
  access_status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

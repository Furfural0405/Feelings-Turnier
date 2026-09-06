from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise RuntimeError(f'Patch-Stelle nicht gefunden: {label}')


TYPES = r'''export type Participant = {
  id: string
  name: string
  teamSize: number
  members: string[]
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

export type GroupMatchResult = 'player1' | 'draw' | 'player2' | null

export type GroupMatch = {
  id: string
  groupId: string
  player1Id: string
  player2Id: string
  result: GroupMatchResult
}

export type CompetitionSettings = {
  teamSize: number
  winPoints: number
  drawPoints: number
  lossPoints: number
}

export type StandingRow = {
  participantId: string
  name: string
  totalPoints: number
  kills: number
  assists: number
  deaths: number
  wins: number
  draws: number
  losses: number
  matchPoints: number
  usesResults: boolean
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
  result: GroupMatchResult
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
  groupMatches: GroupMatch[]
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
'''

TOURNAMENT = r'''import { calculateTotalScore, DEFAULT_SCORING_WEIGHTS, emptyParticipantStats } from './scoring'
import type {
  CompetitionSettings,
  GroupMatch,
  GroupMatchResult,
  KnockoutBracket,
  KnockoutMatch,
  Participant,
  ParticipantStats,
  QualificationPlan,
  QualifiedPlayer,
  ScoringWeights,
  StandingRow,
  TournamentGroup,
} from '../types'

const DEFAULT_COMPETITION: CompetitionSettings = {
  teamSize: 1,
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
}

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

export function createGroupMatches(groups: TournamentGroup[]): GroupMatch[] {
  return groups.flatMap((group) => {
    const matches: GroupMatch[] = []
    for (let i = 0; i < group.participantIds.length; i += 1) {
      for (let j = i + 1; j < group.participantIds.length; j += 1) {
        matches.push({
          id: `${group.id}-m${matches.length + 1}`,
          groupId: group.id,
          player1Id: group.participantIds[i],
          player2Id: group.participantIds[j],
          result: null,
        })
      }
    }
    return matches
  })
}

export function buildStandings(
  group: TournamentGroup,
  participants: Participant[],
  stats: Record<string, ParticipantStats>,
  scoringWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  allMatches: GroupMatch[] = [],
  competition: CompetitionSettings = DEFAULT_COMPETITION,
): StandingRow[] {
  const participantMap = new Map(participants.map((participant) => [participant.id, participant]))
  const matches = allMatches.filter((match) => match.groupId === group.id)
  const usesResults = matches.some((match) => match.result !== null)

  const rows = group.participantIds.map((participantId) => {
    const participant = participantMap.get(participantId)
    const participantStats = stats[participantId] ?? emptyParticipantStats()
    const kills = participantStats.rounds.reduce((sum, round) => sum + round.kills, 0)
    const assists = participantStats.rounds.reduce((sum, round) => sum + round.assists, 0)
    const deaths = participantStats.rounds.reduce((sum, round) => sum + round.deaths, 0)
    let wins = 0
    let draws = 0
    let losses = 0

    for (const match of matches) {
      if (!match.result || (match.player1Id !== participantId && match.player2Id !== participantId)) continue
      if (match.result === 'draw') {
        draws += 1
      } else {
        const isPlayer1 = match.player1Id === participantId
        const won = (match.result === 'player1' && isPlayer1) || (match.result === 'player2' && !isPlayer1)
        if (won) wins += 1
        else losses += 1
      }
    }

    return {
      participantId,
      name: participant?.name ?? 'Unbekannt',
      totalPoints: calculateTotalScore(participantStats, scoringWeights),
      kills,
      assists,
      deaths,
      wins,
      draws,
      losses,
      matchPoints: wins * competition.winPoints + draws * competition.drawPoints + losses * competition.lossPoints,
      usesResults,
    }
  })

  return rows.sort((a, b) => {
    if (usesResults) {
      if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints
      if (b.wins !== a.wins) return b.wins - a.wins
    }
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

export function createQualificationPlan(participantCount: number, requestedGroupCount: number): QualificationPlan | null {
  const participants = Math.max(0, Math.trunc(participantCount))
  const requested = Math.max(1, Math.min(10, Math.trunc(requestedGroupCount)))
  if (participants < 4) return null

  if (participants < 8) {
    if (requested <= 1) {
      return { requestedGroupCount: requested, groupCount: 1, qualifiersPerGroup: 4, knockoutSize: 4, adjusted: false, smallestGroupSize: participants, smallTournamentOverride: true }
    }
    return { requestedGroupCount: requested, groupCount: 2, qualifiersPerGroup: 2, knockoutSize: 4, adjusted: requested !== 2, smallestGroupSize: Math.floor(participants / 2), smallTournamentOverride: true }
  }

  if (requested === 1) {
    const maxQualifiers = Math.min(32, Math.floor(participants / 2))
    for (const knockoutSize of [32, 16, 8, 4]) {
      if (knockoutSize <= maxQualifiers) {
        return { requestedGroupCount: requested, groupCount: 1, qualifiersPerGroup: knockoutSize, knockoutSize, adjusted: false, smallestGroupSize: participants, smallTournamentOverride: false }
      }
    }
    return null
  }

  const maximumGroups = Math.min(requested, 10, Math.floor(participants / 4))
  for (let groupCount = maximumGroups; groupCount >= 2; groupCount -= 1) {
    const smallestGroupSize = Math.floor(participants / groupCount)
    const maxQualifiersPerGroup = Math.min(Math.floor(smallestGroupSize / 2), Math.floor(32 / groupCount))
    for (let qualifiersPerGroup = maxQualifiersPerGroup; qualifiersPerGroup >= 2; qualifiersPerGroup -= 1) {
      const knockoutSize = groupCount * qualifiersPerGroup
      if (!isPowerOfTwo(knockoutSize)) continue
      return { requestedGroupCount: requested, groupCount, qualifiersPerGroup, knockoutSize, adjusted: groupCount !== requested, smallestGroupSize, smallTournamentOverride: false }
    }
  }
  return null
}

export function createQualificationPlanForExistingGroups(participantCount: number, groupCount: number): QualificationPlan | null {
  const plan = createQualificationPlan(participantCount, groupCount)
  if (!plan || plan.groupCount !== groupCount) return null
  return plan
}

function newMatch(id: string, player1Id: string | null, player2Id: string | null): KnockoutMatch {
  return { id, player1Id, player2Id, winnerId: null, result: null, kdaRoundCount: 1, stats: {} }
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
    matches.push(newMatch(`ko-r0-m${index}`, high.participantId, low.participantId))
  }
  return matches
}

function pairCrossGroup(qualifiers: QualifiedPlayer[], groups: TournamentGroup[]): KnockoutMatch[] {
  if (groups.length < 2 || qualifiers.length < 4) return []
  const groupOrder = orderedGroupIndex(groups)
  const qualifiersPerGroup = Math.max(...qualifiers.map((qualifier) => qualifier.groupRank))
  const matches: KnockoutMatch[] = []
  const half = qualifiersPerGroup / 2

  for (let rankIndex = 0; rankIndex < half; rankIndex += 1) {
    const highRank = rankIndex + 1
    const lowRank = qualifiersPerGroup - rankIndex
    const highPot = qualifiers.filter((q) => q.groupRank === highRank).sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0))
    const lowPot = qualifiers.filter((q) => q.groupRank === lowRank).sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0))
    if (highPot.length !== groups.length || lowPot.length !== groups.length) return []
    const rotation = groups.length === 2 ? 1 : (rankIndex % (groups.length - 1)) + 1
    highPot.forEach((highSeed, index) => {
      const lowSeed = lowPot[(index + rotation) % lowPot.length]
      matches.push(newMatch(`ko-r0-m${matches.length}`, highSeed.participantId, lowSeed.participantId))
    })
  }
  return matches
}

export function createGlobalKnockoutBracket(
  groups: TournamentGroup[],
  participants: Participant[],
  stats: Record<string, ParticipantStats>,
  qualifiersPerGroup: number,
  scoringWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  groupMatches: GroupMatch[] = [],
  competition: CompetitionSettings = DEFAULT_COMPETITION,
): KnockoutBracket {
  const qualifiers: QualifiedPlayer[] = groups.flatMap((group) =>
    buildStandings(group, participants, stats, scoringWeights, groupMatches, competition)
      .slice(0, qualifiersPerGroup)
      .map((row, index) => ({ participantId: row.participantId, groupId: group.id, groupName: group.name, groupRank: index + 1 })),
  )

  const firstRound = groups.length === 1 ? pairSingleGroup(qualifiers) : pairCrossGroup(qualifiers, groups)
  const rounds: KnockoutMatch[][] = []
  if (firstRound.length * 2 !== qualifiers.length) return { qualifierIds: qualifiers.map((q) => q.participantId), qualifiers, createdAt: new Date().toISOString(), rounds: [] }
  rounds.push(firstRound)
  let matchesInNextRound = firstRound.length / 2
  let roundIndex = 1
  while (matchesInNextRound >= 1) {
    rounds.push(Array.from({ length: matchesInNextRound }, (_, matchIndex) => newMatch(`ko-r${roundIndex}-m${matchIndex}`, null, null)))
    matchesInNextRound /= 2
    roundIndex += 1
  }
  return { qualifierIds: qualifiers.map((q) => q.participantId), qualifiers, createdAt: new Date().toISOString(), rounds }
}

export function updateBracketWinner(bracket: KnockoutBracket, roundIndex: number, matchIndex: number, winnerId: string | null): KnockoutBracket {
  const rounds = bracket.rounds.map((round) => round.map((match) => ({
    ...match,
    stats: Object.fromEntries(Object.entries(match.stats ?? {}).map(([participantId, stats]) => [participantId, { rounds: stats.rounds.map((roundStats) => ({ ...roundStats })) }])),
  })))
  const target = rounds[roundIndex]?.[matchIndex]
  if (!target) return bracket
  const allowed = [target.player1Id, target.player2Id].filter(Boolean)
  target.winnerId = winnerId && allowed.includes(winnerId) ? winnerId : null

  for (let r = roundIndex + 1; r < rounds.length; r += 1) {
    const previousRound = rounds[r - 1]
    rounds[r].forEach((match, index) => {
      const player1Id = previousRound[index * 2]?.winnerId ?? null
      const player2Id = previousRound[index * 2 + 1]?.winnerId ?? null
      const participantsChanged = match.player1Id !== player1Id || match.player2Id !== player2Id
      match.player1Id = player1Id
      match.player2Id = player2Id
      if (participantsChanged) {
        match.stats = {}
        match.result = null
      }
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

export function resultLabel(result: GroupMatchResult): string {
  if (result === 'player1') return 'Sieg links'
  if (result === 'player2') return 'Sieg rechts'
  if (result === 'draw') return 'Unentschieden'
  return 'Noch kein Ergebnis'
}
'''


def patch_app() -> None:
    path = ROOT / 'src/App.tsx'
    s = path.read_text(encoding='utf-8')

    s = replace_once(s, '  buildStandings,\n  createGlobalKnockoutBracket,', '  buildStandings,\n  createGlobalKnockoutBracket,\n  createGroupMatches,', 'createGroupMatches import')
    s = replace_once(s, '  AccessProfile,\n  HeroContent,', '  AccessProfile,\n  CompetitionSettings,\n  GroupMatchResult,\n  HeroContent,', 'competition type imports')

    s = replace_once(s, 'const DEFAULT_SCORING: ScoringWeights = DEFAULT_SCORING_WEIGHTS\n', "const DEFAULT_SCORING: ScoringWeights = DEFAULT_SCORING_WEIGHTS\n\nconst DEFAULT_COMPETITION: CompetitionSettings = { teamSize: 1, winPoints: 3, drawPoints: 1, lossPoints: 0 }\n", 'DEFAULT_COMPETITION')
    s = replace_once(s, '  groups: [],\n  stats: {},', '  groups: [],\n  groupMatches: [],\n  stats: {},', 'DEFAULT_STATE groupMatches')

    normalize_block = r'''function normalizeCompetition(value: unknown): CompetitionSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<CompetitionSettings> : {}
  const safeNumber = (raw: unknown, fallback: number) => {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? Math.max(0, Math.min(20, parsed)) : fallback
  }
  return {
    teamSize: clamp(Number(candidate.teamSize) || 1, 1, 5),
    winPoints: safeNumber(candidate.winPoints, 3),
    drawPoints: safeNumber(candidate.drawPoints, 1),
    lossPoints: safeNumber(candidate.lossPoints, 0),
  }
}

function normalizeParticipant(value: unknown): Participant {
  const candidate = value && typeof value === 'object' ? value as { id?: unknown; name?: unknown; team_size?: unknown; teamSize?: unknown; members?: unknown } : {}
  const name = String(candidate.name ?? '').trim()
  const teamSize = clamp(Number(candidate.team_size ?? candidate.teamSize) || 1, 1, 5)
  const rawMembers = Array.isArray(candidate.members) ? candidate.members.map((member) => String(member).trim()).filter(Boolean) : []
  const members = teamSize === 1 ? [rawMembers[0] || name] : rawMembers.slice(0, teamSize)
  return { id: String(candidate.id ?? ''), name, teamSize, members }
}

'''
    if 'function normalizeCompetition(' not in s:
        s = s.replace('function normalizeScoring(value: unknown): ScoringWeights {', normalize_block + 'function normalizeScoring(value: unknown): ScoringWeights {', 1)

    s = replace_once(s, '      kdaRoundCount: clamp(Number(match.kdaRoundCount) || 1, 1, 3),\n      stats:', "      result: ['player1', 'player2', 'draw'].includes(String(match.result)) ? match.result : null,\n      kdaRoundCount: clamp(Number(match.kdaRoundCount) || 1, 1, 3),\n      stats:", 'normalize bracket result')
    s = replace_once(s, '    groups: state.groups,\n    stats: state.stats,', '    groups: state.groups,\n    groupMatches: state.groupMatches,\n    stats: state.stats,', 'storedState groupMatches')
    s = replace_once(s, '  const [scoringWeights, setScoringWeights] = useState<ScoringWeights>(DEFAULT_SCORING)\n', "  const [scoringWeights, setScoringWeights] = useState<ScoringWeights>(DEFAULT_SCORING)\n  const [competition, setCompetition] = useState<CompetitionSettings>(DEFAULT_COMPETITION)\n  const [teamMembers, setTeamMembers] = useState<string[]>([])\n", 'competition state')
    s = replace_once(s, "useState<'header' | 'background' | 'scoring' | 'group'>('header')", "useState<'header' | 'background' | 'competition' | 'scoring' | 'group'>('header')", 'settings tab competition')

    s = replace_once(s, ".select('hero,background,scoring')", ".select('hero,background,scoring,competition')", 'load competition select')
    s = replace_once(s, '        setScoringWeights(normalizeScoring(data?.scoring))', '        setScoringWeights(normalizeScoring(data?.scoring))\n        setCompetition(normalizeCompetition(data?.competition))', 'load competition')

    s = replace_once(s, ".from('participants').select('id,name').order", ".from('participants').select('id,name,team_size,members').order", 'admin participant select')
    s = replace_once(s, '      const participants = (participantResult.data ?? []) as Participant[]', '      const participants = (participantResult.data ?? []).map(normalizeParticipant)', 'normalize admin participants')
    s = replace_once(s, '        groups: Array.isArray(payload.groups) ? payload.groups : [],\n        stats:', '        groups: Array.isArray(payload.groups) ? payload.groups : [],\n        groupMatches: Array.isArray(payload.groupMatches) ? payload.groupMatches : [],\n        stats:', 'load group matches')
    s = replace_once(s, 'state.groupCount, state.groupRoundCount, state.groups, state.stats, state.knockoutBracket', 'state.groupCount, state.groupRoundCount, state.groups, state.groupMatches, state.stats, state.knockoutBracket', 'save effect group matches')

    save_comp = r'''  async function saveCompetitionSettings() {
    if (!supabase || !isAdmin || !user) return
    if (state.participants.length > 0 && competition.teamSize !== state.participants[0]?.teamSize) {
      setNotice('Der Turniermodus kann erst geändert werden, wenn alle vorhandenen Teilnehmer gelöscht wurden.')
      return
    }
    const cleaned = normalizeCompetition(competition)
    setCompetition(cleaned)
    setSiteSaving(true)
    const { error } = await supabase
      .from('site_settings')
      .update({ competition: cleaned, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', 1)
    setSiteSaving(false)
    setNotice(error ? `Turniermodus konnte nicht gespeichert werden: ${error.message}` : `Turniermodus ${cleaned.teamSize}vs${cleaned.teamSize} und Tabellenwertung wurden veröffentlicht.`)
  }

  function changeTeamSize(teamSize: number) {
    if (state.participants.length > 0) {
      setNotice('Zum Wechsel des Turniermodus bitte zuerst alle Teilnehmer löschen.')
      return
    }
    setCompetition((current) => ({ ...current, teamSize: clamp(teamSize, 1, 5) }))
    setTeamMembers([])
    setNewName('')
  }

'''
    if 'async function saveCompetitionSettings()' not in s:
        s = s.replace('  async function saveScoringSettings() {', save_comp + '  async function saveScoringSettings() {', 1)

    s = replace_once(s, ".from('participants').select('id,name').order", ".from('participants').select('id,name,team_size,members').order", 'refresh participant select')
    s = replace_once(s, '    const participants = (data ?? []) as Participant[]', '    const participants = (data ?? []).map(normalizeParticipant)', 'refresh normalize participants')

    old_submit_start = '''  async function submitParticipant(name: string) {'''
    old_submit_end = '''  async function addSingleParticipant() {
    if (await submitParticipant(newName)) setNewName('')
  }
'''
    start = s.find(old_submit_start)
    end = s.find(old_submit_end)
    if start == -1 or end == -1:
        raise RuntimeError('Patch-Stelle nicht gefunden: participant submit block')
    end += len(old_submit_end)
    new_submit = r'''  async function submitParticipant(name: string) {
    const cleaned = name.trim()
    if (!cleaned) return false
    if (!supabase) {
      setNotice('Supabase ist noch nicht konfiguriert.')
      return false
    }

    const teamSize = competition.teamSize
    const members = teamSize === 1
      ? [cleaned]
      : Array.from({ length: teamSize }, (_, index) => (teamMembers[index] ?? '').trim())

    if (teamSize > 1 && members.some((member) => member.length < 2)) {
      setNotice(`Bitte für alle ${teamSize} Teammitglieder einen Namen oder Gamer-Tag eintragen.`)
      return false
    }

    const { error } = await supabase.from('participants').insert({
      name: cleaned,
      team_size: teamSize,
      members,
      submitted_by: user?.id ?? null,
    })
    if (error) {
      if (error.code === '23505') setNotice(teamSize === 1 ? 'Dieser Gamer-Tag ist bereits angemeldet.' : 'Dieser Teamname ist bereits angemeldet.')
      else setNotice(`Anmeldung fehlgeschlagen: ${error.message}`)
      return false
    }

    setNotice(teamSize === 1 ? '✓ Gamer-Tag wurde für das Turnier angemeldet.' : `✓ Team „${cleaned}“ wurde für das ${teamSize}vs${teamSize}-Turnier angemeldet.`)
    setTeamMembers([])
    if (isAdmin) await refreshParticipants()
    return true
  }

  async function addSingleParticipant() {
    if (await submitParticipant(newName)) setNewName('')
  }
'''
    s = s[:start] + new_submit + s[end:]

    s = replace_once(s, "  async function addBulkParticipants() {\n    if (!supabase || !isAdmin) return", "  async function addBulkParticipants() {\n    if (!supabase || !isAdmin || competition.teamSize !== 1) return", 'bulk solo only')
    s = replace_once(s, "names.map((name) => ({ name, submitted_by: user?.id ?? null }))", "names.map((name) => ({ name, team_size: 1, members: [name], submitted_by: user?.id ?? null }))", 'bulk fields')

    s = replace_once(s, '        groups: current.groups.map((group) => ({ ...group, participantIds: group.participantIds.filter((id) => id !== participantId) })),\n        stats,', '        groups: current.groups.map((group) => ({ ...group, participantIds: group.participantIds.filter((id) => id !== participantId) })),\n        groupMatches: current.groupMatches.filter((match) => match.player1Id !== participantId && match.player2Id !== participantId),\n        stats,', 'remove participant matches')
    s = replace_once(s, '      groups: [],\n      stats: {},', '      groups: [],\n      groupMatches: [],\n      stats: {},', 'clear participants matches')
    s = replace_once(s, "    setBulkNames('')\n    setClearingParticipants(false)", "    setBulkNames('')\n    setTeamMembers([])\n    setClearingParticipants(false)", 'clear team members')

    s = replace_once(s, '    const stats = Object.fromEntries(state.participants.map((participant) => [participant.id, emptyParticipantStats(state.groupRoundCount)]))\n\n    setState((current) => ({ ...current, groupCount: actualGroupCount, groups, stats, knockoutBracket: null }))', '    const stats = Object.fromEntries(state.participants.map((participant) => [participant.id, emptyParticipantStats(state.groupRoundCount)]))\n    const groupMatches = createGroupMatches(groups)\n\n    setState((current) => ({ ...current, groupCount: actualGroupCount, groups, groupMatches, stats, knockoutBracket: null }))', 'create group matches')

    update_match_fn = r'''  function updateGroupMatchResult(matchId: string, result: GroupMatchResult) {
    if (!isAdmin) return
    setState((current) => ({
      ...current,
      groupMatches: current.groupMatches.map((match) => match.id === matchId ? { ...match, result } : match),
      knockoutBracket: null,
    }))
  }

'''
    if 'function updateGroupMatchResult(' not in s:
        s = s.replace('  function updateStat(participantId: string, roundIndex: number, field: keyof RoundStats, rawValue: string) {', update_match_fn + '  function updateStat(participantId: string, roundIndex: number, field: keyof RoundStats, rawValue: string) {', 1)

    s = replace_once(s, 'createGlobalKnockoutBracket(state.groups, state.participants, state.stats, activePlan.qualifiersPerGroup, scoringWeights)', 'createGlobalKnockoutBracket(state.groups, state.participants, state.stats, activePlan.qualifiersPerGroup, scoringWeights, state.groupMatches, competition)', 'KO ranking mode')
    s = replace_once(s, 'setNotice(`${activePlan.knockoutSize} Spieler qualifiziert', 'setNotice(`${activePlan.knockoutSize} ${competition.teamSize === 1 ? \'Spieler\' : \'Teams\'} qualifiziert', 'KO notice')

    ko_result_fn = r'''  function updateKoResult(roundIndex: number, matchIndex: number, result: GroupMatchResult) {
    if (!isAdmin) return
    setState((current) => {
      if (!current.knockoutBracket) return current
      const rounds = current.knockoutBracket.rounds.map((round) => round.map((match) => ({ ...match })))
      const target = rounds[roundIndex]?.[matchIndex]
      if (!target) return current
      target.result = result
      let bracket = { ...current.knockoutBracket, rounds }
      const winnerId = result === 'player1' ? target.player1Id : result === 'player2' ? target.player2Id : null
      bracket = updateBracketWinner(bracket, roundIndex, matchIndex, winnerId)
      return { ...current, knockoutBracket: bracket }
    })
  }

'''
    if 'function updateKoResult(' not in s:
        s = s.replace('  function selectWinner(roundIndex: number, matchIndex: number, winnerId: string) {', ko_result_fn + '  function selectWinner(roundIndex: number, matchIndex: number, winnerId: string) {', 1)

    s = replace_once(s, '    setState((current) => ({ ...DEFAULT_STATE, participants: current.participants }))', '    setState((current) => ({ ...DEFAULT_STATE, participants: current.participants, groupCount: current.groupCount, groupRoundCount: current.groupRoundCount }))', 'reset state')
    s = replace_once(s, '        groups: parsed.groups ?? [],\n        stats:', '        groups: parsed.groups ?? [],\n        groupMatches: Array.isArray(parsed.groupMatches) ? parsed.groupMatches : [],\n        stats:', 'import group matches')

    # Registrierung komplett ersetzen.
    reg_start = s.find('        <section className="panel registration-panel" id="teilnehmer">')
    reg_end = s.find('        <section className="panel scoring-panel">', reg_start)
    if reg_start == -1 or reg_end == -1:
        raise RuntimeError('Patch-Stelle nicht gefunden: registration panel')
    reg = r'''        <section className="panel registration-panel" id="teilnehmer">
          <div className="section-heading"><div><span className="step">01</span><h2>{competition.teamSize === 1 ? 'Teilnehmer' : 'Teams'}</h2></div>{isAdmin && <span className="counter">{state.participants.length} angemeldet</span>}</div>
          <div className="mode-banner"><strong>{competition.teamSize}vs{competition.teamSize}</strong><span>{competition.teamSize === 1 ? 'Einzelspieler-Modus' : `Teammodus · ${competition.teamSize} Personen pro Team`}</span></div>
          <p className="muted">{isAdmin ? 'Als Admin siehst du alle Anmeldungen und kannst sie verwalten.' : competition.teamSize === 1 ? 'Trage deinen Gamer-Tag ein. Bereits angemeldete Namen bleiben für Besucher unsichtbar.' : `Trage zuerst den Teamnamen und anschließend alle ${competition.teamSize} Teammitglieder ein. Bereits angemeldete Teams bleiben für Besucher unsichtbar.`}</p>
          <div className="input-row participant-submit">
            <input className="text-input" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && competition.teamSize === 1) void addSingleParticipant() }} placeholder={competition.teamSize === 1 ? 'Name oder Gamer-Tag' : 'Teamname'} maxLength={40} />
            <button className="button" onClick={() => void addSingleParticipant()}>{competition.teamSize === 1 ? 'Für Turnier anmelden' : 'Team anmelden'}</button>
          </div>
          {competition.teamSize > 1 && newName.trim() && <div className="team-member-fields">
            {Array.from({ length: competition.teamSize }, (_, index) => <label key={index}>Spieler {index + 1}<input className="text-input" value={teamMembers[index] ?? ''} onChange={(event) => setTeamMembers((current) => Array.from({ length: competition.teamSize }, (_, memberIndex) => memberIndex === index ? event.target.value : current[memberIndex] ?? ''))} placeholder="Name oder Gamer-Tag" maxLength={40} /></label>)}
          </div>}
          {isAdmin && <>
            {competition.teamSize === 1 && <details className="bulk-add"><summary>Mehrere Teilnehmer hinzufügen</summary><textarea className="text-area" value={bulkNames} onChange={(event) => setBulkNames(event.target.value)} placeholder="Eine Person pro Zeile" /><button className="button button--secondary" onClick={() => void addBulkParticipants()}>Liste übernehmen</button></details>}
            <div className="admin-toolbar"><div className="admin-tools__actions"><button className="button button--ghost" disabled={clearingParticipants} onClick={() => void refreshParticipants()}>Anmeldungen aktualisieren</button><button className="button button--danger" disabled={clearingParticipants || state.participants.length === 0} onClick={() => void removeAllParticipants()}>{clearingParticipants ? 'Wird gelöscht …' : `Alle ${competition.teamSize === 1 ? 'Teilnehmer' : 'Teams'} löschen`}</button></div></div>
            <div className="chips">{state.participants.map((participant, index) => <div className="chip chip--team" key={participant.id}><span className="chip__index">{index + 1}</span><span><strong>{participant.name}</strong>{participant.teamSize > 1 && <small>{participant.members.join(' · ')}</small>}</span><button className="chip__remove" onClick={() => void removeParticipant(participant.id)} aria-label={`${participant.name} entfernen`}>×</button></div>)}</div>
          </>}
        </section>

'''
    s = s[:reg_start] + reg + s[reg_end:]

    # Competition tab button.
    s = replace_once(s, '<button className={settingsTab === \'background\' ? \'settings-tab settings-tab--active\' : \'settings-tab\'} onClick={() => setSettingsTab(\'background\')}>Website-Hintergrund</button>\n                <button className={settingsTab === \'scoring\'', '<button className={settingsTab === \'background\' ? \'settings-tab settings-tab--active\' : \'settings-tab\'} onClick={() => setSettingsTab(\'background\')}>Website-Hintergrund</button>\n                <button className={settingsTab === \'competition\' ? \'settings-tab settings-tab--active\' : \'settings-tab\'} onClick={() => setSettingsTab(\'competition\')}>Turniermodus & Wertung</button>\n                <button className={settingsTab === \'scoring\'', 'competition tab button')

    branch = r''') : settingsTab === 'scoring' ? (
                <div className="settings-content">'''
    competition_branch = r''') : settingsTab === 'competition' ? (
                <div className="settings-content">
                  <p className="muted">Wähle 1vs1 bis 5vs5. Alle Modi verwenden dieselbe Matchwertung: Ergebnisse sind Hauptkriterium, KDA ist Tie-Breaker. Sind in einer Gruppe überhaupt keine Ergebnisse eingetragen, wird automatisch ausschließlich nach KDA sortiert.</p>
                  <div className="settings-form-grid">
                    <label>Turniermodus<select className="select-input" value={competition.teamSize} onChange={(event) => changeTeamSize(Number(event.target.value))}>{[1,2,3,4,5].map((size) => <option key={size} value={size}>{size}vs{size}{size === 1 ? ' · Einzelspieler' : ` · ${size} Spieler pro Team`}</option>)}</select></label>
                    <label>Punkte pro Sieg<input className="text-input" type="number" min="0" max="20" step="0.5" value={competition.winPoints} onChange={(event) => setCompetition((current) => ({ ...current, winPoints: Number(event.target.value || 0) }))} /></label>
                    <label>Punkte pro Unentschieden<input className="text-input" type="number" min="0" max="20" step="0.5" value={competition.drawPoints} onChange={(event) => setCompetition((current) => ({ ...current, drawPoints: Number(event.target.value || 0) }))} /></label>
                    <label>Punkte pro Niederlage<input className="text-input" type="number" min="0" max="20" step="0.5" value={competition.lossPoints} onChange={(event) => setCompetition((current) => ({ ...current, lossPoints: Number(event.target.value || 0) }))} /></label>
                  </div>
                  {state.participants.length > 0 && <p className="settings-warning">Der Modus ist gesperrt, solange Anmeldungen vorhanden sind. Zum Wechsel zwischen 1vs1 und Teammodus zuerst alle Teilnehmer/Teams löschen.</p>}
                  <div className="plan-card"><span>WERTUNGSLOGIK</span><strong>Sieg {formatPoints(competition.winPoints)} · Unentschieden {formatPoints(competition.drawPoints)} · Niederlage {formatPoints(competition.lossPoints)}</strong><em>Bei Punktgleichheit entscheidet KDA. Ohne eingetragene Match-Ergebnisse gilt ausschließlich KDA.</em></div>
                  <button className="button button--twitch" disabled={siteSaving} onClick={() => void saveCompetitionSettings()}>{siteSaving ? 'Wird gespeichert …' : 'Turniermodus & Wertung veröffentlichen'}</button>
                </div>
              ) : settingsTab === 'scoring' ? (
                <div className="settings-content">'''
    s = replace_once(s, branch, competition_branch, 'competition settings branch')

    # Gruppen-Render ersetzen.
    group_start = s.find('            {state.groups.map((group) => {')
    group_end = s.find('            {state.groups.length > 0 && <section className="panel ko-panel">', group_start)
    if group_start == -1 or group_end == -1:
        raise RuntimeError('Patch-Stelle nicht gefunden: group render')
    group_render = r'''            {state.groups.map((group) => {
              const groupMatches = state.groupMatches.filter((match) => match.groupId === group.id)
              const standings = buildStandings(group, state.participants, state.stats, scoringWeights, state.groupMatches, competition)
              const qualified = activePlan?.qualifiersPerGroup ?? 0
              const usesResults = groupMatches.some((match) => match.result !== null)
              return <section className="panel group-panel" key={group.id}>
                <div className="section-heading"><div><span className="step">{group.name}</span><h2>{group.participantIds.length} {competition.teamSize === 1 ? 'Spieler' : 'Teams'}</h2></div><span className="counter">{usesResults ? 'ERGEBNISWERTUNG + KDA' : 'KDA-ONLY'}</span></div>
                <h3>Begegnungen · Jeder gegen jeden</h3>
                <div className="group-match-list">{groupMatches.map((match) => {
                  const left = participantMap.get(match.player1Id)?.name ?? 'Unbekannt'
                  const right = participantMap.get(match.player2Id)?.name ?? 'Unbekannt'
                  return <div className="group-match-row" key={match.id}><strong>{left}</strong><span>vs</span><strong>{right}</strong><select className="select-input select-input--compact" value={match.result ?? ''} onChange={(event) => updateGroupMatchResult(match.id, (event.target.value || null) as GroupMatchResult)}><option value="">Noch kein Ergebnis</option><option value="player1">Sieg · {left}</option><option value="draw">Unentschieden</option><option value="player2">Sieg · {right}</option></select></div>
                })}</div>
                <h3>{state.groupRoundCount} KDA-Runde{state.groupRoundCount === 1 ? '' : 'n'} · {competition.teamSize === 1 ? 'pro Spieler' : 'als Team-KDA'}</h3>
                <div className="stats-wrap"><table className="stats-table" style={{ minWidth: `${Math.max(780, 180 + state.groupRoundCount * 190)}px` }}>
                  <thead><tr><th>{competition.teamSize === 1 ? 'Spieler' : 'Team'}</th>{Array.from({ length: state.groupRoundCount }, (_, index) => index + 1).flatMap((round) => [<th key={`${round}k`}>S{round} K</th>, <th key={`${round}a`}>A</th>, <th key={`${round}d`}>D</th>, <th key={`${round}p`}>Pkt.</th>])}<th>KDA gesamt</th></tr></thead>
                  <tbody>{group.participantIds.map((participantId) => {
                    const participantStats = normalizeParticipantStats(state.stats[participantId], state.groupRoundCount)
                    const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, scoringWeights), 0)
                    return <tr key={participantId}><th className="player-cell">{participantMap.get(participantId)?.name ?? 'Unbekannt'}</th>{participantStats.rounds.flatMap((round, roundIndex) => [<td key={`${roundIndex}k`}><StatInput value={round.kills} onChange={(value) => updateStat(participantId, roundIndex, 'kills', value)} /></td>,<td key={`${roundIndex}a`}><StatInput value={round.assists} onChange={(value) => updateStat(participantId, roundIndex, 'assists', value)} /></td>,<td key={`${roundIndex}d`}><StatInput value={round.deaths} onChange={(value) => updateStat(participantId, roundIndex, 'deaths', value)} /></td>,<td className={calculateRoundScore(round, scoringWeights) < 0 ? 'points points--negative' : 'points'} key={`${roundIndex}p`}>{formatPoints(calculateRoundScore(round, scoringWeights))}</td>])}<td className={total < 0 ? 'total total--negative' : 'total'}>{formatPoints(total)}</td></tr>
                  })}</tbody>
                </table></div>
                <div className="standings-list">{standings.map((row, index) => <div className={`standing ${index < qualified ? 'standing--qualified' : ''}`} key={row.participantId}><span className="standing__rank">{index + 1}</span><strong>{row.name}</strong>{usesResults && <span className="standing__record">{row.wins} S · {row.draws} U · {row.losses} N · {formatPoints(row.matchPoints)} Tab.-Pkt.</span>}<span className="standing__kda">KDA {formatPoints(row.totalPoints)} · {row.kills} K · {row.assists} A · {row.deaths} D</span>{index < qualified && <span className="qualified-tag">Q</span>}</div>)}</div>
              </section>
            })}

'''
    s = s[:group_start] + group_render + s[group_end:]

    s = replace_once(s, '                  scoringWeights={scoringWeights}\n                  onRoundCount=', '                  scoringWeights={scoringWeights}\n                  onResult={updateKoResult}\n                  onRoundCount=', 'KO result prop')

    # Knockout props + result select.
    s = replace_once(s, '  scoringWeights,\n  onRoundCount,', '  scoringWeights,\n  onResult,\n  onRoundCount,', 'KO destructure result')
    s = replace_once(s, '  scoringWeights: ScoringWeights\n  onRoundCount:', '  scoringWeights: ScoringWeights\n  onResult: (roundIndex: number, matchIndex: number, result: GroupMatchResult) => void\n  onRoundCount:', 'KO result prop type')
    insert_marker = '    <span className="match-number">MATCH {matchIndex + 1}</span>\n    <div className="ko-round-control">'
    insert_new = '''    <span className="match-number">MATCH {matchIndex + 1}</span>\n    <label className="ko-result-control"><span>Ergebnis</span><select className="select-input select-input--compact" disabled={!match.player1Id || !match.player2Id} value={match.result ?? ''} onChange={(event) => onResult(roundIndex, matchIndex, (event.target.value || null) as GroupMatchResult)}><option value="">Noch kein Ergebnis</option><option value="player1">Sieg links</option><option value="draw">Unentschieden</option><option value="player2">Sieg rechts</option></select></label>\n    <div className="ko-round-control">'''
    s = replace_once(s, insert_marker, insert_new, 'KO result control')
    s = replace_once(s, '<option value="">Sieger wählen</option>', '<option value="">{match.result === \'draw\' ? \'Weiterkommenden nach Unentschieden wählen\' : \'Sieger / Weiterkommenden wählen\'}</option>', 'KO winner label')

    # Generische Texte.
    s = s.replace('Spieler · ${roundName(plan.knockoutSize, 0)}', '${plan.knockoutSize} Teilnehmer/Teams · ${roundName(plan.knockoutSize, 0)}') if False else s
    s = s.replace(' · ${plan.knockoutSize} Spieler · ', ' · ${plan.knockoutSize} Teilnehmer/Teams · ')
    s = s.replace('<em>{state.groupRoundCount} KDA-Runde{state.groupRoundCount === 1 ? \'\' : \'n\'} pro Spieler</em>', '<em>{state.groupRoundCount} KDA-Runde{state.groupRoundCount === 1 ? \'\' : \'n\'} · {competition.teamSize}vs{competition.teamSize}</em>')

    path.write_text(s, encoding='utf-8')


def patch_styles() -> None:
    path = ROOT / 'src/styles.css'
    s = path.read_text(encoding='utf-8')
    marker = '/* MULTI-MODE TOURNAMENT */'
    if marker in s:
        return
    s += r'''

/* MULTI-MODE TOURNAMENT */
.mode-banner{display:flex;align-items:center;gap:12px;padding:12px 14px;margin:0 0 14px;border:1px solid rgba(145,71,255,.34);border-radius:14px;background:rgba(145,71,255,.08)}
.mode-banner strong{font-size:1.15rem;color:var(--pink,#ff8fc7)}
.mode-banner span{color:var(--muted,#bcb5c9)}
.team-member-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:14px 0}
.team-member-fields label{display:grid;gap:6px;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#bcb5c9)}
.chip--team>span:nth-child(2){display:grid;gap:3px}.chip--team small{font-size:.72rem;color:var(--muted,#bcb5c9);font-weight:400}
.group-match-list{display:grid;gap:9px;margin:12px 0 22px}.group-match-row{display:grid;grid-template-columns:minmax(120px,1fr) auto minmax(120px,1fr) minmax(190px,.8fr);gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(10,8,18,.28)}
.group-match-row>span{text-align:center;color:var(--muted,#bcb5c9);font-size:.75rem;font-weight:800}.group-match-row strong:last-of-type{text-align:right}
.standing__record{font-size:.78rem;font-weight:800;color:var(--pink,#ff8fc7)}.ko-result-control{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0}.ko-result-control>span{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#bcb5c9)}
@media(max-width:760px){.group-match-row{grid-template-columns:1fr auto 1fr}.group-match-row .select-input{grid-column:1/-1}.standing__record{display:block;width:100%}}
'''
    path.write_text(s, encoding='utf-8')


def patch_setup_sql() -> None:
    path = ROOT / 'supabase/setup.sql'
    if not path.exists():
        return
    s = path.read_text(encoding='utf-8')
    if 'multi-mode tournament 1vs1 to 5vs5' in s.lower():
        return
    sql = (ROOT / 'supabase/multi_mode_migration.sql').read_text(encoding='utf-8')
    s += '\n\n-- Multi-mode tournament 1vs1 to 5vs5\n' + sql + '\n'
    path.write_text(s, encoding='utf-8')


def main() -> None:
    (ROOT / 'src/types.ts').write_text(TYPES, encoding='utf-8')
    (ROOT / 'src/lib/tournament.ts').write_text(TOURNAMENT, encoding='utf-8')
    patch_app()
    patch_styles()
    patch_setup_sql()
    print('Multi-Mode-Turniersystem 1vs1 bis 5vs5 erfolgreich eingebaut.')


if __name__ == '__main__':
    main()

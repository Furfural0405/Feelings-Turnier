import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  buildStandings,
  createGlobalKnockoutBracket,
  createQualificationPlan,
  createQualificationPlanForExistingGroups,
  distributeIntoGroups,
  roundName,
  updateBracketWinner,
} from './lib/tournament'
import {
  calculateRoundScore,
  DEFAULT_SCORING_WEIGHTS,
  emptyParticipantStats,
  formatPoints,
  normalizeParticipantStats,
} from './lib/scoring'
import { supabase, supabaseConfigured } from './lib/supabase'
import type {
  AccessProfile,
  HeroContent,
  KnockoutBracket,
  KnockoutMatch,
  Participant,
  ParticipantStats,
  QualificationPlan,
  RoundStats,
  ScoringWeights,
  SiteBackgroundSettings,
  StoredTournamentState,
  TournamentState,
} from './types'


type TwitchLiveState = 'checking' | 'live' | 'offline' | 'unavailable'

type TwitchPlayerInstance = {
  addEventListener: (event: string, callback: () => void) => void
  setMuted: (muted: boolean) => void
  getQualities: () => string[]
  getQuality: () => string
  setQuality: (quality: string) => void
}

type TwitchPlayerConstructor = {
  new (elementId: string, options: Record<string, unknown>): TwitchPlayerInstance
  ONLINE: string
  OFFLINE: string
  READY: string
  PLAYING: string
}

type TwitchWindow = Window & {
  Twitch?: { Player: TwitchPlayerConstructor }
}

const TWITCH_EMBED_SCRIPT_ID = 'twitch-embed-sdk'
const TWITCH_PLAYER_HOST_ID = 'brume-twitch-player'
const TWITCH_QUALITY_TARGETS = [360, 480, 720, 1080] as const

type TwitchQualityKey = 'auto' | '360' | '480' | '720' | '1080'

function qualityKeyForName(quality: string): TwitchQualityKey | null {
  const normalized = quality.toLowerCase()
  if (normalized === 'auto') return 'auto'
  for (const target of TWITCH_QUALITY_TARGETS) {
    if (normalized.startsWith(`${target}p`)) return String(target) as TwitchQualityKey
  }
  return null
}

function preferQualityName(current: string | undefined, candidate: string): string {
  if (!current) return candidate
  const fps = (value: string) => Number(value.match(/p(\d+)/i)?.[1] ?? 0)
  return fps(candidate) > fps(current) ? candidate : current
}

const DEFAULT_HERO: HeroContent = {
  titleLine1: 'FEELINGS',
  titleLine2: 'TURNIER',
  lead: 'Drei KDA-Runden. Automatische Gruppen. Eine globale K.O.-Stage. Ein Champion.',
  tags: ['VALORANT VIBES', 'STREAM MODE', 'KDA TRACKING'],
}

const DEFAULT_SCORING: ScoringWeights = DEFAULT_SCORING_WEIGHTS

const DEFAULT_BACKGROUND: SiteBackgroundSettings = {
  enabled: false,
  url: '',
  path: '',
  fit: 'cover',
  position: 'center top',
  repeat: 'no-repeat',
  opacity: 42,
  hideDefaultFloral: false,
}

const SITE_BACKGROUND_BUCKET = 'site-assets'
const SITE_BACKGROUND_MAX_BYTES = 10 * 1024 * 1024
const SITE_BACKGROUND_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const DEFAULT_STATE: TournamentState = {
  participants: [],
  groupCount: 2,
  groupRoundCount: 3,
  groups: [],
  stats: {},
  knockoutBracket: null,
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function normalizeHero(value: unknown): HeroContent {
  const candidate = value && typeof value === 'object' ? value as Partial<HeroContent> : {}
  const tags = Array.isArray(candidate.tags) ? candidate.tags.map(String).slice(0, 3) : []
  while (tags.length < 3) tags.push(DEFAULT_HERO.tags[tags.length])
  return {
    titleLine1: typeof candidate.titleLine1 === 'string' && candidate.titleLine1.trim() ? candidate.titleLine1 : DEFAULT_HERO.titleLine1,
    titleLine2: typeof candidate.titleLine2 === 'string' && candidate.titleLine2.trim() ? candidate.titleLine2 : DEFAULT_HERO.titleLine2,
    lead: typeof candidate.lead === 'string' && candidate.lead.trim() ? candidate.lead : DEFAULT_HERO.lead,
    tags,
  }
}

function normalizeBackground(value: unknown): SiteBackgroundSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<SiteBackgroundSettings> : {}
  const fit = candidate.fit === 'contain' ? 'contain' : 'cover'
  const position = ['center top', 'center center', 'left top', 'right top'].includes(String(candidate.position))
    ? candidate.position as SiteBackgroundSettings['position']
    : DEFAULT_BACKGROUND.position
  const repeat = ['no-repeat', 'repeat', 'repeat-y'].includes(String(candidate.repeat))
    ? candidate.repeat as SiteBackgroundSettings['repeat']
    : DEFAULT_BACKGROUND.repeat
  return {
    enabled: Boolean(candidate.enabled),
    url: typeof candidate.url === 'string' ? candidate.url : '',
    path: typeof candidate.path === 'string' ? candidate.path : '',
    fit,
    position,
    repeat,
    opacity: clamp(Number(candidate.opacity) || DEFAULT_BACKGROUND.opacity, 10, 100),
    hideDefaultFloral: Boolean(candidate.hideDefaultFloral),
  }
}

function normalizeScoring(value: unknown): ScoringWeights {
  const candidate = value && typeof value === 'object' ? value as Partial<ScoringWeights> : {}
  const safeWeight = (rawValue: unknown, fallback: number) => {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return fallback
    return Math.round(Math.max(0, Math.min(20, parsed)) * 10) / 10
  }
  return {
    kill: safeWeight(candidate.kill, DEFAULT_SCORING.kill),
    assist: safeWeight(candidate.assist, DEFAULT_SCORING.assist),
    death: safeWeight(candidate.death, DEFAULT_SCORING.death),
    positiveBonus: safeWeight(candidate.positiveBonus, DEFAULT_SCORING.positiveBonus),
    negativePenalty: safeWeight(candidate.negativePenalty, DEFAULT_SCORING.negativePenalty),
  }
}

function normalizeBracket(bracket: KnockoutBracket | null | undefined): KnockoutBracket | null {
  if (!bracket || !Array.isArray(bracket.rounds)) return null
  return {
    ...bracket,
    qualifiers: Array.isArray(bracket.qualifiers) ? bracket.qualifiers : [],
    qualifierIds: Array.isArray(bracket.qualifierIds) ? bracket.qualifierIds : [],
    rounds: bracket.rounds.map((round) => round.map((match) => ({
      ...match,
      kdaRoundCount: clamp(Number(match.kdaRoundCount) || 1, 1, 3),
      stats: match.stats && typeof match.stats === 'object' ? match.stats : {},
    }))),
  }
}

function planText(plan: QualificationPlan | null): string {
  if (!plan) return 'Ab 4 Teilnehmern kann eine K.O.-Phase erzeugt werden.'
  const override = plan.smallTournamentOverride ? ' · Sonderregel unter 8 Teilnehmern' : ''
  return `${plan.groupCount} Gruppe${plan.groupCount === 1 ? '' : 'n'} · Top ${plan.qualifiersPerGroup} · ${plan.knockoutSize} Spieler · ${roundName(plan.knockoutSize, 0)}${override}`
}

function storedState(state: TournamentState): StoredTournamentState {
  return {
    groupCount: state.groupCount,
    groupRoundCount: state.groupRoundCount,
    groups: state.groups,
    stats: state.stats,
    knockoutBracket: state.knockoutBracket,
  }
}

function App() {
  const [state, setState] = useState<TournamentState>(DEFAULT_STATE)
  const [hero, setHero] = useState<HeroContent>(DEFAULT_HERO)
  const [background, setBackground] = useState<SiteBackgroundSettings>(DEFAULT_BACKGROUND)
  const [scoringWeights, setScoringWeights] = useState<ScoringWeights>(DEFAULT_SCORING)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AccessProfile | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [adminDataLoaded, setAdminDataLoaded] = useState(false)
  const [profiles, setProfiles] = useState<AccessProfile[]>([])
  const [notice, setNotice] = useState('')
  const [newName, setNewName] = useState('')
  const [bulkNames, setBulkNames] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'header' | 'background' | 'scoring' | 'group'>('header')
  const [siteSaving, setSiteSaving] = useState(false)
  const [backgroundUploadBusy, setBackgroundUploadBusy] = useState(false)
  const [removingProfileId, setRemovingProfileId] = useState<string | null>(null)
  const [twitchLiveState, setTwitchLiveState] = useState<TwitchLiveState>('checking')
  const [twitchQualities, setTwitchQualities] = useState<Partial<Record<TwitchQualityKey, string>>>({})
  const [twitchSelectedQuality, setTwitchSelectedQuality] = useState<TwitchQualityKey>('auto')
  const twitchPlayerRef = useRef<HTMLDivElement>(null)
  const twitchPlayerInstanceRef = useRef<TwitchPlayerInstance | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number | null>(null)

  const isAdmin = Boolean(profile?.approved && profile.role === 'admin')
  const isCreator = Boolean(isAdmin && profile?.is_creator)
  const participantMap = useMemo(
    () => new Map(state.participants.map((participant) => [participant.id, participant])),
    [state.participants],
  )
  const previewPlan = useMemo(
    () => createQualificationPlan(state.participants.length, state.groupCount),
    [state.participants.length, state.groupCount],
  )
  const activePlan = useMemo(
    () => state.groups.length > 0
      ? createQualificationPlanForExistingGroups(state.participants.length, state.groups.length)
      : previewPlan,
    [previewPlan, state.groups.length, state.participants.length],
  )
  const championId = state.knockoutBracket?.rounds.at(-1)?.[0]?.winnerId ?? null
  const twitchStatusLabel = twitchLiveState === 'live'
    ? 'LIVE'
    : twitchLiveState === 'offline'
      ? 'OFFLINE'
      : twitchLiveState === 'unavailable'
        ? 'STATUS NICHT VERFÜGBAR'
        : 'LIVE-STATUS WIRD GEPRÜFT'

  useEffect(() => {
    let disposed = false
    let statusTimeout: number | null = null
    const qualityRefreshTimers: number[] = []

    const fail = () => {
      if (!disposed) setTwitchLiveState('unavailable')
    }

    const refreshQualities = (player: TwitchPlayerInstance) => {
      if (disposed) return
      try {
        const available = player.getQualities() ?? []
        const mapped: Partial<Record<TwitchQualityKey, string>> = {}
        for (const quality of available) {
          const key = qualityKeyForName(quality)
          if (!key) continue
          mapped[key] = preferQualityName(mapped[key], quality)
        }
        setTwitchQualities(mapped)

        const currentName = player.getQuality()
        const currentKey = Object.entries(mapped).find(([, value]) => value === currentName)?.[0] as TwitchQualityKey | undefined
        if (currentKey) setTwitchSelectedQuality(currentKey)
      } catch {
        // Twitch kann die Qualitätsliste kurz nach READY noch nicht liefern.
      }
    }

    const scheduleQualityRefresh = (player: TwitchPlayerInstance) => {
      refreshQualities(player)
      for (const delay of [900, 2500, 6000]) {
        qualityRefreshTimers.push(window.setTimeout(() => refreshQualities(player), delay))
      }
    }

    const initializePlayer = () => {
      if (disposed || !twitchPlayerRef.current) return
      const twitch = (window as TwitchWindow).Twitch
      if (!twitch?.Player) {
        fail()
        return
      }

      twitchPlayerRef.current.innerHTML = ''
      setTwitchLiveState('checking')

      try {
        const player = new twitch.Player(TWITCH_PLAYER_HOST_ID, {
          width: '100%',
          height: '100%',
          channel: 'brumefeelings',
          parent: [window.location.hostname],
          autoplay: true,
          muted: true,
        })
        twitchPlayerInstanceRef.current = player

        const setLive = () => {
          if (disposed) return
          if (statusTimeout !== null) window.clearTimeout(statusTimeout)
          setTwitchLiveState('live')
        }
        const setOffline = () => {
          if (disposed) return
          if (statusTimeout !== null) window.clearTimeout(statusTimeout)
          setTwitchLiveState('offline')
        }

        player.addEventListener(twitch.Player.ONLINE, setLive)
        player.addEventListener(twitch.Player.OFFLINE, setOffline)
        player.addEventListener(twitch.Player.READY, () => {
          if (disposed) return
          player.setMuted(true)
          scheduleQualityRefresh(player)
        })
        player.addEventListener(twitch.Player.PLAYING, () => refreshQualities(player))

        statusTimeout = window.setTimeout(() => {
          if (!disposed) setTwitchLiveState((current) => current === 'checking' ? 'unavailable' : current)
        }, 12000)
      } catch {
        fail()
      }
    }

    const existingScript = document.getElementById(TWITCH_EMBED_SCRIPT_ID) as HTMLScriptElement | null
    if ((window as TwitchWindow).Twitch?.Player) {
      initializePlayer()
    } else if (existingScript) {
      existingScript.addEventListener('load', initializePlayer)
      existingScript.addEventListener('error', fail)
    } else {
      const script = document.createElement('script')
      script.id = TWITCH_EMBED_SCRIPT_ID
      script.src = 'https://player.twitch.tv/js/embed/v1.js'
      script.async = true
      script.addEventListener('load', initializePlayer)
      script.addEventListener('error', fail)
      document.head.appendChild(script)
    }

    return () => {
      disposed = true
      if (statusTimeout !== null) window.clearTimeout(statusTimeout)
      qualityRefreshTimers.forEach((timer) => window.clearTimeout(timer))
      twitchPlayerInstanceRef.current = null
      const script = document.getElementById(TWITCH_EMBED_SCRIPT_ID)
      script?.removeEventListener('load', initializePlayer)
      script?.removeEventListener('error', fail)
      if (twitchPlayerRef.current) twitchPlayerRef.current.innerHTML = ''
    }
  }, [])

  function changeTwitchQuality(key: TwitchQualityKey) {
    const player = twitchPlayerInstanceRef.current
    const quality = twitchQualities[key]
    if (!player || !quality) return
    try {
      player.setQuality(quality)
      setTwitchSelectedQuality(key)
    } catch {
      setNotice('Diese Twitch-Qualität konnte gerade nicht gesetzt werden.')
    }
  }

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 5200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    async function loadSiteSettings() {
      const { data, error } = await supabase!.from('site_settings').select('hero,background,scoring').eq('id', 1).maybeSingle()
      if (cancelled) return
      if (!error) {
        if (data?.hero) setHero(normalizeHero(data.hero))
        setBackground(normalizeBackground(data?.background))
        setScoringWeights(normalizeScoring(data?.scoring))
      }
    }
    void loadSiteSettings()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    let active = true
    async function syncSession() {
      const { data } = await supabase!.auth.getSession()
      if (!active) return
      setUser(data.session?.user ?? null)
      setAuthLoading(false)
    }

    void syncSession()
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setProfile(null)
      setAdminDataLoaded(false)
      if (!session) setState(DEFAULT_STATE)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !user) {
      setProfile(null)
      return
    }

    let cancelled = false
    async function loadProfile() {
      const { data, error } = await supabase!
        .from('profiles')
        .select('id,email,approved,role,is_creator,access_status,created_at')
        .eq('id', user!.id)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        setNotice(`Profil konnte nicht geladen werden: ${error.message}`)
        return
      }
      setProfile(data as AccessProfile | null)
    }
    void loadProfile()
    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    if (!isCreator) return

    void refreshProfiles(true)
    const interval = window.setInterval(() => void refreshProfiles(true), 10000)
    const onFocus = () => void refreshProfiles(true)
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [isCreator])

  useEffect(() => {
    if (!supabase || !isAdmin) {
      setAdminDataLoaded(false)
      return
    }

    let cancelled = false
    async function loadAdminData() {
      const [participantResult, stateResult, profileResult] = await Promise.all([
        supabase!.from('participants').select('id,name').order('created_at', { ascending: true }),
        supabase!.from('tournament_state').select('payload').eq('id', 1).maybeSingle(),
        supabase!.from('profiles').select('id,email,approved,role,is_creator,access_status,created_at').order('created_at', { ascending: true }),
      ])
      if (cancelled) return
      if (participantResult.error || stateResult.error || profileResult.error) {
        setNotice(participantResult.error?.message ?? stateResult.error?.message ?? profileResult.error?.message ?? 'Daten konnten nicht geladen werden.')
        return
      }

      const participants = (participantResult.data ?? []) as Participant[]
      const payload = (stateResult.data?.payload ?? {}) as Partial<StoredTournamentState>
      const groupRoundCount = clamp(Number(payload.groupRoundCount) || 3, 1, 7)
      const rawStats = payload.stats && typeof payload.stats === 'object' ? payload.stats : {}
      const normalizedStats = Object.fromEntries(
        participants.map((participant) => [participant.id, normalizeParticipantStats(rawStats[participant.id], groupRoundCount)]),
      )
      setState({
        participants,
        groupCount: clamp(Number(payload.groupCount) || 2, 1, 10),
        groupRoundCount,
        groups: Array.isArray(payload.groups) ? payload.groups : [],
        stats: normalizedStats,
        knockoutBracket: normalizeBracket(payload.knockoutBracket),
      })
      setProfiles((profileResult.data ?? []) as AccessProfile[])
      setAdminDataLoaded(true)
    }

    void loadAdminData()
    return () => { cancelled = true }
  }, [isAdmin])

  useEffect(() => {
    if (!supabase || !isAdmin || !adminDataLoaded || !user) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)

    saveTimer.current = window.setTimeout(() => {
      void supabase!
        .from('tournament_state')
        .upsert({
          id: 1,
          payload: storedState(state),
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        }, { onConflict: 'id' })
        .then(({ error }) => {
          if (error) setNotice(`Speichern fehlgeschlagen: ${error.message}`)
        })
    }, 700)

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [state.groupCount, state.groupRoundCount, state.groups, state.stats, state.knockoutBracket, isAdmin, adminDataLoaded, user])

  async function saveHeroSettings() {
    if (!supabase || !isAdmin || !user) return
    const cleaned = normalizeHero(hero)
    setHero(cleaned)
    setSiteSaving(true)
    const { error } = await supabase
      .from('site_settings')
      .update({ hero: cleaned, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', 1)
    setSiteSaving(false)
    setNotice(error ? `Header konnte nicht gespeichert werden: ${error.message}` : 'Header-Inhalte wurden veröffentlicht.')
  }

  async function saveBackgroundSettings(nextValue: SiteBackgroundSettings = background, successMessage = 'Hintergrund-Einstellungen wurden veröffentlicht.') {
    if (!supabase || !isAdmin || !user) return false
    const cleaned = normalizeBackground(nextValue)
    setSiteSaving(true)
    const { error } = await supabase
      .from('site_settings')
      .update({ background: cleaned, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', 1)
    setSiteSaving(false)
    if (error) {
      setNotice(`Hintergrund konnte nicht gespeichert werden: ${error.message}`)
      return false
    }
    setBackground(cleaned)
    setNotice(successMessage)
    return true
  }

  async function saveScoringSettings() {
    if (!supabase || !isAdmin || !user) return
    const cleaned = normalizeScoring(scoringWeights)
    setScoringWeights(cleaned)
    setSiteSaving(true)
    const { error } = await supabase
      .from('site_settings')
      .update({ scoring: cleaned, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', 1)
    setSiteSaving(false)
    setNotice(error
      ? `KDA-Gewichtung konnte nicht gespeichert werden: ${error.message}`
      : 'KDA-Gewichtung wurde veröffentlicht und wird jetzt in Gruppen- und K.O.-Phase verwendet.')
  }

  async function uploadSiteBackground(file: File | null) {
    if (!file || !supabase || !isAdmin || !user) return
    if (!SITE_BACKGROUND_MIME_TYPES.has(file.type)) {
      setNotice('Bitte nur PNG-, JPG- oder WebP-Dateien verwenden.')
      return
    }
    if (file.size > SITE_BACKGROUND_MAX_BYTES) {
      setNotice('Das Hintergrundbild darf maximal 10 MB groß sein.')
      return
    }

    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const unique = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const path = `backgrounds/${user.id}/${unique}.${extension}`
    const previousPath = background.path

    setBackgroundUploadBusy(true)
    const { error: uploadError } = await supabase.storage
      .from(SITE_BACKGROUND_BUCKET)
      .upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false })

    if (uploadError) {
      setBackgroundUploadBusy(false)
      setNotice(`Upload fehlgeschlagen: ${uploadError.message}`)
      return
    }

    const { data: publicData } = supabase.storage.from(SITE_BACKGROUND_BUCKET).getPublicUrl(path)
    const nextBackground = normalizeBackground({ ...background, enabled: true, url: publicData.publicUrl, path })
    const saved = await saveBackgroundSettings(nextBackground, 'Neuer Website-Hintergrund wurde hochgeladen und aktiviert.')

    if (!saved) {
      await supabase.storage.from(SITE_BACKGROUND_BUCKET).remove([path])
    } else if (previousPath && previousPath !== path) {
      await supabase.storage.from(SITE_BACKGROUND_BUCKET).remove([previousPath])
    }

    setBackgroundUploadBusy(false)
    if (backgroundInputRef.current) backgroundInputRef.current.value = ''
  }

  async function removeSiteBackground() {
    if (!supabase || !isAdmin) return
    const oldPath = background.path
    const saved = await saveBackgroundSettings(DEFAULT_BACKGROUND, 'Eigener Hintergrund wurde entfernt. Das Standarddesign ist wieder aktiv.')
    if (saved && oldPath) {
      const { error } = await supabase.storage.from(SITE_BACKGROUND_BUCKET).remove([oldPath])
      if (error) setNotice(`Einstellungen wurden zurückgesetzt, die alte Bilddatei konnte aber nicht gelöscht werden: ${error.message}`)
    }
  }

  async function refreshParticipants() {
    if (!supabase || !isAdmin) return
    const { data, error } = await supabase.from('participants').select('id,name').order('created_at', { ascending: true })
    if (error) {
      setNotice(error.message)
      return
    }
    const participants = (data ?? []) as Participant[]
    setState((current) => ({
      ...current,
      participants,
      stats: Object.fromEntries(participants.map((participant) => [
        participant.id,
        normalizeParticipantStats(current.stats[participant.id], current.groupRoundCount),
      ])),
    }))
  }

  async function submitParticipant(name: string) {
    const cleaned = name.trim()
    if (!cleaned) return false
    if (!supabase) {
      setNotice('Supabase ist noch nicht konfiguriert.')
      return false
    }

    const { error } = await supabase.from('participants').insert({ name: cleaned, submitted_by: user?.id ?? null })
    if (error) {
      if (error.code === '23505') setNotice('Dieser Gamer-Tag ist bereits angemeldet.')
      else setNotice(`Anmeldung fehlgeschlagen: ${error.message}`)
      return false
    }

    setNotice('✓ Gamer-Tag wurde für das Turnier angemeldet.')
    if (isAdmin) await refreshParticipants()
    return true
  }

  async function addSingleParticipant() {
    if (await submitParticipant(newName)) setNewName('')
  }

  async function addBulkParticipants() {
    if (!supabase || !isAdmin) return
    const names = bulkNames.split(/[\n,;]+/).map((name) => name.trim()).filter(Boolean)
    if (!names.length) return
    const { error } = await supabase.from('participants').insert(names.map((name) => ({ name, submitted_by: user?.id ?? null })))
    if (error) {
      setNotice(`Liste konnte nicht vollständig übernommen werden: ${error.message}`)
      return
    }
    setBulkNames('')
    await refreshParticipants()
    setNotice(`${names.length} Teilnehmer hinzugefügt.`)
  }

  async function removeParticipant(participantId: string) {
    if (!supabase || !isAdmin) return
    const { error } = await supabase.from('participants').delete().eq('id', participantId)
    if (error) {
      setNotice(error.message)
      return
    }
    setState((current) => {
      const stats = { ...current.stats }
      delete stats[participantId]
      return {
        ...current,
        participants: current.participants.filter((participant) => participant.id !== participantId),
        groups: current.groups.map((group) => ({ ...group, participantIds: group.participantIds.filter((id) => id !== participantId) })),
        stats,
        knockoutBracket: null,
      }
    })
  }

  function setGroupRoundCount(rawCount: number) {
    if (!isAdmin) return
    const groupRoundCount = clamp(rawCount, 1, 7)
    setState((current) => ({
      ...current,
      groupRoundCount,
      stats: Object.fromEntries(current.participants.map((participant) => [
        participant.id,
        normalizeParticipantStats(current.stats[participant.id], groupRoundCount),
      ])),
      knockoutBracket: null,
    }))
    setNotice(`Gruppenphase auf ${groupRoundCount} KDA-Runde${groupRoundCount === 1 ? '' : 'n'} eingestellt. Die K.O.-Phase wurde ggf. zurückgesetzt.`)
  }

  function createGroups() {
    if (!isAdmin) return
    if (state.participants.length < 1) {
      setNotice('Bitte zuerst Teilnehmer hinzufügen.')
      return
    }

    const plan = createQualificationPlan(state.participants.length, state.groupCount)
    const actualGroupCount = plan?.groupCount ?? Math.max(1, Math.min(state.groupCount, state.participants.length))
    const groups = distributeIntoGroups(state.participants, actualGroupCount)
    const stats = Object.fromEntries(state.participants.map((participant) => [participant.id, emptyParticipantStats(state.groupRoundCount)]))

    setState((current) => ({ ...current, groupCount: actualGroupCount, groups, stats, knockoutBracket: null }))
    if (!plan) setNotice('Gruppen erstellt. Eine K.O.-Phase benötigt mindestens 4 Teilnehmer.')
    else if (plan.adjusted) setNotice(`Automatisch angepasst: ${plan.requestedGroupCount} → ${plan.groupCount} Gruppen. ${planText(plan)}`)
    else setNotice(`Gruppen erstellt. ${planText(plan)}`)
  }

  function updateStat(participantId: string, roundIndex: number, field: keyof RoundStats, rawValue: string) {
    if (!isAdmin) return
    const value = Math.max(0, Math.trunc(Number(rawValue) || 0))
    setState((current) => {
      const participantStats = normalizeParticipantStats(current.stats[participantId], current.groupRoundCount)
      const rounds = participantStats.rounds.map((round, index) => index === roundIndex ? { ...round, [field]: value } : { ...round })
      return { ...current, stats: { ...current.stats, [participantId]: { rounds } }, knockoutBracket: null }
    })
  }

  function generateGlobalBracket() {
    if (!isAdmin || state.groups.length === 0 || !activePlan) {
      setNotice('Für die aktuelle Konfiguration kann noch keine K.O.-Phase erstellt werden.')
      return
    }
    const bracket = createGlobalKnockoutBracket(state.groups, state.participants, state.stats, activePlan.qualifiersPerGroup, scoringWeights)
    if (bracket.qualifierIds.length !== activePlan.knockoutSize || bracket.rounds.length === 0) {
      setNotice('K.O.-Phase konnte nicht gesetzt werden. Bitte Gruppen neu auslosen.')
      return
    }
    setState((current) => ({ ...current, knockoutBracket: bracket }))
    setNotice(`${activePlan.knockoutSize} Spieler qualifiziert · ${roundName(activePlan.knockoutSize, 0)} gestartet.`)
  }

  function selectWinner(roundIndex: number, matchIndex: number, winnerId: string) {
    if (!isAdmin) return
    setState((current) => ({
      ...current,
      knockoutBracket: current.knockoutBracket ? updateBracketWinner(current.knockoutBracket, roundIndex, matchIndex, winnerId || null) : null,
    }))
  }

  function updateKoRoundCount(roundIndex: number, matchIndex: number, rawCount: number) {
    const count = clamp(rawCount, 1, 3)
    setState((current) => {
      if (!current.knockoutBracket) return current
      const rounds = current.knockoutBracket.rounds.map((round, r) => round.map((match, m) => {
        if (r !== roundIndex || m !== matchIndex) return match
        const playerIds = [match.player1Id, match.player2Id].filter((id): id is string => Boolean(id))
        const stats = Object.fromEntries(playerIds.map((participantId) => [
          participantId,
          normalizeParticipantStats(match.stats?.[participantId], count),
        ]))
        return { ...match, kdaRoundCount: count, stats }
      }))
      return { ...current, knockoutBracket: { ...current.knockoutBracket, rounds } }
    })
  }

  function updateKoStat(roundIndex: number, matchIndex: number, participantId: string, kdaRoundIndex: number, field: keyof RoundStats, rawValue: string) {
    const value = Math.max(0, Math.trunc(Number(rawValue) || 0))
    setState((current) => {
      if (!current.knockoutBracket) return current
      const rounds = current.knockoutBracket.rounds.map((round, r) => round.map((match, m) => {
        if (r !== roundIndex || m !== matchIndex) return match
        const participantStats = normalizeParticipantStats(match.stats?.[participantId], match.kdaRoundCount || 1)
        const statsRounds = participantStats.rounds.map((roundStats, index) => index === kdaRoundIndex ? { ...roundStats, [field]: value } : { ...roundStats })
        return { ...match, stats: { ...(match.stats ?? {}), [participantId]: { rounds: statsRounds } } }
      }))
      return { ...current, knockoutBracket: { ...current.knockoutBracket, rounds } }
    })
  }

  async function refreshProfiles(silent = false) {
    if (!supabase || !isCreator) return
    const { data, error } = await supabase.from('profiles').select('id,email,approved,role,is_creator,access_status,created_at').order('created_at', { ascending: true })
    if (error) {
      if (!silent) setNotice(`Zugriffsanfragen konnten nicht geladen werden: ${error.message}`)
      return
    }
    setProfiles((data ?? []) as AccessProfile[])
    if (!silent) setNotice('Zugriffsanfragen aktualisiert.')
  }

  async function setProfileAccess(profileId: string, status: 'approved' | 'rejected') {
    if (!supabase || !isCreator) return
    const approved = status === 'approved'
    const { error } = await supabase
      .from('profiles')
      .update({ approved, role: approved ? 'admin' : 'viewer', access_status: status })
      .eq('id', profileId)

    if (error) {
      setNotice(`Zugriff konnte nicht geändert werden: ${error.message}`)
      return
    }

    setProfiles((current) => current.map((item) => item.id === profileId
      ? { ...item, approved, role: approved ? 'admin' : 'viewer', access_status: status }
      : item))
    setNotice(approved ? 'Account als Admin freigeschaltet.' : 'Zugriffsanfrage abgelehnt.')
  }

  async function removeRejectedProfile(profileId: string, profileEmail: string) {
    if (!supabase || !isCreator) return

    const target = profiles.find((item) => item.id === profileId)
    if (!target || target.is_creator || target.access_status !== 'rejected') {
      setNotice('Nur bereits abgelehnte Anfragen können endgültig entfernt werden.')
      return
    }

    if (!window.confirm(`Abgelehnte Anfrage von ${profileEmail} endgültig entfernen? Der Login-Account wird dabei ebenfalls gelöscht und kann sich später neu registrieren.`)) return

    setRemovingProfileId(profileId)
    try {
      const { data, error } = await supabase.functions.invoke('remove-rejected-admin-request', {
        body: { userId: profileId },
      })

      if (error) {
        let message = typeof data?.error === 'string' ? data.error : ''
        const context = (error as { context?: Response }).context
        if (!message && context) {
          try {
            const body = await context.clone().json() as { error?: string }
            message = body.error ?? ''
          } catch {
            // Fallback auf die allgemeine Fehlermeldung unten.
          }
        }
        throw new Error(message || 'Die abgelehnte Anfrage konnte nicht entfernt werden.')
      }

      if (data?.ok !== true) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Die abgelehnte Anfrage konnte nicht entfernt werden.')
      }

      setProfiles((current) => current.filter((item) => item.id !== profileId))
      setNotice(`Abgelehnte Anfrage von ${profileEmail} wurde endgültig entfernt.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Die abgelehnte Anfrage konnte nicht entfernt werden.')
    } finally {
      setRemovingProfileId(null)
    }
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setAuthBusy(true)
    try {
      if (authMode === 'register') {
        const normalizedEmail = email.trim().toLowerCase()
        const { data: registrationData, error: registrationError } = await supabase.functions.invoke('register-admin-request', {
          body: { email: normalizedEmail, password },
        })

        if (registrationError) {
          let message = typeof registrationData?.error === 'string' ? registrationData.error : ''
          const context = (registrationError as { context?: Response }).context
          if (!message && context) {
            try {
              const body = await context.clone().json() as { error?: string }
              message = body.error ?? ''
            } catch {
              // Fallback auf die allgemeine Fehlermeldung unten.
            }
          }
          throw new Error(message || 'Der Account konnte nicht angelegt werden. Bitte versuche es später erneut.')
        }

        if (registrationData?.ok !== true) {
          throw new Error(typeof registrationData?.error === 'string' ? registrationData.error : 'Der Account konnte nicht angelegt werden.')
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        if (signInError) {
          setAuthMode('login')
          setPassword('')
          setNotice('Account wurde angelegt und wartet auf Freischaltung. Bitte melde dich jetzt normal an.')
          return
        }

        setShowLogin(false)
        setNotice('Account angelegt. Keine E-Mail-Bestätigung nötig – die Freischaltung durch den Ersteller/Admin steht noch aus.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        setShowLogin(false)
        setNotice('Login erfolgreich. Berechtigungen werden geprüft …')
      }
      setPassword('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Login fehlgeschlagen.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function logout() {
    await supabase?.auth.signOut()
    setShowLogin(false)
    setNotice('Abgemeldet.')
  }

  async function resetTournament() {
    if (!supabase || !isAdmin) return
    if (!window.confirm('Turnierdaten wirklich zurücksetzen? Teilnehmer-Anmeldungen und Header-Inhalte bleiben erhalten.')) return
    setState((current) => ({ ...DEFAULT_STATE, participants: current.participants }))
    setNotice('Turnierdaten zurückgesetzt. Teilnehmer und Header-Inhalte wurden behalten.')
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `feelings-turnier-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function importState(file: File | undefined) {
    if (!file || !isAdmin) return
    try {
      const parsed = JSON.parse(await file.text()) as Partial<TournamentState>
      if (!Array.isArray(parsed.groups)) throw new Error('Ungültiges Format')
      const groupRoundCount = clamp(Number(parsed.groupRoundCount) || 3, 1, 7)
      setState((current) => ({
        participants: current.participants,
        groupCount: clamp(Number(parsed.groupCount) || 1, 1, 10),
        groupRoundCount,
        groups: parsed.groups ?? [],
        stats: Object.fromEntries(current.participants.map((participant) => [
          participant.id,
          normalizeParticipantStats(parsed.stats?.[participant.id], groupRoundCount),
        ])),
        knockoutBracket: normalizeBracket(parsed.knockoutBracket),
      }))
      setNotice('Turnierstand importiert.')
    } catch {
      setNotice('Import fehlgeschlagen.')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  const defaultFloralUrl = `${import.meta.env.BASE_URL}brume-floral-default.png`

  return (
    <div className="app-shell">
      {!background.hideDefaultFloral && (
        <div
          className="site-background-layer site-background-layer--floral"
          style={{ backgroundImage: `url("${defaultFloralUrl}")` }}
          aria-hidden="true"
        />
      )}
      {background.enabled && background.url && (
        <div
          className="site-background-layer site-background-layer--custom"
          style={{
            backgroundImage: `url("${background.url}")`,
            backgroundSize: background.fit,
            backgroundPosition: background.position,
            backgroundRepeat: background.repeat,
            opacity: background.opacity / 100,
          }}
          aria-hidden="true"
        />
      )}
      <header className="topbar">
        <div className="container topbar__inner">
          <a className="brand" href="#top"><span className="brand__live">LIVE</span><span>FEELINGS//TOURNAMENT</span></a>
          <div className="topbar__actions">
            {isAdmin ? (
              <><span className="access-pill access-pill--admin">ADMIN · {profile?.email}</span><button className="button button--ghost" onClick={() => void logout()}>Abmelden</button></>
            ) : user ? (
              <><span className="access-pill">FREISCHALTUNG AUSSTEHEND</span><button className="button button--ghost" onClick={() => void logout()}>Abmelden</button></>
            ) : (
              <button className="button button--twitch" onClick={() => setShowLogin(true)}>Admin Login</button>
            )}
          </div>
        </div>
      </header>

      <header className="hero" id="top">
        <div className="hero__grid" />
        <div className="container hero__content">
          <div className="hero__copy">
            <p className="eyebrow">BRUME FEELINGS · COMMUNITY GAMING EVENT</p>
            <h1>{hero.titleLine1}<br /><span>{hero.titleLine2}</span></h1>
            <p className="hero__lead">{hero.lead}</p>
            <div className="hero__tags">{hero.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
          </div>

          <div className={`stream-card stream-card--twitch stream-card--${twitchLiveState}`}>
            <div className="stream-card__bar">
              <span className={`live-dot live-dot--${twitchLiveState}`} />
              <span className="stream-status" aria-live="polite">{twitchStatusLabel}</span>
              <a className="stream-card__channel-link" href="https://www.twitch.tv/brumefeelings" target="_blank" rel="noreferrer">brumefeelings ↗</a>
            </div>
            <div className="stream-card__screen stream-card__screen--embed">
              <div
                id={TWITCH_PLAYER_HOST_ID}
                ref={twitchPlayerRef}
                className="twitch-embed"
                aria-label="Twitch Livestream brumefeelings"
              />
            </div>
            <div className="stream-card__actions">
              <span>{twitchLiveState === 'live' ? 'BrumeFeelings streamt gerade live.' : twitchLiveState === 'offline' ? 'Der Kanal ist aktuell offline.' : twitchLiveState === 'unavailable' ? 'Der Live-Status konnte gerade nicht geladen werden.' : 'Twitch-Status wird geladen.'}</span>
              <div className="twitch-player-tools">
                <label className="twitch-quality-control">
                  <span>Qualität</span>
                  <select
                    className="twitch-quality-select"
                    value={twitchSelectedQuality}
                    onChange={(event) => changeTwitchQuality(event.target.value as TwitchQualityKey)}
                    aria-label="Twitch Streamqualität auswählen"
                  >
                    <option value="auto" disabled={!twitchQualities.auto}>Auto{!twitchQualities.auto ? ' · nicht verfügbar' : ''}</option>
                    {TWITCH_QUALITY_TARGETS.map((quality) => {
                      const key = String(quality) as TwitchQualityKey
                      const available = Boolean(twitchQualities[key])
                      return <option key={quality} value={key} disabled={!available}>{quality}p{available ? '' : ' · nicht verfügbar'}</option>
                    })}
                  </select>
                </label>
                <a className="twitch-open-button" href="https://www.twitch.tv/brumefeelings" target="_blank" rel="noreferrer">Auf Twitch öffnen ↗</a>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container main-grid">
        {notice && <div className="notice" role="status">{notice}</div>}
        {!supabaseConfigured && <div className="setup-warning">Supabase ist noch nicht konfiguriert. Siehe README und <code>.env.example</code>.</div>}

        <section className="panel registration-panel" id="teilnehmer">
          <div className="section-heading"><div><span className="step">01</span><h2>Teilnehmer</h2></div>{isAdmin && <span className="counter">{state.participants.length} angemeldet</span>}</div>
          <p className="muted">{isAdmin ? 'Als Admin siehst du alle Anmeldungen und kannst Teilnehmer verwalten.' : 'Trage deinen Gamer-Tag ein. Die Namen bereits angemeldeter Personen sind nur für freigeschaltete Admins sichtbar.'}</p>
          <div className="input-row participant-submit">
            <input className="text-input" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addSingleParticipant() }} placeholder="Name oder Gamer-Tag" maxLength={40} />
            <button className="button" onClick={() => void addSingleParticipant()}>Für Turnier anmelden</button>
          </div>
          {isAdmin && <>
            <details className="bulk-add"><summary>Mehrere Teilnehmer hinzufügen</summary><textarea className="text-area" value={bulkNames} onChange={(event) => setBulkNames(event.target.value)} placeholder="Eine Person pro Zeile" /><button className="button button--secondary" onClick={() => void addBulkParticipants()}>Liste übernehmen</button></details>
            <div className="admin-toolbar"><button className="button button--ghost" onClick={() => void refreshParticipants()}>Anmeldungen aktualisieren</button></div>
            <div className="chips">{state.participants.map((participant, index) => <div className="chip" key={participant.id}><span className="chip__index">{index + 1}</span><span>{participant.name}</span><button className="chip__remove" onClick={() => void removeParticipant(participant.id)} aria-label={`${participant.name} entfernen`}>×</button></div>)}</div>
          </>}
        </section>

        <section className="panel scoring-panel">
          <div className="section-heading"><div><span className="step">02</span><h2>KDA-Wertung</h2></div></div>
          <div className="score-rules">
            <div className="rule"><strong>+{formatPoints(scoringWeights.kill)}</strong><span>Kill</span></div>
            <div className="rule"><strong>+{formatPoints(scoringWeights.assist)}</strong><span>Assist</span></div>
            <div className="rule rule--negative"><strong>−{formatPoints(scoringWeights.death)}</strong><span>Death</span></div>
            <div className="rule"><strong>+{formatPoints(scoringWeights.positiveBonus)}</strong><span>K + A &gt; D</span></div>
            <div className="rule rule--negative"><strong>−{formatPoints(scoringWeights.negativePenalty)}</strong><span>K + A &lt; D</span></div>
          </div>
        </section>

        {!isAdmin ? (
          <section className="panel locked-panel"><div className="lock-icon">⌁</div><div><p className="eyebrow">ADMIN CHANNEL</p><h2>Turniersteuerung geschützt</h2><p className="muted">Gruppen, Ranglisten, Teilnehmernamen, KDA-Eingaben und K.O.-Matches sind nur für freigeschaltete Accounts sichtbar.</p>{user && !profile?.approved && <p className="pending-note">Dein Account ist angemeldet, wartet aber noch auf Freischaltung.</p>}</div></section>
        ) : (
          <>
            <section className="panel settings-panel" id="einstellungen">
              <div className="section-heading"><div><span className="step">ADMIN</span><h2>Website & Turnier-Einstellungen</h2></div></div>
              <div className="settings-tabs" role="tablist" aria-label="Admin Einstellungen">
                <button className={settingsTab === 'header' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('header')}>Header-Inhalte</button>
                <button className={settingsTab === 'background' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('background')}>Website-Hintergrund</button>
                <button className={settingsTab === 'scoring' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('scoring')}>KDA-Gewichtung</button>
                <button className={settingsTab === 'group' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('group')}>Gruppenphase</button>
              </div>

              {settingsTab === 'header' ? (
                <div className="settings-content">
                  <p className="muted">Diese Texte sind öffentlich sichtbar. Änderungen erscheinen nach dem Speichern auch für ausgeloggte Besucher.</p>
                  <div className="settings-form-grid">
                    <label>Titel – Zeile 1<input className="text-input" maxLength={40} value={hero.titleLine1} onChange={(event) => setHero((current) => ({ ...current, titleLine1: event.target.value }))} /></label>
                    <label>Titel – Zeile 2<input className="text-input" maxLength={40} value={hero.titleLine2} onChange={(event) => setHero((current) => ({ ...current, titleLine2: event.target.value }))} /></label>
                    <label className="settings-wide">Beschreibung<textarea className="text-area" maxLength={240} value={hero.lead} onChange={(event) => setHero((current) => ({ ...current, lead: event.target.value }))} /></label>
                    {hero.tags.map((tag, index) => <label key={index}>Tag {index + 1}<input className="text-input" maxLength={32} value={tag} onChange={(event) => setHero((current) => ({ ...current, tags: current.tags.map((item, tagIndex) => tagIndex === index ? event.target.value : item) }))} /></label>)}
                  </div>
                  <button className="button button--twitch" disabled={siteSaving} onClick={() => void saveHeroSettings()}>{siteSaving ? 'Wird gespeichert …' : 'Header veröffentlichen'}</button>
                </div>
              ) : settingsTab === 'background' ? (
                <div className="settings-content background-settings">
                  <p className="muted">Lade einen eigenen Website-Hintergrund hoch. Er wird in Supabase gespeichert und ist nach dem Veröffentlichen für alle Besucher sichtbar. PNG, JPG und WebP bis 10 MB sind erlaubt.</p>
                  <div className="background-preview" aria-label="Hintergrund Vorschau">
                    {!background.hideDefaultFloral && <img src={defaultFloralUrl} alt="Florales Brume/Twitch Standardmuster" />}
                    {background.enabled && background.url && <img className="background-preview__custom" src={background.url} alt="Aktueller eigener Website-Hintergrund" />}
                    {!background.enabled && <span>Standarddesign aktiv</span>}
                  </div>

                  <div className="background-upload-actions">
                    <input
                      ref={backgroundInputRef}
                      className="visually-hidden-file"
                      id="site-background-upload"
                      type="file"
                      disabled={backgroundUploadBusy}
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void uploadSiteBackground(event.target.files?.[0] ?? null)}
                    />
                    <label className="button button--twitch" htmlFor="site-background-upload" aria-disabled={backgroundUploadBusy}>{backgroundUploadBusy ? 'Bild wird hochgeladen …' : 'Bilddatei hochladen'}</label>
                    {background.path && <button className="button button--danger" disabled={backgroundUploadBusy || siteSaving} onClick={() => void removeSiteBackground()}>Eigenes Bild entfernen</button>}
                  </div>

                  <div className="background-settings-grid">
                    <label className="background-toggle"><input type="checkbox" checked={background.enabled} disabled={!background.url} onChange={(event) => setBackground((current) => ({ ...current, enabled: event.target.checked }))} /><span>Eigenes Hintergrundbild aktivieren</span></label>
                    <label className="background-toggle"><input type="checkbox" checked={background.hideDefaultFloral} onChange={(event) => setBackground((current) => ({ ...current, hideDefaultFloral: event.target.checked }))} /><span>Florales Standardmuster darunter ausblenden</span></label>
                    <label>Darstellung<select className="select-input" value={background.fit} onChange={(event) => setBackground((current) => ({ ...current, fit: event.target.value as SiteBackgroundSettings['fit'] }))}><option value="cover">Cover · Fläche füllen</option><option value="contain">Contain · vollständig sichtbar</option></select></label>
                    <label>Position<select className="select-input" value={background.position} onChange={(event) => setBackground((current) => ({ ...current, position: event.target.value as SiteBackgroundSettings['position'] }))}><option value="center top">Oben mittig</option><option value="center center">Mittig</option><option value="left top">Oben links</option><option value="right top">Oben rechts</option></select></label>
                    <label>Wiederholung<select className="select-input" value={background.repeat} onChange={(event) => setBackground((current) => ({ ...current, repeat: event.target.value as SiteBackgroundSettings['repeat'] }))}><option value="no-repeat">Nicht wiederholen</option><option value="repeat">Horizontal & vertikal kacheln</option><option value="repeat-y">Nur vertikal wiederholen</option></select></label>
                    <label className="background-opacity">Deckkraft · {background.opacity}%<input type="range" min="10" max="100" step="1" value={background.opacity} onChange={(event) => setBackground((current) => ({ ...current, opacity: Number(event.target.value) }))} /></label>
                  </div>

                  <div className="background-settings-footer">
                    <button className="button button--twitch" disabled={siteSaving || backgroundUploadBusy} onClick={() => void saveBackgroundSettings()}>{siteSaving ? 'Wird gespeichert …' : 'Hintergrund veröffentlichen'}</button>
                    <button className="button button--ghost" disabled={siteSaving || backgroundUploadBusy} onClick={() => setBackground(DEFAULT_BACKGROUND)}>Einstellungen auf Standard setzen</button>
                  </div>
                </div>
              ) : settingsTab === 'scoring' ? (
                <div className="settings-content">
                  <p className="muted">Passe die Punktegewichtung global an. Die Werte gelten für die Ranglisten der Gruppenphase und für alle KDA-Punkte in der K.O.-Phase.</p>
                  <div className="settings-form-grid">
                    <label>Punkte pro Kill<input className="text-input" type="number" min="0" max="20" step="0.1" value={scoringWeights.kill} onChange={(event) => setScoringWeights((current) => ({ ...current, kill: Number(event.target.value || 0) }))} /></label>
                    <label>Punkte pro Assist<input className="text-input" type="number" min="0" max="20" step="0.1" value={scoringWeights.assist} onChange={(event) => setScoringWeights((current) => ({ ...current, assist: Number(event.target.value || 0) }))} /></label>
                    <label>Abzug pro Death<input className="text-input" type="number" min="0" max="20" step="0.1" value={scoringWeights.death} onChange={(event) => setScoringWeights((current) => ({ ...current, death: Number(event.target.value || 0) }))} /></label>
                    <label>Bonus bei positiver Runde<input className="text-input" type="number" min="0" max="20" step="0.1" value={scoringWeights.positiveBonus} onChange={(event) => setScoringWeights((current) => ({ ...current, positiveBonus: Number(event.target.value || 0) }))} /></label>
                    <label>Abzug bei negativer Runde<input className="text-input" type="number" min="0" max="20" step="0.1" value={scoringWeights.negativePenalty} onChange={(event) => setScoringWeights((current) => ({ ...current, negativePenalty: Number(event.target.value || 0) }))} /></label>
                  </div>
                  <div className="plan-card">
                    <span>FORMEL</span>
                    <strong>K × {formatPoints(scoringWeights.kill)} + A × {formatPoints(scoringWeights.assist)} − D × {formatPoints(scoringWeights.death)}</strong>
                    <em>Rundensaldo: +{formatPoints(scoringWeights.positiveBonus)} bei K+A&gt;D · −{formatPoints(scoringWeights.negativePenalty)} bei K+A&lt;D</em>
                  </div>
                  <p className="settings-warning">Die Einordnung „positive/negative Runde“ basiert weiterhin auf den echten Werten Kills + Assists im Vergleich zu Deaths. Wenn eine K.O.-Phase bereits erzeugt wurde und sich durch neue Gewichte die Gruppenrangliste ändert, setze die K.O.-Phase anschließend neu, damit die Qualifikanten neu bestimmt werden.</p>
                  <div className="admin-tools__actions">
                    <button className="button button--twitch" disabled={siteSaving} onClick={() => void saveScoringSettings()}>{siteSaving ? 'Wird gespeichert …' : 'KDA-Gewichtung veröffentlichen'}</button>
                    <button className="button button--ghost" disabled={siteSaving} onClick={() => setScoringWeights({ ...DEFAULT_SCORING })}>Standardwerte laden</button>
                  </div>
                </div>
              ) : (
                <div className="settings-content">
                  <p className="muted">Lege fest, aus wie vielen KDA-Runden die Gruppenphase besteht. Erlaubt sind 1 bis 7 Runden.</p>
                  <div className="round-setting-card">
                    <label className="field-label" htmlFor="group-round-count">KDA-Runden in der Gruppenphase</label>
                    <select id="group-round-count" className="select-input" value={state.groupRoundCount} onChange={(event) => setGroupRoundCount(Number(event.target.value))}>
                      {Array.from({ length: 7 }, (_, index) => index + 1).map((count) => <option value={count} key={count}>{count} Runde{count === 1 ? '' : 'n'}</option>)}
                    </select>
                    <strong>{state.groupRoundCount} / 7</strong>
                  </div>
                  <p className="settings-warning">Änderst du die Rundenzahl nach Beginn der Gruppenphase, bleiben vorhandene Werte soweit möglich erhalten. Eine bereits erzeugte K.O.-Phase wird zurückgesetzt, da sich die Rangliste ändern kann.</p>
                </div>
              )}
            </section>

            <section className="panel" id="gruppen">
              <div className="section-heading"><div><span className="step">03</span><h2>Gruppen-Setup</h2></div></div>
              <div className="group-controls">
                <label className="field-label" htmlFor="group-count">Gewünschte Gruppen</label>
                <select id="group-count" className="select-input" value={state.groupCount} onChange={(event) => setState((current) => ({ ...current, groupCount: Number(event.target.value), knockoutBracket: null }))}>{Array.from({ length: 10 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select>
                <button className="button" onClick={createGroups}>Gruppen automatisch erstellen</button>
              </div>
              <div className="plan-card"><span>AUTO PLAN</span><strong>{planText(previewPlan)}</strong><em>{state.groupRoundCount} KDA-Runde{state.groupRoundCount === 1 ? '' : 'n'} pro Spieler</em></div>
            </section>

            {state.groups.map((group) => {
              const standings = buildStandings(group, state.participants, state.stats, scoringWeights)
              const qualified = activePlan?.qualifiersPerGroup ?? 0
              return <section className="panel group-panel" key={group.id}>
                <div className="section-heading"><div><span className="step">{group.name}</span><h2>{group.participantIds.length} Spieler</h2></div></div>
                <h3>{state.groupRoundCount} KDA-Runde{state.groupRoundCount === 1 ? '' : 'n'}</h3>
                <div className="stats-wrap"><table className="stats-table" style={{ minWidth: `${Math.max(780, 180 + state.groupRoundCount * 190)}px` }}>
                  <thead><tr><th>Spieler</th>{Array.from({ length: state.groupRoundCount }, (_, index) => index + 1).flatMap((round) => [<th key={`${round}k`}>S{round} K</th>, <th key={`${round}a`}>A</th>, <th key={`${round}d`}>D</th>, <th key={`${round}p`}>Pkt.</th>])}<th>Gesamt</th></tr></thead>
                  <tbody>{group.participantIds.map((participantId) => {
                    const participantStats = normalizeParticipantStats(state.stats[participantId], state.groupRoundCount)
                    const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, scoringWeights), 0)
                    return <tr key={participantId}><th className="player-cell">{participantMap.get(participantId)?.name ?? 'Unbekannt'}</th>{participantStats.rounds.flatMap((round, roundIndex) => [
                      <td key={`${roundIndex}k`}><StatInput value={round.kills} onChange={(value) => updateStat(participantId, roundIndex, 'kills', value)} /></td>,
                      <td key={`${roundIndex}a`}><StatInput value={round.assists} onChange={(value) => updateStat(participantId, roundIndex, 'assists', value)} /></td>,
                      <td key={`${roundIndex}d`}><StatInput value={round.deaths} onChange={(value) => updateStat(participantId, roundIndex, 'deaths', value)} /></td>,
                      <td className={calculateRoundScore(round, scoringWeights) < 0 ? 'points points--negative' : 'points'} key={`${roundIndex}p`}>{formatPoints(calculateRoundScore(round, scoringWeights))}</td>,
                    ])}<td className={total < 0 ? 'total total--negative' : 'total'}>{formatPoints(total)}</td></tr>
                  })}</tbody>
                </table></div>
                <div className="standings-list">{standings.map((row, index) => <div className={`standing ${index < qualified ? 'standing--qualified' : ''}`} key={row.participantId}><span className="standing__rank">{index + 1}</span><strong>{row.name}</strong><span className="standing__kda">{row.kills} K · {row.assists} A · {row.deaths} D</span><span className="standing__points">{formatPoints(row.totalPoints)} Pkt.</span>{index < qualified && <span className="qualified-tag">Q</span>}</div>)}</div>
              </section>
            })}

            {state.groups.length > 0 && <section className="panel ko-panel">
              <div className="section-heading"><div><span className="step">04</span><h2>Globale K.O.-Phase</h2></div>{championId && <span className="champion-badge">CHAMPION · {participantMap.get(championId)?.name}</span>}</div>
              <p className="muted">{planText(activePlan)}. Zusätzlich kann jedes K.O.-Match mit 1 bis 3 eigenen KDA-Runden dokumentiert werden.</p>
              <button className="button button--twitch" onClick={generateGlobalBracket}>{state.knockoutBracket ? 'K.O.-Phase neu setzen' : 'Gruppenphase abschließen → K.O. starten'}</button>

              {state.knockoutBracket && <div className="bracket">{state.knockoutBracket.rounds.map((round, roundIndex) => <div className="bracket-round" key={roundIndex}>
                <h4>{roundName(state.knockoutBracket!.qualifierIds.length, roundIndex)}</h4>
                <div className="round-matches">{round.map((match, matchIndex) => <KnockoutMatchCard
                  key={match.id}
                  match={match}
                  roundIndex={roundIndex}
                  matchIndex={matchIndex}
                  participantMap={participantMap}
                  scoringWeights={scoringWeights}
                  onRoundCount={updateKoRoundCount}
                  onStat={updateKoStat}
                  onWinner={selectWinner}
                />)}</div>
              </div>)}</div>}
            </section>}

            {isCreator && <section className="panel access-panel">
              <div className="section-heading">
                <div><span className="step">OWNER</span><h2>Admin-Zugriffsanfragen</h2></div>
                <span className="counter">{profiles.filter((item) => item.access_status === 'pending').length} offen</span>
              </div>
              <p className="muted">Nur du als Ersteller (<strong>turnier.admin@gmx.de</strong>) kannst neue Admins freischalten oder Anfragen ablehnen. Abgelehnte Anfragen kannst du anschließend endgültig entfernen; dabei wird auch der zugehörige Login-Account gelöscht und die Adresse kann sich später neu registrieren. Neue erfolgreiche Registrierungen werden automatisch aktualisiert.</p>
              <div className="admin-toolbar"><button className="button button--ghost" onClick={() => void refreshProfiles()}>Jetzt aktualisieren</button></div>
              <div className="access-list">
                {profiles.map((item) => {
                  const statusText = item.is_creator
                    ? 'Ersteller · dauerhaft freigeschaltet'
                    : item.access_status === 'approved'
                      ? 'Als Admin freigeschaltet'
                      : item.access_status === 'rejected'
                        ? 'Anfrage abgelehnt'
                        : 'Wartet auf Entscheidung'
                  return <div className="access-row" key={item.id}>
                    <div><strong>{item.email}</strong><span>{statusText}</span></div>
                    {!item.is_creator && <div className="access-row__actions">
                      {item.access_status !== 'approved' && <button className="button" onClick={() => void setProfileAccess(item.id, 'approved')}>Freischalten</button>}
                      {item.access_status !== 'rejected' && <button className="button button--danger" onClick={() => void setProfileAccess(item.id, 'rejected')}>{item.access_status === 'approved' ? 'Zugriff entziehen' : 'Ablehnen'}</button>}
                      {item.access_status === 'rejected' && <button className="button button--danger" disabled={removingProfileId === item.id} onClick={() => void removeRejectedProfile(item.id, item.email)}>{removingProfileId === item.id ? 'Wird entfernt …' : 'Endgültig entfernen'}</button>}
                    </div>}
                  </div>
                })}
              </div>
            </section>}

            <section className="panel admin-tools"><div><h2>Admin Tools</h2><p className="muted">Turnierstand exportieren/importieren oder Turnierdaten zurücksetzen.</p></div><div className="admin-tools__actions"><button className="button button--ghost" onClick={downloadJson}>Export</button><button className="button button--ghost" onClick={() => importRef.current?.click()}>Import</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importState(event.target.files?.[0])} /><button className="button button--danger" onClick={() => void resetTournament()}>Turnier zurücksetzen</button></div></section>
          </>
        )}
      </main>

      <footer className="footer"><div className="container">FEELINGS//TOURNAMENT · secure admin mode · powered by Supabase</div></footer>

      {showLogin && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowLogin(false) }}><div className="auth-modal"><button className="modal-close" onClick={() => setShowLogin(false)}>×</button><p className="eyebrow">SECURE ACCESS</p><h2>{authMode === 'login' ? 'Admin Login' : 'Account registrieren'}</h2><p className="muted">Neue Accounts werden ohne Bestätigungs-Mail angelegt und bleiben zunächst gesperrt. Ausschließlich der Ersteller/Admin kann sie freischalten.</p><form className="auth-form" onSubmit={(event) => void handleAuth(event)}><label>E-Mail<input className="text-input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Passwort<input className="text-input" type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="button button--twitch" disabled={authBusy || authLoading}>{authBusy ? 'Bitte warten …' : authMode === 'login' ? 'Einloggen' : 'Registrieren'}</button></form><button className="auth-switch" onClick={() => setAuthMode((mode) => mode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Noch keinen Account? Registrieren' : 'Bereits registriert? Zum Login'}</button></div></div>}
    </div>
  )
}

function KnockoutMatchCard({
  match,
  roundIndex,
  matchIndex,
  participantMap,
  scoringWeights,
  onRoundCount,
  onStat,
  onWinner,
}: {
  match: KnockoutMatch
  roundIndex: number
  matchIndex: number
  participantMap: Map<string, Participant>
  scoringWeights: ScoringWeights
  onRoundCount: (roundIndex: number, matchIndex: number, count: number) => void
  onStat: (roundIndex: number, matchIndex: number, participantId: string, kdaRoundIndex: number, field: keyof RoundStats, value: string) => void
  onWinner: (roundIndex: number, matchIndex: number, winnerId: string) => void
}) {
  const playerIds = [match.player1Id, match.player2Id]
  return <div className="match-card">
    <span className="match-number">MATCH {matchIndex + 1}</span>
    <div className="ko-round-control"><span>KDA-Runden</span><select className="select-input select-input--compact" value={match.kdaRoundCount || 1} onChange={(event) => onRoundCount(roundIndex, matchIndex, Number(event.target.value))}>{[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}</select></div>

    {playerIds.map((participantId, playerIndex) => {
      const playerName = participantId ? participantMap.get(participantId)?.name ?? 'Unbekannt' : 'TBD'
      if (!participantId) return <div className="ko-player-block ko-player-block--empty" key={`empty-${playerIndex}`}><strong>{playerName}</strong><span>Wartet auf vorheriges Match</span></div>
      const participantStats = normalizeParticipantStats(match.stats?.[participantId], match.kdaRoundCount || 1)
      const total = participantStats.rounds.reduce((sum, roundStats) => sum + calculateRoundScore(roundStats, scoringWeights), 0)
      return <div className={match.winnerId === participantId ? 'ko-player-block ko-player-block--winner' : 'ko-player-block'} key={participantId}>
        <div className="ko-player-title"><strong>{playerName}</strong><span className={total < 0 ? 'points points--negative' : 'points'}>{formatPoints(total)} Pkt.</span></div>
        <div className="ko-kda-rounds">{participantStats.rounds.map((roundStats, kdaRoundIndex) => <div className="ko-kda-row" key={kdaRoundIndex}>
          <span className="ko-kda-round-label">R{kdaRoundIndex + 1}</span>
          <label>K<StatInput value={roundStats.kills} onChange={(value) => onStat(roundIndex, matchIndex, participantId, kdaRoundIndex, 'kills', value)} /></label>
          <label>A<StatInput value={roundStats.assists} onChange={(value) => onStat(roundIndex, matchIndex, participantId, kdaRoundIndex, 'assists', value)} /></label>
          <label>D<StatInput value={roundStats.deaths} onChange={(value) => onStat(roundIndex, matchIndex, participantId, kdaRoundIndex, 'deaths', value)} /></label>
          <span className={calculateRoundScore(roundStats, scoringWeights) < 0 ? 'ko-round-points points--negative' : 'ko-round-points'}>{formatPoints(calculateRoundScore(roundStats, scoringWeights))}</span>
        </div>)}</div>
      </div>
    })}

    <select className="winner-select" disabled={!match.player1Id || !match.player2Id} value={match.winnerId ?? ''} onChange={(event) => onWinner(roundIndex, matchIndex, event.target.value)}>
      <option value="">Sieger wählen</option>
      {match.player1Id && <option value={match.player1Id}>{participantMap.get(match.player1Id)?.name}</option>}
      {match.player2Id && <option value={match.player2Id}>{participantMap.get(match.player2Id)?.name}</option>}
    </select>
  </div>
}

function StatInput({ value, onChange }: { value: number; onChange: (value: string) => void }) {
  return <input className="stat-input" type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} />
}

export default App

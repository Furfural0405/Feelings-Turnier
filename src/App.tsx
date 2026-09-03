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
import { calculateRoundScore, emptyParticipantStats, formatPoints } from './lib/scoring'
import { supabase, supabaseConfigured } from './lib/supabase'
import type {
  AccessProfile,
  Participant,
  ParticipantStats,
  QualificationPlan,
  RoundStats,
  StoredTournamentState,
  TournamentState,
} from './types'

const DEFAULT_STATE: TournamentState = {
  participants: [],
  groupCount: 2,
  groups: [],
  stats: {},
  knockoutBracket: null,
}

function planText(plan: QualificationPlan | null): string {
  if (!plan) return 'Ab 4 Teilnehmern kann eine K.O.-Phase erzeugt werden.'
  const override = plan.smallTournamentOverride ? ' · Sonderregel unter 8 Teilnehmern' : ''
  return `${plan.groupCount} Gruppe${plan.groupCount === 1 ? '' : 'n'} · Top ${plan.qualifiersPerGroup} · ${plan.knockoutSize} Spieler · ${roundName(plan.knockoutSize, 0)}${override}`
}

function storedState(state: TournamentState): StoredTournamentState {
  return {
    groupCount: state.groupCount,
    groups: state.groups,
    stats: state.stats,
    knockoutBracket: state.knockoutBracket,
  }
}

function App() {
  const [state, setState] = useState<TournamentState>(DEFAULT_STATE)
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
  const importRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number | null>(null)

  const isAdmin = Boolean(profile?.approved && profile.role === 'admin')
  const participantMap = useMemo(
    () => new Map(state.participants.map((participant) => [participant.id, participant])),
    [state.participants],
  )
  const previewPlan = useMemo(
    () => createQualificationPlan(state.participants.length, state.groupCount),
    [state.participants.length, state.groupCount],
  )
  const activePlan = useMemo(
    () =>
      state.groups.length > 0
        ? createQualificationPlanForExistingGroups(state.participants.length, state.groups.length)
        : previewPlan,
    [previewPlan, state.groups.length, state.participants.length],
  )
  const championId = state.knockoutBracket?.rounds.at(-1)?.[0]?.winnerId ?? null

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 4200)
    return () => window.clearTimeout(timeout)
  }, [notice])

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
        .select('id,email,approved,role,created_at')
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
    return () => {
      cancelled = true
    }
  }, [user])

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
        supabase!
          .from('profiles')
          .select('id,email,approved,role,created_at')
          .order('created_at', { ascending: true }),
      ])

      if (cancelled) return
      if (participantResult.error || stateResult.error || profileResult.error) {
        setNotice(
          participantResult.error?.message ?? stateResult.error?.message ?? profileResult.error?.message ?? 'Daten konnten nicht geladen werden.',
        )
        return
      }

      const participants = (participantResult.data ?? []) as Participant[]
      const payload = (stateResult.data?.payload ?? {}) as Partial<StoredTournamentState>
      setState({
        participants,
        groupCount: Number(payload.groupCount) >= 1 ? Number(payload.groupCount) : 2,
        groups: Array.isArray(payload.groups) ? payload.groups : [],
        stats: payload.stats && typeof payload.stats === 'object' ? payload.stats : {},
        knockoutBracket: payload.knockoutBracket ?? null,
      })
      setProfiles((profileResult.data ?? []) as AccessProfile[])
      setAdminDataLoaded(true)
    }

    void loadAdminData()
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  useEffect(() => {
    if (!supabase || !isAdmin || !adminDataLoaded || !user) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)

    saveTimer.current = window.setTimeout(() => {
      void supabase!
        .from('tournament_state')
        .upsert(
          {
            id: 1,
            payload: storedState(state),
            updated_at: new Date().toISOString(),
            updated_by: user.id,
          },
          { onConflict: 'id' },
        )
        .then(({ error }) => {
          if (error) setNotice(`Speichern fehlgeschlagen: ${error.message}`)
        })
    }, 700)

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [state.groupCount, state.groups, state.stats, state.knockoutBracket, isAdmin, adminDataLoaded, user])

  async function refreshParticipants() {
    if (!supabase || !isAdmin) return
    const { data, error } = await supabase.from('participants').select('id,name').order('created_at', { ascending: true })
    if (error) {
      setNotice(error.message)
      return
    }
    const participants = (data ?? []) as Participant[]
    setState((current) => ({ ...current, participants }))
  }

  async function submitParticipant(name: string) {
    const cleaned = name.trim()
    if (!cleaned) return false
    if (!supabase) {
      setNotice('Supabase ist noch nicht konfiguriert.')
      return false
    }

    const { error } = await supabase.from('participants').insert({
      name: cleaned,
      submitted_by: user?.id ?? null,
    })

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
        groups: current.groups.map((group) => ({
          ...group,
          participantIds: group.participantIds.filter((id) => id !== participantId),
        })),
        stats,
        knockoutBracket: null,
      }
    })
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
    const stats = Object.fromEntries(state.participants.map((participant) => [participant.id, emptyParticipantStats()]))

    setState((current) => ({
      ...current,
      groupCount: actualGroupCount,
      groups,
      stats,
      knockoutBracket: null,
    }))

    if (!plan) setNotice('Gruppen erstellt. Eine K.O.-Phase benötigt mindestens 4 Teilnehmer.')
    else if (plan.adjusted) setNotice(`Automatisch angepasst: ${plan.requestedGroupCount} → ${plan.groupCount} Gruppen. ${planText(plan)}`)
    else setNotice(`Gruppen erstellt. ${planText(plan)}`)
  }

  function updateStat(participantId: string, roundIndex: number, field: keyof RoundStats, rawValue: string) {
    if (!isAdmin) return
    const value = Math.max(0, Math.trunc(Number(rawValue) || 0))
    setState((current) => {
      const participantStats = current.stats[participantId] ?? emptyParticipantStats()
      const rounds = participantStats.rounds.map((round, index) =>
        index === roundIndex ? { ...round, [field]: value } : { ...round },
      ) as ParticipantStats['rounds']
      return {
        ...current,
        stats: { ...current.stats, [participantId]: { rounds } },
        knockoutBracket: null,
      }
    })
  }

  function generateGlobalBracket() {
    if (!isAdmin || state.groups.length === 0 || !activePlan) {
      setNotice('Für die aktuelle Konfiguration kann noch keine K.O.-Phase erstellt werden.')
      return
    }

    const bracket = createGlobalKnockoutBracket(state.groups, state.participants, state.stats, activePlan.qualifiersPerGroup)
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
      knockoutBracket: current.knockoutBracket
        ? updateBracketWinner(current.knockoutBracket, roundIndex, matchIndex, winnerId || null)
        : null,
    }))
  }

  async function refreshProfiles() {
    if (!supabase || !isAdmin) return
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,approved,role,created_at')
      .order('created_at', { ascending: true })
    if (error) {
      setNotice(error.message)
      return
    }
    setProfiles((data ?? []) as AccessProfile[])
    setNotice('Zugriffsanfragen aktualisiert.')
  }

  async function approveProfile(profileId: string, approved: boolean) {
    if (!supabase || !isAdmin) return
    const { error } = await supabase
      .from('profiles')
      .update({ approved, role: approved ? 'admin' : 'viewer' })
      .eq('id', profileId)
    if (error) {
      setNotice(error.message)
      return
    }
    setProfiles((current) => current.map((item) => item.id === profileId ? { ...item, approved, role: approved ? 'admin' : 'viewer' } : item))
    setNotice(approved ? 'Zugriff freigeschaltet.' : 'Admin-Zugriff entzogen.')
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setAuthBusy(true)
    try {
      if (authMode === 'register') {
        const redirectTo = `${window.location.origin}${window.location.pathname}`
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectTo },
        })
        if (error) throw error
        setNotice('Account angelegt. Prüfe ggf. deine E-Mail. Danach muss ein Admin deinen Zugriff freischalten.')
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
    if (!window.confirm('Turnierdaten wirklich zurücksetzen? Die Teilnehmer-Anmeldungen bleiben erhalten.')) return
    setState((current) => ({ ...DEFAULT_STATE, participants: current.participants }))
    setNotice('Turnierdaten zurückgesetzt. Teilnehmer-Anmeldungen wurden behalten.')
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
      setState((current) => ({
        participants: current.participants,
        groupCount: Math.max(1, Math.min(10, Number(parsed.groupCount) || 1)),
        groups: parsed.groups ?? [],
        stats: parsed.stats ?? {},
        knockoutBracket: parsed.knockoutBracket ?? null,
      }))
      setNotice('Turnierstand importiert.')
    } catch {
      setNotice('Import fehlgeschlagen.')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="container topbar__inner">
          <a className="brand" href="#top"><span className="brand__live">LIVE</span><span>FEELINGS//TOURNAMENT</span></a>
          <div className="topbar__actions">
            {isAdmin ? (
              <>
                <span className="access-pill access-pill--admin">ADMIN · {profile?.email}</span>
                <button className="button button--ghost" onClick={() => void logout()}>Abmelden</button>
              </>
            ) : user ? (
              <>
                <span className="access-pill">FREISCHALTUNG AUSSTEHEND</span>
                <button className="button button--ghost" onClick={() => void logout()}>Abmelden</button>
              </>
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
            <h1>FEELINGS<br /><span>TURNIER</span></h1>
            <p className="hero__lead">Drei KDA-Runden. Automatische Gruppen. Eine globale K.O.-Stage. Ein Champion.</p>
            <div className="hero__tags"><span>VALORANT VIBES</span><span>STREAM MODE</span><span>KDA TRACKING</span></div>
          </div>
          <div className="stream-card" aria-hidden="true">
            <div className="stream-card__bar"><span className="live-dot" /> LIVE NOW <span>brumefeelings</span></div>
            <div className="stream-card__screen">
              <div className="crosshair">+</div>
              <div className="stream-wordmark">brume<span>feelings</span></div>
              <div className="chat-bubble chat-bubble--one">♡ GLHF chat</div>
              <div className="chat-bubble chat-bubble--two">!turnier</div>
            </div>
          </div>
        </div>
      </header>

      <main className="container main-grid">
        {notice && <div className="notice" role="status">{notice}</div>}
        {!supabaseConfigured && <div className="setup-warning">Supabase ist noch nicht konfiguriert. Siehe README und <code>.env.example</code>.</div>}

        <section className="panel registration-panel" id="teilnehmer">
          <div className="section-heading">
            <div><span className="step">01</span><h2>Teilnehmer</h2></div>
            {isAdmin && <span className="counter">{state.participants.length} angemeldet</span>}
          </div>

          <p className="muted">
            {isAdmin
              ? 'Als Admin siehst du alle Anmeldungen und kannst Teilnehmer verwalten.'
              : 'Trage deinen Gamer-Tag ein. Die Namen bereits angemeldeter Personen sind nur für freigeschaltete Admins sichtbar.'}
          </p>

          <div className="input-row participant-submit">
            <input
              className="text-input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void addSingleParticipant() }}
              placeholder="Name oder Gamer-Tag"
              maxLength={40}
            />
            <button className="button" onClick={() => void addSingleParticipant()}>Für Turnier anmelden</button>
          </div>

          {isAdmin && (
            <>
              <details className="bulk-add">
                <summary>Mehrere Teilnehmer hinzufügen</summary>
                <textarea className="text-area" value={bulkNames} onChange={(event) => setBulkNames(event.target.value)} placeholder="Eine Person pro Zeile" />
                <button className="button button--secondary" onClick={() => void addBulkParticipants()}>Liste übernehmen</button>
              </details>
              <div className="admin-toolbar">
                <button className="button button--ghost" onClick={() => void refreshParticipants()}>Anmeldungen aktualisieren</button>
              </div>
              <div className="chips">
                {state.participants.map((participant, index) => (
                  <div className="chip" key={participant.id}>
                    <span className="chip__index">{index + 1}</span><span>{participant.name}</span>
                    <button className="chip__remove" onClick={() => void removeParticipant(participant.id)} aria-label={`${participant.name} entfernen`}>×</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel scoring-panel">
          <div className="section-heading"><div><span className="step">02</span><h2>KDA-Wertung</h2></div></div>
          <div className="score-rules">
            <div className="rule"><strong>+1</strong><span>Kill</span></div>
            <div className="rule"><strong>+1</strong><span>Assist</span></div>
            <div className="rule rule--negative"><strong>−1,5</strong><span>Death</span></div>
            <div className="rule"><strong>+3</strong><span>K + A &gt; D</span></div>
            <div className="rule rule--negative"><strong>−3</strong><span>K + A &lt; D</span></div>
          </div>
        </section>

        {!isAdmin ? (
          <section className="panel locked-panel">
            <div className="lock-icon">⌁</div>
            <div>
              <p className="eyebrow">ADMIN CHANNEL</p>
              <h2>Turniersteuerung geschützt</h2>
              <p className="muted">Gruppen, Ranglisten, Teilnehmernamen, KDA-Eingaben und K.O.-Matches sind nur für freigeschaltete Accounts sichtbar.</p>
              {user && !profile?.approved && <p className="pending-note">Dein Account ist angemeldet, wartet aber noch auf Freischaltung.</p>}
            </div>
          </section>
        ) : (
          <>
            <section className="panel" id="gruppen">
              <div className="section-heading"><div><span className="step">03</span><h2>Gruppen-Setup</h2></div></div>
              <div className="group-controls">
                <label className="field-label" htmlFor="group-count">Gewünschte Gruppen</label>
                <select id="group-count" className="select-input" value={state.groupCount} onChange={(event) => setState((current) => ({ ...current, groupCount: Number(event.target.value), knockoutBracket: null }))}>
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
                <button className="button" onClick={createGroups}>Gruppen automatisch erstellen</button>
              </div>
              <div className="plan-card"><span>AUTO PLAN</span><strong>{planText(previewPlan)}</strong></div>
            </section>

            {state.groups.map((group) => {
              const standings = buildStandings(group, state.participants, state.stats)
              const qualified = activePlan?.qualifiersPerGroup ?? 0
              return (
                <section className="panel group-panel" key={group.id}>
                  <div className="section-heading"><div><span className="step">{group.name}</span><h2>{group.participantIds.length} Spieler</h2></div></div>
                  <h3>3 KDA-Spiele</h3>
                  <div className="stats-wrap">
                    <table className="stats-table">
                      <thead><tr><th>Spieler</th>{[1,2,3].flatMap((round) => [<th key={`${round}k`}>S{round} K</th>,<th key={`${round}a`}>A</th>,<th key={`${round}d`}>D</th>,<th key={`${round}p`}>Pkt.</th>])}<th>Gesamt</th></tr></thead>
                      <tbody>
                        {group.participantIds.map((participantId) => {
                          const participantStats = state.stats[participantId] ?? emptyParticipantStats()
                          const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round), 0)
                          return <tr key={participantId}>
                            <th className="player-cell">{participantMap.get(participantId)?.name ?? 'Unbekannt'}</th>
                            {participantStats.rounds.flatMap((round, roundIndex) => [
                              <td key={`${roundIndex}k`}><StatInput value={round.kills} onChange={(value) => updateStat(participantId, roundIndex, 'kills', value)} /></td>,
                              <td key={`${roundIndex}a`}><StatInput value={round.assists} onChange={(value) => updateStat(participantId, roundIndex, 'assists', value)} /></td>,
                              <td key={`${roundIndex}d`}><StatInput value={round.deaths} onChange={(value) => updateStat(participantId, roundIndex, 'deaths', value)} /></td>,
                              <td className={calculateRoundScore(round) < 0 ? 'points points--negative' : 'points'} key={`${roundIndex}p`}>{formatPoints(calculateRoundScore(round))}</td>,
                            ])}
                            <td className={total < 0 ? 'total total--negative' : 'total'}>{formatPoints(total)}</td>
                          </tr>
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="standings-list">
                    {standings.map((row, index) => <div className={`standing ${index < qualified ? 'standing--qualified' : ''}`} key={row.participantId}>
                      <span className="standing__rank">{index + 1}</span><strong>{row.name}</strong><span className="standing__kda">{row.kills} K · {row.assists} A · {row.deaths} D</span><span className="standing__points">{formatPoints(row.totalPoints)} Pkt.</span>{index < qualified && <span className="qualified-tag">Q</span>}
                    </div>)}
                  </div>
                </section>
              )
            })}

            {state.groups.length > 0 && (
              <section className="panel ko-panel">
                <div className="section-heading">
                  <div><span className="step">04</span><h2>Globale K.O.-Phase</h2></div>
                  {championId && <span className="champion-badge">CHAMPION · {participantMap.get(championId)?.name}</span>}
                </div>
                <p className="muted">{planText(activePlan)}. Bei mehreren Gruppen werden die Qualifikanten in Runde 1 gruppenübergreifend gesetzt.</p>
                <button className="button button--twitch" onClick={generateGlobalBracket}>{state.knockoutBracket ? 'K.O.-Phase neu setzen' : 'Gruppenphase abschließen → K.O. starten'}</button>

                {state.knockoutBracket && <div className="bracket">
                  {state.knockoutBracket.rounds.map((round, roundIndex) => <div className="bracket-round" key={roundIndex}>
                    <h4>{roundName(state.knockoutBracket!.qualifierIds.length, roundIndex)}</h4>
                    <div className="round-matches">{round.map((match, matchIndex) => {
                      const player1 = match.player1Id ? participantMap.get(match.player1Id)?.name : null
                      const player2 = match.player2Id ? participantMap.get(match.player2Id)?.name : null
                      return <div className="match-card" key={match.id}>
                        <span className="match-number">MATCH {matchIndex + 1}</span>
                        <div className={match.winnerId === match.player1Id ? 'match-player match-player--winner' : 'match-player'}>{player1 ?? 'TBD'}</div>
                        <div className={match.winnerId === match.player2Id ? 'match-player match-player--winner' : 'match-player'}>{player2 ?? 'TBD'}</div>
                        <select className="winner-select" disabled={!match.player1Id || !match.player2Id} value={match.winnerId ?? ''} onChange={(event) => selectWinner(roundIndex, matchIndex, event.target.value)}>
                          <option value="">Sieger wählen</option>
                          {match.player1Id && <option value={match.player1Id}>{player1}</option>}
                          {match.player2Id && <option value={match.player2Id}>{player2}</option>}
                        </select>
                      </div>
                    })}</div>
                  </div>)}
                </div>}
              </section>
            )}

            <section className="panel access-panel">
              <div className="section-heading"><div><span className="step">ADMIN</span><h2>Zugriffsfreigaben</h2></div></div>
              <p className="muted">Registrierte Accounts erhalten erst nach deiner Freigabe Bearbeitungsrechte und Zugriff auf Teilnehmernamen.</p>
              <div className="admin-toolbar"><button className="button button--ghost" onClick={() => void refreshProfiles()}>Zugriffsanfragen aktualisieren</button></div>
              <div className="access-list">
                {profiles.map((item) => <div className="access-row" key={item.id}>
                  <div><strong>{item.email}</strong><span>{item.approved && item.role === 'admin' ? 'Freigeschaltet' : 'Wartet auf Freischaltung'}</span></div>
                  <div className="access-row__actions">
                    {item.approved ? <button className="button button--danger" disabled={item.id === user?.id} onClick={() => void approveProfile(item.id, false)}>Zugriff entziehen</button> : <button className="button" onClick={() => void approveProfile(item.id, true)}>Freischalten</button>}
                  </div>
                </div>)}
              </div>
            </section>

            <section className="panel admin-tools">
              <div><h2>Admin Tools</h2><p className="muted">Turnierstand exportieren/importieren oder Turnierdaten zurücksetzen.</p></div>
              <div className="admin-tools__actions">
                <button className="button button--ghost" onClick={downloadJson}>Export</button>
                <button className="button button--ghost" onClick={() => importRef.current?.click()}>Import</button>
                <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importState(event.target.files?.[0])} />
                <button className="button button--danger" onClick={() => void resetTournament()}>Turnier zurücksetzen</button>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="footer"><div className="container">FEELINGS//TOURNAMENT · secure admin mode · powered by Supabase</div></footer>

      {showLogin && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowLogin(false) }}>
        <div className="auth-modal">
          <button className="modal-close" onClick={() => setShowLogin(false)}>×</button>
          <p className="eyebrow">SECURE ACCESS</p>
          <h2>{authMode === 'login' ? 'Admin Login' : 'Account registrieren'}</h2>
          <p className="muted">Neue Accounts sind zunächst gesperrt und müssen von einem freigeschalteten Admin bestätigt werden.</p>
          <form className="auth-form" onSubmit={(event) => void handleAuth(event)}>
            <label>E-Mail<input className="text-input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Passwort<input className="text-input" type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button className="button button--twitch" disabled={authBusy || authLoading}>{authBusy ? 'Bitte warten …' : authMode === 'login' ? 'Einloggen' : 'Registrieren'}</button>
          </form>
          <button className="auth-switch" onClick={() => setAuthMode((mode) => mode === 'login' ? 'register' : 'login')}>
            {authMode === 'login' ? 'Noch keinen Account? Registrieren' : 'Bereits registriert? Zum Login'}
          </button>
        </div>
      </div>}
    </div>
  )
}

function StatInput({ value, onChange }: { value: number; onChange: (value: string) => void }) {
  return <input className="stat-input" type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} />
}

export default App

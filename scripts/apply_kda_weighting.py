from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Patch-Stelle nicht gefunden: {label}")
    return text.replace(old, new, 1)


def patch_types() -> None:
    path = ROOT / 'src/types.ts'
    s = path.read_text(encoding='utf-8')
    marker = "export type SiteBackgroundSettings = {"
    block = """export type ScoringWeights = {
  kill: number
  assist: number
  death: number
  positiveBonus: number
  negativePenalty: number
}

"""
    if 'export type ScoringWeights = {' not in s:
        if marker not in s:
            raise RuntimeError('Patch-Stelle nicht gefunden: ScoringWeights in types.ts')
        s = s.replace(marker, block + marker, 1)
    path.write_text(s, encoding='utf-8')


def patch_scoring() -> None:
    path = ROOT / 'src/lib/scoring.ts'
    s = path.read_text(encoding='utf-8')
    s = replace_once(
        s,
        "import type { ParticipantStats, RoundStats } from '../types'",
        "import type { ParticipantStats, RoundStats, ScoringWeights } from '../types'",
        'Scoring import',
    )

    old = """export function calculateRoundScore(stats: RoundStats): number {
  const base = stats.kills + stats.assists - stats.deaths * 1.5
  const combatBalance = stats.kills + stats.assists - stats.deaths
  const bonus = combatBalance > 0 ? 3 : combatBalance < 0 ? -3 : 0
  return base + bonus
}

export function calculateTotalScore(stats: ParticipantStats): number {
  return stats.rounds.reduce((sum, round) => sum + calculateRoundScore(round), 0)
}
"""
    new = """export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  kill: 1,
  assist: 1,
  death: 1.5,
  positiveBonus: 3,
  negativePenalty: 3,
}

export function calculateRoundScore(
  stats: RoundStats,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  const base = stats.kills * weights.kill
    + stats.assists * weights.assist
    - stats.deaths * weights.death
  const combatBalance = stats.kills + stats.assists - stats.deaths
  const bonus = combatBalance > 0
    ? weights.positiveBonus
    : combatBalance < 0
      ? -weights.negativePenalty
      : 0
  return base + bonus
}

export function calculateTotalScore(
  stats: ParticipantStats,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  return stats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, weights), 0)
}
"""
    if 'DEFAULT_SCORING_WEIGHTS' not in s:
        if old not in s:
            raise RuntimeError('Patch-Stelle nicht gefunden: Scoring-Funktionen')
        s = s.replace(old, new, 1)
    path.write_text(s, encoding='utf-8')


def patch_tournament() -> None:
    path = ROOT / 'src/lib/tournament.ts'
    s = path.read_text(encoding='utf-8')
    s = replace_once(
        s,
        "import { calculateTotalScore, emptyParticipantStats } from './scoring'",
        "import { calculateTotalScore, DEFAULT_SCORING_WEIGHTS, emptyParticipantStats } from './scoring'",
        'Tournament scoring import',
    )
    if '  ScoringWeights,' not in s:
        s = replace_once(s, '  QualifiedPlayer,\n', '  QualifiedPlayer,\n  ScoringWeights,\n', 'ScoringWeights type import')

    old_sig = """export function buildStandings(
  group: TournamentGroup,
  participants: Participant[],
  stats: Record<string, ParticipantStats>,
): StandingRow[] {"""
    new_sig = """export function buildStandings(
  group: TournamentGroup,
  participants: Participant[],
  stats: Record<string, ParticipantStats>,
  scoringWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): StandingRow[] {"""
    s = replace_once(s, old_sig, new_sig, 'buildStandings signature')
    s = replace_once(s, 'totalPoints: calculateTotalScore(participantStats),', 'totalPoints: calculateTotalScore(participantStats, scoringWeights),', 'buildStandings score')

    old_ko = """export function createGlobalKnockoutBracket(
  groups: TournamentGroup[],
  participants: Participant[],
  stats: Record<string, ParticipantStats>,
  qualifiersPerGroup: number,
): KnockoutBracket {"""
    new_ko = """export function createGlobalKnockoutBracket(
  groups: TournamentGroup[],
  participants: Participant[],
  stats: Record<string, ParticipantStats>,
  qualifiersPerGroup: number,
  scoringWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): KnockoutBracket {"""
    s = replace_once(s, old_ko, new_ko, 'createGlobalKnockoutBracket signature')
    s = replace_once(s, 'buildStandings(group, participants, stats)', 'buildStandings(group, participants, stats, scoringWeights)', 'KO standings')
    path.write_text(s, encoding='utf-8')


def patch_app() -> None:
    path = ROOT / 'src/App.tsx'
    s = path.read_text(encoding='utf-8')

    s = replace_once(s, '  calculateRoundScore,\n  emptyParticipantStats,', '  calculateRoundScore,\n  DEFAULT_SCORING_WEIGHTS,\n  emptyParticipantStats,', 'App scoring import')
    s = replace_once(s, '  RoundStats,\n  SiteBackgroundSettings,', '  RoundStats,\n  ScoringWeights,\n  SiteBackgroundSettings,', 'App ScoringWeights type import')
    s = replace_once(s, 'const DEFAULT_BACKGROUND: SiteBackgroundSettings = {', 'const DEFAULT_SCORING: ScoringWeights = DEFAULT_SCORING_WEIGHTS\n\nconst DEFAULT_BACKGROUND: SiteBackgroundSettings = {', 'DEFAULT_SCORING')

    scoring_normalizer = """function normalizeScoring(value: unknown): ScoringWeights {
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

"""
    if 'function normalizeScoring(' not in s:
        marker = 'function normalizeBracket(bracket: KnockoutBracket | null | undefined): KnockoutBracket | null {'
        if marker not in s:
            raise RuntimeError('Patch-Stelle nicht gefunden: normalizeScoring')
        s = s.replace(marker, scoring_normalizer + marker, 1)

    s = replace_once(
        s,
        '  const [background, setBackground] = useState<SiteBackgroundSettings>(DEFAULT_BACKGROUND)\n',
        '  const [background, setBackground] = useState<SiteBackgroundSettings>(DEFAULT_BACKGROUND)\n  const [scoringWeights, setScoringWeights] = useState<ScoringWeights>(DEFAULT_SCORING)\n',
        'Scoring state',
    )
    s = replace_once(
        s,
        "  const [settingsTab, setSettingsTab] = useState<'header' | 'background' | 'group'>('header')",
        "  const [settingsTab, setSettingsTab] = useState<'header' | 'background' | 'scoring' | 'group'>('header')",
        'Settings tab type',
    )
    s = replace_once(s, ".select('hero,background')", ".select('hero,background,scoring')", 'Site settings select')
    s = replace_once(
        s,
        '        setBackground(normalizeBackground(data?.background))',
        '        setBackground(normalizeBackground(data?.background))\n        setScoringWeights(normalizeScoring(data?.scoring))',
        'Load scoring settings',
    )

    save_fn = """  async function saveScoringSettings() {
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

"""
    if 'async function saveScoringSettings()' not in s:
        marker = '  async function uploadSiteBackground(file: File | null) {'
        if marker not in s:
            raise RuntimeError('Patch-Stelle nicht gefunden: saveScoringSettings')
        s = s.replace(marker, save_fn + marker, 1)

    s = replace_once(
        s,
        'createGlobalKnockoutBracket(state.groups, state.participants, state.stats, activePlan.qualifiersPerGroup)',
        'createGlobalKnockoutBracket(state.groups, state.participants, state.stats, activePlan.qualifiersPerGroup, scoringWeights)',
        'KO generation weights',
    )

    old_panel = '''        <section className="panel scoring-panel">
          <div className="section-heading"><div><span className="step">02</span><h2>KDA-Wertung</h2></div></div>
          <div className="score-rules">
            <div className="rule"><strong>+1</strong><span>Kill</span></div><div className="rule"><strong>+1</strong><span>Assist</span></div><div className="rule rule--negative"><strong>−1,5</strong><span>Death</span></div><div className="rule"><strong>+3</strong><span>K + A &gt; D</span></div><div className="rule rule--negative"><strong>−3</strong><span>K + A &lt; D</span></div>
          </div>
        </section>'''
    new_panel = '''        <section className="panel scoring-panel">
          <div className="section-heading"><div><span className="step">02</span><h2>KDA-Wertung</h2></div></div>
          <div className="score-rules">
            <div className="rule"><strong>+{formatPoints(scoringWeights.kill)}</strong><span>Kill</span></div>
            <div className="rule"><strong>+{formatPoints(scoringWeights.assist)}</strong><span>Assist</span></div>
            <div className="rule rule--negative"><strong>−{formatPoints(scoringWeights.death)}</strong><span>Death</span></div>
            <div className="rule"><strong>+{formatPoints(scoringWeights.positiveBonus)}</strong><span>K + A &gt; D</span></div>
            <div className="rule rule--negative"><strong>−{formatPoints(scoringWeights.negativePenalty)}</strong><span>K + A &lt; D</span></div>
          </div>
        </section>'''
    s = replace_once(s, old_panel, new_panel, 'Public scoring panel')

    tabs_old = '''                <button className={settingsTab === 'background' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('background')}>Website-Hintergrund</button>
                <button className={settingsTab === 'group' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('group')}>Gruppenphase</button>'''
    tabs_new = '''                <button className={settingsTab === 'background' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('background')}>Website-Hintergrund</button>
                <button className={settingsTab === 'scoring' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('scoring')}>KDA-Gewichtung</button>
                <button className={settingsTab === 'group' ? 'settings-tab settings-tab--active' : 'settings-tab'} onClick={() => setSettingsTab('group')}>Gruppenphase</button>'''
    s = replace_once(s, tabs_old, tabs_new, 'Scoring settings tab')

    group_old = '''              ) : (
                <div className="settings-content">
                  <p className="muted">Lege fest, aus wie vielen KDA-Runden die Gruppenphase besteht. Erlaubt sind 1 bis 7 Runden.</p>'''
    group_new = '''              ) : settingsTab === 'scoring' ? (
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
                  <p className="muted">Lege fest, aus wie vielen KDA-Runden die Gruppenphase besteht. Erlaubt sind 1 bis 7 Runden.</p>'''
    s = replace_once(s, group_old, group_new, 'Scoring settings content')

    s = replace_once(s, 'const standings = buildStandings(group, state.participants, state.stats)', 'const standings = buildStandings(group, state.participants, state.stats, scoringWeights)', 'Group standings weights')
    s = replace_once(s, 'const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round), 0)', 'const total = participantStats.rounds.reduce((sum, round) => sum + calculateRoundScore(round, scoringWeights), 0)', 'Group total weights')
    s = s.replace("calculateRoundScore(round) < 0 ? 'points points--negative' : 'points'", "calculateRoundScore(round, scoringWeights) < 0 ? 'points points--negative' : 'points'")
    s = s.replace('formatPoints(calculateRoundScore(round))', 'formatPoints(calculateRoundScore(round, scoringWeights))')

    s = replace_once(
        s,
        '                  participantMap={participantMap}\n                  onRoundCount={updateKoRoundCount}',
        '                  participantMap={participantMap}\n                  scoringWeights={scoringWeights}\n                  onRoundCount={updateKoRoundCount}',
        'KO component scoring prop',
    )
    s = replace_once(s, '  participantMap,\n  onRoundCount,', '  participantMap,\n  scoringWeights,\n  onRoundCount,', 'KO destructuring')
    s = replace_once(s, '  participantMap: Map<string, Participant>\n  onRoundCount:', '  participantMap: Map<string, Participant>\n  scoringWeights: ScoringWeights\n  onRoundCount:', 'KO scoring prop type')
    s = replace_once(s, 'const total = participantStats.rounds.reduce((sum, roundStats) => sum + calculateRoundScore(roundStats), 0)', 'const total = participantStats.rounds.reduce((sum, roundStats) => sum + calculateRoundScore(roundStats, scoringWeights), 0)', 'KO total weights')
    s = s.replace("calculateRoundScore(roundStats) < 0 ? 'ko-round-points points--negative' : 'ko-round-points'", "calculateRoundScore(roundStats, scoringWeights) < 0 ? 'ko-round-points points--negative' : 'ko-round-points'")
    s = s.replace('formatPoints(calculateRoundScore(roundStats))', 'formatPoints(calculateRoundScore(roundStats, scoringWeights))')

    path.write_text(s, encoding='utf-8')


def patch_setup_sql() -> None:
    path = ROOT / 'supabase/setup.sql'
    if not path.exists():
        return
    s = path.read_text(encoding='utf-8')
    if 'add column if not exists scoring jsonb' in s:
        return
    s += """

-- Globale KDA-Gewichtung. In der produktiven Datenbank bereits angewendet.
alter table public.site_settings
  add column if not exists scoring jsonb not null default jsonb_build_object(
    'kill', 1,
    'assist', 1,
    'death', 1.5,
    'positiveBonus', 3,
    'negativePenalty', 3
  );
"""
    path.write_text(s, encoding='utf-8')


def main() -> None:
    patch_types()
    patch_scoring()
    patch_tournament()
    patch_app()
    patch_setup_sql()
    print('KDA-Gewichtung erfolgreich in den aktuellen Repository-Stand eingebaut.')


if __name__ == '__main__':
    main()

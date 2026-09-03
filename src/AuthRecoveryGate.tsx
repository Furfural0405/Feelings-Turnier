import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { supabase } from './lib/supabase'

function recoveryLinkInUrl(): boolean {
  if (typeof window === 'undefined') return false

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const queryParams = new URLSearchParams(window.location.search)

  return hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery'
}

export default function AuthRecoveryGate({ children }: { children: ReactNode }) {
  const [recoveryMode, setRecoveryMode] = useState(recoveryLinkInUrl)
  const [sessionReady, setSessionReady] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!supabase) return

    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSessionReady(Boolean(data.session))
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
        setSessionReady(Boolean(session))
        setMessage('Recovery-Link bestätigt. Lege jetzt dein neues Passwort fest.')
        return
      }

      if (recoveryMode && session) {
        setSessionReady(true)
      }
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [recoveryMode])

  async function saveNewPassword(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return

    if (newPassword.length < 8) {
      setMessage('Das neue Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }

    if (newPassword !== confirmPassword) {
      setMessage('Die beiden Passwörter stimmen nicht überein.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      // Die Recovery-Session soll nicht als normaler Admin-Login bestehen bleiben.
      // Nach erfolgreicher Änderung muss sich der Nutzer bewusst neu anmelden.
      await supabase.auth.signOut()

      window.history.replaceState({}, document.title, window.location.pathname)
      setNewPassword('')
      setConfirmPassword('')
      setSuccess(true)
      setMessage('Passwort erfolgreich geändert.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Das Passwort konnte nicht geändert werden.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelRecovery() {
    await supabase?.auth.signOut()
    window.history.replaceState({}, document.title, window.location.pathname)
    setRecoveryMode(false)
    setSuccess(false)
    setMessage('')
  }

  if (success) {
    return (
      <div className="modal-backdrop">
        <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-success-title">
          <p className="eyebrow">SECURE ACCESS</p>
          <h2 id="recovery-success-title">Passwort geändert</h2>
          <p className="muted">
            Dein neues Passwort wurde gespeichert. Die Recovery-Sitzung wurde beendet. Melde dich jetzt mit deinem neuen Passwort normal an.
          </p>
          <button className="button button--twitch" onClick={() => {
            setSuccess(false)
            setRecoveryMode(false)
            setMessage('')
          }}>
            Zurück zur Website
          </button>
        </div>
      </div>
    )
  }

  if (recoveryMode) {
    return (
      <div className="modal-backdrop">
        <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
          <p className="eyebrow">ACCOUNT RECOVERY</p>
          <h2 id="recovery-title">Neues Passwort festlegen</h2>
          <p className="muted">
            Der Link aus deiner E-Mail bestätigt deine Identität nur vorübergehend. Lege hier jetzt dein neues Passwort fest.
          </p>

          <form className="auth-form" onSubmit={(event) => void saveNewPassword(event)}>
            <label>
              Neues Passwort
              <input
                className="text-input"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Neues Passwort wiederholen
              <input
                className="text-input"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>

            {message && <p className="muted" role="status">{message}</p>}

            <button className="button button--twitch" disabled={busy || !sessionReady}>
              {busy ? 'Passwort wird gespeichert …' : sessionReady ? 'Neues Passwort speichern' : 'Recovery-Link wird geprüft …'}
            </button>
          </form>

          <button className="auth-switch" type="button" onClick={() => void cancelRecovery()}>
            Abbrechen und abmelden
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

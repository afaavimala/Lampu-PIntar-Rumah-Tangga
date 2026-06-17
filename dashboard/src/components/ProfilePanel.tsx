import { useEffect, useState, type FormEvent } from 'react'
import { getProfile, updateProfile } from '../lib/api'
import type { UserSummary } from '../lib/types'

type ProfilePanelProps = {
  onProfileUpdated?: (user: UserSummary) => void
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function ProfilePanel({ onProfileUpdated }: ProfilePanelProps) {
  const [profile, setProfile] = useState<UserSummary | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const nextProfile = await getProfile()
        if (!mounted) return
        setProfile(nextProfile)
        setName(nextProfile.name)
        setEmail(nextProfile.email)
      } catch (err) {
        if (mounted) {
          setError(toErrorMessage(err, 'Gagal memuat profil'))
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    setSavingProfile(true)
    try {
      const updated = await updateProfile({ name: name.trim(), email: email.trim() })
      setProfile(updated)
      setName(updated.name)
      setEmail(updated.email)
      setMessage('Profil tersimpan.')
      onProfileUpdated?.(updated)
    } catch (err) {
      setError(toErrorMessage(err, 'Gagal menyimpan profil'))
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSavePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    setSavingPassword(true)
    try {
      const updated = await updateProfile({
        currentPassword,
        newPassword,
      })
      setProfile(updated)
      setCurrentPassword('')
      setNewPassword('')
      setMessage('Password berhasil diganti.')
      onProfileUpdated?.(updated)
    } catch (err) {
      setError(toErrorMessage(err, 'Gagal mengganti password'))
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) {
    return (
      <section className="panel-shell profile-panel">
        <h2>Account</h2>
        <p className="small">Memuat profil...</p>
      </section>
    )
  }

  return (
    <section className="panel-shell profile-panel">
      <div className="panel-head">
        <div>
          <h2>Account</h2>
          <p className="small">Kelola nama, email, dan password akun.</p>
        </div>
        {profile ? <span className="role-badge">{profile.role}</span> : null}
      </div>

      {error ? <p className="error global-error">{error}</p> : null}
      {message ? <p className="success-message">{message}</p> : null}

      {profile ? (
        <div className="profile-grid">
          <article className="profile-card">
            <h3>Identitas Akun</h3>
            <dl className="profile-facts">
              <div>
                <dt>Nama</dt>
                <dd>{profile.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{profile.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{profile.role}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{profile.isActive ? 'Aktif' : 'Nonaktif'}</dd>
              </div>
            </dl>
          </article>

          <form className="panel-form" onSubmit={(event) => void handleSaveProfile(event)}>
            <h3>Edit Profil</h3>
            <label>
              Nama
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={1}
                maxLength={255}
                required
                disabled={savingProfile}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={savingProfile}
              />
            </label>
            <button type="submit" disabled={savingProfile || !name.trim() || !email.trim()}>
              {savingProfile ? 'Menyimpan...' : 'Simpan Profil'}
            </button>
          </form>

          <form className="panel-form" onSubmit={(event) => void handleSavePassword(event)}>
            <h3>Ganti Password</h3>
            <label>
              Current Password
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                required
                disabled={savingPassword}
              />
            </label>
            <label>
              New Password
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                required
                disabled={savingPassword}
              />
            </label>
            <button
              type="submit"
              disabled={savingPassword || currentPassword.length < 8 || newPassword.length < 8}
            >
              {savingPassword ? 'Menyimpan...' : 'Ganti Password'}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { BulbIcon, EyeIcon, LockIcon, MailIcon } from './UiIcons'

type LoginFormProps = {
  loading: boolean
  error: string | null
  retryAfterSec?: number | null
  onLogin: (email: string, password: string) => Promise<void>
}

export function LoginForm({ loading, error, retryAfterSec = null, onLogin }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [remainingSec, setRemainingSec] = useState(0)

  useEffect(() => {
    setRemainingSec(Math.max(0, Math.ceil(retryAfterSec ?? 0)))
  }, [retryAfterSec])

  useEffect(() => {
    if (remainingSec <= 0) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setRemainingSec((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [remainingSec])

  const rateLimitMessage =
    remainingSec > 0
      ? `Terlalu banyak percobaan login. Tunggu ${remainingSec} detik lalu coba lagi.`
      : retryAfterSec
        ? 'Waktu tunggu selesai. Silakan coba login lagi.'
        : null
  const visibleError = rateLimitMessage ?? error
  const submitDisabled = loading || remainingSec > 0

  return (
    <section className="login-screen">
      <div className="login-shell">
        <div className="login-brand">
          <BulbIcon className="brand-bulb" />
          <h1>
            SmartHome <span>IoT</span>
          </h1>
        </div>
        <div className="login-panel">
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              if (submitDisabled) {
                return
              }
              await onLogin(email, password)
            }}
            className="login-form-blue"
          >
            <label className="field-block">
              <span className="field-title">
                <MailIcon className="field-title-icon" />
                Email Address
              </span>
              <span className="field-input-wrap">
                <MailIcon className="field-input-icon" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  placeholder="example@email.com"
                />
              </span>
            </label>

            <label className="field-block">
              <span className="field-title">
                <LockIcon className="field-title-icon" />
                Password
              </span>
              <span className="field-input-wrap">
                <LockIcon className="field-input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="........"
                />
                <button
                  type="button"
                  className="eye-button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  <EyeIcon className="eye-icon" />
                </button>
              </span>
            </label>

            <label className="remember-row">
              <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
              Remember Me
            </label>

            {visibleError ? <p className="error login-error">{visibleError}</p> : null}

            <button type="submit" disabled={submitDisabled} className="login-button">
              {loading ? 'LOADING...' : 'LOGIN'}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}

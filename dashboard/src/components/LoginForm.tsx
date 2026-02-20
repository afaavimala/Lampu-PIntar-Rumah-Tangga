import { useState } from 'react'
import { BulbIcon, EyeIcon, LockIcon, MailIcon } from './UiIcons'

type LoginFormProps = {
  loading: boolean
  error: string | null
  onLogin: (email: string, password: string) => Promise<void>
}

export function LoginForm({ loading, error, onLogin }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)

  return (
    <section className="login-screen">
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

          {error ? <p className="error login-error">{error}</p> : null}

          <button type="submit" disabled={loading} className="login-button">
            {loading ? 'LOADING...' : 'LOGIN'}
          </button>

          <p className="forgot-line">
            <span />
            <a href="#" onClick={(event) => event.preventDefault()}>
              Forgot Password?
            </a>
            <span />
          </p>
          <p className="register-line">
            Don&apos;t have an account?{' '}
            <a href="#" onClick={(event) => event.preventDefault()}>
              Register
            </a>
          </p>
        </form>
      </div>
    </section>
  )
}

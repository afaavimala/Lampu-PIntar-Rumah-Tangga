import { useState } from 'react'

type LoginFormProps = {
  loading: boolean
  error: string | null
  onLogin: (email: string, password: string) => Promise<void>
}

export function LoginForm({ loading, error, onLogin }: LoginFormProps) {
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('admin12345')

  return (
    <section className="login-shell">
      <div className="login-card">
        <h1>SmartLamp Control</h1>
        <p className="subtitle">Login untuk mengakses dashboard IoT lampu rumah tangga.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            await onLogin(email, password)
          }}
          className="login-form"
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>
      </div>
    </section>
  )
}

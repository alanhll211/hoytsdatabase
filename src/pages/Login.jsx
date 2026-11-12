import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { canOpen, homeFor, profileFor } from '../permissions'

// Where to go after signing in: the page they were headed to if they can
// open it, otherwise their own home page.
function destination(profile, from) {
  return from && canOpen(profile, from) ? from : homeFor(profile)
}

export default function Login() {
  const { profile, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  // Already signed in — send them where they were headed (or their home page).
  if (profile) {
    return <Navigate to={destination(profile, location.state?.from)} replace />
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (login(username, password)) {
      navigate(destination(profileFor(username), location.state?.from), { replace: true })
    } else {
      setError('Access denied. Please check your username and password.')
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">
            <i className="bi bi-boxes"></i>
          </span>
          <div>
            <div className="brand-name">Hoyts Traceability</div>
            <div className="brand-sub">Food Safety Records</div>
          </div>
        </div>

        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Enter your username and password to continue.</p>

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="mb-3">
            <label className="form-label fw-semibold" htmlFor="login-username">
              Username
            </label>
            <input
              id="login-username"
              name="username"
              type="text"
              className="form-control"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                if (error) setError('')
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              autoFocus
            />
          </div>
          <div className="mb-3">
            <label className="form-label fw-semibold" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError('')
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
          </div>

          {error && (
            <div className="alert alert-danger py-2 px-3 mb-3" role="alert">
              <i className="bi bi-exclamation-triangle me-1"></i>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary w-100">
            <i className="bi bi-box-arrow-in-right me-1"></i>Sign in
          </button>
        </form>
      </div>
    </div>
  )
}

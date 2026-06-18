import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')

  // Already signed in — send them where they were headed (or Home).
  if (user) {
    return <Navigate to={location.state?.from || '/'} replace />
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (login(username)) {
      navigate(location.state?.from || '/', { replace: true })
    } else {
      setError('Access denied. Please check your username and try again.')
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
        <p className="login-sub">Enter your username to continue.</p>

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

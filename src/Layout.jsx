import { useEffect, useState } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import { useFlash } from './FlashContext'
import { useAuth } from './AuthContext'

const NAV_ITEMS = [
  { to: '/', icon: 'bi-house', label: 'Home', end: true },
  { to: '/traceability', icon: 'bi-search', label: 'Traceability' },
  { to: '/batches', icon: 'bi-archive', label: 'Batches' },
  { to: '/recipes', icon: 'bi-journal-text', label: 'Recipes' },
  { to: '/ingredients', icon: 'bi-basket2', label: 'Ingredients' },
]

const FLASH_ICONS = {
  success: 'bi-check-circle-fill',
  danger: 'bi-x-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
}

function Brand() {
  return (
    <Link className="gnav-brand" to="/">
      <span className="brand-mark">
        <i className="bi bi-boxes"></i>
      </span>
      <span className="brand-name">Hoyts Traceability</span>
    </Link>
  )
}

export default function Layout() {
  const { messages, dismiss } = useFlash()
  const { logout } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [lastPath, setLastPath] = useState(location.pathname)

  // Close the mobile menu whenever the route changes (adjusting state during
  // render, rather than in an effect, avoids an extra paint with it open).
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setMenuOpen(false)
  }

  // Lock page scroll and allow Escape to close while the mobile menu is open.
  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <div className="app-shell">
      <header className={`gnav ${menuOpen ? 'is-open' : ''}`}>
        <div className="gnav-inner">
          <Brand />

          {/* Desktop links */}
          <nav className="gnav-links d-none d-lg-flex" aria-label="Main">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} className="gnav-link" to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button type="button" className="gnav-signout d-none d-lg-inline-flex" onClick={logout}>
            Sign out
          </button>

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="gnav-burger d-lg-none"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span></span>
            <span></span>
          </button>
        </div>

        {/* Mobile full-screen menu */}
        <nav
          id="mobile-menu"
          className="gnav-sheet d-lg-none"
          aria-label="Main"
          aria-hidden={!menuOpen}
          inert={!menuOpen}
        >
          <ul>
            {NAV_ITEMS.map((item, i) => (
              <li key={item.to} style={{ '--i': i }}>
                <NavLink
                  className="sheet-link"
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                >
                  <i className={`bi ${item.icon}`}></i>
                  {item.label}
                </NavLink>
              </li>
            ))}
            <li style={{ '--i': NAV_ITEMS.length }}>
              <button type="button" className="sheet-link sheet-signout" onClick={logout}>
                <i className="bi bi-box-arrow-left"></i>Sign out
              </button>
            </li>
          </ul>
        </nav>
      </header>

      <main className="app-content">
        <Outlet />
      </main>

      {/* Flash toasts — bottom centre so they never cover page actions */}
      <div className="flash-region" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`flash-toast ${m.category}`} role="status">
            <i className={`ft-icon bi ${FLASH_ICONS[m.category] || FLASH_ICONS.info}`}></i>
            <span className="ft-text">{m.text}</span>
            <button
              type="button"
              className="ft-close"
              aria-label="Dismiss"
              onClick={() => dismiss(m.id)}
            >
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

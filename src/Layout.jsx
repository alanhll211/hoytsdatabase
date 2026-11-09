import { useEffect, useState } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import { useFlash } from './FlashContext'
import { useAuth } from './AuthContext'

// Each site has its own pages; the switch in the nav moves between them.
const SITES = [
  {
    id: 'main',
    label: '25-27 Alex Ave',
    short: '25-27',
    home: '/',
    items: [
      { to: '/', icon: 'bi-house', label: 'Home', end: true },
      { to: '/traceability', icon: 'bi-search', label: 'Traceability' },
      { to: '/batches', icon: 'bi-archive', label: 'Batches' },
      { to: '/recipes', icon: 'bi-journal-text', label: 'Recipes' },
      { to: '/ingredients', icon: 'bi-basket2', label: 'Ingredients' },
    ],
  },
  {
    id: 'ffs',
    label: '36-40 Alex Ave (FFS)',
    short: '36-40 FFS',
    home: '/ffs',
    items: [{ to: '/ffs', icon: 'bi-journal-check', label: 'Production Log', end: true }],
  },
]

function siteFor(pathname) {
  return pathname === '/ffs' || pathname.startsWith('/ffs/') ? SITES[1] : SITES[0]
}

function SiteSwitch({ current, compact = false }) {
  return (
    <nav className="site-switch" aria-label="Site">
      {SITES.map((s) => (
        <Link
          key={s.id}
          to={s.home}
          className={s.id === current.id ? 'active' : ''}
          aria-current={s.id === current.id ? 'true' : undefined}
          title={s.label}
        >
          {compact ? (
            <>
              <span className="d-none d-xl-inline">{s.label}</span>
              <span className="d-xl-none">{s.short}</span>
            </>
          ) : (
            s.label
          )}
        </Link>
      ))}
    </nav>
  )
}

const FLASH_ICONS = {
  success: 'bi-check-circle-fill',
  danger: 'bi-x-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
}

function Brand({ to }) {
  return (
    <Link className="gnav-brand" to={to}>
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
  const site = siteFor(location.pathname)
  const navItems = site.items
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
          <Brand to={site.home} />
          <div className="d-none d-lg-flex">
            <SiteSwitch current={site} compact />
          </div>

          {/* Desktop links */}
          <nav className="gnav-links d-none d-lg-flex" aria-label="Main">
            {navItems.map((item) => (
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
            <li className="sheet-site" style={{ '--i': 0 }}>
              <SiteSwitch current={site} />
            </li>
            {navItems.map((item, i) => (
              <li key={item.to} style={{ '--i': i + 1 }}>
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
            <li style={{ '--i': navItems.length + 1 }}>
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

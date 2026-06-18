import { NavLink, Outlet, Link } from 'react-router-dom'
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
  success: 'bi-check-lg',
  danger: 'bi-x-lg',
  warning: 'bi-exclamation-triangle',
  info: 'bi-info-lg',
}

function SidebarNav({ dismissOffcanvas }) {
  const { logout } = useAuth()
  return (
    <>
      <Link className="sidebar-brand" to="/" {...(dismissOffcanvas ? { 'data-bs-dismiss': 'offcanvas' } : {})}>
        <span className="brand-mark">
          <i className="bi bi-boxes"></i>
        </span>
        <span>
          <span className="brand-name d-block">Hoyts Traceability</span>
          <span className="brand-sub">Food Safety Records</span>
        </span>
      </Link>
      <div className="sidebar-section">Menu</div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              className="nav-link"
              to={item.to}
              end={item.end}
              {...(dismissOffcanvas ? { 'data-bs-dismiss': 'offcanvas' } : {})}
            >
              <i className={`bi ${item.icon}`}></i>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-signout"
          onClick={logout}
          {...(dismissOffcanvas ? { 'data-bs-dismiss': 'offcanvas' } : {})}
        >
          <i className="bi bi-box-arrow-left"></i>Sign out
        </button>
        <span className="sidebar-footer-note">Batch &amp; recipe traceability</span>
      </div>
    </>
  )
}

export default function Layout() {
  const { messages, dismiss } = useFlash()

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="sidebar d-none d-lg-flex">
        <SidebarNav />
      </aside>

      {/* Mobile offcanvas sidebar */}
      <div className="offcanvas offcanvas-start sidebar d-lg-none" tabIndex="-1" id="mobileSidebar">
        <SidebarNav dismissOffcanvas />
      </div>

      <div className="app-main">
        {/* Mobile topbar */}
        <header className="topbar d-lg-none">
          <button
            className="btn-toggle"
            type="button"
            data-bs-toggle="offcanvas"
            data-bs-target="#mobileSidebar"
            aria-label="Open menu"
          >
            <i className="bi bi-list"></i>
          </button>
          <Link className="topbar-brand" to="/">
            <i className="bi bi-boxes me-2"></i>Hoyts Traceability
          </Link>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>

      {/* Flash toasts */}
      <div className="flash-region">
        {messages.map((m) => (
          <div key={m.id} className={`flash-toast ${m.category}`} role="alert">
            <span className="ft-icon">
              <i className={`bi ${FLASH_ICONS[m.category] || FLASH_ICONS.info}`}></i>
            </span>
            <span className="flex-grow-1">{m.text}</span>
            <button type="button" className="btn-close" onClick={() => dismiss(m.id)}></button>
          </div>
        ))}
      </div>
    </div>
  )
}

import { NavLink, Outlet } from 'react-router-dom'
import { useFlash } from './FlashContext'

export default function Layout() {
  const { messages, dismiss } = useFlash()

  return (
    <>
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark">
        <div className="container">
          <NavLink className="navbar-brand" to="/traceability">
            <i className="bi bi-boxes me-2"></i>Traceability
          </NavLink>
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#nav"
          >
            <span className="navbar-toggler-icon"></span>
          </button>
          <div className="collapse navbar-collapse" id="nav">
            <ul className="navbar-nav ms-auto gap-1">
              <li className="nav-item">
                <NavLink className="nav-link" to="/traceability">
                  <i className="bi bi-search me-1"></i>Traceability
                </NavLink>
              </li>
              <li className="nav-item">
                <NavLink className="nav-link" to="/batches">
                  <i className="bi bi-archive me-1"></i>Batches
                </NavLink>
              </li>
              <li className="nav-item">
                <NavLink className="nav-link" to="/recipes">
                  <i className="bi bi-book me-1"></i>Recipes
                </NavLink>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      <div className="container my-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`alert alert-${m.category} alert-dismissible fade show py-2`}
            role="alert"
          >
            {m.text}
            <button type="button" className="btn-close" onClick={() => dismiss(m.id)}></button>
          </div>
        ))}

        <Outlet />
      </div>
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { formatAuDate } from '../utils/date'

export default function Home() {
  const [ingredients, setIngredients] = useState([])
  const [batches, setBatches] = useState([])
  const [recipes, setRecipes] = useState([])
  const [batchesLast30, setBatchesLast30] = useState(0)

  useEffect(() => {
    const unsubIngredients = onSnapshot(collection(db, 'ingredients'), (snap) =>
      setIngredients(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubBatches = onSnapshot(collection(db, 'batches'), (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setBatches(docs)
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
      setBatchesLast30(
        docs.filter((b) => {
          const t = b.receivedDate?.toDate ? b.receivedDate.toDate().getTime() : 0
          return t >= cutoff
        }).length
      )
    })
    const unsubRecipes = onSnapshot(collection(db, 'recipes'), (snap) =>
      setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    return () => {
      unsubIngredients()
      unsubBatches()
      unsubRecipes()
    }
  }, [])

  const recentBatches = useMemo(() => {
    return [...batches]
      .sort((a, b) => {
        const ad = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0
        const bd = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0
        return bd - ad
      })
      .slice(0, 6)
  }, [batches])

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Welcome back</h1>
          <p className="page-sub">
            Track ingredient batches and trace exactly what went into every production run.
          </p>
        </div>
        <Link to="/traceability" className="btn btn-primary">
          <i className="bi bi-search me-1"></i>Run Traceability
        </Link>
      </div>

      {/* Stats */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-xl-3">
          <div className="stat-card">
            <span className="stat-icon teal">
              <i className="bi bi-basket2"></i>
            </span>
            <div>
              <div className="stat-value">{ingredients.length}</div>
              <div className="stat-label">Ingredients</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-xl-3">
          <div className="stat-card">
            <span className="stat-icon blue">
              <i className="bi bi-archive"></i>
            </span>
            <div>
              <div className="stat-value">{batches.length}</div>
              <div className="stat-label">Batch Records</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-xl-3">
          <div className="stat-card">
            <span className="stat-icon violet">
              <i className="bi bi-journal-text"></i>
            </span>
            <div>
              <div className="stat-value">{recipes.length}</div>
              <div className="stat-label">Recipes</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-xl-3">
          <div className="stat-card">
            <span className="stat-icon amber">
              <i className="bi bi-calendar-check"></i>
            </span>
            <div>
              <div className="stat-value">{batchesLast30}</div>
              <div className="stat-label">Received (30 days)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="section-title">Quick actions</div>
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <Link to="/batches" className="action-card">
            <span className="ac-icon">
              <i className="bi bi-plus-lg"></i>
            </span>
            <div className="ac-title">Add a batch record</div>
            <p className="ac-desc">Log a new ingredient delivery with its supplier and batch number.</p>
          </Link>
        </div>
        <div className="col-md-4">
          <Link to="/recipes" className="action-card">
            <span className="ac-icon">
              <i className="bi bi-journal-plus"></i>
            </span>
            <div className="ac-title">Manage recipes</div>
            <p className="ac-desc">Define which ingredients make up each of your products.</p>
          </Link>
        </div>
        <div className="col-md-4">
          <Link to="/traceability" className="action-card">
            <span className="ac-icon">
              <i className="bi bi-search"></i>
            </span>
            <div className="ac-title">Trace a production run</div>
            <p className="ac-desc">Find which batch of every ingredient went into a given date's production.</p>
          </Link>
        </div>
      </div>

      {/* Recent batches */}
      <div className="card mb-4">
        <div className="card-header py-3 d-flex justify-content-between align-items-center">
          <span className="fw-semibold">Recently added batches</span>
          <Link to="/batches" className="btn btn-sm btn-outline-secondary">
            View all
          </Link>
        </div>
        <div className="card-body p-0">
          {recentBatches.length > 0 ? (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th className="ps-4">Ingredient</th>
                    <th>Supplier</th>
                    <th>Batch Number</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBatches.map((b) => (
                    <tr key={b.id}>
                      <td className="ps-4 fw-medium">{b.ingredientName}</td>
                      <td>{b.supplierName || <span className="text-muted">—</span>}</td>
                      <td>{b.batchNumber}</td>
                      <td className="text-muted">{formatAuDate(b.receivedDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <span className="es-icon">
                <i className="bi bi-archive"></i>
              </span>
              <div className="es-title">No batches recorded yet</div>
              <p>
                Start by <Link to="/batches">adding your first batch record</Link>.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="card">
        <div className="card-body py-4">
          <div className="section-title mb-3">How traceability works</div>
          <div className="row g-4">
            <div className="col-md-4">
              <div className="howto-step">
                <span className="step-num">1</span>
                <div>
                  <div className="step-title">Record incoming batches</div>
                  <p>Every ingredient delivery is logged with its supplier, batch number and received date.</p>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="howto-step">
                <span className="step-num">2</span>
                <div>
                  <div className="step-title">Define recipes</div>
                  <p>Each product is defined as a recipe — the list of ingredients it contains.</p>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="howto-step">
                <span className="step-num">3</span>
                <div>
                  <div className="step-title">Trace any production date</div>
                  <p>
                    Pick a recipe and date — the system finds the batch of each ingredient most recently
                    received before that date, ready to export.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

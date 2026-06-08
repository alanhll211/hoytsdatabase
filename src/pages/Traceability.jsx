import { useEffect, useState } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import DatePickInput from '../components/DatePickInput'
import { parseAuDate, formatAuDate } from '../utils/date'
import { downloadCsv } from '../utils/csv'

export default function Traceability() {
  const { flash } = useFlash()
  const [recipes, setRecipes] = useState([])

  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [productionDateStr, setProductionDateStr] = useState('')

  const [results, setResults] = useState(null)
  const [activeRecipe, setActiveRecipe] = useState(null)
  const [activeProductionDate, setActiveProductionDate] = useState(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'recipes'), orderBy('name')), (snap) =>
      setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [])

  async function runTraceability(recipe, productionDate) {
    const ingredientIds = recipe.ingredientIds || []
    const cutoff = Timestamp.fromDate(productionDate)

    const items = await Promise.all(
      ingredientIds.map(async (ingredientId, idx) => {
        const ingredientName = (recipe.ingredientNames || [])[idx] || ''
        const snap = await getDocs(
          query(
            collection(db, 'batches'),
            where('ingredientId', '==', ingredientId),
            where('receivedDate', '<=', cutoff),
            orderBy('receivedDate', 'desc'),
            limit(1)
          )
        )
        const batch = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
        return { ingredientId, ingredientName, batch }
      })
    )
    items.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName))
    return items
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedRecipeId || !productionDateStr) {
      flash('Please select a recipe and production date.', 'danger')
      return
    }
    const productionDate = parseAuDate(productionDateStr)
    if (!productionDate) {
      flash('Invalid date. Use DD/MM/YYYY format.', 'danger')
      return
    }
    const recipe = recipes.find((r) => r.id === selectedRecipeId)
    if (!recipe) {
      flash('Recipe not found.', 'danger')
      return
    }

    setRunning(true)
    try {
      const items = await runTraceability(recipe, productionDate)
      setResults(items)
      setActiveRecipe(recipe)
      setActiveProductionDate(productionDate)
    } finally {
      setRunning(false)
    }
  }

  function exportCsv() {
    if (!results || !activeRecipe || !activeProductionDate) return
    const rows = [
      ['Recipe', activeRecipe.name],
      ['Production Date', formatAuDate(activeProductionDate)],
      [],
      ['Ingredient', 'Batch Number', 'Received Date'],
    ]
    for (const r of results) {
      if (r.batch) {
        rows.push([r.ingredientName, r.batch.batchNumber, formatAuDate(r.batch.receivedDate)])
      } else {
        rows.push([r.ingredientName, 'NO BATCH FOUND', ''])
      }
    }
    const safeName = activeRecipe.name.replace(/ /g, '_').replace(/\//g, '-')
    const d = activeProductionDate
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate()
    ).padStart(2, '0')}`
    downloadCsv(`traceability_${safeName}_${stamp}.csv`, rows)
  }

  const missingCount = results ? results.filter((r) => !r.batch).length : 0

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="page-heading mb-0">
          <i className="bi bi-search me-2 text-primary"></i>Traceability Lookup
        </h1>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="row g-3 align-items-end">
              <div className="col-md-5">
                <label className="form-label fw-semibold">Recipe</label>
                <select
                  className="form-select"
                  required
                  value={selectedRecipeId}
                  onChange={(e) => setSelectedRecipeId(e.target.value)}
                >
                  <option value="">— Select a recipe —</option>
                  {recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold">Production Date</label>
                <DatePickInput value={productionDateStr} onChange={setProductionDateStr} required />
              </div>
              <div className="col-md-3">
                <button type="submit" className="btn btn-primary w-100" disabled={running}>
                  <i className="bi bi-search me-1"></i>
                  {running ? 'Searching…' : 'Search'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {results !== null && activeRecipe && activeProductionDate && (
        <div className="card">
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-3">
            <div>
              <span className="fw-semibold fs-6">{activeRecipe.name}</span>
              <span className="text-muted ms-2">
                Production date: {formatAuDate(activeProductionDate)}
              </span>
            </div>
            <button className="btn btn-sm btn-outline-success" onClick={exportCsv}>
              <i className="bi bi-download me-1"></i>Export CSV
            </button>
          </div>

          {results.length > 0 ? (
            <>
              {missingCount > 0 && (
                <div className="alert alert-warning rounded-0 border-0 border-bottom border-warning mb-0 py-2 px-4">
                  <i className="bi bi-exclamation-triangle me-1"></i>
                  {missingCount} ingredient{missingCount !== 1 ? 's' : ''} had no batch recorded on or
                  before this date.
                </div>
              )}
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-4">Ingredient</th>
                      <th>Batch Number</th>
                      <th>Received Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.ingredientId} className={!r.batch ? 'table-warning' : ''}>
                        <td className="ps-4">{r.ingredientName}</td>
                        <td>
                          {r.batch ? (
                            r.batch.batchNumber
                          ) : (
                            <span className="text-warning fw-semibold">
                              <i className="bi bi-exclamation-triangle me-1"></i>No batch found
                            </span>
                          )}
                        </td>
                        <td>{r.batch ? formatAuDate(r.batch.receivedDate) : <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-footer text-muted small">
                {results.length} ingredient{results.length !== 1 ? 's' : ''}
              </div>
            </>
          ) : (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-inbox display-4 d-block mb-2"></i>
              This recipe has no ingredients assigned.
            </div>
          )}
        </div>
      )}

      {results === null && recipes.length === 0 && (
        <div className="alert alert-info">
          <i className="bi bi-info-circle me-1"></i>
          No recipes found.{' '}
          <a href="/recipes" className="alert-link">
            Create a recipe
          </a>{' '}
          to get started.
        </div>
      )}
    </>
  )
}

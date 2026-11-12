import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from '../data'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import { useAuth } from '../AuthContext'
import { displayName } from '../permissions'
import DatePickInput from '../components/DatePickInput'
import { formatAuDate, formatAuDateTime, parseAuDate } from '../utils/date'
import { lookupMaterials, materialsSnapshot } from '../utils/trace'

// Products pushed from Traceability, grouped by production day. Each push
// opens to show its raw materials as they were when it was pushed. Kitchen
// and ALAN can correct an entry; only ALAN can delete one.

const COLLECTION = 'dailyProduction'
const DAYS_PER_PAGE = 10

const ms = (t) => t?.toMillis?.() ?? Number.MAX_SAFE_INTEGER
const timeOf = (t) =>
  t?.toDate ? t.toDate().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : ''
const dash = <span className="text-muted">—</span>

// The raw material table, laid out like the Traceability results.
function Materials({ materials }) {
  if (!materials.length) return <div className="text-muted small px-4 py-3">This product has no ingredients.</div>
  return (
    <>
      <ul className="material-list d-md-none">
        {materials.map((m, i) => (
          <li key={i} className={!m.found ? 'missing' : ''}>
            <div className="ml-info">
              <div className="fw-semibold">{m.ingredientName}</div>
              {m.found ? (
                <>
                  <div className="fw-medium">{m.batchNumber}</div>
                  <div className="text-muted small">
                    {[m.supplierName, m.country].filter(Boolean).join(' · ') || '—'}
                    {' · received '}
                    {formatAuDate(m.receivedDate)}
                  </div>
                </>
              ) : (
                <div className="text-warning fw-semibold small">
                  <i className="bi bi-exclamation-triangle me-1"></i>No batch found
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="table-responsive d-none d-md-block">
        <table className="table table-sm mb-0 dl-materials">
          <thead>
            <tr>
              <th className="ps-4">Ingredient</th>
              <th>Supplier Name</th>
              <th>Country</th>
              <th>Batch Number</th>
              <th>Received Date</th>
              <th>Record Created Date</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m, i) => (
              <tr key={i} className={!m.found ? 'table-warning' : ''}>
                <td className="ps-4">{m.ingredientName}</td>
                <td>{m.supplierName || dash}</td>
                <td>{m.country || dash}</td>
                <td className="fw-medium">
                  {m.found ? (
                    m.batchNumber
                  ) : (
                    <span className="text-warning fw-semibold">
                      <i className="bi bi-exclamation-triangle me-1"></i>No batch found
                    </span>
                  )}
                </td>
                <td>{m.receivedDate ? formatAuDate(m.receivedDate) : dash}</td>
                <td className="text-muted small">{m.createdAt ? formatAuDateTime(m.createdAt) : dash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function DailyLog() {
  const { flash } = useFlash()
  const { user, profile } = useAuth()
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dayLimit, setDayLimit] = useState(DAYS_PER_PAGE)
  // Pushes whose raw materials are showing.
  const [expanded, setExpanded] = useState(() => new Set())
  // Pushes saved before raw materials were stored with them get looked up
  // when opened: { [id]: { loading } | { materials } | { error } }.
  const [lookedUp, setLookedUp] = useState({})
  // { id, date, productName, batchNumber, size, barcode } while editing.
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, COLLECTION), orderBy('date', 'desc')),
        (snap) => {
          setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
          setLoaded(true)
        },
        (err) => {
          console.error(err)
          setLoaded(true)
        }
      ),
    []
  )

  const days = useMemo(() => {
    const text = q.trim().toLowerCase()
    const from = parseAuDate(dateFrom)
    const to = parseAuDate(dateTo)
    const groups = new Map()
    for (const e of entries) {
      const d = e.date?.toDate ? e.date.toDate() : null
      if (from && d && d < from) continue
      if (to && d && d > to) continue
      const haystack = `${e.productName} ${e.batchNumber || ''} ${e.size || ''} ${e.barcode || ''}`.toLowerCase()
      if (text && !haystack.includes(text)) continue
      const key = formatAuDate(d)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(e)
    }
    // Within a day, in the order they were pushed.
    return [...groups].map(([date, list]) => ({
      date,
      entries: [...list].sort((a, b) => ms(a.createdAt) - ms(b.createdAt)),
    }))
  }, [entries, q, dateFrom, dateTo])

  function clearFilters() {
    setQ('')
    setDateFrom('')
    setDateTo('')
  }

  async function lookUp(e) {
    setLookedUp((m) => ({ ...m, [e.id]: { loading: true } }))
    try {
      const recipeSnap = await getDoc(doc(db, 'recipes', e.recipeId))
      if (!recipeSnap.exists()) throw new Error(`Recipe ${e.recipeId} not found`)
      const ingredients = (await getDocs(collection(db, 'ingredients'))).docs.map((d) => ({ id: d.id, ...d.data() }))
      const date = e.date.toDate()
      const items = await lookupMaterials({ id: recipeSnap.id, ...recipeSnap.data() }, date, ingredients)
      setLookedUp((m) => ({ ...m, [e.id]: { materials: materialsSnapshot(items, date) } }))
    } catch (err) {
      console.error(err)
      setLookedUp((m) => ({ ...m, [e.id]: { error: true } }))
    }
  }

  function toggle(e) {
    const opening = !expanded.has(e.id)
    setExpanded((s) => {
      const next = new Set(s)
      if (opening) next.add(e.id)
      else next.delete(e.id)
      return next
    })
    if (opening && !e.materials && !lookedUp[e.id]?.materials) lookUp(e)
  }

  function renderDetail(e) {
    if (e.materials) return <Materials materials={e.materials} />
    const found = lookedUp[e.id]
    if (!found || found.loading) return <div className="text-muted small px-4 py-3">Loading raw materials…</div>
    if (found.error) {
      return <div className="text-danger small px-4 py-3">Could not load the raw materials for this product.</div>
    }
    return (
      <>
        <div className="text-muted small px-4 pt-2 pb-1">
          <i className="bi bi-info-circle me-1"></i>
          Pushed before raw materials were saved with each push, so these are looked up from the current batch
          records.
        </div>
        <Materials materials={found.materials} />
      </>
    )
  }

  function openEdit(e) {
    setEditing({
      id: e.id,
      date: formatAuDate(e.date),
      productName: e.productName || '',
      batchNumber: e.batchNumber || '',
      size: e.size || '',
      barcode: e.barcode || '',
    })
  }

  const setEdit = (key) => (ev) => {
    const value = ev.target.value
    setEditing((x) => ({ ...x, [key]: value }))
  }

  async function handleSave(ev) {
    ev.preventDefault()
    if (saving) return
    const date = parseAuDate(editing.date)
    if (!date) {
      flash('Invalid date. Use DD/MM/YYYY format.', 'danger')
      return
    }
    const productName = editing.productName.trim()
    if (!productName) {
      flash('Product name is required.', 'danger')
      return
    }
    setSaving(true)
    try {
      await updateDoc(doc(db, COLLECTION, editing.id), {
        date: Timestamp.fromDate(date),
        productName,
        batchNumber: editing.batchNumber.trim(),
        size: editing.size.trim(),
        barcode: editing.barcode.trim(),
        updatedBy: user,
        updatedAt: serverTimestamp(),
      })
      flash(`Updated ${productName}.`, 'success')
      setEditing(null)
    } catch (err) {
      console.error(err)
      flash('Could not save the changes. Please try again.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(e) {
    if (!profile.canDelete) return
    const bn = e.batchNumber ? ` (batch ${e.batchNumber})` : ''
    if (!confirm(`Delete ${e.productName}${bn} on ${formatAuDate(e.date)}?`)) return
    try {
      await deleteDoc(doc(db, COLLECTION, e.id))
      flash(`Deleted ${e.productName}.`, 'success')
    } catch (err) {
      console.error(err)
      flash('Could not delete the entry. Please try again.', 'danger')
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Daily Production Log</h1>
          <p className="page-sub">Products pushed from Traceability, by day. Tap a product to see its raw materials.</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="row g-2 align-items-end">
            <div className="col-md-4">
              <label className="form-label" htmlFor="dl_q">Search</label>
              <input
                id="dl_q"
                type="text"
                className="form-control"
                placeholder="Product, batch number or barcode"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label">From</label>
              <DatePickInput value={dateFrom} onChange={setDateFrom} />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label">To</label>
              <DatePickInput value={dateTo} onChange={setDateTo} />
            </div>
            <div className="col-md-2 d-flex">
              <button className="btn btn-outline-secondary flex-fill" onClick={clearFilters}>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {!loaded ? (
        <div className="text-muted">Loading…</div>
      ) : days.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="es-icon">
              <i className="bi bi-calendar-check"></i>
            </span>
            <div className="es-title">{entries.length ? 'No entries match the filters' : 'Nothing pushed yet'}</div>
            <p>
              {entries.length
                ? 'Adjust the filters above.'
                : 'Search a product on Traceability, check the batch number, then press Push.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          {days.slice(0, dayLimit).map((day) => (
            <div className="card mb-3" key={day.date}>
              <div className="card-header py-3">
                <div className="fw-semibold">{day.date}</div>
                <div className="text-muted small">
                  {day.entries.length} product{day.entries.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="table-responsive">
                <table className="table mb-0 daily-table">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">Product</th>
                      <th>Batch Number</th>
                      <th>Pushed by</th>
                      <th style={{ width: 100 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.entries.map((e) => {
                      const open = expanded.has(e.id)
                      const pack = [e.size, e.barcode].filter(Boolean).join(' · ')
                      return (
                        <Fragment key={e.id}>
                          <tr className={open ? 'dl-open' : ''}>
                            <td className="ps-3">
                              <button
                                type="button"
                                className="dl-toggle"
                                aria-expanded={open}
                                aria-controls={`dl-detail-${e.id}`}
                                onClick={() => toggle(e)}
                              >
                                <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`}></i>
                                <span>
                                  <span className="fw-medium d-block">{e.productName}</span>
                                  {pack && <span className="text-muted small d-block">{pack}</span>}
                                </span>
                              </button>
                            </td>
                            <td className="fw-medium">{e.batchNumber || dash}</td>
                            <td>
                              {displayName(e.pushedBy)}
                              <span className="text-muted small ms-1">{timeOf(e.createdAt)}</span>
                              {e.updatedBy && (
                                <div className="text-muted small">edited by {displayName(e.updatedBy)}</div>
                              )}
                            </td>
                            <td>
                              <div className="d-flex gap-1 justify-content-end pe-2">
                                <button
                                  className="btn btn-sm btn-outline-secondary btn-icon"
                                  title="Edit"
                                  onClick={() => openEdit(e)}
                                >
                                  <i className="bi bi-pencil"></i>
                                </button>
                                {profile.canDelete && (
                                  <button
                                    className="btn btn-sm btn-outline-danger btn-icon"
                                    title="Delete"
                                    onClick={() => handleDelete(e)}
                                  >
                                    <i className="bi bi-trash"></i>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {open && (
                            <tr className="dl-detail" id={`dl-detail-${e.id}`}>
                              <td colSpan={4} className="p-0">
                                {renderDetail(e)}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {days.length > dayLimit && (
            <button className="btn btn-outline-secondary" onClick={() => setDayLimit((n) => n + DAYS_PER_PAGE)}>
              Show older days
            </button>
          )}
        </>
      )}

      {editing && (
        <>
          <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
            <div className="modal-dialog">
              <div className="modal-content">
                <form onSubmit={handleSave}>
                  <div className="modal-header">
                    <h5 className="modal-title">Edit Entry</h5>
                    <button type="button" className="btn-close" aria-label="Close" onClick={() => setEditing(null)}></button>
                  </div>
                  <div className="modal-body">
                    <div className="row g-3">
                      <div className="col-sm-6">
                        <label className="form-label fw-semibold">Date</label>
                        <DatePickInput
                          value={editing.date}
                          onChange={(v) => setEditing((x) => ({ ...x, date: v }))}
                          required
                        />
                      </div>
                      <div className="col-12">
                        <label className="form-label fw-semibold" htmlFor="dl_product">Product</label>
                        <input
                          id="dl_product"
                          className="form-control"
                          autoComplete="off"
                          required
                          value={editing.productName}
                          onChange={setEdit('productName')}
                        />
                      </div>
                      <div className="col-sm-6">
                        <div className="bn-warning">Please double check the batch number before saving</div>
                        <label className="form-label fw-semibold" htmlFor="dl_batch">Batch Number</label>
                        <input
                          id="dl_batch"
                          className="form-control"
                          autoComplete="off"
                          value={editing.batchNumber}
                          onChange={setEdit('batchNumber')}
                        />
                      </div>
                      <div className="col-6 col-sm-3 align-self-end">
                        <label className="form-label fw-semibold" htmlFor="dl_size">Size</label>
                        <input
                          id="dl_size"
                          className="form-control"
                          autoComplete="off"
                          value={editing.size}
                          onChange={setEdit('size')}
                        />
                      </div>
                      <div className="col-6 col-sm-3 align-self-end">
                        <label className="form-label fw-semibold" htmlFor="dl_barcode">Barcode</label>
                        <input
                          id="dl_barcode"
                          className="form-control"
                          autoComplete="off"
                          value={editing.barcode}
                          onChange={setEdit('barcode')}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}
    </>
  )
}

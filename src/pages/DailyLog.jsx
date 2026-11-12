import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import { useAuth } from '../AuthContext'
import { displayName } from '../permissions'
import DatePickInput from '../components/DatePickInput'
import { formatAuDate, parseAuDate } from '../utils/date'

// Products pushed from Traceability, grouped by production day. Kitchen and
// ALAN can correct an entry; only ALAN can delete one.

const COLLECTION = 'dailyProduction'
const DAYS_PER_PAGE = 10

const ms = (t) => t?.toMillis?.() ?? Number.MAX_SAFE_INTEGER
const timeOf = (t) =>
  t?.toDate ? t.toDate().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : ''

export default function DailyLog() {
  const { flash } = useFlash()
  const { user, profile } = useAuth()
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dayLimit, setDayLimit] = useState(DAYS_PER_PAGE)
  // { id, date, productName, batchNumber } while the edit dialog is open.
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
      if (text && !`${e.productName} ${e.batchNumber}`.toLowerCase().includes(text)) continue
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

  function openEdit(e) {
    setEditing({
      id: e.id,
      date: formatAuDate(e.date),
      productName: e.productName || '',
      batchNumber: e.batchNumber || '',
    })
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
    const batchNumber = editing.batchNumber.trim()
    if (!productName || !batchNumber) {
      flash('Product and batch number are both required.', 'danger')
      return
    }
    setSaving(true)
    try {
      await updateDoc(doc(db, COLLECTION, editing.id), {
        date: Timestamp.fromDate(date),
        productName,
        batchNumber,
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
    if (!confirm(`Delete ${e.productName} (batch ${e.batchNumber}) on ${formatAuDate(e.date)}?`)) return
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
          <p className="page-sub">Products pushed from Traceability, with their batch numbers, by day.</p>
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
                placeholder="Product or batch number"
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
                      <th className="ps-4">Product</th>
                      <th>Batch Number</th>
                      <th>Pushed by</th>
                      <th style={{ width: 100 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.entries.map((e) => (
                      <tr key={e.id}>
                        <td className="ps-4 fw-medium">{e.productName}</td>
                        <td className="fw-medium">{e.batchNumber}</td>
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
                    ))}
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
                          onChange={(e) => setEditing((x) => ({ ...x, productName: e.target.value }))}
                        />
                      </div>
                      <div className="col-sm-6">
                        <div className="bn-warning">Please double check the batch number before saving</div>
                        <label className="form-label fw-semibold" htmlFor="dl_batch">Batch Number</label>
                        <input
                          id="dl_batch"
                          className="form-control"
                          autoComplete="off"
                          required
                          value={editing.batchNumber}
                          onChange={(e) => setEditing((x) => ({ ...x, batchNumber: e.target.value }))}
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

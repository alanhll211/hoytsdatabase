import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import DatePickInput from '../components/DatePickInput'
import { parseAuDate, formatAuDate, formatAuDateTime } from '../utils/date'
import { downloadCsv } from '../utils/csv'

const emptyAddForm = {
  ingredientId: '',
  newIngredientName: '',
  supplierName: '',
  country: '',
  batchNumber: '',
  receivedDate: '',
}

export default function Batches() {
  const { flash } = useFlash()
  const [batches, setBatches] = useState([])
  const [ingredients, setIngredients] = useState([])

  const [q, setQ] = useState('')
  const [ingredientId, setIngredientId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [showAddModal, setShowAddModal] = useState(false)
  const [ingMode, setIngMode] = useState('select')
  const [form, setForm] = useState(emptyAddForm)

  const [editingBatch, setEditingBatch] = useState(null)
  const [editForm, setEditForm] = useState(null)

  useEffect(() => {
    const unsubBatches = onSnapshot(
      query(collection(db, 'batches'), orderBy('receivedDate', 'desc')),
      (snap) => setBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubIngredients = onSnapshot(
      query(collection(db, 'ingredients'), orderBy('name')),
      (snap) => setIngredients(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    return () => {
      unsubBatches()
      unsubIngredients()
    }
  }, [])

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase()
    const dFrom = parseAuDate(dateFrom)
    const dTo = parseAuDate(dateTo)
    return batches
      .filter((b) => {
        if (qLower) {
          const matches =
            (b.ingredientName || '').toLowerCase().includes(qLower) ||
            (b.batchNumber || '').toLowerCase().includes(qLower)
          if (!matches) return false
        }
        if (ingredientId && b.ingredientId !== ingredientId) return false
        const received = b.receivedDate?.toDate ? b.receivedDate.toDate() : null
        if (dFrom && received && received < dFrom) return false
        if (dTo && received && received > dTo) return false
        return true
      })
      .sort((a, b) => {
        const ad = a.receivedDate?.toDate ? a.receivedDate.toDate().getTime() : 0
        const bd = b.receivedDate?.toDate ? b.receivedDate.toDate().getTime() : 0
        if (bd !== ad) return bd - ad
        return (a.ingredientName || '').localeCompare(b.ingredientName || '')
      })
  }, [batches, q, ingredientId, dateFrom, dateTo])

  function clearFilters() {
    setQ('')
    setIngredientId('')
    setDateFrom('')
    setDateTo('')
  }

  async function resolveIngredient() {
    if (ingMode === 'new') {
      const name = form.newIngredientName.trim()
      if (!name) return null
      const existing = ingredients.find((i) => i.name.toLowerCase() === name.toLowerCase())
      if (existing) return existing
      const docRef = await addDoc(collection(db, 'ingredients'), {
        name,
        createdAt: serverTimestamp(),
      })
      return { id: docRef.id, name }
    }
    return ingredients.find((i) => i.id === form.ingredientId) || null
  }

  function resetAddForm() {
    setForm(emptyAddForm)
    setIngMode('select')
  }

  async function handleAddSubmit(e) {
    e.preventDefault()
    const ingredient = await resolveIngredient()
    if (!ingredient) {
      flash('Please select an ingredient or enter a new one.', 'danger')
      return
    }
    if (!form.batchNumber.trim()) {
      flash('Batch number is required.', 'danger')
      return
    }
    const receivedDate = parseAuDate(form.receivedDate)
    if (!receivedDate) {
      flash('Invalid date. Use DD/MM/YYYY format.', 'danger')
      return
    }

    await addDoc(collection(db, 'batches'), {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      supplierName: form.supplierName.trim() || null,
      country: form.country.trim() || null,
      batchNumber: form.batchNumber.trim(),
      receivedDate: Timestamp.fromDate(receivedDate),
      createdAt: serverTimestamp(),
    })
    flash(`Batch "${form.batchNumber.trim()}" added for ${ingredient.name}.`, 'success')
    setShowAddModal(false)
    resetAddForm()
  }

  function openEdit(batch) {
    setEditingBatch(batch)
    setEditForm({
      ingredientId: batch.ingredientId,
      supplierName: batch.supplierName || '',
      country: batch.country || '',
      batchNumber: batch.batchNumber,
      receivedDate: formatAuDate(batch.receivedDate),
    })
  }

  async function handleEditSubmit(e) {
    e.preventDefault()
    if (!editForm.ingredientId) {
      flash('Ingredient is required.', 'danger')
      return
    }
    if (!editForm.batchNumber.trim()) {
      flash('Batch number is required.', 'danger')
      return
    }
    const receivedDate = parseAuDate(editForm.receivedDate)
    if (!receivedDate) {
      flash('Invalid date. Use DD/MM/YYYY format.', 'danger')
      return
    }

    const ingredient = ingredients.find((i) => i.id === editForm.ingredientId)
    await updateDoc(doc(db, 'batches', editingBatch.id), {
      ingredientId: editForm.ingredientId,
      ingredientName: ingredient?.name || editingBatch.ingredientName,
      supplierName: editForm.supplierName.trim() || null,
      country: editForm.country.trim() || null,
      batchNumber: editForm.batchNumber.trim(),
      receivedDate: Timestamp.fromDate(receivedDate),
    })
    flash(`Batch "${editForm.batchNumber.trim()}" updated.`, 'success')
    setEditingBatch(null)
    setEditForm(null)
  }

  async function handleDelete(batch) {
    if (!confirm(`Delete batch '${batch.batchNumber}' for ${batch.ingredientName}?`)) return
    await deleteDoc(doc(db, 'batches', batch.id))
    flash(`Batch "${batch.batchNumber}" deleted.`, 'success')
  }

  function exportCsv() {
    const rows = [
      ['Ingredient', 'Supplier Name', 'Country', 'Batch Number', 'Received Date', 'Record Created'],
    ]
    for (const b of filtered) {
      rows.push([
        b.ingredientName,
        b.supplierName || '',
        b.country || '',
        b.batchNumber,
        formatAuDate(b.receivedDate),
        b.createdAt ? formatAuDateTime(b.createdAt) : '',
      ])
    }
    const today = new Date()
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
      today.getDate()
    ).padStart(2, '0')}`
    downloadCsv(`batch_records_${stamp}.csv`, rows)
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="page-heading mb-0">
          <i className="bi bi-archive me-2 text-primary"></i>Batch Records
        </h1>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-success" onClick={exportCsv}>
            <i className="bi bi-download me-1"></i>Export CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <i className="bi bi-plus-lg me-1"></i>Add Batch
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="row g-2 align-items-end">
            <div className="col-md-3">
              <label className="form-label form-label-sm fw-semibold mb-1">Search</label>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="form-control form-control-sm"
                placeholder="Ingredient or batch number"
              />
            </div>
            <div className="col-md-3">
              <label className="form-label form-label-sm fw-semibold mb-1">Ingredient</label>
              <select
                value={ingredientId}
                onChange={(e) => setIngredientId(e.target.value)}
                className="form-select form-select-sm"
              >
                <option value="">All ingredients</option>
                {ingredients.map((ing) => (
                  <option key={ing.id} value={ing.id}>
                    {ing.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label form-label-sm fw-semibold mb-1">Received from</label>
              <DatePickInput value={dateFrom} onChange={setDateFrom} />
            </div>
            <div className="col-md-2">
              <label className="form-label form-label-sm fw-semibold mb-1">Received to</label>
              <DatePickInput value={dateTo} onChange={setDateTo} />
            </div>
            <div className="col-md-2 d-flex gap-2">
              <button className="btn btn-sm btn-outline-secondary flex-fill" onClick={clearFilters}>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="card">
        <div className="card-body p-0">
          {filtered.length > 0 ? (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th className="ps-4">Ingredient</th>
                    <th>Supplier Name</th>
                    <th>Country</th>
                    <th>Batch Number</th>
                    <th>Received Date</th>
                    <th>Record Created</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => (
                    <tr key={b.id}>
                      <td className="ps-4">{b.ingredientName}</td>
                      <td>{b.supplierName || '—'}</td>
                      <td>{b.country || '—'}</td>
                      <td className="fw-medium">{b.batchNumber}</td>
                      <td>{formatAuDate(b.receivedDate)}</td>
                      <td className="text-muted small">
                        {b.createdAt ? formatAuDateTime(b.createdAt) : '—'}
                      </td>
                      <td>
                        <div className="d-flex gap-1">
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            title="Edit"
                            onClick={() => openEdit(b)}
                          >
                            <i className="bi bi-pencil"></i>
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            title="Delete"
                            onClick={() => handleDelete(b)}
                          >
                            <i className="bi bi-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-inbox display-4 d-block mb-2"></i>
              No batch records found.
            </div>
          )}
        </div>
        {filtered.length > 0 && (
          <div className="card-footer text-muted small">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Add Batch Modal */}
      {showAddModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleAddSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">Add Batch Record</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => {
                      setShowAddModal(false)
                      resetAddForm()
                    }}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Ingredient</label>
                    <div className="d-flex gap-2 mb-2">
                      <button
                        type="button"
                        className={`btn btn-sm ${ingMode === 'select' ? 'btn-primary' : 'btn-outline-secondary'}`}
                        onClick={() => setIngMode('select')}
                      >
                        Select existing
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${ingMode === 'new' ? 'btn-primary' : 'btn-outline-secondary'}`}
                        onClick={() => setIngMode('new')}
                      >
                        + Create new
                      </button>
                    </div>
                    {ingMode === 'select' ? (
                      <select
                        className="form-select"
                        value={form.ingredientId}
                        onChange={(e) => setForm({ ...form, ingredientId: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {ingredients.map((ing) => (
                          <option key={ing.id} value={ing.id}>
                            {ing.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="form-control"
                        placeholder="New ingredient name"
                        autoComplete="off"
                        value={form.newIngredientName}
                        onChange={(e) => setForm({ ...form, newIngredientName: e.target.value })}
                      />
                    )}
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Supplier Name</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. Acme Supplies"
                      autoComplete="off"
                      value={form.supplierName}
                      onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Country</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. Australia"
                      autoComplete="off"
                      value={form.country}
                      onChange={(e) => setForm({ ...form, country: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Batch Number</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. LOT-20240115"
                      required
                      autoComplete="off"
                      value={form.batchNumber}
                      onChange={(e) => setForm({ ...form, batchNumber: e.target.value })}
                    />
                  </div>
                  <div className="mb-1">
                    <label className="form-label fw-semibold">Received Date</label>
                    <DatePickInput
                      value={form.receivedDate}
                      onChange={(v) => setForm({ ...form, receivedDate: v })}
                      required
                    />
                    <div className="form-text">Enter the date the batch was physically received.</div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowAddModal(false)
                      resetAddForm()
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add Batch
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {showAddModal && <div className="modal-backdrop fade show"></div>}

      {/* Edit Batch Modal */}
      {editingBatch && editForm && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleEditSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">Edit Batch Record</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => {
                      setEditingBatch(null)
                      setEditForm(null)
                    }}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Ingredient</label>
                    <select
                      className="form-select"
                      value={editForm.ingredientId}
                      onChange={(e) => setEditForm({ ...editForm, ingredientId: e.target.value })}
                    >
                      <option value="">— Select —</option>
                      {ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Supplier Name</label>
                    <input
                      type="text"
                      className="form-control"
                      autoComplete="off"
                      value={editForm.supplierName}
                      onChange={(e) => setEditForm({ ...editForm, supplierName: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Country</label>
                    <input
                      type="text"
                      className="form-control"
                      autoComplete="off"
                      value={editForm.country}
                      onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Batch Number</label>
                    <input
                      type="text"
                      className="form-control"
                      required
                      autoComplete="off"
                      value={editForm.batchNumber}
                      onChange={(e) => setEditForm({ ...editForm, batchNumber: e.target.value })}
                    />
                  </div>
                  <div className="mb-1">
                    <label className="form-label fw-semibold">Received Date</label>
                    <DatePickInput
                      value={editForm.receivedDate}
                      onChange={(v) => setEditForm({ ...editForm, receivedDate: v })}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditingBatch(null)
                      setEditForm(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {editingBatch && <div className="modal-backdrop fade show"></div>}
    </>
  )
}

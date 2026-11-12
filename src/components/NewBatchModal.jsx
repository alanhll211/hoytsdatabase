import { useState } from 'react'
import { addDoc, collection, serverTimestamp, Timestamp } from '../data'
import { db } from '../firebase'
import DatePickInput from './DatePickInput'
import { formatAuDate, parseAuDate } from '../utils/date'
import { withTextPrefix } from '../utils/batch'

// Records a new batch of one raw material from the Traceability results.
// Saved to the shared batches collection, the same records the Batches page
// shows, so every product that uses this ingredient picks it up.
//
// last: the batch currently shown for this ingredient (pre-fills the form).
// defaultDate: received date to start with (the searched production date).
export default function NewBatchModal({ ingredient, last, defaultDate, user, onClose, onSaved, flash }) {
  const [form, setForm] = useState({
    supplierName: last?.supplierName || '',
    country: last?.country || '',
    batchNumber: last?.useCurrentDate ? '' : last?.batchNumber || '',
    useCurrentDate: !!last?.useCurrentDate,
    receivedDate: formatAuDate(defaultDate),
  })
  const [saving, setSaving] = useState(false)
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return
    if (!form.useCurrentDate && !form.batchNumber.trim()) {
      flash('Batch number is required.', 'danger')
      return
    }
    const receivedDate = parseAuDate(form.receivedDate)
    if (!receivedDate) {
      flash('Invalid date. Use DD/MM/YYYY format.', 'danger')
      return
    }
    const batchNumber = form.useCurrentDate ? null : withTextPrefix(form.batchNumber)
    if (
      batchNumber &&
      last &&
      !last.useCurrentDate &&
      withTextPrefix(last.batchNumber).toLowerCase() === batchNumber.toLowerCase() &&
      !confirm(`Batch ${batchNumber} is already the latest batch for ${ingredient.name}. Save it again?`)
    ) {
      return
    }

    setSaving(true)
    try {
      await addDoc(collection(db, 'batches'), {
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        supplierName: form.supplierName.trim() || null,
        country: form.country.trim() || null,
        batchNumber,
        useCurrentDate: form.useCurrentDate,
        receivedDate: Timestamp.fromDate(receivedDate),
        createdAt: serverTimestamp(),
        createdBy: user,
      })
      flash(`Batch ${batchNumber ?? 'Current Date'} added for ${ingredient.name}.`, 'success')
      onSaved(receivedDate)
    } catch (err) {
      console.error(err)
      flash('Could not save the batch. Please try again.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
        <div className="modal-dialog">
          <div className="modal-content">
            <form onSubmit={handleSubmit}>
              <div className="modal-header">
                <div>
                  <h5 className="modal-title">New Batch</h5>
                  <div className="text-muted small">{ingredient.name}</div>
                </div>
                <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-sm-6">
                    <label className="form-label fw-semibold" htmlFor="nb_supplier">Supplier Name</label>
                    <input
                      id="nb_supplier"
                      className="form-control"
                      autoComplete="off"
                      value={form.supplierName}
                      onChange={(e) => set('supplierName', e.target.value)}
                    />
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label fw-semibold" htmlFor="nb_country">Country</label>
                    <input
                      id="nb_country"
                      className="form-control"
                      autoComplete="off"
                      value={form.country}
                      onChange={(e) => set('country', e.target.value)}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label fw-semibold" htmlFor="nb_batch">Batch Number</label>
                    <input
                      id="nb_batch"
                      className="form-control"
                      placeholder={form.useCurrentDate ? 'Production date (DDMMYY)' : 'e.g. LOT-20240115'}
                      required={!form.useCurrentDate}
                      disabled={form.useCurrentDate}
                      autoComplete="off"
                      value={form.useCurrentDate ? '' : form.batchNumber}
                      onChange={(e) => set('batchNumber', e.target.value)}
                    />
                    <button
                      type="button"
                      className={`chip-toggle mt-2 ${form.useCurrentDate ? 'on' : ''}`}
                      aria-pressed={form.useCurrentDate}
                      onClick={() => set('useCurrentDate', !form.useCurrentDate)}
                    >
                      <i className="bi bi-calendar-event"></i>Use Current Date
                    </button>
                    <div className="form-text">
                      {last
                        ? 'Filled in from the batch shown now. Change what is different on the new bag.'
                        : 'No earlier batch for this ingredient.'}
                    </div>
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label fw-semibold">Received Date</label>
                    <DatePickInput value={form.receivedDate} onChange={(v) => set('receivedDate', v)} required />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Add Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show"></div>
    </>
  )
}

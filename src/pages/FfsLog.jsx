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
import ComboInput from '../components/ComboInput'
import { parseAuDate, formatAuDate } from '../utils/date'
import { hoytsBatchNumber } from '../utils/excelRow'
import { copyHtmlTable } from '../utils/clipboard'
import {
  MACHINES,
  emptyLine,
  sortNewestFirst,
  sortEntryOrder,
  entriesOnDay,
  rowCount,
  lastEntryFor,
  lastEntryOnMachine,
  productOptions,
  supplierOptions,
  fillForSupplier,
  internalOptions,
  fillForInternal,
  weightOptions,
  unitsForWeight,
  buildFfsRows,
  ffsRowsToHtml,
  ffsRowsToTsv,
} from '../utils/ffs'

const COLLECTION = 'ffsEntries'
const DAYS_PER_PAGE = 10

function blankForm(date) {
  return {
    date: formatAuDate(date),
    machine: '',
    productName: '',
    hoytsBatch: hoytsBatchNumber(date),
    // Hoyts Batch NO. follows the date until it is edited by hand.
    hoytsAuto: true,
    weightPerBag: '',
    unitsPerBox: '',
    lines: [emptyLine()],
    // { machine, date } while the product fields still hold a machine's last
    // run untouched, so tapping another machine can swap them.
    machineFill: null,
  }
}

const str = (v) => String(v ?? '').trim()
const cleanLine = (l) => ({
  internalIngredient: str(l.internalIngredient),
  supplier: str(l.supplier),
  country: str(l.country),
  batchNumber: str(l.batchNumber),
})

function formFromEntry(e) {
  const date = e.date?.toDate ? e.date.toDate() : new Date()
  return {
    date: formatAuDate(date),
    machine: e.machine ? String(e.machine) : '',
    productName: e.productName || '',
    hoytsBatch: e.hoytsBatch || '',
    hoytsAuto: (e.hoytsBatch || '') === hoytsBatchNumber(date),
    weightPerBag: e.weightPerBag || '',
    unitsPerBox: e.unitsPerBox || '',
    lines: e.lines?.length ? e.lines.map(cleanLine) : [emptyLine()],
    machineFill: null,
  }
}

// Weight, units and raw materials copied from an earlier run.
const runDetails = (e) => ({
  weightPerBag: e.weightPerBag || '',
  unitsPerBox: e.unitsPerBox || '',
  lines: e.lines?.length ? e.lines.map(cleanLine) : [emptyLine()],
})
const noProduct = { productName: '', weightPerBag: '', unitsPerBox: '', lines: [emptyLine()] }
const PRODUCT_FIELDS = new Set(['productName', 'weightPerBag', 'unitsPerBox'])
const hasProductInput = (f) =>
  [f.productName, f.weightPerBag, f.unitsPerBox, ...f.lines.flatMap(Object.values)].some((v) => str(v))

const dash = <span className="text-muted">—</span>

export default function FfsLog() {
  const { flash } = useFlash()
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)

  const [q, setQ] = useState('')
  const [machineFilter, setMachineFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dayLimit, setDayLimit] = useState(DAYS_PER_PAGE)

  // form === null means the dialog is closed; editingId === null means adding.
  const [form, setForm] = useState(null)
  const [editingId, setEditingId] = useState(null)
  // Bumped to remount the form's inputs whenever a fresh form starts.
  const [formKey, setFormKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [copiedKey, setCopiedKey] = useState(null)
  // Date for "Copy a day". null follows the latest production day until a
  // date is picked or typed.
  const [copyDate, setCopyDate] = useState(null)

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

  const history = useMemo(() => sortNewestFirst(entries), [entries])
  // "Last time" never looks at the entry being edited.
  const past = useMemo(
    () => (editingId ? history.filter((e) => e.id !== editingId) : history),
    [history, editingId]
  )

  // Every run on the picked day, whatever the list filters show.
  const copyDay = copyDate ?? formatAuDate(history[0]?.date ?? new Date())
  const copyDayEntries = useMemo(() => entriesOnDay(history, copyDay), [history, copyDay])
  const copyDayKey = `pick:${copyDay}`
  const copySummary = useMemo(() => {
    if (!copyDayEntries?.length) return null
    const runs = copyDayEntries.length
    const rows = rowCount(copyDayEntries)
    const machines = [...new Set(copyDayEntries.map((e) => e.machine))].sort((a, b) => a - b)
    return {
      date: formatAuDate(copyDayEntries[0].date),
      runs: `${runs} run${runs !== 1 ? 's' : ''}`,
      rows: `${rows} row${rows !== 1 ? 's' : ''}`,
      machines: `Machine${machines.length !== 1 ? 's' : ''} ${machines.join(', ')}`,
      products: [...new Set(copyDayEntries.map((e) => e.productName))].join(', '),
    }
  }, [copyDayEntries])

  const productName = form?.productName ?? ''
  const productOpts = useMemo(() => productOptions(past), [past])
  const supplierOpts = useMemo(() => supplierOptions(past, productName), [past, productName])
  const internalOpts = useMemo(() => internalOptions(past, productName), [past, productName])
  const weightOpts = useMemo(() => weightOptions(past, productName), [past, productName])

  const days = useMemo(() => {
    const text = q.trim().toLowerCase()
    const from = parseAuDate(dateFrom)
    const to = parseAuDate(dateTo)
    const groups = new Map()
    for (const e of history) {
      const d = e.date?.toDate ? e.date.toDate() : null
      if (from && d && d < from) continue
      if (to && d && d > to) continue
      if (machineFilter && String(e.machine) !== machineFilter) continue
      if (text) {
        const haystack = [
          e.productName,
          e.hoytsBatch,
          ...(e.lines || []).flatMap((l) => [l.internalIngredient, l.supplier, l.country, l.batchNumber]),
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(text)) continue
      }
      const key = formatAuDate(d)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(e)
    }
    return [...groups].map(([date, list]) => ({ date, entries: sortEntryOrder(list) }))
  }, [history, q, machineFilter, dateFrom, dateTo])

  function clearFilters() {
    setQ('')
    setMachineFilter('')
    setDateFrom('')
    setDateTo('')
  }

  function startForm(id, value) {
    setEditingId(id)
    setForm(value)
    setFormKey((k) => k + 1)
  }

  function closeForm() {
    setForm(null)
    setEditingId(null)
  }

  // Any change to the product fields keeps them from being swapped by a
  // later machine tap.
  const setField = (key, value) =>
    setForm((f) => ({ ...f, [key]: value, ...(PRODUCT_FIELDS.has(key) ? { machineFill: null } : {}) }))
  const setLine = (i, patch) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)),
      machineFill: null,
    }))
  const setLines = (fn) => setForm((f) => ({ ...f, lines: fn(f.lines), machineFill: null }))

  // Tapping a machine fills in its last run, as long as no product has been
  // typed or picked yet. Another machine tap swaps in that machine's last run.
  function pickMachine(m) {
    setForm((f) => {
      const next = { ...f, machine: String(m) }
      if (!f.machineFill && hasProductInput(f)) return next
      const last = lastEntryOnMachine(past, m)
      if (!last) return f.machineFill ? { ...next, ...noProduct, machineFill: null } : next
      return {
        ...next,
        productName: last.productName || '',
        ...runDetails(last),
        machineFill: { machine: m, date: formatAuDate(last.date) },
      }
    })
  }

  function setDate(value) {
    setForm((f) => {
      const d = parseAuDate(value)
      return { ...f, date: value, hoytsBatch: f.hoytsAuto && d ? hoytsBatchNumber(d) : f.hoytsBatch }
    })
  }

  function resetHoyts() {
    setForm((f) => {
      const d = parseAuDate(f.date)
      return d ? { ...f, hoytsBatch: hoytsBatchNumber(d), hoytsAuto: true } : f
    })
  }

  // Picking a product fills everything from its last run; all stays editable.
  function pickProduct(option) {
    const last = lastEntryFor(past, option.value)
    if (!last) return
    setForm((f) => ({ ...f, ...runDetails(last), machineFill: null }))
  }

  function pickSupplier(i, option) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, x) =>
        x === i
          ? { ...l, supplier: option.value, ...fillForSupplier(past, f.productName, option.value, l.internalIngredient) }
          : l
      ),
      machineFill: null,
    }))
  }

  function pickInternal(i, option) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, x) =>
        x === i
          ? { ...l, internalIngredient: option.value, ...fillForInternal(past, f.productName, option.value) }
          : l
      ),
      machineFill: null,
    }))
  }

  function pickWeight(option) {
    setForm((f) => {
      const units = unitsForWeight(past, f.productName, option.value)
      return {
        ...f,
        weightPerBag: option.value,
        ...(units === null ? {} : { unitsPerBox: units }),
        machineFill: null,
      }
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return
    const addAnother = e.nativeEvent?.submitter?.value === 'another'
    const date = parseAuDate(form.date)
    if (!date) {
      flash('Invalid date. Use DD/MM/YYYY format.', 'danger')
      return
    }
    if (!form.machine) {
      flash('Please choose a machine.', 'danger')
      return
    }
    const name = form.productName.trim()
    if (!name) {
      flash('Product name is required.', 'danger')
      return
    }
    const data = {
      date: Timestamp.fromDate(date),
      machine: Number(form.machine),
      productName: name,
      hoytsBatch: form.hoytsBatch.trim(),
      weightPerBag: form.weightPerBag.trim(),
      unitsPerBox: form.unitsPerBox.trim(),
      lines: form.lines.map(cleanLine).filter((l) => Object.values(l).some(Boolean)),
    }

    setSaving(true)
    try {
      if (editingId) {
        await updateDoc(doc(db, COLLECTION, editingId), data)
        flash(`Updated ${name} on machine ${data.machine}.`, 'success')
        closeForm()
      } else {
        await addDoc(collection(db, COLLECTION), { ...data, createdAt: serverTimestamp() })
        flash(`Saved ${name} on machine ${data.machine}.`, 'success')
        if (addAnother) {
          // Next run is usually the same day and Hoyts batch, so keep both.
          startForm(null, { ...blankForm(date), hoytsBatch: form.hoytsBatch, hoytsAuto: form.hoytsAuto })
        } else {
          closeForm()
        }
      }
    } catch (err) {
      console.error(err)
      flash('Could not save the entry. Please try again.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(entry) {
    if (!confirm(`Delete ${entry.productName} (machine ${entry.machine}) on ${formatAuDate(entry.date)}?`)) return
    try {
      await deleteDoc(doc(db, COLLECTION, entry.id))
      flash(`Deleted ${entry.productName}.`, 'success')
    } catch (err) {
      console.error(err)
      flash('Could not delete the entry. Please try again.', 'danger')
    }
  }

  function copyEntries(list, key, label = '') {
    const rows = buildFfsRows(list)
    if (copyHtmlTable(ffsRowsToHtml(rows), ffsRowsToTsv(rows))) {
      setCopiedKey(key)
      const what = `${rows.length} row${rows.length !== 1 ? 's' : ''}${label ? ` ${label}` : ''}`
      flash(`Copied ${what}. Paste into column A in Excel.`, 'success')
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 2000)
    } else {
      flash('Copy failed. Your browser blocked clipboard access.', 'danger')
    }
  }

  function renderEntry(e) {
    const lines = e.lines?.length ? e.lines : [emptyLine()]
    const n = lines.length
    const copied = copiedKey === e.id
    return lines.map((l, i) => (
      <tr key={`${e.id}-${i}`} className={i < n - 1 ? 'line-cont' : ''}>
        {i === 0 && (
          <td rowSpan={n} className="ps-4">
            <span className="machine-badge">{e.machine}</span>
          </td>
        )}
        {i === 0 && (
          <td rowSpan={n} className="fw-medium">
            {e.productName}
          </td>
        )}
        <td className="line-cell">{l.internalIngredient || dash}</td>
        {i === 0 && <td rowSpan={n}>{e.hoytsBatch || dash}</td>}
        <td className="line-cell">{l.supplier || dash}</td>
        <td className="line-cell">{l.country || dash}</td>
        <td className="line-cell fw-medium">{l.batchNumber || dash}</td>
        {i === 0 && (
          <td rowSpan={n} className="text-end">
            {e.weightPerBag || dash}
          </td>
        )}
        {i === 0 && (
          <td rowSpan={n} className="text-end">
            {e.unitsPerBox || dash}
          </td>
        )}
        {i === 0 && (
          <td rowSpan={n}>
            <div className="d-flex gap-1 justify-content-end pe-2">
              <button
                className="btn btn-sm btn-outline-secondary btn-icon"
                title="Copy this run for Excel"
                onClick={() => copyEntries([e], e.id)}
              >
                <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'}`}></i>
              </button>
              <button
                className="btn btn-sm btn-outline-secondary btn-icon"
                title="Edit"
                onClick={() => startForm(e.id, formFromEntry(e))}
              >
                <i className="bi bi-pencil"></i>
              </button>
              <button
                className="btn btn-sm btn-outline-danger btn-icon"
                title="Delete"
                onClick={() => handleDelete(e)}
              >
                <i className="bi bi-trash"></i>
              </button>
            </div>
          </td>
        )}
      </tr>
    ))
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>FFS Production Log</h1>
          <p className="page-sub">
            36-40 Alex Ave (FFS). One entry per machine run, ready to paste into the FFS sheet.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => startForm(null, blankForm(new Date()))}>
          <i className="bi bi-plus-lg me-1"></i>Add Entry
        </button>
      </div>

      {/* Copy every run of one day, all machines, for the FFS sheet */}
      <div className="card mb-3">
        <div className="card-body py-3">
          <div className="row g-2 align-items-end">
            <div className="col-md-3">
              <label className="form-label" htmlFor="ffs_copy_date">
                Copy a day for Excel
              </label>
              <DatePickInput id="ffs_copy_date" value={copyDay} onChange={setCopyDate} />
            </div>
            <div className="col-md-6 copy-day-summary" aria-live="polite">
              {!loaded ? null : !copyDayEntries ? (
                <span className="text-danger">Enter the date as DD/MM/YYYY.</span>
              ) : !copySummary ? (
                <span className="text-muted">No runs on {formatAuDate(parseAuDate(copyDay))}.</span>
              ) : (
                <>
                  <div className="fw-medium">
                    {copySummary.runs} · {copySummary.rows} · {copySummary.machines}
                  </div>
                  <div className="text-muted small" title={copySummary.products}>
                    {copySummary.products}
                  </div>
                </>
              )}
            </div>
            <div className="col-md-3 d-flex">
              <button
                className="btn btn-primary flex-fill"
                disabled={!copySummary}
                onClick={() =>
                  copyEntries(copyDayEntries, copyDayKey, `(${copySummary.runs} on ${copySummary.date})`)
                }
              >
                <i className={`bi ${copiedKey === copyDayKey ? 'bi-check-lg' : 'bi-clipboard'} me-1`}></i>
                {copiedKey === copyDayKey ? 'Copied' : 'Copy All Products'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="row g-2 align-items-end">
            <div className="col-md-4">
              <label className="form-label" htmlFor="ffs_q">Search</label>
              <input
                id="ffs_q"
                type="text"
                className="form-control"
                placeholder="Product, supplier or batch"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="ffs_machine_filter">Machine</label>
              <select
                id="ffs_machine_filter"
                className="form-select"
                value={machineFilter}
                onChange={(e) => setMachineFilter(e.target.value)}
              >
                <option value="">All machines</option>
                {MACHINES.map((m) => (
                  <option key={m} value={String(m)}>
                    Machine {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">From</label>
              <DatePickInput value={dateFrom} onChange={setDateFrom} />
            </div>
            <div className="col-md-2">
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
              <i className="bi bi-inbox"></i>
            </span>
            <div className="es-title">{entries.length ? 'No entries match the filters' : 'No FFS entries yet'}</div>
            <p>{entries.length ? 'Adjust the filters above.' : 'Add the first machine run to start the log.'}</p>
          </div>
        </div>
      ) : (
        <>
          {days.slice(0, dayLimit).map((day) => (
            <div className="card mb-3" key={day.date}>
              <div className="card-header d-flex flex-wrap gap-2 justify-content-between align-items-center py-3">
                <div>
                  <div className="fw-semibold">{day.date}</div>
                  <div className="text-muted small">
                    {day.entries.length} run{day.entries.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => copyEntries(day.entries, day.date)}
                  title="Copy this day's runs. Paste into column A in Excel."
                >
                  <i className={`bi ${copiedKey === day.date ? 'bi-check-lg' : 'bi-clipboard'} me-1`}></i>
                  {copiedKey === day.date ? 'Copied' : 'Copy Day'}
                </button>
              </div>
              <div className="table-responsive">
                <table className="table mb-0 ffs-table">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-4">Machine</th>
                      <th>Product</th>
                      <th>Internal Ingredients</th>
                      <th>Hoyts Batch</th>
                      <th>Supplier</th>
                      <th>Country</th>
                      <th>Batch / Lot</th>
                      <th className="text-end">Weight (g)/Bag</th>
                      <th className="text-end">Unit/Box</th>
                      <th style={{ width: 130 }}></th>
                    </tr>
                  </thead>
                  <tbody>{day.entries.flatMap(renderEntry)}</tbody>
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

      {form && (
        <>
          <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
            <div className="modal-dialog modal-wide">
              <div className="modal-content allow-overflow">
                <form key={formKey} onSubmit={handleSubmit}>
                  <div className="modal-header">
                    <h5 className="modal-title">{editingId ? 'Edit Entry' : 'Add Entry'}</h5>
                    <button type="button" className="btn-close" aria-label="Close" onClick={closeForm}></button>
                  </div>
                  <div className="modal-body">
                    <div className="row g-3">
                      <div className="col-md-4">
                        <label className="form-label fw-semibold">Date</label>
                        <DatePickInput value={form.date} onChange={setDate} required />
                      </div>
                      <div className="col-md-8">
                        <div className="form-label fw-semibold" id="ffs_machine_label">
                          Machine NO.
                        </div>
                        <div className="machine-picker" role="radiogroup" aria-labelledby="ffs_machine_label">
                          {MACHINES.map((m) => {
                            const on = form.machine === String(m)
                            return (
                              <button
                                key={m}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                className={on ? 'on' : ''}
                                onClick={() => pickMachine(m)}
                              >
                                {m}
                              </button>
                            )
                          })}
                        </div>
                        {form.machineFill && (
                          <div className="form-text">
                            Filled in from machine {form.machineFill.machine}'s last run on {form.machineFill.date}.
                            Change anything that's different.
                          </div>
                        )}
                      </div>
                      <div className="col-md-8">
                        <label className="form-label fw-semibold" htmlFor="ffs_product">
                          Product Name
                        </label>
                        <ComboInput
                          id="ffs_product"
                          value={form.productName}
                          onChange={(v) => setField('productName', v)}
                          onPick={pickProduct}
                          options={productOpts}
                          selectOnFocus={!!form.machineFill}
                          placeholder="e.g. Cumin Ground"
                          required
                          emptyText="No products yet. Type a new one."
                        />
                        <div className="form-text">
                          Pick a previous product to fill in last run's supplier, country, batch, weight and units.
                        </div>
                      </div>
                      <div className="col-md-4">
                        <label className="form-label fw-semibold" htmlFor="ffs_hoyts">
                          Hoyts Batch NO.
                        </label>
                        <input
                          id="ffs_hoyts"
                          className="form-control"
                          autoComplete="off"
                          value={form.hoytsBatch}
                          onChange={(e) => setForm((f) => ({ ...f, hoytsBatch: e.target.value, hoytsAuto: false }))}
                        />
                        <div className="form-text">
                          {form.hoytsAuto ? (
                            "Julian code of the date (DDDYY)."
                          ) : (
                            <>
                              Edited by hand.{' '}
                              <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={resetHoyts}>
                                Use the date's code
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="col-6 col-md-4">
                        <label className="form-label fw-semibold" htmlFor="ffs_weight">
                          Weight (g) / Bag
                        </label>
                        <ComboInput
                          id="ffs_weight"
                          value={form.weightPerBag}
                          onChange={(v) => setField('weightPerBag', v)}
                          onPick={pickWeight}
                          options={weightOpts}
                          placeholder="e.g. 25"
                          emptyText="No previous weights for this product"
                        />
                      </div>
                      <div className="col-6 col-md-4">
                        <label className="form-label fw-semibold" htmlFor="ffs_units">
                          Unit / Box
                        </label>
                        <input
                          id="ffs_units"
                          className="form-control"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="e.g. 18"
                          value={form.unitsPerBox}
                          onChange={(e) => setField('unitsPerBox', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="section-title mt-4 mb-2">Raw Materials</div>
                    {form.lines.map((line, i) => (
                      <div className="ffs-line" key={i}>
                        <div className="row g-2">
                          <div className="col-6 col-md-3">
                            <label className="form-label small" htmlFor={`ffs_internal_${i}`}>
                              Internal Ingredient
                            </label>
                            <ComboInput
                              id={`ffs_internal_${i}`}
                              value={line.internalIngredient}
                              onChange={(v) => setLine(i, { internalIngredient: v })}
                              onPick={(o) => pickInternal(i, o)}
                              options={internalOpts}
                              placeholder="Optional"
                              emptyText="None recorded for this product"
                            />
                          </div>
                          <div className="col-6 col-md-3">
                            <label className="form-label small" htmlFor={`ffs_supplier_${i}`}>
                              Supplier
                            </label>
                            <ComboInput
                              id={`ffs_supplier_${i}`}
                              value={line.supplier}
                              onChange={(v) => setLine(i, { supplier: v })}
                              onPick={(o) => pickSupplier(i, o)}
                              options={supplierOpts}
                              placeholder="e.g. Best Ingredients"
                              emptyText="No suppliers yet. Type a new one."
                            />
                          </div>
                          <div className="col-6 col-md-2">
                            <label className="form-label small" htmlFor={`ffs_country_${i}`}>
                              Country
                            </label>
                            <input
                              id={`ffs_country_${i}`}
                              className="form-control"
                              autoComplete="off"
                              value={line.country}
                              onChange={(e) => setLine(i, { country: e.target.value })}
                            />
                          </div>
                          <div className={form.lines.length > 1 ? 'col-5 col-md-3' : 'col-6 col-md-4'}>
                            <label className="form-label small" htmlFor={`ffs_batch_${i}`}>
                              Batch / Lot No.
                            </label>
                            <input
                              id={`ffs_batch_${i}`}
                              className="form-control"
                              autoComplete="off"
                              value={line.batchNumber}
                              onChange={(e) => setLine(i, { batchNumber: e.target.value })}
                            />
                          </div>
                          {form.lines.length > 1 && (
                            <div className="col-1 d-flex align-items-end justify-content-end">
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-icon"
                                title="Remove line"
                                onClick={() => setLines((lines) => lines.filter((_, x) => x !== i))}
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setLines((lines) => [...lines, emptyLine()])}
                    >
                      <i className="bi bi-plus-lg me-1"></i>Add Line
                    </button>
                    <div className="form-text">
                      Add a line for a second supplier, or another ingredient such as sugar and crystals.
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={closeForm}>
                      Cancel
                    </button>
                    {!editingId && (
                      <button
                        type="submit"
                        value="another"
                        className="btn btn-outline-primary"
                        disabled={saving}
                        title="Save this run and start the next one on the same day"
                      >
                        Save &amp; Add Another
                      </button>
                    )}
                    <button type="submit" value="close" className="btn btn-primary" disabled={saving}>
                      {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Entry'}
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

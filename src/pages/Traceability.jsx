import { Fragment, useEffect, useState } from 'react'
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  getDocs,
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from '../data'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import { useAuth } from '../AuthContext'
import { canOpen, displayName } from '../permissions'
import ComboInput from '../components/ComboInput'
import DatePickInput from '../components/DatePickInput'
import NewBatchModal from '../components/NewBatchModal'
import { parseAuDate, formatAuDate, formatAuDateTime } from '../utils/date'
import { downloadCsv } from '../utils/csv'
import {
  displayBatchNumber as batchNumberOn,
  lookupMaterials,
  materialCopyRows,
  materialsSnapshot,
  PACKAGING,
  packagingFromPack,
  blankPackagingComments,
  materialComments,
  packagingSnapshot,
  rememberPack,
  findJarSize,
  jarSizeOptions,
  packagingForPack,
  jarSizeUpdate,
} from '../utils/trace'
import { copyHtmlTable, copyText } from '../utils/clipboard'
import {
  PH_NOT_TESTED,
  buildExcelRows,
  hoytsBatchNumber,
  materialsTsv,
  normalizeBarcode,
  parseRecipeName,
  rowsToHtml,
  rowsToTsv,
} from '../utils/excelRow'

// prefill: batch number from the production date's Julian code (DDDYY), size,
// barcode, jar size and packaging from the product's first saved pack.
// Without it (Kitchen) they start empty and are typed or picked, and the
// packaging starts from the usual jar and lid suppliers.
function initialHeader(recipe, productionDate, prefill, jarSizes) {
  const pack = prefill ? recipe.packs?.find((p) => p.size || p.barcode) : null
  return {
    hoytsBn: prefill ? hoytsBatchNumber(productionDate) : '',
    size: pack?.size || '',
    barcode: pack?.barcode || '',
    ...packagingForPack(pack, jarSizes),
    ...blankPackagingComments(),
    phStart: recipe.phStart ?? PH_NOT_TESTED,
    phEnd: recipe.phEnd ?? PH_NOT_TESTED,
    document: parseRecipeName(recipe.name).document,
  }
}

export default function Traceability() {
  const { flash } = useFlash()
  const { user, profile } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [ingredients, setIngredients] = useState([])
  // Jar sizes with the jar and lid details last used with each.
  const [jarSizes, setJarSizes] = useState([])

  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [productionDateStr, setProductionDateStr] = useState(() => formatAuDate(new Date()))

  const [results, setResults] = useState(null)
  const [activeRecipe, setActiveRecipe] = useState(null)
  const [activeProductionDate, setActiveProductionDate] = useState(null)
  const [running, setRunning] = useState(false)
  // Which copy button just succeeded: 'all', 'materials' or null.
  const [copied, setCopied] = useState(null)
  // Grey-row values for this lookup only; recipe defaults are edited on Recipes.
  const [header, setHeader] = useState(null)
  // Result row whose ingredient is getting a new batch (dialog open).
  const [newBatchFor, setNewBatchFor] = useState(null)
  const [pushing, setPushing] = useState(false)
  // Recipe, date and batch number of the last successful push.
  const [pushedKey, setPushedKey] = useState(null)

  useEffect(() => {
    const unsubRecipes = onSnapshot(query(collection(db, 'recipes'), orderBy('name')), (snap) =>
      setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubIngredients = onSnapshot(collection(db, 'ingredients'), (snap) =>
      setIngredients(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubJarSizes = onSnapshot(
      collection(db, 'jarSizes'),
      (snap) => setJarSizes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error(err)
    )
    return () => {
      unsubRecipes()
      unsubIngredients()
      unsubJarSizes()
    }
  }, [])

  const runTraceability = (recipe, productionDate) => lookupMaterials(recipe, productionDate, ingredients)

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
      setHeader(initialHeader(recipe, productionDate, profile.prefill, jarSizes))
      setCopied(null)
      setPushedKey(null)
    } finally {
      setRunning(false)
    }
  }

  const displayBatchNumber = (batch) => batchNumberOn(batch, activeProductionDate)

  // The recipe as it is now, so sizes saved since the search show up.
  const liveRecipe = (activeRecipe && recipes.find((r) => r.id === activeRecipe.id)) || activeRecipe
  const sizeOptions = (liveRecipe?.packs || [])
    .filter((p) => String(p.size ?? '').trim())
    .map((p) => ({ value: p.size, hint: p.barcode || 'no barcode' }))

  const jarSizeOpts = jarSizeOptions(jarSizes)

  // Picking a saved size brings its barcode, jar size and jar/lid details with
  // it. A size with no jar size yet leaves a jar size already picked alone.
  function pickSize(option) {
    const pack = liveRecipe.packs.find((p) => p.size === option.value)
    setHeader((h) => {
      const next = { ...h, size: option.value, barcode: pack?.barcode || '' }
      if (!String(pack?.jarSize ?? '').trim() && h.jarSize.trim()) return next
      return { ...next, ...packagingForPack(pack, jarSizes) }
    })
  }

  // Picking a jar size brings the jar and lid details last used with it.
  function pickJarSize(option) {
    const jar = findJarSize(jarSizes, option.value)
    setHeader((h) => ({ ...h, jarSize: option.value, ...packagingFromPack(jar) }))
  }

  // Remember this size with its barcode, jar size and packaging for the
  // product (a known size takes the new values), and the jar and lid details
  // for the jar size. Failing to save never blocks the push or copy.
  async function rememberSize() {
    const packs = rememberPack(liveRecipe?.packs, header)
    const jar = jarSizeUpdate(jarSizes, header)
    try {
      if (packs) await updateDoc(doc(db, 'recipes', liveRecipe.id), { packs })
      if (jar) {
        const data = { ...jar.data, updatedAt: serverTimestamp(), updatedBy: user }
        if (jar.id) await updateDoc(doc(db, 'jarSizes', jar.id), data)
        else await addDoc(collection(db, 'jarSizes'), { ...data, createdAt: serverTimestamp() })
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Reload the raw materials after a new batch, keeping the edited grey row.
  async function refreshResults() {
    setResults(await runTraceability(activeRecipe, activeProductionDate))
  }

  function handleBatchSaved(receivedDate) {
    setNewBatchFor(null)
    if (receivedDate > activeProductionDate) {
      flash('That batch was received after the production date, so this lookup still shows the earlier one.', 'warning')
    }
    refreshResults()
  }

  const pushKey = activeRecipe && header ? `${activeRecipe.id}|${formatAuDate(activeProductionDate)}|${header.hoytsBn.trim()}` : ''

  // Push records the product to the Daily Log: date, product, batch number,
  // size, barcode, pH and document, who pushed it, and the raw materials as
  // shown now. Any
  // of batch number, size and barcode may be left empty and filled in later.
  async function push() {
    if (pushing || !activeRecipe) return
    const batchNumber = header.hoytsBn.trim()
    const productName = parseRecipeName(activeRecipe.name).productName
    const date = Timestamp.fromDate(activeProductionDate)
    setPushing(true)
    try {
      const sameDay = await getDocs(query(collection(db, 'dailyProduction'), where('date', '==', date)))
      const earlier = sameDay.docs.map((d) => d.data()).find((d) => d.recipeId === activeRecipe.id)
      if (
        earlier &&
        !confirm(
          `${productName} was already pushed for ${formatAuDate(activeProductionDate)} ` +
            `(batch ${earlier.batchNumber || 'not entered'}, by ${displayName(earlier.pushedBy)}). Push it again?`
        )
      ) {
        return
      }
      await addDoc(collection(db, 'dailyProduction'), {
        date,
        recipeId: activeRecipe.id,
        recipeName: activeRecipe.name,
        productName,
        batchNumber,
        size: header.size.trim(),
        barcode: normalizeBarcode(header.barcode),
        jarSize: header.jarSize.trim(),
        // Kept so the Daily Log can copy the same Excel rows later.
        phStart: header.phStart,
        phEnd: header.phEnd,
        document: header.document.trim(),
        materials: snapshot(),
        pushedBy: user,
        createdAt: serverTimestamp(),
      })
      setPushedKey(pushKey)
      flash(
        batchNumber
          ? `Pushed ${productName} (batch ${batchNumber}) to the Daily Log.`
          : `Pushed ${productName} to the Daily Log without a batch number.`,
        'success'
      )
      rememberSize()
    } catch (err) {
      console.error(err)
      flash('Could not push. Please try again.', 'danger')
    } finally {
      setPushing(false)
    }
  }

  // The raw materials followed by the jars and lids, as pushed and copied.
  const snapshot = () => [...materialsSnapshot(results, activeProductionDate), ...packagingSnapshot(header)]

  // Ingredient / Supplier / Country / Batch Number for each row, built the
  // same way as the Daily Log's copy so both paste identically.
  const materialRows = () => materialCopyRows(snapshot())

  function reportCopy(which, ok, message) {
    if (ok) {
      setCopied(which)
      flash(message, 'success')
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000)
    } else {
      flash('Copy failed. Your browser blocked clipboard access.', 'danger')
    }
  }

  // Copy the product row plus one row per raw material, spanning the sheet's
  // columns A-P, with jar and lid comments in column P. Paste into column A of
  // the next empty row.
  function copyAll() {
    if (!results) return
    const materials = snapshot()
    const rows = buildExcelRows({
      productionDate: activeProductionDate,
      recipeName: activeRecipe.name,
      header: { ...header, barcode: normalizeBarcode(header.barcode) },
      materials: materialCopyRows(materials),
      comments: materialComments(materials),
    })
    const ok = copyHtmlTable(rowsToHtml(rows), rowsToTsv(rows))
    reportCopy('all', ok, `Copied ${rows.length} rows. Paste into column A in Excel.`)
    if (ok) rememberSize()
  }

  // Copy only the raw material rows as tab-separated text, ready to paste
  // into column D (no header row, no date columns).
  async function copyMaterials() {
    if (!results) return
    const rows = materialRows()
    reportCopy(
      'materials',
      await copyText(materialsTsv(rows)),
      `Copied ${rows.length} row${rows.length !== 1 ? 's' : ''}. Paste into column D in Excel.`
    )
  }

  function exportCsv() {
    if (!results || !activeRecipe || !activeProductionDate) return
    const rows = [
      ['Recipe', activeRecipe.name],
      ['Production Date', formatAuDate(activeProductionDate)],
      [],
      ['Ingredient', 'Supplier Name', 'Country', 'Batch Number', 'Received Date', 'Record Created Date', 'Comments'],
    ]
    for (const r of results) {
      if (r.batch) {
        rows.push([
          r.ingredientName,
          r.batch.supplierName || '',
          r.batch.country || '',
          displayBatchNumber(r.batch),
          formatAuDate(r.batch.receivedDate),
          r.batch.createdAt ? formatAuDateTime(r.batch.createdAt) : '',
        ])
      } else {
        rows.push([r.ingredientName, '', '', 'NO BATCH FOUND', '', ''])
      }
    }
    for (const m of packagingSnapshot(header)) {
      rows.push([m.ingredientName, m.supplierName, '', m.batchNumber, '', '', m.comment])
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
      <div className="page-header">
        <div>
          <h1>Traceability Lookup</h1>
          <p className="page-sub">
            Select a recipe and production date to see exactly which ingredient batches were used.
          </p>
        </div>
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
          <div className="card-header d-flex flex-wrap gap-2 justify-content-between align-items-center py-3">
            <div>
              <div className="fw-semibold">{activeRecipe.name}</div>
              <div className="text-muted small">
                Production date {formatAuDate(activeProductionDate)}
              </div>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <button
                className="btn btn-sm btn-success"
                onClick={push}
                disabled={pushing}
                title="Save this product and batch number to the Daily Log"
              >
                <i className={`bi ${pushedKey === pushKey ? 'bi-check-lg' : 'bi-send'} me-1`}></i>
                {pushing ? 'Pushing…' : pushedKey === pushKey ? 'Pushed' : 'Push'}
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={copyAll}
                disabled={results.length === 0}
                title="Copy the product row and raw materials. Paste into column A in Excel."
              >
                <i className={`bi ${copied === 'all' ? 'bi-check-lg' : 'bi-clipboard'} me-1`}></i>
                {copied === 'all' ? 'Copied' : 'Copy All'}
              </button>
              <button
                className="btn btn-sm btn-outline-primary"
                onClick={copyMaterials}
                disabled={results.length === 0}
                title="Copy Ingredient, Supplier Name, Country and Batch Number. Paste into column D in Excel."
              >
                <i className={`bi ${copied === 'materials' ? 'bi-check-lg' : 'bi-clipboard'} me-1`}></i>
                {copied === 'materials' ? 'Copied' : 'Copy Materials'}
              </button>
              <button className="btn btn-sm btn-outline-success" onClick={exportCsv}>
                <i className="bi bi-download me-1"></i>Export CSV
              </button>
            </div>
          </div>

          {results.length > 0 ? (
            <>
              <div className="px-4 py-3 border-bottom bg-light">
                <div className="row g-2 align-items-end">
                  <div className="col-6 col-md-2">
                    <div className="form-label small fw-semibold mb-1">Date</div>
                    <div>{formatAuDate(activeProductionDate)}</div>
                  </div>
                  <div className="col-6 col-md-2">
                    <div className="form-label small fw-semibold mb-1">Product Name</div>
                    <div>{parseRecipeName(activeRecipe.name).productName}</div>
                  </div>
                  <div className="col-12 col-md-3 col-xl-2">
                    <div className="bn-warning">Please double check the batch number before saving</div>
                    <label className="form-label small fw-semibold mb-1" htmlFor="tr_hoytsBn">
                      Batch Number
                    </label>
                    <input
                      id="tr_hoytsBn"
                      className="form-control form-control-sm"
                      autoComplete="off"
                      value={header.hoytsBn}
                      onChange={(e) => setHeader((h) => ({ ...h, hoytsBn: e.target.value }))}
                    />
                  </div>
                  <div className="col-6 col-md-2 col-xl-1">
                    <label className="form-label small fw-semibold mb-1" htmlFor="tr_size">Size</label>
                    <ComboInput
                      id="tr_size"
                      small
                      value={header.size}
                      onChange={(v) => setHeader((h) => ({ ...h, size: v }))}
                      onPick={pickSize}
                      options={sizeOptions}
                      emptyText="No sizes saved for this product yet. Type one."
                    />
                  </div>
                  <div className="col-6 col-md-2">
                    <label className="form-label small fw-semibold mb-1 text-nowrap" htmlFor="tr_barcode">Label Barcode</label>
                    <input
                      id="tr_barcode"
                      className="form-control form-control-sm"
                      autoComplete="off"
                      value={header.barcode}
                      onChange={(e) => setHeader((h) => ({ ...h, barcode: e.target.value }))}
                    />
                  </div>
                  {[
                    ['phStart', 'pH Start'],
                    ['phEnd', 'pH End'],
                    ['document', 'Document'],
                  ].map(([key, label]) => (
                    <div className="col-4 col-md-1" key={key}>
                      <label className="form-label small fw-semibold mb-1 text-nowrap" htmlFor={`tr_${key}`}>{label}</label>
                      <input
                        id={`tr_${key}`}
                        className="form-control form-control-sm"
                        value={header[key]}
                        onChange={(e) => setHeader((h) => ({ ...h, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                {/* Jars and lids go after the raw materials when pushed or copied. */}
                <div className="form-label small fw-semibold mt-3 mb-1">Packaging</div>
                {/* Phones: Jars / Lids on their own line, then supplier and batch at half
                    width each, then comments across the full width. */}
                <div className="row g-2 align-items-center tr-packaging">
                  <div className="col-12 col-md-1 small fw-medium tr-packaging-label">
                    <label className="mb-0 text-nowrap" htmlFor="tr_jarSize">Jar size</label>
                  </div>
                  <div className="col-6 col-md-3 col-xl-2">
                    <ComboInput
                      id="tr_jarSize"
                      small
                      selectOnFocus
                      value={header.jarSize}
                      onChange={(v) => setHeader((h) => ({ ...h, jarSize: v }))}
                      onPick={pickJarSize}
                      options={jarSizeOpts}
                      placeholder="Pick a jar size"
                      emptyText="No jar sizes yet. Type one, e.g. 500ml."
                    />
                  </div>
                  <div className="w-100 mb-1"></div>
                  <div className="d-none d-md-block col-md-1"></div>
                  <div className="col-6 col-md-3 col-xl-2 form-label small fw-semibold mb-0">Supplier</div>
                  <div className="col-6 col-md-3 col-xl-2 form-label small fw-semibold mb-0">Batch</div>
                  <div className="d-none d-md-block col-md-5 col-xl-4 form-label small fw-semibold mb-0">Comments</div>
                  <div className="w-100 m-0"></div>
                  {PACKAGING.map(({ key, label }) => (
                    <Fragment key={key}>
                      <div className="col-12 col-md-1 small fw-medium tr-packaging-label">{label}</div>
                      <div className="col-6 col-md-3 col-xl-2">
                        <input
                          id={`tr_${key}Supplier`}
                          className="form-control form-control-sm"
                          autoComplete="off"
                          aria-label={`${label} supplier`}
                          value={header[`${key}Supplier`]}
                          onChange={(e) => setHeader((h) => ({ ...h, [`${key}Supplier`]: e.target.value }))}
                        />
                      </div>
                      <div className="col-6 col-md-3 col-xl-2">
                        <input
                          id={`tr_${key}Batch`}
                          className="form-control form-control-sm"
                          autoComplete="off"
                          aria-label={`${label} batch`}
                          value={header[`${key}Batch`]}
                          onChange={(e) => setHeader((h) => ({ ...h, [`${key}Batch`]: e.target.value }))}
                        />
                      </div>
                      <div className="col-12 col-md-5 col-xl-4">
                        <input
                          id={`tr_${key}Comment`}
                          className="form-control form-control-sm"
                          autoComplete="off"
                          placeholder="Comments"
                          aria-label={`${label} comments`}
                          value={header[`${key}Comment`]}
                          onChange={(e) => setHeader((h) => ({ ...h, [`${key}Comment`]: e.target.value }))}
                        />
                      </div>
                      <div className="w-100 m-0"></div>
                    </Fragment>
                  ))}
                </div>
                <div className="form-text mt-2">
                  Pick a jar size to fill in the jar and lid details last used with it, on any product. Push or Copy All
                  remembers them for the jar size, and the size, barcode and jar size for this product, so picking the
                  size fills everything in next time. Jars and lids are pushed and copied after the raw materials, and
                  Copy All puts their comments in column P.
                </div>
              </div>
              {missingCount > 0 && (
                <div className="alert alert-warning rounded-0 border-0 border-bottom border-warning mb-0 py-2 px-4">
                  <i className="bi bi-exclamation-triangle me-1"></i>
                  {missingCount} ingredient{missingCount !== 1 ? 's' : ''} had no batch recorded on or
                  before this date.
                </div>
              )}
              {/* Phones: one block per raw material so New batch is in reach. */}
              <ul className="material-list d-md-none">
                {results.map((r, idx) => (
                  <li key={`${r.ingredientId}-${idx}`} className={!r.batch ? 'missing' : ''}>
                    <div className="ml-info">
                      <div className="fw-semibold">{r.ingredientName}</div>
                      {r.batch ? (
                        <>
                          <div className="fw-medium">{displayBatchNumber(r.batch)}</div>
                          <div className="text-muted small">
                            {[r.batch.supplierName, r.batch.country].filter(Boolean).join(' · ') || '—'}
                            {' · received '}
                            {formatAuDate(r.batch.receivedDate)}
                          </div>
                        </>
                      ) : (
                        <div className="text-warning fw-semibold small">
                          <i className="bi bi-exclamation-triangle me-1"></i>No batch found
                        </div>
                      )}
                    </div>
                    <button
                      className="btn btn-sm btn-outline-primary text-nowrap"
                      title={`Record a new batch of ${r.ingredientName}`}
                      onClick={() => setNewBatchFor(r)}
                    >
                      <i className="bi bi-plus-lg me-1"></i>New batch
                    </button>
                  </li>
                ))}
              </ul>
              <div className="table-responsive d-none d-md-block">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-4">Ingredient</th>
                      <th>Supplier Name</th>
                      <th>Country</th>
                      <th>Batch Number</th>
                      <th>Received Date</th>
                      <th>Record Created Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, idx) => (
                      <tr key={`${r.ingredientId}-${idx}`} className={!r.batch ? 'table-warning' : ''}>
                        <td className="ps-4">{r.ingredientName}</td>
                        <td>{r.batch?.supplierName || <span className="text-muted">—</span>}</td>
                        <td>{r.batch?.country || <span className="text-muted">—</span>}</td>
                        <td className="fw-medium">
                          {r.batch ? (
                            displayBatchNumber(r.batch)
                          ) : (
                            <span className="text-warning fw-semibold">
                              <i className="bi bi-exclamation-triangle me-1"></i>No batch found
                            </span>
                          )}
                        </td>
                        <td>{r.batch ? formatAuDate(r.batch.receivedDate) : <span className="text-muted">—</span>}</td>
                        <td className="text-muted small">
                          {r.batch?.createdAt ? formatAuDateTime(r.batch.createdAt) : <span className="text-muted">—</span>}
                        </td>
                        <td className="text-end pe-3">
                          <button
                            className="btn btn-sm btn-outline-primary text-nowrap"
                            title={`Record a new batch of ${r.ingredientName}`}
                            onClick={() => setNewBatchFor(r)}
                          >
                            <i className="bi bi-plus-lg me-1"></i>New batch
                          </button>
                        </td>
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
            <div className="empty-state">
              <span className="es-icon">
                <i className="bi bi-inbox"></i>
              </span>
              <div className="es-title">No ingredients assigned</div>
              <p>This recipe has no ingredients yet. Edit it on the Recipes page.</p>
            </div>
          )}
        </div>
      )}

      {newBatchFor && (
        <NewBatchModal
          ingredient={{ id: newBatchFor.ingredientId, name: newBatchFor.ingredientName }}
          last={newBatchFor.batch}
          defaultDate={activeProductionDate}
          user={user}
          flash={flash}
          onClose={() => setNewBatchFor(null)}
          onSaved={handleBatchSaved}
        />
      )}

      {results === null && recipes.length === 0 && (
        <div className="alert alert-info">
          <i className="bi bi-info-circle me-1"></i>
          No recipes found.
          {/* Users without the Recipes page (kitchen) can't follow the link. */}
          {canOpen(profile, '/recipes') && (
            <>
              {' '}
              <a href="/recipes" className="alert-link">
                Create a recipe
              </a>{' '}
              to get started.
            </>
          )}
        </div>
      )}
    </>
  )
}

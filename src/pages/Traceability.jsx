import { useEffect, useState } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  addDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import { useAuth } from '../AuthContext'
import { displayName } from '../permissions'
import DatePickInput from '../components/DatePickInput'
import NewBatchModal from '../components/NewBatchModal'
import { parseAuDate, formatAuDate, formatAuDateTime, formatDdmmyy } from '../utils/date'
import { downloadCsv } from '../utils/csv'
import { withTextPrefix } from '../utils/batch'
import { copyHtmlTable, copyText } from '../utils/clipboard'
import {
  PH_NOT_TESTED,
  buildExcelRows,
  hoytsBatchNumber,
  normalizeBarcode,
  parseRecipeName,
  rowsToHtml,
  rowsToTsv,
} from '../utils/excelRow'

const ms = (t) => t?.toMillis?.() ?? 0

function initialHeader(recipe, productionDate) {
  const pack = recipe.packs?.[0]
  return {
    // Batch number defaults to the production date's Julian code (DDDYY).
    hoytsBn: hoytsBatchNumber(productionDate),
    packIndex: 0,
    size: pack?.size || '',
    barcode: pack?.barcode || '',
    phStart: recipe.phStart ?? PH_NOT_TESTED,
    phEnd: recipe.phEnd ?? PH_NOT_TESTED,
    document: parseRecipeName(recipe.name).document,
  }
}

export default function Traceability() {
  const { flash } = useFlash()
  const { user } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [ingredients, setIngredients] = useState([])

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
    return () => {
      unsubRecipes()
      unsubIngredients()
    }
  }, [])

  async function runTraceability(recipe, productionDate) {
    const ingredientIds = recipe.ingredientIds || []
    // Resolve each name from its ingredient id rather than the recipe's
    // parallel ingredientNames array, which can be stored out of order and
    // would otherwise mismatch the supplier/country/batch columns.
    const nameById = new Map(ingredients.map((i) => [i.id, i.name]))
    const ingredientNames = recipe.ingredientNames || []
    const cutoff = Timestamp.fromDate(productionDate)

    // Query each distinct ingredient only once, even if it appears more than
    // once in the recipe, to avoid duplicate Firestore reads. A few recent
    // batches are read so that, when two share a received date, the one
    // entered last wins (e.g. a new bag recorded the same day).
    const uniqueIds = [...new Set(ingredientIds)]
    const batchByIngredient = new Map()
    await Promise.all(
      uniqueIds.map(async (ingredientId) => {
        const snap = await getDocs(
          query(
            collection(db, 'batches'),
            where('ingredientId', '==', ingredientId),
            where('receivedDate', '<=', cutoff),
            orderBy('receivedDate', 'desc'),
            limit(10)
          )
        )
        const latest = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort(
            (a, b) =>
              ms(b.receivedDate) - ms(a.receivedDate) ||
              (b.createdAt ? ms(b.createdAt) : Infinity) - (a.createdAt ? ms(a.createdAt) : Infinity)
          )[0]
        batchByIngredient.set(ingredientId, latest || null)
      })
    )

    const items = ingredientIds.map((ingredientId, idx) => ({
      ingredientId,
      ingredientName:
        nameById.get(ingredientId) ||
        batchByIngredient.get(ingredientId)?.ingredientName ||
        ingredientNames[idx] ||
        '',
      batch: batchByIngredient.get(ingredientId) || null,
    }))
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
      setHeader(initialHeader(recipe, productionDate))
      setCopied(null)
      setPushedKey(null)
    } finally {
      setRunning(false)
    }
  }

  // "Current Date" batches have no fixed batch number — they resolve to the
  // searched production date formatted as DDMMYY. All batch numbers carry a
  // leading apostrophe so Excel keeps them as text.
  function displayBatchNumber(batch) {
    return withTextPrefix(
      batch.useCurrentDate ? formatDdmmyy(activeProductionDate) : batch.batchNumber
    )
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

  // Push records today's product to the Daily Log: date, product and batch
  // number, plus who pushed it.
  async function push() {
    if (pushing || !activeRecipe) return
    const batchNumber = header.hoytsBn.trim()
    if (!batchNumber) {
      flash('Enter the batch number before pushing.', 'danger')
      return
    }
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
            `(batch ${earlier.batchNumber}, by ${displayName(earlier.pushedBy)}). Push it again?`
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
        pushedBy: user,
        createdAt: serverTimestamp(),
      })
      setPushedKey(pushKey)
      flash(`Pushed ${productName} (batch ${batchNumber}) to the Daily Log.`, 'success')
    } catch (err) {
      console.error(err)
      flash('Could not push. Please try again.', 'danger')
    } finally {
      setPushing(false)
    }
  }

  function selectPack(index) {
    const pack = activeRecipe.packs[index]
    setHeader((h) => ({ ...h, packIndex: index, size: pack.size || '', barcode: pack.barcode || '' }))
  }

  // Ingredient / Supplier / Country / Batch Number for each raw material.
  function materialRows() {
    return results.map((r) => [
      r.ingredientName,
      r.batch?.supplierName || '',
      r.batch?.country || '',
      r.batch ? displayBatchNumber(r.batch) : 'NO BATCH FOUND',
    ])
  }

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
  // columns A-P. Paste into column A of the next empty row.
  function copyAll() {
    if (!results) return
    const rows = buildExcelRows({
      productionDate: activeProductionDate,
      recipeName: activeRecipe.name,
      header: { ...header, barcode: normalizeBarcode(header.barcode) },
      materials: materialRows(),
    })
    reportCopy(
      'all',
      copyHtmlTable(rowsToHtml(rows), rowsToTsv(rows)),
      `Copied ${rows.length} rows. Paste into column A in Excel.`
    )
  }

  // Copy only the raw material rows as tab-separated text, ready to paste
  // into column D (no header row, no date columns).
  async function copyMaterials() {
    if (!results) return
    const lines = materialRows().map((row) =>
      row.map((v) => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t')
    )
    reportCopy(
      'materials',
      await copyText(lines.join('\r\n')),
      `Copied ${lines.length} row${lines.length !== 1 ? 's' : ''}. Paste into column D in Excel.`
    )
  }

  function exportCsv() {
    if (!results || !activeRecipe || !activeProductionDate) return
    const rows = [
      ['Recipe', activeRecipe.name],
      ['Production Date', formatAuDate(activeProductionDate)],
      [],
      ['Ingredient', 'Supplier Name', 'Country', 'Batch Number', 'Received Date', 'Record Created Date'],
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
                      inputMode="numeric"
                      value={header.hoytsBn}
                      onChange={(e) => setHeader((h) => ({ ...h, hoytsBn: e.target.value }))}
                    />
                  </div>
                  {activeRecipe.packs?.length > 1 && (
                    <div className="col-6 col-md-2">
                      <label className="form-label small fw-semibold mb-1" htmlFor="tr_pack">Pack</label>
                      <select
                        id="tr_pack"
                        className="form-select form-select-sm"
                        value={header.packIndex}
                        onChange={(e) => selectPack(Number(e.target.value))}
                      >
                        {activeRecipe.packs.map((p, i) => (
                          <option key={i} value={i}>{p.size || `Pack ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {[
                    ['size', 'Size'],
                    ['barcode', 'Label Barcode'],
                    ['phStart', 'pH Start'],
                    ['phEnd', 'pH End'],
                    ['document', 'Document'],
                  ].map(([key, label]) => (
                    <div className="col-6 col-md-1" key={key}>
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
                {(!header.size || !header.barcode) && (
                  <div className="text-warning small mt-2">
                    <i className="bi bi-exclamation-triangle me-1"></i>
                    Size or barcode is empty. Save them on the Recipes page to fill them in next time.
                  </div>
                )}
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

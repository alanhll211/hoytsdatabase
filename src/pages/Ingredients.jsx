import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import { formatAuDate } from '../utils/date'

export default function Ingredients() {
  const { flash } = useFlash()
  const [ingredients, setIngredients] = useState([])
  const [batches, setBatches] = useState([])
  const [recipes, setRecipes] = useState([])
  const [q, setQ] = useState('')

  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsubIngredients = onSnapshot(
      query(collection(db, 'ingredients'), orderBy('name')),
      (snap) => setIngredients(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubBatches = onSnapshot(collection(db, 'batches'), (snap) =>
      setBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubRecipes = onSnapshot(collection(db, 'recipes'), (snap) =>
      setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    return () => {
      unsubIngredients()
      unsubBatches()
      unsubRecipes()
    }
  }, [])

  const usage = useMemo(() => {
    const map = new Map()
    for (const ing of ingredients) {
      map.set(ing.id, { batchCount: 0, recipeCount: 0, recipeNames: [] })
    }
    for (const b of batches) {
      const u = map.get(b.ingredientId)
      if (u) u.batchCount++
    }
    for (const r of recipes) {
      for (const id of r.ingredientIds || []) {
        const u = map.get(id)
        if (u) {
          u.recipeCount++
          u.recipeNames.push(r.name)
        }
      }
    }
    return map
  }, [ingredients, batches, recipes])

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase()
    if (!qLower) return ingredients
    return ingredients.filter((i) => (i.name || '').toLowerCase().includes(qLower))
  }, [ingredients, q])

  function openRename(ing) {
    setRenaming(ing)
    setRenameValue(ing.name)
  }

  async function handleRenameSubmit(e) {
    e.preventDefault()
    const newName = renameValue.trim()
    if (!newName) {
      flash('Ingredient name is required.', 'danger')
      return
    }
    if (newName === renaming.name) {
      setRenaming(null)
      return
    }
    const duplicate = ingredients.some(
      (i) => i.id !== renaming.id && i.name.toLowerCase() === newName.toLowerCase()
    )
    if (duplicate) {
      flash(`An ingredient named "${newName}" already exists.`, 'warning')
      return
    }

    setBusy(true)
    try {
      const wb = writeBatch(db)
      wb.update(doc(db, 'ingredients', renaming.id), { name: newName })
      // Keep denormalised names in sync
      for (const b of batches) {
        if (b.ingredientId === renaming.id) {
          wb.update(doc(db, 'batches', b.id), { ingredientName: newName })
        }
      }
      for (const r of recipes) {
        if ((r.ingredientIds || []).includes(renaming.id)) {
          // Map in place to stay parallel with ingredientIds (don't re-sort).
          const names = (r.ingredientNames || []).map((n) =>
            n === renaming.name ? newName : n
          )
          wb.update(doc(db, 'recipes', r.id), { ingredientNames: names })
        }
      }
      await wb.commit()
      flash(`Ingredient renamed to "${newName}".`, 'success')
      setRenaming(null)
    } catch (err) {
      console.error(err)
      flash('Rename failed. Please try again.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteConfirm() {
    const ing = deleting
    if (!ing) return
    setBusy(true)
    try {
      const wb = writeBatch(db)
      // Remove all batch records for this ingredient
      for (const b of batches) {
        if (b.ingredientId === ing.id) {
          wb.delete(doc(db, 'batches', b.id))
        }
      }
      // Remove from any recipes that reference it
      for (const r of recipes) {
        const ids = r.ingredientIds || []
        if (ids.includes(ing.id)) {
          wb.update(doc(db, 'recipes', r.id), {
            ingredientIds: ids.filter((id) => id !== ing.id),
            ingredientNames: (r.ingredientNames || []).filter((n) => n !== ing.name),
          })
        }
      }
      // Finally remove the ingredient itself
      wb.delete(doc(db, 'ingredients', ing.id))
      await wb.commit()
      flash(`Ingredient "${ing.name}" and its related records were deleted.`, 'success')
      setDeleting(null)
    } catch (err) {
      console.error(err)
      flash('Delete failed. Please try again.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const deletingUsage = deleting ? usage.get(deleting.id) : null

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ingredients</h1>
          <p className="page-sub">
            Master list of all ingredients. Deleting an ingredient also removes its batch records
            and takes it out of any recipes.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header py-3">
          <div className="d-flex gap-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="form-control"
              placeholder="Search ingredients…"
              style={{ maxWidth: 320 }}
            />
            {q && (
              <button className="btn btn-outline-secondary" onClick={() => setQ('')}>
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="card-body p-0">
          {filtered.length > 0 ? (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th className="ps-4">Ingredient</th>
                    <th>Batch Records</th>
                    <th>Used in Recipes</th>
                    <th>Created</th>
                    <th style={{ width: 110 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ing) => {
                    const u = usage.get(ing.id) || { batchCount: 0, recipeCount: 0, recipeNames: [] }
                    return (
                      <tr key={ing.id}>
                        <td className="ps-4 fw-medium">{ing.name}</td>
                        <td>
                          {u.batchCount > 0 ? (
                            <span className="badge-teal">{u.batchCount}</span>
                          ) : (
                            <span className="text-muted small">None</span>
                          )}
                        </td>
                        <td>
                          {u.recipeNames.length > 0 ? (
                            <>
                              {u.recipeNames.slice(0, 3).map((name) => (
                                <span key={name} className="badge-soft me-1">
                                  {name}
                                </span>
                              ))}
                              {u.recipeNames.length > 3 && (
                                <span className="text-muted small">
                                  +{u.recipeNames.length - 3} more
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted small">Not used</span>
                          )}
                        </td>
                        <td className="text-muted">{formatAuDate(ing.createdAt)}</td>
                        <td>
                          <div className="d-flex gap-1">
                            <button
                              className="btn btn-sm btn-outline-secondary btn-icon"
                              title="Rename"
                              onClick={() => openRename(ing)}
                            >
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger btn-icon"
                              title="Delete"
                              onClick={() => setDeleting(ing)}
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <span className="es-icon">
                <i className="bi bi-basket2"></i>
              </span>
              <div className="es-title">{q ? `No ingredients match "${q}"` : 'No ingredients yet'}</div>
              <p>Ingredients are created when you add batch records.</p>
            </div>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="card-footer text-muted small">
            {filtered.length} ingredient{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Rename Modal */}
      {renaming && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleRenameSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">Rename Ingredient</h5>
                  <button type="button" className="btn-close" onClick={() => setRenaming(null)}></button>
                </div>
                <div className="modal-body">
                  <label className="form-label">Ingredient Name</label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    autoFocus
                    autoComplete="off"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                  />
                  <div className="form-text">
                    The new name will also be applied to all existing batch records and recipes.
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {renaming && <div className="modal-backdrop fade show"></div>}

      {/* Delete Confirmation Modal */}
      {deleting && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title text-danger">
                  <i className="bi bi-exclamation-triangle me-2"></i>Delete Ingredient
                </h5>
                <button type="button" className="btn-close" onClick={() => setDeleting(null)}></button>
              </div>
              <div className="modal-body">
                <p className="mb-2">
                  You are about to permanently delete <strong>{deleting.name}</strong>.
                </p>
                {deletingUsage && (deletingUsage.batchCount > 0 || deletingUsage.recipeCount > 0) ? (
                  <div className="alert alert-warning mb-0">
                    <div className="fw-semibold mb-1">This will also:</div>
                    <ul className="mb-0 ps-3">
                      {deletingUsage.batchCount > 0 && (
                        <li>
                          Delete <strong>{deletingUsage.batchCount}</strong> batch record
                          {deletingUsage.batchCount !== 1 ? 's' : ''}
                        </li>
                      )}
                      {deletingUsage.recipeCount > 0 && (
                        <li>
                          Remove it from <strong>{deletingUsage.recipeCount}</strong> recipe
                          {deletingUsage.recipeCount !== 1 ? 's' : ''} (
                          {deletingUsage.recipeNames.join(', ')})
                        </li>
                      )}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted mb-0">
                    This ingredient has no batch records and is not used in any recipes.
                  </p>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleting(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={handleDeleteConfirm}>
                  {busy ? 'Deleting…' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleting && <div className="modal-backdrop fade show"></div>}
    </>
  )
}

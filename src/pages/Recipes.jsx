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
} from 'firebase/firestore'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import { formatAuDate } from '../utils/date'

export default function Recipes() {
  const { flash } = useFlash()
  const [recipes, setRecipes] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [q, setQ] = useState('')

  const [showAddModal, setShowAddModal] = useState(false)
  const [addName, setAddName] = useState('')
  const [addIngredientIds, setAddIngredientIds] = useState([])

  const [editingRecipe, setEditingRecipe] = useState(null)
  const [editName, setEditName] = useState('')
  const [editIngredientIds, setEditIngredientIds] = useState([])

  useEffect(() => {
    const unsubRecipes = onSnapshot(
      query(collection(db, 'recipes'), orderBy('name')),
      (snap) => setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubIngredients = onSnapshot(
      query(collection(db, 'ingredients'), orderBy('name')),
      (snap) => setIngredients(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    return () => {
      unsubRecipes()
      unsubIngredients()
    }
  }, [])

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase()
    if (!qLower) return recipes
    return recipes.filter((r) => (r.name || '').toLowerCase().includes(qLower))
  }, [recipes, q])

  function nameExists(name, excludeId) {
    return recipes.some(
      (r) => r.id !== excludeId && r.name.toLowerCase() === name.toLowerCase()
    )
  }

  function resolveIngredientNames(ids) {
    return ids
      .map((id) => ingredients.find((i) => i.id === id)?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  }

  function resetAddForm() {
    setAddName('')
    setAddIngredientIds([])
  }

  function toggleAddIngredient(id) {
    setAddIngredientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleEditIngredient(id) {
    setEditIngredientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleAddSubmit(e) {
    e.preventDefault()
    const name = addName.trim()
    if (!name) {
      flash('Recipe name is required.', 'danger')
      return
    }
    if (nameExists(name)) {
      flash(`Recipe "${name}" already exists.`, 'warning')
      return
    }
    await addDoc(collection(db, 'recipes'), {
      name,
      ingredientIds: addIngredientIds,
      ingredientNames: resolveIngredientNames(addIngredientIds),
      createdAt: serverTimestamp(),
    })
    flash(`Recipe "${name}" created.`, 'success')
    setShowAddModal(false)
    resetAddForm()
  }

  function openEdit(recipe) {
    setEditingRecipe(recipe)
    setEditName(recipe.name)
    setEditIngredientIds(recipe.ingredientIds || [])
  }

  async function handleEditSubmit(e) {
    e.preventDefault()
    const name = editName.trim()
    if (!name) {
      flash('Recipe name is required.', 'danger')
      return
    }
    if (nameExists(name, editingRecipe.id)) {
      flash(`A recipe named "${name}" already exists.`, 'warning')
      return
    }
    await updateDoc(doc(db, 'recipes', editingRecipe.id), {
      name,
      ingredientIds: editIngredientIds,
      ingredientNames: resolveIngredientNames(editIngredientIds),
    })
    flash(`Recipe "${name}" updated.`, 'success')
    setEditingRecipe(null)
  }

  async function handleDelete(recipe) {
    if (!confirm(`Delete recipe '${recipe.name}'?`)) return
    await deleteDoc(doc(db, 'recipes', recipe.id))
    flash(`Recipe "${recipe.name}" deleted.`, 'success')
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="page-heading mb-0">
          <i className="bi bi-book me-2 text-primary"></i>Recipes
        </h1>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <i className="bi bi-plus-lg me-1"></i>Add Recipe
        </button>
      </div>

      <div className="card">
        <div className="card-header bg-white py-3">
          <div className="d-flex gap-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="form-control"
              placeholder="Search recipes…"
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
                <thead className="table-light">
                  <tr>
                    <th className="ps-4">Recipe Name</th>
                    <th>Ingredients</th>
                    <th>Created</th>
                    <th style={{ width: 110 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((recipe) => {
                    const ings = recipe.ingredientNames || []
                    return (
                      <tr key={recipe.id}>
                        <td className="ps-4 fw-medium">{recipe.name}</td>
                        <td>
                          {ings.length > 0 ? (
                            <>
                              {ings.slice(0, 4).map((name) => (
                                <span key={name} className="badge bg-light text-dark border me-1">
                                  {name}
                                </span>
                              ))}
                              {ings.length > 4 && (
                                <span className="text-muted small">+{ings.length - 4} more</span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted small">No ingredients</span>
                          )}
                        </td>
                        <td className="text-muted">{formatAuDate(recipe.createdAt)}</td>
                        <td>
                          <div className="d-flex gap-1">
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              title="Edit"
                              onClick={() => openEdit(recipe)}
                            >
                              <i className="bi bi-pencil"></i>
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger"
                              title="Delete"
                              onClick={() => handleDelete(recipe)}
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
            <div className="text-center py-5 text-muted">
              <i className="bi bi-inbox display-4 d-block mb-2"></i>
              {q ? `No recipes match "${q}".` : 'No recipes yet.'}
            </div>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="card-footer text-muted small">
            {filtered.length} recipe{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Add Recipe Modal */}
      {showAddModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleAddSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">Add Recipe</h5>
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
                    <label className="form-label fw-semibold">Recipe Name</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. Chocolate Cake"
                      required
                      autoComplete="off"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label fw-semibold">Ingredients</label>
                    {ingredients.length > 0 ? (
                      <div className="border rounded p-2" style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {ingredients.map((ing) => (
                          <div className="form-check" key={ing.id}>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id={`new_ing_${ing.id}`}
                              checked={addIngredientIds.includes(ing.id)}
                              onChange={() => toggleAddIngredient(ing.id)}
                            />
                            <label className="form-check-label" htmlFor={`new_ing_${ing.id}`}>
                              {ing.name}
                            </label>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted small mb-0">
                        No ingredients yet. Add batch records first to create ingredients.
                      </p>
                    )}
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
                    Create Recipe
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {showAddModal && <div className="modal-backdrop fade show"></div>}

      {/* Edit Recipe Modal */}
      {editingRecipe && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleEditSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">Edit Recipe</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setEditingRecipe(null)}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Recipe Name</label>
                    <input
                      type="text"
                      className="form-control"
                      required
                      autoComplete="off"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label fw-semibold">Ingredients</label>
                    {ingredients.length > 0 ? (
                      <div className="border rounded p-2" style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {ingredients.map((ing) => (
                          <div className="form-check" key={ing.id}>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id={`edit_ing_${ing.id}`}
                              checked={editIngredientIds.includes(ing.id)}
                              onChange={() => toggleEditIngredient(ing.id)}
                            />
                            <label className="form-check-label" htmlFor={`edit_ing_${ing.id}`}>
                              {ing.name}
                            </label>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted small mb-0">No ingredients yet.</p>
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingRecipe(null)}>
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
      {editingRecipe && <div className="modal-backdrop fade show"></div>}
    </>
  )
}

const TEXT_TYPES = new Set(['text', 'search', 'tel', 'url', 'email', 'password', ''])

// Focus handler that selects a text field's whole value, so typing replaces
// it. Works as a form's onFocus too (React focus events bubble), where it
// covers every text field inside. Fields that aren't text are left alone.
export function selectAllOnFocus(e) {
  const el = e.target
  if (!(el instanceof HTMLInputElement) || el.readOnly || !TEXT_TYPES.has(el.type)) return
  const text = el.value
  if (!text) return
  const selectAll = () => {
    // Not once typing has started or the field has been left.
    if (document.activeElement !== el || el.value !== text) return
    try {
      el.setSelectionRange(0, text.length)
    } catch {
      el.select()
    }
  }
  selectAll()
  // On phones the tap that focused the field drops the caret a moment later,
  // and Safari clears the selection on mouseup; select again after both.
  setTimeout(selectAll, 0)
  setTimeout(selectAll, 150)
  const onUp = (ev) => {
    ev.preventDefault()
    selectAll()
  }
  el.addEventListener('mouseup', onUp, { once: true })
  setTimeout(() => el.removeEventListener('mouseup', onUp), 600)
}

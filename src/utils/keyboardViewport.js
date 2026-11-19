// Phones: keeps an open dialog (.modal) within the part of the screen above
// the on-screen keyboard, and scrolls the field being typed in into view.
//
// iOS doesn't shrink the page when the keyboard opens, so a full-height
// dialog keeps its lower part behind the keyboard: the last fields can't be
// scrolled up above it and the dialog seems stuck. visualViewport reports the
// area that is actually visible; while the keyboard is up the dialog is sized
// to it (html.kb-open with --vv-top and --vv-height, see appCustom.css).

const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select'

export function installKeyboardViewport() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const touch = window.matchMedia('(pointer: coarse)')
  let frame = 0
  let revealAfterUpdate = false

  const focusedField = () => {
    const el = document.activeElement
    return el?.matches?.(FIELD) && el.closest('.modal') ? el : null
  }

  // Scrolls the dialog so the field sits in the upper part of what's visible,
  // leaving room below it for a dropdown list. Leaves it alone when it's
  // already there.
  function reveal() {
    const el = focusedField()
    if (!el) return
    const box = el.closest('.modal')
    const area = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.top >= area.top + 12 && r.bottom <= area.top + area.height * 0.6) return
    box.scrollTo({ top: box.scrollTop + r.top - (area.top + area.height * 0.2), behavior: 'smooth' })
  }

  function update() {
    frame = 0
    // A shrunken visible area at normal zoom means the keyboard is up.
    const open = vv.scale < 1.05 && vv.height < root.clientHeight - 120
    root.classList.toggle('kb-open', open)
    if (open) {
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`)
      root.style.setProperty('--vv-height', `${vv.height}px`)
    }
    if (open && revealAfterUpdate) reveal()
    revealAfterUpdate = false
  }
  const schedule = (andReveal) => {
    if (andReveal) revealAfterUpdate = true
    if (!frame) frame = requestAnimationFrame(update)
  }
  // The keyboard opening or changing height: refit and show the field. The
  // visible area merely moving only refits, so the user can scroll freely.
  vv.addEventListener('resize', () => schedule(true))
  vv.addEventListener('scroll', () => schedule(false))

  // A tap on a field: bring it into view once the keyboard has settled
  // (iOS slides it in for about 300 ms), or right away if it's already up.
  document.addEventListener('focusin', () => {
    if (!touch.matches || !focusedField()) return
    setTimeout(reveal, root.classList.contains('kb-open') ? 60 : 350)
  })
  update()
}

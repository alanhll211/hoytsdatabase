// Copy a table as both HTML and plain text. Must run synchronously inside the
// click handler. Goes through a copy event because navigator.clipboard.write
// sanitizes HTML, which can strip the mso-number-format styles Excel needs.
// Returns true on success.
export function copyHtmlTable(html, text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const onCopy = (e) => {
    e.clipboardData.setData('text/html', html)
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  }
  document.addEventListener('copy', onCopy)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.removeEventListener('copy', onCopy)
    document.body.removeChild(ta)
  }
}

// Copy plain text to the clipboard. Uses the async Clipboard API where
// available (HTTPS / localhost) and falls back to execCommand otherwise.
// Resolves to true on success.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// Batch numbers are stored with a leading apostrophe so that pasting into
// Excel keeps them as text (otherwise "012345" loses its leading zero and
// "22.1540" becomes 22.154). Idempotent: an existing apostrophe is kept as-is.
export function withTextPrefix(value) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  return s.startsWith("'") ? s : `'${s}`
}

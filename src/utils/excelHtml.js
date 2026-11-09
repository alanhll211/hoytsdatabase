// Shared pieces for copying rows to Excel as an HTML table. Excel reads the
// HTML flavour of the clipboard first and honours mso-number-format, so codes
// can stay text (keeping leading zeros) without a visible apostrophe, and
// dates stay real dates the sheet can sort and filter.

export const TEXT_FORMAT = "mso-number-format:'\\@'"
export const DATE_FORMAT = "mso-number-format:'dd\\/mm\\/yyyy'"

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// styleFor(value, rowIndex, colIndex) returns the CSS declarations for a cell.
export function htmlTable(rows, styleFor) {
  const body = rows
    .map((row, r) => {
      const cells = row.map((v, c) => {
        const styles = styleFor(v, r, c)
        const attr = styles.length ? ` style="${styles.join(';')}"` : ''
        return `<td${attr}>${escapeHtml(v)}</td>`
      })
      return `<tr>${cells.join('')}</tr>`
    })
    .join('')
  return `<table>${body}</table>`
}

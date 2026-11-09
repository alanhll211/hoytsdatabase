import { Fragment, useId, useRef, useState } from 'react'

// Free-text input with a dropdown of previous values. Picking an option (by
// click, Enter, or typing it exactly) calls onPick so the caller can fill in
// related fields. Anything can still be typed, and every field stays editable.
//
// options: [{ value, hint?, group? }]
export default function ComboInput({
  id,
  value,
  onChange,
  onPick,
  options,
  placeholder,
  ariaLabel,
  required,
  emptyText = 'No previous entries',
}) {
  const autoId = useId()
  const inputId = id || autoId
  const listId = `${inputId}-list`
  const inputRef = useRef(null)
  const lastPicked = useRef(null)
  const [open, setOpen] = useState(false)
  // Text the list is narrowed by; empty shows every option.
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(-1)

  const f = filter.trim().toLowerCase()
  const shown = f ? options.filter((o) => o.value.toLowerCase().includes(f)) : options
  // While typing, hide the menu once nothing matches; the button still opens
  // it to show the empty message.
  const showMenu = open && (shown.length > 0 || !f)

  function pick(option) {
    lastPicked.current = option.value
    onChange(option.value)
    onPick?.(option)
    setOpen(false)
    setActive(-1)
  }

  function handleChange(e) {
    const text = e.target.value
    onChange(text)
    setFilter(text)
    setOpen(true)
    setActive(-1)
    const exact = options.find((o) => o.value.toLowerCase() === text.trim().toLowerCase())
    if (exact && exact.value !== lastPicked.current) {
      lastPicked.current = exact.value
      onPick?.(exact)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setFilter('')
        setOpen(true)
        setActive(0)
      } else {
        setActive((a) => Math.min(a + 1, shown.length - 1))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && showMenu && shown[active]) {
      e.preventDefault()
      pick(shown[active])
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="combo">
      <div className="input-group">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className="form-control"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={showMenu}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          required={required}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
        />
        <button
          type="button"
          className="btn btn-outline-secondary"
          tabIndex={-1}
          aria-label="Show previous values"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setFilter('')
            setActive(-1)
            setOpen((o) => !o)
            inputRef.current?.focus()
          }}
        >
          <i className="bi bi-chevron-down"></i>
        </button>
      </div>
      {showMenu && (
        <ul className="combo-menu" id={listId} role="listbox">
          {shown.length === 0 ? (
            <li className="combo-empty">{emptyText}</li>
          ) : (
            shown.map((o, i) => (
              <Fragment key={`${o.group || ''}|${o.value}`}>
                {o.group && (i === 0 || shown[i - 1].group !== o.group) && (
                  <li className="combo-group" role="presentation">
                    {o.group}
                  </li>
                )}
                <li
                  role="option"
                  aria-selected={i === active}
                  className={`combo-option${i === active ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(o)
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="combo-value">{o.value}</span>
                  {o.hint && <span className="combo-hint">{o.hint}</span>}
                </li>
              </Fragment>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import flatpickr from 'flatpickr'

export default function DatePickInput({ value, onChange, placeholder, required, name }) {
  const inputRef = useRef(null)
  const fpRef = useRef(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    fpRef.current = flatpickr(inputRef.current, {
      dateFormat: 'd/m/Y',
      allowInput: true,
      appendTo: document.body,
      onChange: (_dates, dateStr) => onChangeRef.current(dateStr),
    })
    return () => fpRef.current?.destroy()
  }, [])

  useEffect(() => {
    if (fpRef.current && fpRef.current.input.value !== (value || '')) {
      fpRef.current.setDate(value || '', false)
    }
  }, [value])

  return (
    <div className="input-group">
      <input
        ref={inputRef}
        type="text"
        name={name}
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        className="form-control"
        placeholder={placeholder || 'DD/MM/YYYY'}
        required={required}
        autoComplete="off"
      />
      <button
        type="button"
        className="btn btn-outline-secondary"
        onClick={() => fpRef.current?.open()}
      >
        <i className="bi bi-calendar3"></i>
      </button>
    </div>
  )
}

import { createContext, useCallback, useContext, useState } from 'react'

const FlashContext = createContext(null)

let nextId = 1

export function FlashProvider({ children }) {
  const [messages, setMessages] = useState([])

  const flash = useCallback((text, category = 'success') => {
    const id = nextId++
    setMessages((prev) => [...prev, { id, text, category }])
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id))
    }, 6000)
  }, [])

  const dismiss = useCallback((id) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return (
    <FlashContext.Provider value={{ messages, flash, dismiss }}>
      {children}
    </FlashContext.Provider>
  )
}

export function useFlash() {
  return useContext(FlashContext)
}

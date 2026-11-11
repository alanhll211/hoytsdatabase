import { createContext, useCallback, useContext, useState } from 'react'
import { profileFor } from './permissions'

const AuthContext = createContext(null)

const STORAGE_KEY = 'hoyts-user'

function storedUser() {
  try {
    return profileFor(sessionStorage.getItem(STORAGE_KEY))?.id || null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(storedUser)
  const profile = profileFor(user)

  // Returns true if the username belongs to a known user (any letter case).
  const login = useCallback((username) => {
    const p = profileFor(username)
    if (!p) return false
    sessionStorage.setItem(STORAGE_KEY, p.id)
    setUser(p.id)
    return true
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, profile, login, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

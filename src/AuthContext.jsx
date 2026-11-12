import { createContext, useCallback, useContext, useState } from 'react'
import { checkLogin, profileFor } from './permissions'
import { setDemoMode } from './data'

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
  // Set before any page renders, so the demo account's pages read and write
  // its private database from their first call.
  setDemoMode(!!profile?.demo)

  // Returns true when the username (any letter case) and password match.
  const login = useCallback((username, password) => {
    const p = checkLogin(username, password)
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

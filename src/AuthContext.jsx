import { createContext, useCallback, useContext, useState } from 'react'

const AuthContext = createContext(null)

const STORAGE_KEY = 'hoyts-user'
// The only username permitted to enter the system.
const ALLOWED_USERNAME = 'alan'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => sessionStorage.getItem(STORAGE_KEY) || null)

  // Returns true if the username is accepted. Anything other than the allowed
  // username is rejected.
  const login = useCallback((username) => {
    if ((username || '').trim().toLowerCase() !== ALLOWED_USERNAME) {
      return false
    }
    sessionStorage.setItem(STORAGE_KEY, ALLOWED_USERNAME)
    setUser(ALLOWED_USERNAME)
    return true
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

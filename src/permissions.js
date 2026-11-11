// Who can sign in and what each person can reach. Sign-in is by username only,
// so this controls what the app shows; it is not a security boundary.
//
// sites: 'main' is 25-27 Alex Ave (Traceability and its pages), 'ffs' is
// 36-40 Alex Ave (FFS). A site that isn't listed is hidden completely.
export const USERS = {
  alan: { id: 'alan', name: 'ALAN', sites: ['main', 'ffs'], canDelete: true, isAdmin: true },
  kitchen: { id: 'kitchen', name: 'Kitchen', sites: ['main'], canDelete: false, isAdmin: false },
  michael: { id: 'michael', name: 'Michael', sites: ['ffs'], canDelete: false, isAdmin: false },
}

export const SITE_HOME = { main: '/', ffs: '/ffs' }

export function profileFor(username) {
  return USERS[String(username ?? '').trim().toLowerCase()] || null
}

export function siteForPath(pathname) {
  return pathname === '/ffs' || pathname.startsWith('/ffs/') ? 'ffs' : 'main'
}

export function canOpen(profile, pathname) {
  return !!profile && profile.sites.includes(siteForPath(pathname))
}

export function homeFor(profile) {
  return SITE_HOME[profile?.sites[0]] || '/'
}

// Display name for a stored username, e.g. on who pushed a record.
export function displayName(username) {
  return profileFor(username)?.name || username || ''
}

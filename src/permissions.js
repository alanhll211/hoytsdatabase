// Who can sign in and what each person can reach. Sign-in is by username only,
// so this controls what the app shows; it is not a security boundary.
//
// sites: 'main' is 25-27 Alex Ave (Traceability and its pages), 'ffs' is
// 36-40 Alex Ave (FFS). A site that isn't listed is hidden completely.
// pages (optional): the only pages this user gets, in menu order; without
// it they get every page of their sites.
// home (optional): where they land after signing in.
export const USERS = {
  alan: { id: 'alan', name: 'ALAN', sites: ['main', 'ffs'], canDelete: true, isAdmin: true },
  kitchen: {
    id: 'kitchen',
    name: 'Kitchen',
    sites: ['main'],
    pages: ['/batches', '/daily', '/traceability'],
    home: '/batches',
    canDelete: false,
    isAdmin: false,
  },
  michael: { id: 'michael', name: 'Michael', sites: ['ffs'], canDelete: false, isAdmin: false },
}

export const SITE_HOME = { main: '/', ffs: '/ffs' }

export function profileFor(username) {
  return USERS[String(username ?? '').trim().toLowerCase()] || null
}

export function siteForPath(pathname) {
  return pathname === '/ffs' || pathname.startsWith('/ffs/') ? 'ffs' : 'main'
}

const onPage = (pathname, page) => pathname === page || pathname.startsWith(`${page}/`)

export function canOpen(profile, pathname) {
  if (!profile || !profile.sites.includes(siteForPath(pathname))) return false
  return !profile.pages || profile.pages.some((page) => onPage(pathname, page))
}

export function homeFor(profile) {
  return profile?.home || SITE_HOME[profile?.sites[0]] || '/'
}

// A site's menu for this user: pages they can't open are left out, and a
// user with their own page list sees it in that order.
export function menuFor(profile, items) {
  const allowed = items.filter((item) => canOpen(profile, item.to))
  if (!profile?.pages) return allowed
  return allowed.sort((a, b) => profile.pages.indexOf(a.to) - profile.pages.indexOf(b.to))
}

// Display name for a stored username, e.g. on who pushed a record.
export function displayName(username) {
  return profileFor(username)?.name || username || ''
}

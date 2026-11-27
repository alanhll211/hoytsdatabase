// The app can stay open for days on a phone, and a reopened home-screen app
// can show a saved copy, so it checks whether a newer version has been
// deployed: the script index.html names now against the one this page runs.

const SCRIPT = /<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/

function runningScript() {
  return document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') || null
}

export async function newerVersionDeployed() {
  const mine = runningScript()
  // The dev server has no built script to compare.
  if (!mine) return false
  try {
    const res = await fetch('/index.html', { cache: 'no-store' })
    if (!res.ok) return false
    const latest = (await res.text()).match(SCRIPT)?.[1]
    return !!latest && latest !== mine
  } catch {
    return false
  }
}

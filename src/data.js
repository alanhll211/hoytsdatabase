// Every page reads and writes through this module instead of importing
// 'firebase/firestore' directly. Normally each call goes straight to
// Firestore. In demo mode (the qa account) the same calls run against a
// private database kept in this browser tab instead: it starts empty, is
// never sent anywhere, and is gone once the tab or app is closed.
//
// Only what the app uses is supported: collection / doc refs, queries with
// where (==, !=, <, <=, >, >=), orderBy and limit, getDoc, getDocs,
// onSnapshot, addDoc, updateDoc, deleteDoc and writeBatch.
import * as fs from 'firebase/firestore'
import { Timestamp } from 'firebase/firestore'

export { Timestamp }

let demo = false

export function setDemoMode(on) {
  demo = !!on
}

// ---- Demo store: { collectionName: { docId: data } }, saved to
// sessionStorage so a reload keeps it but closing the tab clears it.

const STORE_KEY = 'hoyts-demo-db'
let store = null
const listeners = new Set()

const isMem = (x) => !!x && x.__mem === true

function encode(v) {
  if (v instanceof Timestamp) return { __ts: [v.seconds, v.nanoseconds] }
  if (Array.isArray(v)) return v.map(encode)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
  return v
}

function decode(v) {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    if (Array.isArray(v.__ts)) return new Timestamp(v.__ts[0], v.__ts[1])
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
  }
  return v
}

// Copies plain objects and arrays; Timestamps are immutable and shared.
function clone(v) {
  if (v instanceof Timestamp) return v
  if (Array.isArray(v)) return v.map(clone)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
  return v
}

function load() {
  if (store) return store
  try {
    store = decode(JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}')) || {}
  } catch {
    store = {}
  }
  return store
}

function save() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(encode(store)))
  } catch {
    // Storage full or blocked: the data still lives in memory for now.
  }
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const newId = () => Array.from({ length: 20 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('')

const sortKey = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v)

function compare(a, b) {
  const x = sortKey(a)
  const y = sortKey(b)
  if (x === y) return 0
  if (x === null || x === undefined) return -1
  if (y === null || y === undefined) return 1
  return x < y ? -1 : 1
}

const TESTS = {
  '==': (c) => c === 0,
  '!=': (c) => c !== 0,
  '<': (c) => c < 0,
  '<=': (c) => c <= 0,
  '>': (c) => c > 0,
  '>=': (c) => c >= 0,
}

function memDocRef(col, id) {
  return { __mem: true, type: 'doc', col, id, path: `${col}/${id}` }
}

function snapshotOf(col, rows) {
  const docs = rows.map(({ id, data }) => ({
    id,
    ref: memDocRef(col, id),
    exists: () => true,
    data: () => clone(data),
  }))
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) }
}

// Runs a collection or query ref the way Firestore would.
function run(ref) {
  const all = load()[ref.col] || {}
  // Firestore returns documents in id order unless told otherwise.
  let rows = Object.keys(all)
    .sort()
    .map((id) => ({ id, data: all[id] }))
  const constraints = ref.constraints || []
  for (const c of constraints) {
    if (c.kind !== 'where') continue
    const test = TESTS[c.op]
    if (!test) throw new Error(`Demo database: unsupported operator ${c.op}`)
    rows = rows.filter((r) => r.data[c.field] !== undefined && test(compare(r.data[c.field], c.value)))
  }
  const orders = constraints.filter((c) => c.kind === 'orderBy')
  if (orders.length) {
    rows = rows.filter((r) => orders.every((o) => r.data[o.field] !== undefined))
    rows.sort((a, b) => {
      for (const o of orders) {
        const d = compare(a.data[o.field], b.data[o.field])
        if (d) return o.dir === 'desc' ? -d : d
      }
      return 0
    })
  }
  const lim = constraints.find((c) => c.kind === 'limit')
  if (lim) rows = rows.slice(0, lim.n)
  return snapshotOf(ref.col, rows)
}

// Tells live lists about a change, after the write call returns (as
// Firestore does for local writes).
function changed(cols) {
  save()
  for (const l of listeners) {
    if (!cols.has(l.ref.col)) continue
    setTimeout(() => {
      if (listeners.has(l)) l.next(run(l.ref))
    }, 0)
  }
}

function applyUpdate(ref, patch) {
  const docs = load()[ref.col]
  if (!docs?.[ref.id]) throw new Error(`No document to update: ${ref.path}`)
  docs[ref.id] = { ...docs[ref.id], ...clone(patch) }
}

function applySet(ref, data) {
  const s = load()
  s[ref.col] = s[ref.col] || {}
  s[ref.col][ref.id] = clone(data)
}

function applyDelete(ref) {
  delete load()[ref.col]?.[ref.id]
}

// ---- The Firestore functions the app uses

export function collection(db, path) {
  return demo ? { __mem: true, type: 'collection', col: path, path } : fs.collection(db, path)
}

export function doc(dbOrCollection, path, id) {
  if (isMem(dbOrCollection)) return memDocRef(dbOrCollection.col, path)
  return demo ? memDocRef(path, id) : fs.doc(dbOrCollection, path, id)
}

export function query(ref, ...constraints) {
  return isMem(ref) ? { ...ref, type: 'query', constraints: [...(ref.constraints || []), ...constraints] } : fs.query(ref, ...constraints)
}

export function where(field, op, value) {
  return demo ? { kind: 'where', field, op, value } : fs.where(field, op, value)
}

export function orderBy(field, dir = 'asc') {
  return demo ? { kind: 'orderBy', field, dir } : fs.orderBy(field, dir)
}

export function limit(n) {
  return demo ? { kind: 'limit', n } : fs.limit(n)
}

export function serverTimestamp() {
  return demo ? Timestamp.now() : fs.serverTimestamp()
}

export function getDoc(ref) {
  if (!isMem(ref)) return fs.getDoc(ref)
  const data = load()[ref.col]?.[ref.id]
  return Promise.resolve({ id: ref.id, ref, exists: () => !!data, data: () => (data ? clone(data) : undefined) })
}

export function getDocs(ref) {
  return isMem(ref) ? Promise.resolve(run(ref)) : fs.getDocs(ref)
}

export function onSnapshot(ref, next, error) {
  if (!isMem(ref)) return fs.onSnapshot(ref, next, error)
  const l = { ref, next }
  listeners.add(l)
  setTimeout(() => {
    if (listeners.has(l)) next(run(ref))
  }, 0)
  return () => listeners.delete(l)
}

export async function addDoc(ref, data) {
  if (!isMem(ref)) return fs.addDoc(ref, data)
  const docRef = memDocRef(ref.col, newId())
  applySet(docRef, data)
  changed(new Set([ref.col]))
  return docRef
}

export async function updateDoc(ref, patch) {
  if (!isMem(ref)) return fs.updateDoc(ref, patch)
  applyUpdate(ref, patch)
  changed(new Set([ref.col]))
}

export async function deleteDoc(ref) {
  if (!isMem(ref)) return fs.deleteDoc(ref)
  applyDelete(ref)
  changed(new Set([ref.col]))
}

export function writeBatch(db) {
  if (!demo) return fs.writeBatch(db)
  const ops = []
  const wb = {
    set: (ref, data) => (ops.push(() => applySet(ref, data)), wb),
    update: (ref, patch) => (ops.push(() => applyUpdate(ref, patch)), wb),
    delete: (ref) => (ops.push(() => applyDelete(ref)), wb),
    commit: async () => {
      // All or nothing, like a Firestore batch.
      const before = clone(load())
      try {
        ops.forEach((op) => op())
      } catch (err) {
        store = before
        throw err
      }
      changed(new Set(Object.keys(load()).concat(Object.keys(before))))
    },
  }
  return wb
}

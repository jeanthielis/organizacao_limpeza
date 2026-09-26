// offline.js — fila local de fotos (IndexedDB) para envio quando a conexão voltar
const DB_NAME = 'controlpoint-offline'
const STORE = 'photoQueue'
const DB_VERSION = 1

function openDB () {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run (mode, fn) {
  return openDB().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    let result
    try { result = fn(store) } catch (e) { reject(e); return }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

export function newQueueId () {
  return 'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// record: { id, blob, pointName, field: 'photo'|'after', docId?, createdAt }
export async function addPhoto (record) {
  await run('readwrite', s => s.put(record))
  return record.id
}

export async function updatePhoto (id, patch) {
  const d = await openDB()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite')
    const s = t.objectStore(STORE)
    const g = s.get(id)
    g.onsuccess = () => {
      const cur = g.result
      if (!cur) { resolve(null); return }
      s.put({ ...cur, ...patch })
    }
    t.oncomplete = () => resolve(true)
    t.onerror = () => reject(t.error)
  })
}

export async function listPhotos () {
  const d = await openDB()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function removePhoto (id) {
  return run('readwrite', s => s.delete(id))
}

export async function countReady () {
  const all = await listPhotos()
  return all.filter(r => r.docId).length
}

// Remove blobs órfãos (capturados mas nunca salvos) com mais de 24h
export async function purgeOrphans (maxAgeMs = 86400000) {
  const all = await listPhotos()
  const limit = Date.now() - maxAgeMs
  for (const r of all) {
    if (!r.docId && (r.createdAt || 0) < limit) await removePhoto(r.id)
  }
}

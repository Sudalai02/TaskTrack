// ============================================================
// STORE — Firestore-backed (cloud source of truth) with a local
// IndexedDB fallback for the brief signed-out window.
//
// Layout mirrors the intended Firestore design:
//   users/{uid}/meta, users/{uid}/profile, users/{uid}/settings,
//   users/{uid}/tasks, users/{uid}/projects, ... etc.
//
// PERFORMANCE: reads are cache-first. Each store is buffered in
// memory the first time it is queried; writes apply to the cache
// immediately and hit Firestore in the background, so the UI
// reflects changes instantly without waiting on the network.
// Firestore's persistent local cache stays the durable copy and
// replays any offline writes when connectivity returns.
// ============================================================

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { app, auth, onAuthStateChanged } from "../config/firebase.js";

const firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const STORES = [
  "meta",
  "profile",
  "settings",
  "goals",
  "projects",
  "tasks",
  "habits",
  "habitLogs",
  "focusSessions",
  "notes",
  "folders",
  "inbox",
  "events",
  "recycleBin",
  "alerts",
];

// Modules that support soft-delete / restore via the Recycle Bin.
export const RECYCLABLE_STORES = [
  "tasks",
  "projects",
  "goals",
  "habits",
  "notes",
  "folders",
  "events",
  "focusSessions",
  "inbox",
];

let currentUid = null;

onAuthStateChanged(auth, (user) => {
  currentUid = user?.uid || null;
  if (user) migrateLocalToCloud(user.uid);
});

// ---------- in-memory write-through cache ----------
// `cache` maps storeName → Map(id → doc). A store is marked `loaded`
// after its first successful Firestore read. Pending local writes are
// kept in the Map even while the store is still loading, so nothing
// the user does is ever lost to a cache reset.
const cache = new Map();
const loaded = new Set();

function cacheOf(storeName) {
  let m = cache.get(storeName);
  if (!m) {
    m = new Map();
    cache.set(storeName, m);
  }
  return m;
}

function cacheSet(storeName, obj) {
  cacheOf(storeName).set(String(obj.id), { ...obj });
}

async function ensureLoaded(storeName) {
  if (loaded.has(storeName)) return;
  loaded.add(storeName); // guard against duplicate concurrent loads
  const ref = collectionRef(storeName);
  if (!ref) return;
  try {
    const snap = await getDocs(ref);
    const m = new Map(cacheOf(storeName)); // keep any optimistic local writes
    for (const d of snap.docs) {
      if (!m.has(d.id)) m.set(d.id, { ...d.data(), id: d.id });
    }
    cache.set(storeName, m);
  } catch (err) {
    loaded.delete(storeName); // allow a retry on the next read
    console.warn(`[db] store "${storeName}" failed to sync`, err?.message || err);
  }
}

// Pick up changes made in other tabs/devtools by re-syncing in the
// background whenever the tab regains focus. Reads keep serving the
// cached data instantly; the fresh copy lands when the query returns.
window.addEventListener("focus", () => {
  for (const storeName of [...loaded]) {
    loaded.delete(storeName);
    ensureLoaded(storeName);
  }
});

// ---------- path builders ----------

function cloudPath(storeName, uid = currentUid) {
  return uid ? `users/${uid}/${storeName}` : null;
}

function collectionRef(storeName, uid = currentUid) {
  const path = cloudPath(storeName, uid);
  return path ? collection(firestore, path) : null;
}

function docRef(storeName, id, uid = currentUid) {
  const path = cloudPath(storeName, uid);
  return path ? doc(firestore, path, String(id)) : null;
}

// ---------- cloud write helpers ----------

const BATCH_LIMIT = 499;

// Firestore writes are fire-and-forget for the UI path. The SDK's
// persistent cache guarantees the mutation survives locally and is
// replayed when the network returns, which is all this app needs.
function writeAsync(snapshot) {
  Promise.resolve(snapshot).then(
    () => undefined,
    (err) => console.warn("[db] write pending in Firestore cache", err?.message || err)
  );
}

async function writeInBatches(storeName, objs, uid) {
  for (let i = 0; i < objs.length; i += BATCH_LIMIT) {
    const chunk = objs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(firestore);
    for (const obj of chunk) {
      batch.set(doc(firestore, cloudPath(storeName, uid), String(obj.id)), obj, {
        merge: true,
      });
    }
    await batch.commit();
  }
}

// ---------- public API ----------

export async function getAll(storeName) {
  const ref = collectionRef(storeName);
  if (!ref) return localGetAll(storeName);
  await ensureLoaded(storeName);
  return [...cacheOf(storeName).values()].map((d) => ({ ...d }));
}

export async function get(storeName, id) {
  const ref = docRef(storeName, id);
  if (!ref) return localGet(storeName, id);
  await ensureLoaded(storeName);
  const d = cacheOf(storeName).get(String(id));
  return d ? { ...d } : null;
}

export async function put(storeName, obj) {
  const ref = docRef(storeName, obj.id);
  if (!ref) return localPut(storeName, obj);
  cacheSet(storeName, obj);
  writeAsync(setDoc(ref, obj, { merge: true }));
  return obj;
}

export async function bulkPut(storeName, objs) {
  if (!objs.length) return objs;
  for (const obj of objs) cacheSet(storeName, obj);
  if (!currentUid) return localBulkPut(storeName, objs);
  return writeInBatches(storeName, objs, currentUid).then(() => objs);
}

export async function del(storeName, id) {
  const ref = docRef(storeName, id);
  if (!ref) return localDel(storeName, id);
  cacheOf(storeName).delete(String(id));
  writeAsync(deleteDoc(ref));
}

export async function clear(storeName) {
  const ref = collectionRef(storeName);
  if (!ref) return localClear(storeName);
  cacheOf(storeName).clear();
  loaded.delete(storeName);
  try {
    const snap = await getDocs(ref);
    const ids = snap.docs.map((d) => d.id);
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
      const batch = writeBatch(firestore);
      for (const id of ids.slice(i, i + BATCH_LIMIT)) {
        batch.delete(doc(firestore, cloudPath(storeName), String(id)));
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn(`[db] clear "${storeName}" failed`, err?.message || err);
  }
}

// ---------- meta helpers (key/value convenience) ----------
export async function getMeta(key) {
  const row = await get("meta", key);
  return row ? row.value : undefined;
}

export async function setMeta(key, value) {
  return put("meta", { id: key, value });
}

// ---------- legacy migration ----------
// One-time upload of existing IndexedDB data into the signed-in
// user's Firestore space. Docs already present in Firestore win;
// local stores are cleared afterwards so data never bleeds into
// another account on the same browser.

const MIGRATION_FLAG_KEY = "nexora:migrated:";

async function migrateLocalToCloud(uid) {
  try {
    let flag = false;
    try {
      flag = localStorage.getItem(MIGRATION_FLAG_KEY + uid) === "1";
    } catch {
      /* storage unavailable — fall through to the data check below */
    }
    if (flag) return;

    for (const storeName of STORES) {
      const localDocs = await localGetAll(storeName);
      const items = localDocs.filter((o) => o && o.id);
      if (!items.length) continue;

      const snap = await getDocs(collection(firestore, cloudPath(storeName, uid)));
      const existing = new Set(snap.docs.map((d) => d.id));
      const toWrite = items.filter((o) => !existing.has(o.id));
      if (toWrite.length) {
        await writeInBatches(storeName, toWrite, uid);
        for (const obj of toWrite) cacheSet(storeName, obj);
      }
    }

    try {
      localStorage.setItem(MIGRATION_FLAG_KEY + uid, "1");
    } catch {
      /* storage unavailable — will re-run next login, harmless */
    }
    clearLocalStore();
  } catch (err) {
    console.warn("[db] legacy migration skipped:", err?.message || err);
  }
}

async function clearLocalStore() {
  try {
    await Promise.all(STORES.map((storeName) => localClear(storeName)));
  } catch {
    /* ignore — leftover local data is harmless once the flag is set */
  }
}

// ============================================================
// LOCAL STORE — IndexedDB. Only used as a fallback while signed
// out, or as the migration source above.
// ============================================================

const LOCAL_DB_NAME = "nexora";
const LOCAL_DB_VERSION = 2;

let localDbPromise = null;

function openLocalDb() {
  if (localDbPromise) return localDbPromise;
  localDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return localDbPromise;
}

function localTx(storeName, mode) {
  return openLocalDb().then((db) =>
    db.transaction(storeName, mode).objectStore(storeName)
  );
}

function localWrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function localGetAll(storeName) {
  const store = await localTx(storeName, "readonly");
  return localWrap(store.getAll());
}

async function localGet(storeName, id) {
  const store = await localTx(storeName, "readonly");
  return localWrap(store.get(id));
}

async function localPut(storeName, obj) {
  const store = await localTx(storeName, "readwrite");
  return localWrap(store.put(obj)).then(() => obj);
}

async function localBulkPut(storeName, objs) {
  const store = await localTx(storeName, "readwrite");
  await Promise.all(objs.map((o) => localWrap(store.put(o))));
  return objs;
}

async function localDel(storeName, id) {
  const store = await localTx(storeName, "readwrite");
  return localWrap(store.delete(id));
}

async function localClear(storeName) {
  const store = await localTx(storeName, "readwrite");
  return localWrap(store.clear());
}
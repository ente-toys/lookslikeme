const FACE_CACHE_DB_NAME = "lookslikeme-face-cache";
const FACE_CACHE_STORE = "faces";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(FACE_CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FACE_CACHE_STORE)) {
        db.createObjectStore(FACE_CACHE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

async function hashBytes(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (const b of arr) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function getModelFamily(): string {
  return (
    (globalThis as typeof globalThis & { __LLU_MODEL_FAMILY__?: string })
      .__LLU_MODEL_FAMILY__ ?? "buffalo_s"
  );
}

function cacheKey(fileHash: string): string {
  return `${getModelFamily()}:${fileHash}`;
}

async function hasEntry(key: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;

  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(FACE_CACHE_STORE, "readonly");
      const request = tx.objectStore(FACE_CACHE_STORE).count(key);
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function areAllFilesCached(files: File[]): Promise<boolean> {
  if (files.length === 0) return false;

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const hash = await hashBytes(buffer);
    const cached = await hasEntry(cacheKey(hash));
    if (!cached) return false;
  }
  return true;
}

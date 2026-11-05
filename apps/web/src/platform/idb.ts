/**
 * A minimal promise wrapper over IndexedDB.
 *
 * Card data, printing lists and image bytes all outgrow localStorage quickly —
 * a single card image is around a megabyte — so they live here instead. Only
 * the handful of operations the caches need are implemented.
 */

// Still the tool's old name: renaming the database would orphan everything a
// browser has already stored, pins and preferences included.
const DB_NAME = 'mtgproxy';
const DB_VERSION = 1;

export const STORES = ['cards', 'prints', 'images', 'data'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('could not open IndexedDB'));
  });
  return dbPromise;
}

async function transact<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${mode} failed`));
  });
}

export interface StoredValue<T> {
  value: T;
  storedAt: number;
}

export async function idbGet<T>(store: StoreName, key: string): Promise<StoredValue<T> | undefined> {
  return transact<StoredValue<T> | undefined>(store, 'readonly', (objectStore) =>
    objectStore.get(key),
  );
}

export async function idbSet<T>(store: StoreName, key: string, value: T): Promise<void> {
  await transact(store, 'readwrite', (objectStore) =>
    objectStore.put({ value, storedAt: Date.now() } satisfies StoredValue<T>, key),
  );
}

export async function idbClear(store: StoreName): Promise<void> {
  await transact(store, 'readwrite', (objectStore) => objectStore.clear());
}

export async function idbCount(store: StoreName): Promise<number> {
  return transact<number>(store, 'readonly', (objectStore) => objectStore.count());
}

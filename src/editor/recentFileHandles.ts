import type { BrowserFileSystemFileHandle } from "./fileAccess";

const HANDLE_DB_NAME = "3forge-file-handles";
const HANDLE_STORE_NAME = "recent-file-handles";
const HANDLE_DB_VERSION = 1;

interface BrowserIndexedDbLike {
  open(name: string, version?: number): IDBOpenDBRequest;
}

function getIndexedDb(indexedDbObject: BrowserIndexedDbLike | null = typeof window !== "undefined" ? window.indexedDB : null): BrowserIndexedDbLike | null {
  return indexedDbObject && typeof indexedDbObject.open === "function" ? indexedDbObject : null;
}

function openHandleDatabase(indexedDbObject: BrowserIndexedDbLike | null = getIndexedDb()): Promise<IDBDatabase | null> {
  if (!indexedDbObject) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDbObject.open(HANDLE_DB_NAME, HANDLE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        database.createObjectStore(HANDLE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runHandleStoreRequest<T>(
  mode: IDBTransactionMode,
  execute: (store: IDBObjectStore) => IDBRequest<T> | void,
  indexedDbObject: BrowserIndexedDbLike | null = getIndexedDb(),
): Promise<T | null> {
  return openHandleDatabase(indexedDbObject).then((database) => {
    if (!database) {
      return null;
    }

    return new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(HANDLE_STORE_NAME, mode);
      const store = transaction.objectStore(HANDLE_STORE_NAME);
      const request = execute(store);

      if (!request) {
        transaction.oncomplete = () => resolve(null);
        transaction.onerror = () => reject(transaction.error);
        return;
      }

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    }).finally(() => {
      database.close();
    });
  });
}

export async function saveRecentFileHandle(
  fileHandleId: string,
  handle: BrowserFileSystemFileHandle,
  indexedDbObject: BrowserIndexedDbLike | null = getIndexedDb(),
): Promise<boolean> {
  try {
    await runHandleStoreRequest("readwrite", (store) => store.put(handle, fileHandleId), indexedDbObject);
    return true;
  } catch {
    return false;
  }
}

export async function readRecentFileHandle(
  fileHandleId: string,
  indexedDbObject: BrowserIndexedDbLike | null = getIndexedDb(),
): Promise<BrowserFileSystemFileHandle | null> {
  try {
    const handle = await runHandleStoreRequest("readonly", (store) => store.get(fileHandleId), indexedDbObject);
    return handle as BrowserFileSystemFileHandle | null;
  } catch {
    return null;
  }
}

export async function removeRecentFileHandle(
  fileHandleId: string,
  indexedDbObject: BrowserIndexedDbLike | null = getIndexedDb(),
): Promise<boolean> {
  try {
    await runHandleStoreRequest("readwrite", (store) => store.delete(fileHandleId), indexedDbObject);
    return true;
  } catch {
    return false;
  }
}

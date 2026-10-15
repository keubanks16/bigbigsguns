// Local storage for the catalog (IndexedDB). Nothing leaves the device.
const DB = (() => {
  const NAME = 'bigbigs-gun-collection';
  const STORE = 'guns';
  let dbp;

  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const result = fn(store);
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      t.onerror = () => reject(t.error);
    });
  }

  return {
    all: () => tx('readonly', s => s.getAll()),
    get: id => tx('readonly', s => s.get(id)),
    put: gun => tx('readwrite', s => s.put(gun)),
    remove: id => tx('readwrite', s => s.delete(id)),
    clear: () => tx('readwrite', s => s.clear()),
  };
})();

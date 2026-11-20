// Browser File objects are read-only snapshots. Store the referenced snapshot separately from the JSON draft.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('minimark-file-encodings', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('originals');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new Error('浏览器无法访问文件缓存，请重新打开文件。'));
  });
}
async function access(key: string, mode: 'read' | 'write' | 'delete', value?: Blob): Promise<Blob | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('originals', mode === 'read' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('originals');
      const request = mode === 'read' ? store.get(key) : mode === 'write' ? store.put(value, key) : store.delete(key);
      transaction.oncomplete = () => resolve(mode === 'read' ? request.result as Blob | undefined : undefined);
      transaction.onabort = transaction.onerror = () => reject(new Error('浏览器文件缓存失败，请检查可用空间。'));
    });
  } finally { db.close(); }
}
export async function keepOriginal(bytes: Uint8Array<ArrayBuffer>) {
  const key = crypto.randomUUID(); await access(key, 'write', new Blob([bytes])); return key;
}
export async function originalBytes(key?: string) {
  const blob = key ? await access(key, 'read') : undefined;
  if (!blob) throw new Error('原始文件不可用，请重新打开文件。');
  return new Uint8Array(await blob.arrayBuffer());
}
export function forgetOriginal(key?: string) { if (key) void access(key, 'delete').catch(() => {}); }

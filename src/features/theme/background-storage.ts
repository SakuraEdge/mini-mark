export interface BackgroundRecord {
  schema: 1;
  image: Blob;
  name: string;
  enabled: boolean;
  transparency: number;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('minimark-appearance', 1);
    let finished = false;
    const timeout = setTimeout(() => fail(), 5000);
    function fail() {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      reject(new Error('无法访问背景存储，请稍后重试。'));
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings');
    };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      finished = true; clearTimeout(timeout); resolve(request.result);
    };
  });
}

async function access(write: boolean, value?: BackgroundRecord | null, metadataOnly = false): Promise<unknown> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      let metadata: unknown, image: unknown;
      const transaction = db.transaction('settings', write ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('settings');
      if (write) {
        if (value) {
          const { image, ...metadata } = value;
          store.put(metadata, 'background');
          if (!metadataOnly) store.put(image, 'background-image');
        } else { store.delete('background'); store.delete('background-image'); }
      } else {
        const metadataRequest = store.get('background'), imageRequest = store.get('background-image');
        metadataRequest.onsuccess = () => { metadata = metadataRequest.result; };
        imageRequest.onsuccess = () => { image = imageRequest.result; };
      }
      transaction.oncomplete = () => resolve(metadata ? { ...metadata as object, image } : undefined);
      transaction.onabort = transaction.onerror = () => reject(new Error('背景设置保存失败，请检查本地存储空间。'));
    });
  } finally { db.close(); }
}

export async function readBackground(): Promise<BackgroundRecord | null> {
  const value = await access(false) as Partial<BackgroundRecord> | undefined;
  if (!value) return null;
  if (value.schema !== 1 || !(value.image instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp'].includes(value.image.type) ||
      value.image.size <= 0 || value.image.size > 8 * 1024 * 1024 || typeof value.name !== 'string' || typeof value.enabled !== 'boolean' ||
      typeof value.transparency !== 'number' || !Number.isFinite(value.transparency)) throw new Error('背景设置无法读取，请重新选择图片。');
  return { schema: 1, image: value.image, name: value.name.slice(0, 240), enabled: value.enabled, transparency: Math.max(0, Math.min(100, Math.round(value.transparency))) };
}

export async function writeBackground(value: BackgroundRecord | null, metadataOnly = false): Promise<void> { await access(true, value, metadataOnly); }

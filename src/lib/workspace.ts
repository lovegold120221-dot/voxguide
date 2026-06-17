export interface WorkspaceOutput {
  id: string;
  userId: string;
  type: 'document' | 'image' | 'screenshot' | 'capture' | 'app';
  title: string;
  textContent?: string;       // HTML/text for documents
  blobData?: ArrayBuffer;     // Binary for images
  mimeType: string;
  fileSize: number;
  driveFileId?: string;
  driveLink?: string;
  createdAt: string;
}

const DB_NAME = 'beatrice_workspace';
const STORE_NAME = 'outputs';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listOutputs(userId: string): Promise<WorkspaceOutput[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('userId');
    const range = IDBKeyRange.only(userId);
    const results: WorkspaceOutput[] = [];
    const req = index.openCursor(range, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveOutput(output: WorkspaceOutput): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(output);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOutput(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getOutput(id: string): Promise<WorkspaceOutput | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function clearUserOutputs(userId: string): Promise<void> {
  const all = await listOutputs(userId);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let completed = 0;
    for (const out of all) {
      const req = store.delete(out.id);
      req.onsuccess = () => {
        completed++;
        if (completed >= all.length) resolve();
      };
      req.onerror = () => reject(req.error);
    }
    if (all.length === 0) resolve();
  });
}

// ── Google Drive sync ──

async function findOrCreateWorkspaceFolder(gFetch: (url: string, options?: RequestInit, isRetry?: boolean) => Promise<{ ok: boolean; status: number; data: any }>): Promise<string | null> {
  // Search for existing folder
  const searchRes = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=name='Beatrice_Workspace' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`
  );
  if (searchRes.ok && searchRes.data?.files?.length > 0) {
    return searchRes.data.files[0].id;
  }

  // Create folder
  const createRes = await gFetch(
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Beatrice_Workspace',
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Auto-saved outputs from Beatrice AI assistant',
      }),
    }
  );
  if (createRes.ok && createRes.data?.id) {
    return createRes.data.id;
  }
  return null;
}

export async function uploadToDrive(
  gFetch: (url: string, options?: RequestInit, isRetry?: boolean) => Promise<{ ok: boolean; status: number; data: any }>,
  output: WorkspaceOutput,
): Promise<{ fileId: string; link: string } | null> {
  try {
    const folderId = await findOrCreateWorkspaceFolder(gFetch);
    if (!folderId) return null;

    let body: BodyInit;
    let mimeType: string;

    if (output.type === 'document' && output.textContent) {
      body = output.textContent;
      mimeType = output.mimeType || 'text/html';
    } else if (output.blobData) {
      body = output.blobData;
      mimeType = output.mimeType || 'application/octet-stream';
    } else {
      return null;
    }

    // Use multipart upload to set metadata + content
    const boundary = 'beatrice_boundary_42';
    const metadata = JSON.stringify({
      name: `${output.title.replace(/[^a-zA-Z0-9 _-]/g, '')}.${mimeType === 'text/html' ? 'html' : mimeType.split('/')[1] || 'bin'}`,
      parents: [folderId],
      description: `Created by Beatrice on ${output.createdAt}`,
    });

    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
      body instanceof ArrayBuffer ? new Uint8Array(body) : body,
      `--${boundary}--`,
    ].join('\r\n');

    const uploadRes = await gFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (uploadRes.ok && uploadRes.data?.id) {
      return {
        fileId: uploadRes.data.id,
        link: uploadRes.data.webViewLink || `https://drive.google.com/file/d/${uploadRes.data.id}/view`,
      };
    }
    return null;
  } catch (err) {
    console.error('Drive upload failed:', err);
    return null;
  }
}

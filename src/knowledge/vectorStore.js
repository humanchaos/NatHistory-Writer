// ─── IndexedDB Vector Store ────────────────────────────

const DB_NAME = 'scriptwriter_knowledge';
const DB_VERSION = 1;
const DOCS_STORE = 'documents';
const CHUNKS_STORE = 'chunks';

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(DOCS_STORE)) {
                db.createObjectStore(DOCS_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
                const store = db.createObjectStore(CHUNKS_STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('docId', 'docId', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Add a document with its embedded chunks to the store.
 * @param {string} filename
 * @param {string[]} chunkTexts
 * @param {number[][]} embeddings — parallel array of embedding vectors
 */
export async function addDocument(filename, chunkTexts, embeddings) {
    const db = await openDB();
    const docId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const tx = db.transaction([DOCS_STORE, CHUNKS_STORE], 'readwrite');

    // Store document metadata
    tx.objectStore(DOCS_STORE).put({
        id: docId,
        filename,
        chunkCount: chunkTexts.length,
        addedAt: new Date().toISOString(),
    });

    // Store each chunk with its embedding
    const chunkStore = tx.objectStore(CHUNKS_STORE);
    for (let i = 0; i < chunkTexts.length; i++) {
        chunkStore.put({
            docId,
            text: chunkTexts[i],
            embedding: embeddings[i],
        });
    }

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(docId);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * List all documents.
 * @returns {Promise<object[]>}
 */
export async function listDocuments() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_STORE, 'readonly');
        const req = tx.objectStore(DOCS_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Delete a document and all its chunks.
 */
export async function deleteDocument(docId) {
    const db = await openDB();
    const tx = db.transaction([DOCS_STORE, CHUNKS_STORE], 'readwrite');

    tx.objectStore(DOCS_STORE).delete(docId);

    // Delete all chunks for this doc
    const chunkStore = tx.objectStore(CHUNKS_STORE);
    const index = chunkStore.index('docId');
    const cursorReq = index.openCursor(IDBKeyRange.only(docId));
    cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            cursor.delete();
            cursor.continue();
        }
    };

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

/**
 * Search for the top-K most relevant chunks.
 * @param {number[]} queryEmbedding
 * @param {number} topK
 * @returns {Promise<Array<{text: string, score: number, docId: string}>>}
 */
export async function search(queryEmbedding, topK = 5) {
    const db = await openDB();
    const chunks = await new Promise((resolve, reject) => {
        const tx = db.transaction(CHUNKS_STORE, 'readonly');
        const req = tx.objectStore(CHUNKS_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });

    if (chunks.length === 0) return [];

    // Score all chunks
    const scored = chunks.map((chunk) => ({
        text: chunk.text,
        docId: chunk.docId,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Sort by score descending and take top K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

/**
 * Check if the knowledge base has any documents.
 * @returns {Promise<boolean>}
 */
export async function hasDocuments() {
    const docs = await listDocuments();
    return docs.length > 0;
}

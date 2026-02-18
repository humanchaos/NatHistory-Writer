// ─── Shared Knowledge Base Client ─────────────────────
// Talks to the server-side Vercel Blob API routes.
// Mirrors the vectorStore.js interface for local KB.

/**
 * List all shared KB documents.
 * @returns {Promise<Array<{id, filename, chunkCount, addedAt}>>}
 */
export async function listSharedDocuments() {
    try {
        const res = await fetch('/api/kb-list');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { docs } = await res.json();
        return docs || [];
    } catch (err) {
        console.warn('[SharedKB] listSharedDocuments failed:', err.message);
        return [];
    }
}

/**
 * Search shared KB for relevant chunks using a pre-computed query embedding.
 * @param {number[]} queryEmbedding
 * @param {number} topK
 * @returns {Promise<Array<{text, score, docId, filename}>>}
 */
export async function searchShared(queryEmbedding, topK = 5) {
    try {
        const res = await fetch('/api/kb-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queryEmbedding, topK }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { results } = await res.json();
        return results || [];
    } catch (err) {
        console.warn('[SharedKB] searchShared failed:', err.message);
        return [];
    }
}

/**
 * Upload a document to the shared KB (admin only).
 * @param {string} password — KB_ADMIN_PASSWORD
 * @param {string} filename
 * @param {string[]} chunks
 * @param {number[][]} embeddings
 * @returns {Promise<{docId, filename, chunkCount}>}
 */
export async function addSharedDocument(password, filename, chunks, embeddings) {
    const res = await fetch('/api/kb-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, filename, chunks, embeddings }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

/**
 * Delete a document from the shared KB (admin only).
 * @param {string} password — KB_ADMIN_PASSWORD
 * @param {string} docId
 */
export async function deleteSharedDocument(password, docId) {
    const res = await fetch('/api/kb-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, docId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

/**
 * Check if the shared KB has any documents.
 * @returns {Promise<boolean>}
 */
export async function hasSharedDocuments() {
    const docs = await listSharedDocuments();
    return docs.length > 0;
}

/**
 * Trigger a refresh of curated industry intelligence sources.
 * @param {string} password — KB_ADMIN_PASSWORD
 * @param {string[]} [sourceIds] — optional subset of source IDs to refresh
 * @param {function} [onProgress] — called with (sourceLabel, status) as each source completes
 * @returns {Promise<Array<{id, label, status, chunkCount?, error?}>>}
 */
export async function triggerRefresh(password, sourceIds, onProgress) {
    const res = await fetch('/api/kb-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, sourceIds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.results || [];
}

/**
 * Load the curated source list from the server config.
 * @returns {Promise<Array<{id, label, category, url}>>}
 */
export async function listSources() {
    try {
        const res = await fetch('/api/kb-sources.json');
        if (!res.ok) return [];
        const data = await res.json();
        return (data.sources || []).map(s => ({
            id: s.id,
            label: s.label,
            category: s.category,
            url: s.url,
        }));
    } catch {
        return [];
    }
}


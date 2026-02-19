// ─── Pipeline Checkpoint Store — IndexedDB persistence ───────────
// Saves pipeline state after each agent step so work can survive
// browser close, WiFi loss, or PC shutdown.

const DB_NAME = 'scriptwriter_pipeline';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoint';

/**
 * Open (or create) the checkpoint IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Save a pipeline checkpoint. Overwrites any existing checkpoint.
 *
 * @param {object} state
 * @param {string} state.seedIdea — the original seed
 * @param {string|null} state.platform — target platform
 * @param {number|null} state.year — target delivery year
 * @param {string|null} state.directive — creative directive
 * @param {number} state.phase — last completed phase number (0–6)
 * @param {string} state.step — last completed step ID
 * @param {object} state.ctx — the full pipeline context object
 * @param {boolean} [state.isAssessment] — whether this is an assessment run
 */
export async function saveCheckpoint(state) {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
            id: 'current',
            ...state,
            updatedAt: new Date().toISOString(),
            startedAt: state.startedAt || new Date().toISOString(),
            status: 'running',
        });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        // Non-fatal — checkpoint failure should never block the pipeline
        console.warn('Checkpoint save failed:', err.message);
    }
}

/**
 * Load the current checkpoint, if any.
 * @returns {Promise<object|null>}
 */
export async function loadCheckpoint() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get('current');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.warn('Checkpoint load failed:', err.message);
        return null;
    }
}

/**
 * Clear the current checkpoint (call on pipeline completion or discard).
 */
export async function clearCheckpoint() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete('current');
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('Checkpoint clear failed:', err.message);
    }
}

/**
 * Check if a running checkpoint exists.
 * @returns {Promise<boolean>}
 */
export async function hasCheckpoint() {
    const cp = await loadCheckpoint();
    return cp !== null && cp.status === 'running';
}

/**
 * Mark the checkpoint as complete (rather than deleting it, for debugging).
 */
export async function markComplete() {
    try {
        const cp = await loadCheckpoint();
        if (!cp) return;
        cp.status = 'complete';
        cp.completedAt = new Date().toISOString();
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(cp);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('Checkpoint mark-complete failed:', err.message);
    }
}

// ─── Batch (Multi-Genre) State ─────────────────────────
// Saves which genres were completed and their results so resume
// can skip finished genres and restore their result cards.

/**
 * Save batch state for multi-genre resume.
 * @param {object} state
 * @param {string} state.seedIdea
 * @param {Array} state.genreSuggestions — full genre list
 * @param {Array} state.completedGenres — [{genreName, genreKey, pitchDeck}, ...]
 * @param {number} state.currentIndex — index of current/next genre to run
 * @param {string|null} state.platform
 * @param {number|null} state.year
 * @param {string|null} state.directive
 * @param {string} state.chaosMode
 * @param {boolean} state.grandNarrativeMode
 * @param {number} state.maxRevisions
 */
export async function saveBatchState(state) {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
            id: 'batch',
            ...state,
            updatedAt: new Date().toISOString(),
            startedAt: state.startedAt || new Date().toISOString(),
            status: 'running',
        });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('Batch state save failed:', err.message);
    }
}

/**
 * Load saved batch state, if any.
 * @returns {Promise<object|null>}
 */
export async function loadBatchState() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get('batch');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.warn('Batch state load failed:', err.message);
        return null;
    }
}

/**
 * Clear the batch state (call on batch completion or discard).
 */
export async function clearBatchState() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete('batch');
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('Batch state clear failed:', err.message);
    }
}

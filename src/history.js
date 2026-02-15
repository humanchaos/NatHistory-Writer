// ─── Run History — IndexedDB persistence ───────────

const DB_NAME = 'scriptwriter_db';
const DB_VERSION = 2;
const STORE_NAME = 'runs';
const DRYRUN_STORE = 'dryruns';
const LEGACY_KEY = 'scriptwriter_runs';

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains(DRYRUN_STORE)) {
                const drStore = db.createObjectStore(DRYRUN_STORE, { keyPath: 'id' });
                drStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Generate a short unique ID.
 */
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Migrate legacy localStorage data to IndexedDB (one-time).
 */
async function migrateLegacy() {
    try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (!raw) return;
        const runs = JSON.parse(raw);
        if (!Array.isArray(runs) || runs.length === 0) return;

        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        for (const run of runs) {
            store.put(run);
        }

        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

        localStorage.removeItem(LEGACY_KEY);
        console.log(`[History] Migrated ${runs.length} runs from localStorage to IndexedDB`);
    } catch (err) {
        console.warn('[History] Legacy migration failed:', err.message);
    }
}

// Run migration on load
migrateLegacy();

/**
 * Get all saved runs, newest first.
 * @returns {Promise<Array<object>>}
 */
export async function getRuns() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const runs = request.result || [];
                runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                resolve(runs);
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return [];
    }
}

/**
 * Save a completed run.
 * @param {object} data — { seedIdea, phaseOutputs, finalPitchDeck }
 * @returns {Promise<object>} the saved run
 */
export async function saveRun(data) {
    const db = await openDB();
    const run = {
        id: uid(),
        timestamp: new Date().toISOString(),
        seedIdea: data.seedIdea,
        title: extractTitle(data.finalPitchDeck),
        finalPitchDeck: data.finalPitchDeck,
        phaseOutputs: data.phaseOutputs || [],
    };

    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(run);
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    // Trim to 50 newest runs
    const all = await getRuns();
    if (all.length > 50) {
        const toDelete = all.slice(50);
        const cleanTx = db.transaction(STORE_NAME, 'readwrite');
        const cleanStore = cleanTx.objectStore(STORE_NAME);
        for (const old of toDelete) {
            cleanStore.delete(old.id);
        }
    }

    return run;
}

/**
 * Delete a run by ID.
 */
export async function deleteRun(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Get a single run by ID.
 */
export async function getRunById(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Extract a title from the pitch deck markdown (first H1 or H2).
 */
function extractTitle(markdown) {
    if (!markdown) return 'Untitled Pitch';
    const match = markdown.match(/^#{1,2}\s+(.+)$/m);
    return match ? match[1].replace(/\*+/g, '').trim() : 'Untitled Pitch';
}

// ─── Dryrun Result Persistence ─────────────────────────

/**
 * Save a completed dryrun result.
 * Strips bulky pitchDeck text to save storage — keeps scores, calibration, and metadata.
 * @param {{ results, aggregate, calibration }} data
 * @returns {Promise<object>} the saved dryrun
 */
export async function saveDryrunResult(data) {
    const db = await openDB();
    const record = {
        id: uid(),
        timestamp: new Date().toISOString(),
        aggregate: data.aggregate,
        calibration: data.calibration,
        seeds: (data.results || []).map(r => ({
            name: r.seed.name,
            platform: r.seed.platform || null,
            rejected: r.rejected,
            score: r.rejected ? null : r.scorecard.overall,
            summary: r.scorecard?.summary || r.scorecard?.rejectionReason || '',
            dimensions: r.rejected ? [] : (r.scorecard.dimensions || []),
            duration: r.duration,
        })),
    };

    const tx = db.transaction(DRYRUN_STORE, 'readwrite');
    tx.objectStore(DRYRUN_STORE).put(record);
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    // Trim to 20 newest dryruns
    const all = await getDryrunResults();
    if (all.length > 20) {
        const toDelete = all.slice(20);
        const cleanTx = db.transaction(DRYRUN_STORE, 'readwrite');
        const cleanStore = cleanTx.objectStore(DRYRUN_STORE);
        for (const old of toDelete) {
            cleanStore.delete(old.id);
        }
    }

    return record;
}

/**
 * Get all saved dryrun results, newest first.
 * @returns {Promise<Array<object>>}
 */
export async function getDryrunResults() {
    try {
        const db = await openDB();
        const tx = db.transaction(DRYRUN_STORE, 'readonly');
        const store = tx.objectStore(DRYRUN_STORE);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const results = request.result || [];
                results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return [];
    }
}

/**
 * Delete a dryrun result by ID.
 */
export async function deleteDryrunResult(id) {
    const db = await openDB();
    const tx = db.transaction(DRYRUN_STORE, 'readwrite');
    tx.objectStore(DRYRUN_STORE).delete(id);
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

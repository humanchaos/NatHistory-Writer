// ─── Run History — localStorage persistence ───────────

const STORAGE_KEY = 'scriptwriter_runs';

/**
 * Generate a short unique ID.
 */
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Get all saved runs, newest first.
 * @returns {Array<object>}
 */
export function getRuns() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

/**
 * Save a completed run.
 * @param {object} data — { seedIdea, phaseOutputs, finalPitchDeck }
 * @returns {object} the saved run
 */
export function saveRun(data) {
    const runs = getRuns();
    const run = {
        id: uid(),
        timestamp: new Date().toISOString(),
        seedIdea: data.seedIdea,
        title: extractTitle(data.finalPitchDeck),
        finalPitchDeck: data.finalPitchDeck,
        phaseOutputs: data.phaseOutputs || [],
    };
    runs.unshift(run); // newest first
    // Keep max 50 runs to avoid localStorage limits
    if (runs.length > 50) runs.length = 50;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
    return run;
}

/**
 * Delete a run by ID.
 */
export function deleteRun(id) {
    const runs = getRuns().filter((r) => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

/**
 * Get a single run by ID.
 */
export function getRunById(id) {
    return getRuns().find((r) => r.id === id) || null;
}

/**
 * Extract a title from the pitch deck markdown (first H1 or H2).
 */
function extractTitle(markdown) {
    if (!markdown) return 'Untitled Pitch';
    const match = markdown.match(/^#{1,2}\s+(.+)$/m);
    return match ? match[1].replace(/\*+/g, '').trim() : 'Untitled Pitch';
}

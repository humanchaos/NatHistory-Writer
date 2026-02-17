/**
 * Text embedding client — proxied through /api/embed.
 * The API key never reaches the browser.
 */

/**
 * Embed a single text string. Returns a float array.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
    const res = await fetch('/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.embedding;
}

/**
 * Embed multiple text chunks sequentially with progress callback.
 * Each chunk is sent as a separate request to keep progress reporting accurate.
 * @param {string[]} texts
 * @param {function} [onProgress] — optional callback(current, total)
 * @returns {Promise<number[][]>}
 */
export async function embedBatch(texts, onProgress) {
    const embeddings = [];
    for (let i = 0; i < texts.length; i++) {
        const emb = await embedText(texts[i]);
        embeddings.push(emb);
        if (onProgress) onProgress(i + 1, texts.length);
        // Small delay to avoid rate limits
        if (i < texts.length - 1) {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    return embeddings;
}

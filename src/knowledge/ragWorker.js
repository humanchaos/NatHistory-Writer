/**
 * RAG Web Worker — offloads chunking + embedding to keep the main UI thread responsive.
 *
 * Messages IN:
 *   { type: 'process', text: string, isPdf?: boolean }
 *
 * Messages OUT:
 *   { type: 'progress', phase: string, current?: number, total?: number, pct: number }
 *   { type: 'done', chunks: string[], embeddings: number[][] }
 *   { type: 'error', message: string }
 */

// ── Inline chunker (cannot import ES modules in basic workers) ──────
function chunkText(text, chunkSize = 500, overlap = 80) {
    if (!text || text.length === 0) return [];
    const clean = text.replace(/\r\n/g, '\n').trim();
    if (clean.length <= chunkSize) return [clean];

    const chunks = [];
    let start = 0;

    while (start < clean.length) {
        let end = start + chunkSize;
        if (end < clean.length) {
            const paraBreak = clean.lastIndexOf('\n\n', end);
            if (paraBreak > start + chunkSize * 0.5) {
                end = paraBreak;
            } else {
                const sentenceBreak = clean.lastIndexOf('. ', end);
                if (sentenceBreak > start + chunkSize * 0.5) {
                    end = sentenceBreak + 1;
                }
            }
        }
        chunks.push(clean.slice(start, end).trim());
        start = end - overlap;
        if (start < 0) start = 0;
        if (start >= clean.length) break;
    }

    return chunks.filter((c) => c.length > 20);
}

// ── Embed via proxy ─────────────────────────────────────────────────
async function embedText(text) {
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

// ── Main handler ────────────────────────────────────────────────────
self.onmessage = async (e) => {
    const { type, text, isPdf } = e.data;

    if (type !== 'process') return;

    try {
        // Phase 1: Chunk
        const baseProgress = isPdf ? 40 : 0;
        self.postMessage({ type: 'progress', phase: 'Chunking…', pct: baseProgress });
        const chunks = chunkText(text);

        if (chunks.length === 0) {
            self.postMessage({ type: 'error', message: 'Content is empty or too short.' });
            return;
        }

        // Phase 2: Embed each chunk
        const embeddings = [];
        for (let i = 0; i < chunks.length; i++) {
            const emb = await embedText(chunks[i]);
            embeddings.push(emb);

            const pct = baseProgress + Math.round(((i + 1) / chunks.length) * (100 - baseProgress));
            self.postMessage({
                type: 'progress',
                phase: `Embedding… ${i + 1}/${chunks.length}`,
                current: i + 1,
                total: chunks.length,
                pct,
            });

            // Small delay to avoid rate limits
            if (i < chunks.length - 1) {
                await new Promise((r) => setTimeout(r, 100));
            }
        }

        self.postMessage({ type: 'done', chunks, embeddings });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    }
};

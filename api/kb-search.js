import { list } from '@vercel/blob';

/**
 * POST /api/kb-search
 * Body: { queryEmbedding: number[], topK?: number }
 * Returns: { results: Array<{ text, score, docId, filename }> }
 * No auth required — read-only.
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

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { queryEmbedding, topK = 5 } = req.body;

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
        return res.status(400).json({ error: 'Missing or invalid queryEmbedding' });
    }

    try {
        // Graceful fallback when Blob is not yet configured
        if (!process.env.BLOB_READ_WRITE_TOKEN) {
            return res.status(200).json({ results: [] });
        }

        const { blobs } = await list({ prefix: 'kb/' });

        if (blobs.length === 0) {
            return res.status(200).json({ results: [] });
        }

        // Fetch all documents and score their chunks
        const allChunks = [];

        await Promise.all(
            blobs.map(async (blob) => {
                try {
                    const r = await fetch(blob.url);
                    const doc = await r.json();
                    if (!doc.chunks || !doc.embeddings) return;

                    for (let i = 0; i < doc.chunks.length; i++) {
                        const score = cosineSimilarity(queryEmbedding, doc.embeddings[i]);
                        allChunks.push({
                            text: doc.chunks[i],
                            score,
                            docId: doc.id,
                            filename: doc.filename,
                        });
                    }
                } catch {
                    // Skip malformed blobs
                }
            })
        );

        allChunks.sort((a, b) => b.score - a.score);
        const results = allChunks.slice(0, topK);

        return res.status(200).json({ results });
    } catch (err) {
        console.error('[kb-search] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

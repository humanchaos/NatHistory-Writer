import { put } from '@vercel/blob';

const ADMIN_PASSWORD = process.env.KB_ADMIN_PASSWORD;

/**
 * POST /api/kb-upload
 * Body: { password, filename, chunks: string[], embeddings: number[][] }
 * Returns: { docId }
 * Requires KB_ADMIN_PASSWORD env var.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'KB_ADMIN_PASSWORD not configured on server' });
    }

    const { password, filename, chunks, embeddings } = req.body;

    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid admin password' });
    }

    if (!filename || !Array.isArray(chunks) || !Array.isArray(embeddings)) {
        return res.status(400).json({ error: 'Missing filename, chunks, or embeddings' });
    }

    if (chunks.length !== embeddings.length) {
        return res.status(400).json({ error: 'chunks and embeddings arrays must be the same length' });
    }

    const docId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const doc = {
        id: docId,
        filename,
        chunks,
        embeddings,
        addedAt: new Date().toISOString(),
    };

    try {
        await put(`kb/${docId}.json`, JSON.stringify(doc), {
            access: 'public',
            contentType: 'application/json',
        });

        return res.status(200).json({ docId, filename, chunkCount: chunks.length });
    } catch (err) {
        console.error('[kb-upload] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

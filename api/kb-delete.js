import { list, del } from '@vercel/blob';

const ADMIN_PASSWORD = process.env.KB_ADMIN_PASSWORD;

/**
 * DELETE /api/kb-delete
 * Body: { password, docId }
 * Returns: { ok: true }
 * Requires KB_ADMIN_PASSWORD env var.
 */
export default async function handler(req, res) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'KB_ADMIN_PASSWORD not configured on server' });
    }

    const { password, docId } = req.body;

    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid admin password' });
    }

    if (!docId) {
        return res.status(400).json({ error: 'Missing docId' });
    }

    try {
        // Find the blob URL for this docId
        const { blobs } = await list({ prefix: `kb/${docId}` });

        if (blobs.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        await del(blobs[0].url);

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[kb-delete] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

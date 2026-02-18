import { list } from '@vercel/blob';

/**
 * GET /api/kb-list
 * Returns metadata for all shared KB documents.
 * No auth required — read-only.
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Graceful fallback when Blob is not yet configured
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(200).json({ docs: [] });
    }

    try {
        const { blobs } = await list({ prefix: 'kb/' });

        // Each blob pathname is kb/{docId}.json
        // The metadata (filename, chunkCount, addedAt) is stored inside the JSON
        const docs = await Promise.all(
            blobs.map(async (blob) => {
                try {
                    const res2 = await fetch(blob.url);
                    const data = await res2.json();
                    return {
                        id: data.id,
                        filename: data.filename,
                        chunkCount: data.chunks?.length ?? 0,
                        addedAt: data.addedAt,
                        blobUrl: blob.url,
                    };
                } catch {
                    return null;
                }
            })
        );

        const valid = docs.filter(Boolean);
        valid.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

        return res.status(200).json({ docs: valid });
    } catch (err) {
        console.error('[kb-list] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

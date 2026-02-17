import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY;

/**
 * POST /api/embed
 * Body: { text } — single text string
 *   or: { texts } — array of text strings (batch)
 * Returns: { embedding } (single) or { embeddings } (batch)
 *
 * Proxies Gemini embedding calls so the API key stays server-side.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const { text, texts } = req.body;

    if (!text && (!texts || !Array.isArray(texts))) {
        return res.status(400).json({ error: 'Missing text or texts array' });
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

    try {
        if (texts && Array.isArray(texts)) {
            // Batch mode — embed each text sequentially
            const embeddings = [];
            for (const t of texts) {
                const result = await model.embedContent(t);
                embeddings.push(result.embedding.values);
            }
            return res.status(200).json({ embeddings });
        } else {
            // Single mode
            const result = await model.embedContent(text);
            return res.status(200).json({ embedding: result.embedding.values });
        }
    } catch (err) {
        console.error('Embed API error:', err.message);
        return res.status(502).json({ error: `Gemini API error: ${err.message}` });
    }
}

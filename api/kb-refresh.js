import { list, put, del } from '@vercel/blob';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sourcesConfig = require('./kb-sources.json');

const API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_PASSWORD = process.env.KB_ADMIN_PASSWORD;

/**
 * POST /api/kb-refresh
 * Body: { password, sourceIds?: string[] }
 *   - password: KB_ADMIN_PASSWORD
 *   - sourceIds: optional array of source IDs to refresh (omit = refresh all)
 * Returns: { results: Array<{ id, label, status, chunkCount?, error? }> }
 *
 * Fetches each curated industry source, extracts text via Gemini,
 * embeds it, and upserts to Vercel Blob (replacing any previous version).
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'KB_ADMIN_PASSWORD not configured on server' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not configured — add it in Vercel project settings and your local .env' });
    }

    const { password, sourceIds } = req.body;

    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid admin password' });
    }

    const genAI = new GoogleGenerativeAI(API_KEY);

    // Filter to requested sources (or all)
    const toRefresh = sourceIds?.length
        ? sourcesConfig.sources.filter(s => sourceIds.includes(s.id))
        : sourcesConfig.sources;

    const results = [];

    for (const source of toRefresh) {
        try {
            console.log(`[kb-refresh] Fetching: ${source.label}`);

            // ── Step 1: Extract text via Gemini ──────────────
            const extractModel = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                tools: [{ googleSearch: {} }],
            });

            const extractResult = await extractModel.generateContent(
                `Visit this URL and extract ALL substantive text content: ${source.url}

Your extraction target for this source:
${source.extractionTarget}

Signal keywords to prioritise: ${source.signalKeywords.join(', ')}

Output format:
- Start with: SOURCE: ${source.label}
- Then: CATEGORY: ${source.category}
- Then: FETCHED: ${new Date().toISOString()}
- Then: URL: ${source.url}
- Then a blank line
- Then ALL extracted content, preserving headlines, article summaries, names, dates, and key data points
- Flag any signal keywords found with [SIGNAL: keyword] inline
- Do NOT summarise — extract the actual content`
            );

            const rawText = (await extractResult.response).text();

            if (!rawText || rawText.trim().length < 100) {
                results.push({ id: source.id, label: source.label, status: 'skipped', reason: 'Insufficient content extracted' });
                continue;
            }

            // ── Step 2: Chunk the text ────────────────────────
            const chunks = chunkText(rawText, 800, 100);

            if (chunks.length === 0) {
                results.push({ id: source.id, label: source.label, status: 'skipped', reason: 'No chunks produced' });
                continue;
            }

            // ── Step 3: Embed all chunks ──────────────────────
            const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
            const embeddings = [];

            for (const chunk of chunks) {
                const embResult = await embeddingModel.embedContent(chunk);
                embeddings.push(embResult.embedding.values);
            }

            // ── Step 4: Delete old version if exists ──────────
            const blobPath = `${sourcesConfig.refreshConfig.blobPrefix}${source.id}.json`;
            try {
                const { blobs: existing } = await list({ prefix: blobPath });
                if (existing.length > 0) {
                    await del(existing[0].url);
                }
            } catch {
                // OK if nothing to delete
            }

            // ── Step 5: Upsert to Vercel Blob ─────────────────
            const doc = {
                id: `intel_${source.id}`,
                filename: `🌐 ${source.label}`,
                category: source.category,
                sourceUrl: source.url,
                chunks,
                embeddings,
                fetchedAt: new Date().toISOString(),
                addedAt: new Date().toISOString(),
                isIntelligence: true,
            };

            await put(blobPath, JSON.stringify(doc), {
                access: 'public',
                contentType: 'application/json',
            });

            results.push({
                id: source.id,
                label: source.label,
                status: 'ok',
                chunkCount: chunks.length,
                fetchedAt: doc.fetchedAt,
            });

            console.log(`[kb-refresh] ✓ ${source.label} — ${chunks.length} chunks`);

        } catch (err) {
            console.error(`[kb-refresh] ✗ ${source.label}:`, err.message);
            results.push({ id: source.id, label: source.label, status: 'error', error: err.message });
        }
    }

    return res.status(200).json({ results });
}

/**
 * Simple sliding-window text chunker.
 * @param {string} text
 * @param {number} chunkSize — words per chunk
 * @param {number} overlap — word overlap between chunks
 * @returns {string[]}
 */
function chunkText(text, chunkSize = 800, overlap = 100) {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let i = 0;

    while (i < words.length) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        if (chunk.trim().length > 50) {
            chunks.push(chunk);
        }
        i += chunkSize - overlap;
    }

    return chunks;
}

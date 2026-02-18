import { embedText } from './embeddings.js';
import { search, hasDocuments } from './vectorStore.js';
import { searchShared, hasSharedDocuments } from './sharedKB.js';

/**
 * Retrieve relevant knowledge context for a query.
 * Merges results from both the local (IndexedDB) and shared (Vercel Blob) knowledge bases,
 * re-ranks by score, and returns the top-K as a formatted string.
 *
 * @param {string} query — the context/question to search for
 * @param {number} topK — number of chunks to retrieve (total, across both sources)
 * @returns {Promise<string>}
 */
export async function retrieveContext(query, topK = 5) {
    const [hasLocal, hasShared] = await Promise.all([hasDocuments(), hasSharedDocuments()]);
    if (!hasLocal && !hasShared) return '';

    try {
        const queryEmbedding = await embedText(query);

        // Query both sources in parallel
        const [localResults, sharedResults] = await Promise.all([
            hasLocal ? search(queryEmbedding, topK) : [],
            hasShared ? searchShared(queryEmbedding, topK) : [],
        ]);

        // Tag source for logging, then merge and re-rank
        const tagged = [
            ...localResults.map(r => ({ ...r, source: 'local' })),
            ...sharedResults.map(r => ({ ...r, source: 'shared' })),
        ];

        tagged.sort((a, b) => b.score - a.score);
        const top = tagged.slice(0, topK);

        if (top.length > 0) {
            const localCount = top.filter(r => r.source === 'local').length;
            const sharedCount = top.filter(r => r.source === 'shared').length;
            console.log(`[RAG] Retrieved ${top.length} chunks (${localCount} local, ${sharedCount} shared)`);
        }

        // Filter by minimum relevance score
        const relevant = top.filter(r => r.score > 0.3);
        if (relevant.length === 0) return '';

        const contextBlocks = relevant.map(
            (r, i) => `[Source ${i + 1}] (relevance: ${(r.score * 100).toFixed(0)}%)${r.source === 'shared' ? ' 🌐' : ''}\n${r.text}`
        );

        return `### Relevant Research from Knowledge Base\n\n${contextBlocks.join('\n\n---\n\n')}`;
    } catch (err) {
        console.warn('RAG retrieval failed:', err.message);
        return '';
    }
}

/**
 * Retrieve narrative form signals from the knowledge base.
 * Uses a fixed, format-focused query — independent of seed topic — so that
 * commissioning trends, episode structures, and format preferences are ALWAYS
 * retrieved regardless of what the pitch is about.
 *
 * @param {number} topK — number of chunks to retrieve
 * @returns {Promise<string>}
 */
export async function retrieveNarrativeContext(topK = 6) {
    const hasShared = await hasSharedDocuments();
    if (!hasShared) return '';

    // Fixed narrative-form query — topic-agnostic, format-focused
    const NARRATIVE_QUERY = [
        'narrative form format series structure episode count commissioning preference',
        'limited series character-led observational presenter-led blue-chip authored immersive',
        'format trend greenlight deal flow what buyers want storytelling approach',
        'format fatigue narrative innovation co-production structure episode runtime',
    ].join(' ');

    try {
        const queryEmbedding = await embedText(NARRATIVE_QUERY);
        const results = await searchShared(queryEmbedding, topK);

        // Lower threshold for narrative signals — 0.2 — since format language
        // may not score as high as topically-matched content
        const relevant = results.filter(r => r.score > 0.2);
        if (relevant.length === 0) return '';

        console.log(`[RAG:narrative] Retrieved ${relevant.length} narrative-form signal chunks`);

        const contextBlocks = relevant.map(
            (r, i) => `[Signal ${i + 1}] (relevance: ${(r.score * 100).toFixed(0)}%) 🌐\n${r.text}`
        );

        return `### Live Industry Narrative Form Signals\n\n${contextBlocks.join('\n\n---\n\n')}`;
    } catch (err) {
        console.warn('RAG narrative retrieval failed:', err.message);
        return '';
    }
}

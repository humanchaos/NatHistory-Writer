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

import { embedText } from './embeddings.js';
import { search, hasDocuments } from './vectorStore.js';

/**
 * Retrieve relevant knowledge context for a query.
 * Returns a formatted string of relevant chunks, or empty string if no documents.
 *
 * @param {string} query — the context/question to search for
 * @param {number} topK — number of chunks to retrieve
 * @returns {Promise<string>}
 */
export async function retrieveContext(query, topK = 5) {
    const hasDocs = await hasDocuments();
    if (!hasDocs) return '';

    try {
        const queryEmbedding = await embedText(query);
        const results = await search(queryEmbedding, topK);

        if (results.length === 0) return '';

        // Filter by minimum relevance score
        const relevant = results.filter((r) => r.score > 0.3);
        if (relevant.length === 0) return '';

        const contextBlocks = relevant.map(
            (r, i) => `[Source ${i + 1}] (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.text}`
        );

        return `### Relevant Research from Knowledge Base\n\n${contextBlocks.join('\n\n---\n\n')}`;
    } catch (err) {
        console.warn('RAG retrieval failed:', err.message);
        return '';
    }
}

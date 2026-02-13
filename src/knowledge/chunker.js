/**
 * Split text into overlapping chunks for embedding.
 * @param {string} text — the full document text
 * @param {number} chunkSize — target characters per chunk
 * @param {number} overlap — overlap characters between chunks
 * @returns {string[]}
 */
export function chunkText(text, chunkSize = 500, overlap = 80) {
    if (!text || text.length === 0) return [];

    // Normalize whitespace
    const clean = text.replace(/\r\n/g, '\n').trim();

    if (clean.length <= chunkSize) return [clean];

    const chunks = [];
    let start = 0;

    while (start < clean.length) {
        let end = start + chunkSize;

        // Try to break at a paragraph or sentence boundary
        if (end < clean.length) {
            // Look for paragraph break first
            const paraBreak = clean.lastIndexOf('\n\n', end);
            if (paraBreak > start + chunkSize * 0.5) {
                end = paraBreak;
            } else {
                // Fall back to sentence boundary
                const sentenceBreak = clean.lastIndexOf('. ', end);
                if (sentenceBreak > start + chunkSize * 0.5) {
                    end = sentenceBreak + 1;
                }
            }
        }

        chunks.push(clean.slice(start, end).trim());
        start = end - overlap;
        if (start < 0) start = 0;
        // Avoid infinite loop on tiny overlap
        if (start >= clean.length) break;
    }

    return chunks.filter((c) => c.length > 20); // drop tiny fragments
}

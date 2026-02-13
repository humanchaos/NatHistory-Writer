import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

let embeddingModel = null;

function getModel() {
    if (!embeddingModel) {
        const genAI = new GoogleGenerativeAI(API_KEY);
        embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    }
    return embeddingModel;
}

/**
 * Embed a single text string. Returns a float array.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
    const model = getModel();
    const result = await model.embedContent(text);
    return result.embedding.values;
}

/**
 * Embed multiple text chunks in batch (sequential to respect rate limits).
 * @param {string[]} texts
 * @param {function} [onProgress] — optional callback(current, total)
 * @returns {Promise<number[][]>}
 */
export async function embedBatch(texts, onProgress) {
    const embeddings = [];
    for (let i = 0; i < texts.length; i++) {
        const emb = await embedText(texts[i]);
        embeddings.push(emb);
        if (onProgress) onProgress(i + 1, texts.length);
        // Small delay to avoid rate limits
        if (i < texts.length - 1) {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    return embeddings;
}

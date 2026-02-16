import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

let genAI = null;

/**
 * Initialize the Gemini client. Call once at startup.
 */
export function initGemini() {
    if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE') {
        throw new Error('MISSING_API_KEY');
    }
    genAI = new GoogleGenerativeAI(API_KEY);
}

/**
 * Call an agent with the given system prompt and user message.
 * Creates a fresh model instance per call with the system instruction baked in.
 * Optionally accepts tools (e.g. Google Search grounding).
 * Returns the response text.
 */
export async function callAgent(systemPrompt, userMessage, { retries = 2, tools = [], signal } = {}) {
    if (!genAI) initGemini();

    const modelConfig = {
        model: 'gemini-2.0-flash',
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    if (tools.length > 0) {
        modelConfig.tools = tools;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) throw new DOMException('Agent call aborted', 'AbortError');
        try {
            const model = genAI.getGenerativeModel(modelConfig);

            const result = await model.generateContent(userMessage);
            if (signal?.aborted) throw new DOMException('Agent call aborted', 'AbortError');
            const response = await result.response;
            return response.text();
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            console.warn(`Agent call attempt ${attempt + 1} failed:`, err.message);
            if (attempt === retries) throw err;
            // Exponential backoff
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
    }
}

/**
 * Create a multi-turn chat session with a system prompt.
 * Optionally accepts tools (e.g. Google Search grounding).
 * Returns an object with send(message) → Promise<string>.
 */
export function createChat(systemPrompt, { tools = [] } = {}) {
    if (!genAI) initGemini();

    const modelConfig = {
        model: 'gemini-2.0-flash',
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    if (tools.length > 0) {
        modelConfig.tools = tools;
    }

    const model = genAI.getGenerativeModel(modelConfig);
    const chat = model.startChat();

    return {
        async send(message) {
            const result = await chat.sendMessage(message);
            const response = await result.response;
            return response.text();
        },
    };
}

/**
 * Extract text content from a PDF via Gemini multimodal.
 * @param {string} base64Data — base64-encoded PDF bytes
 * @returns {Promise<string>} — extracted text
 */
export async function extractPdfText(base64Data) {
    if (!genAI) initGemini();

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
        {
            inlineData: {
                mimeType: 'application/pdf',
                data: base64Data,
            },
        },
        { text: 'Extract ALL text content from this PDF document. Preserve the structure (headings, paragraphs, lists, tables). Output ONLY the extracted text — no commentary, no summary, no analysis. If the PDF contains images with text, OCR them.' },
    ]);

    return (await result.response).text();
}

/**
 * Extract text content from a URL via Gemini + Google Search grounding.
 * @param {string} url — the URL to read
 * @returns {Promise<string>} — extracted text
 */
export async function extractUrlContent(url) {
    if (!genAI) initGemini();

    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        tools: [{ googleSearch: {} }],
    });

    const result = await model.generateContent(
        `Read the full content of this web page and extract ALL text: ${url}\n\nOutput ONLY the extracted text content — preserve headings, paragraphs, lists, and key data. Do NOT summarize or analyze. Include all substantive text visible on the page.`
    );

    return (await result.response).text();
}

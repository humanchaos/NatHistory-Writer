/**
 * Gemini API client — proxied through Vercel serverless functions.
 *
 * All calls route through /api/* so the API key never reaches the browser.
 * In dev mode (Vite), requests are proxied to `vercel dev` via vite.config.js.
 */

/**
 * Initialize the Gemini client. Now a no-op — kept for backward compatibility
 * so callers that used to call initGemini() don't break.
 */
export function initGemini() {
    // No-op: the API key lives server-side now.
    // We keep this function so main.js doesn't need to remove its try/catch.
}

/**
 * Call an agent with the given system prompt and user message.
 * Routes through /api/generate.
 * Optionally accepts tools (e.g. Google Search grounding).
 * Returns the response text.
 */
export async function callAgent(systemPrompt, userMessage, { retries = 2, tools = [], signal } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) throw new DOMException('Agent call aborted', 'AbortError');
        try {
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ systemPrompt, userMessage, tools }),
                signal,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            return data.text;
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
 * Stateless: accumulates history client-side and sends it with each turn
 * via /api/generate (Vercel serverless functions are stateless).
 * Returns an object with send(message) → Promise<string>.
 */
export function createChat(systemPrompt, { tools = [] } = {}) {
    // Accumulate conversation history for multi-turn
    const history = [];

    return {
        async send(message) {
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemPrompt,
                    userMessage: message,
                    tools,
                    history,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const data = await res.json();

            // Append to history for next turn
            history.push(
                { role: 'user', parts: [{ text: message }] },
                { role: 'model', parts: [{ text: data.text }] }
            );

            return data.text;
        },
    };
}

/**
 * Extract text content from a PDF via the server-side proxy.
 * @param {string} base64Data — base64-encoded PDF bytes
 * @returns {Promise<string>} — extracted text
 */
export async function extractPdfText(base64Data) {
    const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'pdf', data: base64Data }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.text;
}

/**
 * Extract text content from a URL via the server-side proxy.
 * @param {string} url — the URL to read
 * @returns {Promise<string>} — extracted text
 */
export async function extractUrlContent(url) {
    const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', data: url }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.text;
}

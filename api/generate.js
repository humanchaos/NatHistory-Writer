import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY;

/**
 * POST /api/generate
 * Body: { systemPrompt, userMessage, tools?, history? }
 * Returns: { text }
 *
 * Proxies Gemini generateContent calls so the API key stays server-side.
 * Also handles multi-turn chat by accepting a history array.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const { systemPrompt, userMessage, tools = [], history = [] } = req.body;

    if (!systemPrompt || !userMessage) {
        return res.status(400).json({ error: 'Missing systemPrompt or userMessage' });
    }

    const genAI = new GoogleGenerativeAI(API_KEY);

    const modelConfig = {
        model: 'gemini-2.0-flash',
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    if (tools.length > 0) {
        modelConfig.tools = tools;
    }

    try {
        const model = genAI.getGenerativeModel(modelConfig);

        let text;

        if (history.length > 0) {
            // Multi-turn: replay conversation history then send new message
            const chat = model.startChat({ history });
            const result = await chat.sendMessage(userMessage);
            text = (await result.response).text();
        } else {
            // Single-turn
            const result = await model.generateContent(userMessage);
            text = (await result.response).text();
        }

        return res.status(200).json({ text });
    } catch (err) {
        console.error('Generate API error:', err.message);
        return res.status(502).json({ error: `Gemini API error: ${err.message}` });
    }
}

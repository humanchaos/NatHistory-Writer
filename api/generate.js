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

    const { systemPrompt, userMessage, tools = [], history = [], responseFormat } = req.body;

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

    if (responseFormat === 'json') {
        modelConfig.generationConfig = { responseMimeType: 'application/json' };
    }

    try {
        const model = genAI.getGenerativeModel(modelConfig);

        let result;

        if (history.length > 0) {
            // Multi-turn: replay conversation history then send new message
            const chat = model.startChat({ history });
            result = await chat.sendMessage(userMessage);
        } else {
            // Single-turn
            result = await model.generateContent(userMessage);
        }

        let response = await result.response;
        let callCount = 0;

        // Proper Tool Execution Loop (Fix 1)
        // If the model asks to execute a function, we must either execute it or return a fallback.
        // Google Search is native and typically doesn't trigger this, but custom tools will.
        while (response.functionCalls && response.functionCalls().length > 0 && callCount < 5) {
            callCount++;
            const calls = response.functionCalls();
            const functionResponses = [];

            for (const call of calls) {
                console.warn(`[Gemini API] Received unhandled function call: ${call.name}`);
                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: { error: `Server has no execution logic registered for '${call.name}'` }
                    }
                });
            }

            // Return the function responses to the model to continue generation
            if (history.length > 0) {
                const chat = model.startChat({ history: [...history, { role: 'model', parts: response.candidates[0].content.parts }] });
                result = await chat.sendMessage(functionResponses);
            } else {
                result = await model.generateContent([
                    { role: "user", parts: [{ text: userMessage }] },
                    { role: "model", parts: response.candidates[0].content.parts },
                    { role: "user", parts: functionResponses }
                ]);
            }
            response = await result.response;
        }

        const text = response.text();
        return res.status(200).json({ text });
    } catch (err) {
        console.error('Generate API error:', err.message);
        return res.status(502).json({ error: `Gemini API error: ${err.message}` });
    }
}

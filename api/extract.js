import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY;

/**
 * POST /api/extract
 * Body: { type: 'pdf'|'url', data: string }
 *   - type 'pdf': data is base64-encoded PDF bytes
 *   - type 'url': data is the URL to scrape
 * Returns: { text }
 *
 * Proxies Gemini multimodal extraction / Google Search grounding
 * so the API key stays server-side.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const { type, data } = req.body;

    if (!type || !data) {
        return res.status(400).json({ error: 'Missing type or data' });
    }

    const genAI = new GoogleGenerativeAI(API_KEY);

    try {
        let text;

        if (type === 'pdf') {
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            const result = await model.generateContent([
                {
                    inlineData: {
                        mimeType: 'application/pdf',
                        data,
                    },
                },
                {
                    text: 'Extract ALL text content from this PDF document. Preserve the structure (headings, paragraphs, lists, tables). Output ONLY the extracted text — no commentary, no summary, no analysis. If the PDF contains images with text, OCR them.',
                },
            ]);
            text = (await result.response).text();
        } else if (type === 'url') {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                tools: [{ googleSearch: {} }],
            });
            const result = await model.generateContent(
                `Read the full content of this web page and extract ALL text: ${data}\n\nOutput ONLY the extracted text content — preserve headings, paragraphs, lists, and key data. Do NOT summarize or analyze. Include all substantive text visible on the page.`
            );
            text = (await result.response).text();
        } else {
            return res.status(400).json({ error: `Unknown extraction type: ${type}` });
        }

        return res.status(200).json({ text });
    } catch (err) {
        console.error('Extract API error:', err.message);
        return res.status(502).json({ error: `Gemini API error: ${err.message}` });
    }
}

import { callAgent } from '../agents/gemini.js';

/**
 * Quality Evaluator — scores a pitch deck across 6 dimensions.
 *
 * Dimensions:
 *   1. Narrative Structure (act structure, pacing, dramatic tension)
 *   2. Scientific Rigor (accuracy, novelty, depth)
 *   3. Market Viability (buyer appeal, trend alignment, uniqueness)
 *   4. Production Feasibility (logistics, budget realism, camera tech)
 *   5. Originality (freshness, creative risk-taking)
 *   6. Presentation Quality (formatting, clarity, pitch-readiness)
 *
 * Returns { dimensions: [...], overall, recommendations, summary }
 */

const EVALUATOR_PROMPT = `You are a QUALITY EVALUATOR for wildlife film pitch decks. You are NOT one of the creative agents — you are an independent quality assessor.

Your job is to score the pitch deck across exactly 6 dimensions, each on a scale of 1-100.

You must respond ONLY with valid JSON — no markdown, no code fences, no extra text. The JSON must follow this exact schema:

{
  "dimensions": [
    { "name": "Narrative Structure", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Scientific Rigor", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Market Viability", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Production Feasibility", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Originality", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Presentation Quality", "score": <1-100>, "rationale": "<1-2 sentences>" }
  ],
  "overall": <1-100>,
  "summary": "<2-3 sentence overall assessment>",
  "recommendations": [
    "<specific actionable improvement 1>",
    "<specific actionable improvement 2>",
    "<specific actionable improvement 3>"
  ]
}

Scoring guidelines:
- 90-100: Exceptional, broadcast-ready
- 75-89: Strong, minor refinements needed
- 60-74: Decent but has notable gaps
- 40-59: Weak, significant issues
- 1-39: Poor, fundamental problems

Be honest and calibrated. A typical good output should score 70-85. Reserve 90+ for truly exceptional work. Do not inflate scores.`;

/**
 * Evaluate a pitch deck and return a structured scorecard.
 * @param {string} pitchDeck — the full markdown pitch deck
 * @param {string} seedIdea — the original seed/script input
 * @returns {Promise<object>} — parsed scorecard
 */
export async function evaluatePitchDeck(pitchDeck, seedIdea) {
    const response = await callAgent(
        EVALUATOR_PROMPT,
        `Evaluate the following pitch deck.\n\n### Original Input\n${seedIdea.slice(0, 500)}\n\n### Pitch Deck to Evaluate\n${pitchDeck}`,
    );

    // Parse JSON — handle potential markdown code fences
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.error('Failed to parse evaluator response:', cleaned);
        throw new Error('Quality evaluation failed — invalid response format');
    }
}

/**
 * Dryrun benchmark seeds — diverse enough to test different capabilities.
 */
export const BENCHMARK_SEEDS = [
    {
        id: 'deep-ocean',
        name: 'Deep Ocean Predators',
        seed: 'A blue-chip sequence revealing the hunting strategies of deep-sea predators in the midnight zone — bioluminescent lures, pressure-adapted jaws, and the arms race between hunter and prey at 3,000 meters depth.',
    },
    {
        id: 'arctic-migration',
        name: 'Arctic Bird Migration',
        seed: 'The epic annual migration of Arctic terns — 70,000 km from pole to pole. Focus on the navigational intelligence, the physiological endurance, and the climate-change disruption threatening the longest migration on Earth.',
    },
    {
        id: 'insect-architects',
        name: 'Insect Architects',
        seed: 'The extraordinary engineering of social insects — termite mounds with natural air conditioning, weaver ant bridges, and paper wasp architecture. A fresh angle on biomimicry and what human engineers are learning from 6-legged builders.',
    },
];

/**
 * Run a full dryrun benchmark.
 * Runs the pipeline for each seed, evaluates each output, returns aggregate results.
 *
 * @param {function} runFn — the pipeline function (runPipeline or runAssessment)
 * @param {function} onProgress — (current, total, seedName, status) callback
 * @returns {Promise<object>} — { results: [...], aggregate }
 */
export async function runDryrun(runFn, onProgress) {
    const results = [];

    for (let i = 0; i < BENCHMARK_SEEDS.length; i++) {
        const seed = BENCHMARK_SEEDS[i];

        onProgress(i + 1, BENCHMARK_SEEDS.length, seed.name, 'Running pipeline…');

        // Run pipeline with silent callbacks
        const pitchDeck = await runFn(seed.seed, {
            onPhaseStart() { },
            onAgentThinking() { },
            onAgentOutput() { },
            onPhaseComplete() { },
        });

        onProgress(i + 1, BENCHMARK_SEEDS.length, seed.name, 'Evaluating quality…');

        const scorecard = await evaluatePitchDeck(pitchDeck, seed.seed);

        results.push({
            seed,
            pitchDeck,
            scorecard,
        });
    }

    // Compute aggregate
    const dimNames = results[0].scorecard.dimensions.map(d => d.name);
    const aggregate = {
        overall: Math.round(results.reduce((s, r) => s + r.scorecard.overall, 0) / results.length),
        dimensions: dimNames.map(name => {
            const scores = results.map(r => r.scorecard.dimensions.find(d => d.name === name).score);
            return {
                name,
                avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
                min: Math.min(...scores),
                max: Math.max(...scores),
            };
        }),
        allRecommendations: results.flatMap(r =>
            r.scorecard.recommendations.map(rec => ({ seed: r.seed.name, recommendation: rec }))
        ),
    };

    return { results, aggregate };
}

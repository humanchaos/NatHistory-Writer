import { callAgent } from './gemini.js';
import {
    MARKET_ANALYST,
    CHIEF_SCIENTIST,
    FIELD_PRODUCER,
    STORY_PRODUCER,
    COMMISSIONING_EDITOR,
    SHOWRUNNER,
    ADVERSARY,
    DISCOVERY_SCOUT,
    DRIFT_GATE,
    GENRE_STRATEGIST,
    ALL_AGENTS,
} from './personas.js';
import { retrieveContext, retrieveNarrativeContext } from '../knowledge/rag.js';
import { saveCheckpoint, clearCheckpoint } from '../pipelineState.js';
import { PROVOCATEUR, rollMutations, applyMutations, generateAccident, CHAOS_MODES } from './chaos.js';
import { validateSources } from './urlValidator.js';
export { CHAOS_MODES };

/**
 * Step ordering for the seed pipeline — used for checkpoint resume.
 * Each entry corresponds to a ctx key set by an agentStep.
 */
const PIPELINE_STEPS = [
    'discovery',
    'marketMandate',
    'animalFactSheet',
    'logisticsBreakdown',
    'draftV1',
    'provocation',
    'rejectionMemo',
    'revisionDirectives',
    'revisedScience',
    'revisedLogistics',
    'draftV2',
    'greenlightReview',
    'finalPitchDeck',
    'gatekeeperVerdict',
];

/**
 * Custom error for pipeline cancellation.
 */
export class PipelineCancelled extends Error {
    constructor() { super('Pipeline cancelled by user'); this.name = 'PipelineCancelled'; }
}

// Shared abort controller — set by the UI, checked by agentStep
let _abortSignal = null;

/**
 * Set the AbortSignal that the pipeline should respect.
 * Call with null to clear.
 */
export function setPipelineAbortSignal(signal) {
    _abortSignal = signal;
}

/**
 * Helper: show a thinking card, call the agent, then fill the card.
 * Checks the abort signal before making the API call.
 * Optionally accepts agentOpts.tools for Gemini tool use (e.g. Google Search).
 */
async function agentStep(agent, prompt, { onAgentThinking, onAgentOutput }, agentOpts = {}) {
    if (_abortSignal?.aborted) throw new PipelineCancelled();
    onAgentThinking(agent);

    // Resolve functional system prompts
    const docMode = agentOpts.docMode || 'wildlife';
    const systemPromptText = typeof agent.systemPrompt === 'function' ? agent.systemPrompt(docMode) : agent.systemPrompt;

    const result = await callAgent(systemPromptText, prompt, agentOpts);
    if (_abortSignal?.aborted) throw new PipelineCancelled();
    onAgentOutput(agent, result);
    return result;
}

// MAX_REVISIONS now comes from opts.maxRevisions (default 3)

/**
 * Detect if an agent output contains a ⛔ REJECTION signal.
 * Returns { rejected: boolean, type: string|null }
 */
function detectRejection(agentOutput) {
    const text = agentOutput.toUpperCase();
    if (text.includes('⛔ SCIENTIFIC REJECTION') || text.includes('SCIENTIFIC REJECTION')) {
        return { rejected: true, type: 'SCIENTIFIC' };
    }
    if (text.includes('⛔ ETHICAL REJECTION') || text.includes('ETHICAL REJECTION')) {
        return { rejected: true, type: 'ETHICAL' };
    }
    if (text.includes('PIPELINE HALT RECOMMENDED')) {
        return { rejected: true, type: 'GENERAL' };
    }
    return { rejected: false, type: null };
}

/**
 * PATCH 4: Fail-fast severity classifier.
 * Regex-based (no LLM call). Checks whether a rejection is CATASTROPHIC
 * (biologically impossible / fundamentally unethical → kill immediately)
 * or RECOVERABLE (factual error / proportionality issue → ≤3 pivots).
 */
function classifySeverity(agentOutput, rejectionType) {
    const upper = agentOutput.toUpperCase();

    // ── CATASTROPHIC patterns (immediate kill) ──
    const catastrophicPatterns = rejectionType === 'SCIENTIFIC'
        ? [
            /BIOLOGICALLY IMPOSSIBLE/i,
            /FUNDAMENTALLY (?:FLAWED|IMPOSSIBLE|WRONG)/i,
            /NO SCIENTIFIC BASIS/i,
            /VIOLATES (?:BASIC|FUNDAMENTAL) (?:BIOLOGY|PHYSICS|ECOLOGY)/i,
            /SPECIES (?:DOES NOT|DOESN'T|CANNOT) EXIST/i,
            /ENTIRELY FABRICATED/i,
        ]
        : [ // ETHICAL
            /ENTIRE CONCEPT REQUIRES UNETHICAL/i,
            /FUNDAMENTALLY (?:UNETHICAL|INHUMANE)/i,
            /NO ETHICAL (?:ALTERNATIVE|WAY|METHOD)/i,
            /INHERENTLY (?:CRUEL|HARMFUL|EXPLOITATIVE)/i,
            /CANNOT BE FILMED (?:ETHICALLY|WITHOUT HARM)/i,
            /ANIMAL (?:CRUELTY|ABUSE) REQUIRED/i,
        ];

    for (const pat of catastrophicPatterns) {
        if (pat.test(agentOutput)) {
            return 'CATASTROPHIC';
        }
    }

    return 'RECOVERABLE';
}

/**
 * PATCH 3: Defamation Guard — rule-based classification.
 * Scans agent output for real-person references combined with fictional negativity.
 * Returns: 'SAFE' | 'WARNING' | 'CRITICAL'
 *  - SAFE: No real-person + negative fiction patterns found.
 *  - WARNING: Real person mentioned in a potentially negative fictional context (review recommended).
 *  - CRITICAL: Real person clearly attributed fictional scandal/harm/disgrace.
 */
function classifyDefamation(text) {
    // Real-person indicators (named individuals with titles/honorifics)
    const realPersonPatterns = [
        /(?:Sir |Dame |Dr\.? |Prof\.? |President |Director )[A-Z][a-z]+ [A-Z][a-z]+/g,
        /David Attenborough/gi,
        /Steve Irwin/gi,
        /Jane Goodall/gi,
    ];

    // Fictional negativity patterns (things you should NOT attribute to real people)
    const fictionalScandalPatterns = [
        /\b(?:disgraced?|scandal|controversy|accused|convicted|arrested|fired|sacked|exposed|downfall)\b/gi,
        /\b(?:secretly|alleged|rumored|cover[- ]?up|corruption|fraud|malpractice)\b/gi,
        /\b(?:fictitious|fictional|imaginar(?:y|ily)|invented|fabricated)\s+(?:scandal|controversy|crime|incident)/gi,
    ];

    let hasRealPerson = false;
    let hasNegativeFiction = false;
    let criticalMatch = false;

    for (const pat of realPersonPatterns) {
        if (pat.test(text)) {
            hasRealPerson = true;
            break;
        }
    }

    if (!hasRealPerson) return 'SAFE';

    for (const pat of fictionalScandalPatterns) {
        if (pat.test(text)) {
            hasNegativeFiction = true;
            // Check for explicit fictional attribution to a real person
            // e.g., "David Attenborough was disgraced" or "Sir David... scandal"
            const sentences = text.split(/[.!?]+/);
            for (const sentence of sentences) {
                const hasName = realPersonPatterns.some(p => p.test(sentence));
                const hasBad = fictionalScandalPatterns.some(p => p.test(sentence));
                // Reset regex lastIndex
                realPersonPatterns.forEach(p => p.lastIndex = 0);
                fictionalScandalPatterns.forEach(p => p.lastIndex = 0);
                if (hasName && hasBad) {
                    criticalMatch = true;
                    break;
                }
            }
            break;
        }
    }

    // Reset all regex lastIndex values
    realPersonPatterns.forEach(p => p.lastIndex = 0);
    fictionalScandalPatterns.forEach(p => p.lastIndex = 0);

    if (criticalMatch) return 'CRITICAL';
    if (hasNegativeFiction) return 'WARNING';
    return 'SAFE';
}

/**
 * Extract a numeric score from agent output (e.g., "Score: 72/100" or "Greenlight Score: 85/100").
 * Returns the score as a number, or null if not found.
 */
function extractScore(agentOutput) {
    const patterns = [
        /Score:\s*(\d{1,3})\s*\/\s*100/i,
        /Greenlight\s*Score:\s*(\d{1,3})\s*\/\s*100/i,
        /(\d{1,3})\s*\/\s*100/,
    ];
    for (const pattern of patterns) {
        const match = agentOutput.match(pattern);
        if (match) return parseInt(match[1], 10);
    }
    return null;
}

/**
 * Run the full 6-phase multi-agent pipeline.
 *
 * @param {string} seedIdea — the user's seed idea
 * @param {object} cbs
 * @param {function} cbs.onPhaseStart — (phaseNumber, phaseName)
 * @param {function} cbs.onAgentThinking — (agent) — fired BEFORE the API call
 * @param {function} cbs.onAgentOutput — (agent, outputText) — fired AFTER the API call
 * @param {function} cbs.onPhaseComplete — (phaseNumber)
 * @param {object} [opts] — optional overrides
 * @param {string|null} [opts.platform] — target platform (e.g., 'Netflix')
 * @param {number|null} [opts.year] — target delivery year (when the show airs/streams)
 * @returns {Promise<string>} — the final Master Pitch Deck
 */

// ═══════════════════════════════════════════════════════
// HANDS-FREE MODE: Genre Suggestion
// ═══════════════════════════════════════════════════════

/**
 * Suggest 3 genre lenses for a seed idea using the Genre Strategist agent.
 * Pulls RAG context from the knowledge base and uses Google Search grounding.
 *
 * @param {string} seedIdea — the user's seed idea
 * @returns {Promise<Array<{genreKey: string, genreName: string, rationale: string}>>}
 */
export async function suggestGenres(seedIdea, opts = {}) {
    const docMode = opts.docMode || 'wildlife';

    // 1. Retrieve knowledge base context (topic + narrative form signals in parallel)
    let knowledgeContext = '';
    let narrativeContext = '';
    try {
        [knowledgeContext, narrativeContext] = await Promise.all([
            retrieveContext(seedIdea, 3, docMode),
            retrieveNarrativeContext(3, docMode),
        ]);
    } catch (e) {
        console.warn('Knowledge retrieval skipped for genre suggestion:', e.message);
    }
    const kbBlock = knowledgeContext
        ? `\n\nThe user has uploaded the following research/reports to the knowledge base. Use these signals to inform your genre recommendations:\n\n${knowledgeContext}\n\n`
        : '';
    const narrativeKbBlock = narrativeContext
        ? `\n\n${narrativeContext}\n\nUse these live industry signals to inform which narrative forms are currently in demand, gaining momentum, or experiencing fatigue.\n\n`
        : '';

    const prompt = `Analyze this seed idea and recommend 3 maximally different genre lenses from the genre menu:\n\n"${seedIdea}"${kbBlock}${narrativeKbBlock}\n\nReturn ONLY the JSON array — no markdown fences, no explanation.`;

    // Helper: extract and validate a JSON array of genre objects from raw text
    const extractGenres = (raw) => {
        if (!raw || typeof raw !== 'string') return null;

        const tryParse = (text) => {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 5 &&
                    parsed.every(g => g.genreKey && g.genreName && g.rationale)) {
                    return parsed.slice(0, 3);
                }
            } catch (_) { }
            return null;
        };

        // Strategy A: Strip markdown fences
        const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        let result = tryParse(cleaned);
        if (result) return result;

        // Strategy B: Regex-extract the first [...] JSON array
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            result = tryParse(arrayMatch[0]);
            if (result) return result;

            // Strategy C: Fix trailing commas
            const fixed = arrayMatch[0].replace(/,\s*([\]}])/g, '$1');
            result = tryParse(fixed);
            if (result) return result;
        }

        return null;
    };

    // 2. Attempt 1: Call with Google Search grounding
    try {
        const systemPromptToUse = typeof GENRE_STRATEGIST.systemPrompt === 'function' ? GENRE_STRATEGIST.systemPrompt(docMode) : GENRE_STRATEGIST.systemPrompt;
        const raw = await callAgent(
            systemPromptToUse,
            prompt,
            { tools: [{ googleSearch: {} }] }
        );
        const genres = extractGenres(raw);
        if (genres) return genres;
        console.warn('Genre Strategist (grounded) returned unparseable response:', raw?.substring(0, 300));
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn('Genre Strategist (grounded) call failed:', err.message);
    }

    // 3. Attempt 2: Retry WITHOUT Google Search (plain LLM call — more reliable JSON output)
    try {
        const systemPromptToUse = typeof GENRE_STRATEGIST.systemPrompt === 'function' ? GENRE_STRATEGIST.systemPrompt(docMode) : GENRE_STRATEGIST.systemPrompt;
        const raw = await callAgent(
            systemPromptToUse,
            prompt,
            { tools: [] }
        );
        const genres = extractGenres(raw);
        if (genres) return genres;
        console.warn('Genre Strategist (plain) returned unparseable response:', raw?.substring(0, 300));
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn('Genre Strategist (plain) call failed:', err.message);
    }

    // 4. All attempts failed — return marked fallbacks
    console.warn('Genre suggestion failed after all attempts. Using default lenses.');
    return [
        { genreKey: 'blue-chip-2', genreName: 'Blue Chip 2.0', rationale: 'Classic prestige format — a strong baseline for any wildlife subject.', _isFallback: true },
        { genreKey: 'scientific-procedural', genreName: 'Scientific Procedural', rationale: 'Technology-driven investigation angle — adds novelty and commercial appeal.', _isFallback: true },
        { genreKey: 'ecological-biography', genreName: 'Ecological Biography', rationale: 'Character-driven deep-time format — emotional resonance through a single organism\'s story.', _isFallback: true },
    ];
}

export async function runPipeline(seedIdea, cbs, opts = {}) {
    const { platform = null, year = null, directive = null, checkpoint = null, maxRevisions = 3, genrePreference = null, chaosMode = 'precision', grandNarrativeMode = false, docMode = 'wildlife' } = opts;

    // ─── DOC MODE TERMINOLOGY ─────────────────────────────────
    // Dynamic labels used throughout agent prompts to avoid hardcoded wildlife language
    const isFactual = docMode === 'factual';
    const factSheetLabel = isFactual ? 'Research Fact Sheet' : 'Animal Fact Sheet';
    const scientistInstruction = isFactual
        ? 'Based on this, conduct deep research with verified sources. You MUST include: the primary subject with historical/scientific context and key claims, a mandatory B-Story secondary angle, exact locations/time periods, ethical considerations, and the visual payoff. Output your full Research Fact Sheet.'
        : 'Based on this, propose novel animal behaviors with peer-reviewed citations. You MUST include: the primary species with scientific name and biological mechanism, a mandatory B-Story backup species, exact location/seasonality, ethical considerations, and the visual payoff. Output your full Animal Fact Sheet.';
    const producerParallelNote = isFactual
        ? 'You are running IN PARALLEL with the Chief Investigator — you do not yet have their Research Fact Sheet. Assess production feasibility based on the seed idea and the Market Mandate. Focus on the subject, locations, and access described in the seed text. If specific details are ambiguous, make reasonable production assumptions and flag them.'
        : 'You are running IN PARALLEL with the Chief Scientist — you do not yet have their Animal Fact Sheet. Assess production feasibility based on the seed idea and the Market Mandate. Focus on the species, location, and behavior described in the seed text. If specific scientific details are ambiguous, make reasonable production assumptions and flag them.';
    const producerSoloNote = isFactual
        ? `Here is the Research Fact Sheet from the Chief Investigator:\n\n`
        : `Here is the Animal Fact Sheet from the Chief Scientist:\n\n`;
    const docTypeLabel = isFactual ? 'factual documentary' : 'wildlife documentary';

    // ─── Resume support: hydrate ctx from checkpoint and determine resume point ──
    const ctx = checkpoint?.ctx ? { ...checkpoint.ctx, seedIdea } : { seedIdea };
    const resumeAfter = checkpoint?.step || null;
    const shouldSkip = (step) => {
        if (!resumeAfter) return false;
        const resumeIdx = PIPELINE_STEPS.indexOf(resumeAfter);
        const stepIdx = PIPELINE_STEPS.indexOf(step);
        return stepIdx >= 0 && stepIdx <= resumeIdx;
    };

    // Helper: save checkpoint after each major step (fire-and-forget)
    const checkpoint_ = (step, phase) => {
        saveCheckpoint({
            seedIdea,
            platform,
            year,
            directive,
            genrePreference,
            phase,
            step,
            ctx: { ...ctx },
            startedAt: checkpoint?.startedAt,
        });
    };

    // ─── CHAOS ENGINE: Mutation Setup ─────────────────────────
    const chaosConfig = CHAOS_MODES[chaosMode] || CHAOS_MODES.precision;
    let activeMutations = [];
    let promptOverrides = new Map();

    if (chaosConfig.mutations > 0) {
        activeMutations = rollMutations(chaosConfig.mutations);
        promptOverrides = applyMutations(activeMutations, ALL_AGENTS);

        // Chaos only affects creative agents — research agents always deliver unbiased work
        const RESEARCH_AGENT_IDS = new Set(['discovery-scout', 'market-analyst', 'chief-scientist', 'field-producer']);
        for (const id of RESEARCH_AGENT_IDS) promptOverrides.delete(id);
        activeMutations = activeMutations.filter(m => !RESEARCH_AGENT_IDS.has(m.targetAgentId));

        // Log mutations for UI display
        if (cbs.onChaosEvent) {
            for (const m of activeMutations) {
                const targetAgent = ALL_AGENTS.find(a => a.id === m.targetAgentId);
                cbs.onChaosEvent('mutation', {
                    mutation: m.mutation,
                    targetAgent: targetAgent?.name || m.targetAgentId,
                });
            }
        }
    }

    // ─── CHAOS ENGINE: Mutated agent caller ───────────────────
    // Wraps the standard agentStep to inject mutation prompts
    async function mutatedAgentStep(agent, prompt, callbacks, agentOpts = {}) {
        const override = promptOverrides.get(agent.id);
        const resolvedPrompt = typeof agent.systemPrompt === 'function' ? agent.systemPrompt(docMode) : agent.systemPrompt;
        
        if (override) {
            const mutatedAgent = { ...agent, systemPrompt: override };
            return agentStep(mutatedAgent, prompt, callbacks, agentOpts);
        }
        const mutatedAgent = { ...agent, systemPrompt: resolvedPrompt };
        return agentStep(mutatedAgent, prompt, callbacks, agentOpts);
    }

    // Build optional context strings
    const platformNote = platform ? `\n\n🎯 TARGET PLATFORM: This pitch is being developed specifically for **${platform}**. Tailor all recommendations — tone, format, budget tier, episode structure — to ${platform}'s commissioning style and audience.\n` : '';
    const yearNote = year ? `\n📅 TARGET DELIVERY YEAR: ${year}. This is the year the show will AIR/STREAM — not when it's filmed. Calibrate all market analysis, audience trends, competitive landscape, and narrative strategy to what will be relevant WHEN THIS LAUNCHES. Technology references should reflect what will be cutting-edge at delivery, not today.\n` : '';
    const directiveNote = directive ? `\n\n🎯 CREATIVE DIRECTIVE (MANDATORY): ${directive}\nThis directive comes directly from the executive producer. ALL agents must incorporate this requirement into their analysis and output. It is non-negotiable.\n` : '';

    // Genre preference mapping
    const genreLabels = {
        'scientific-procedural': 'Scientific Procedural — The "CSI" of ecology using eDNA, satellite tagging, and AI forensics',
        'nature-noir': 'Nature Noir — Investigative "True Crime" for the planet, uncovering environmental crimes via forensic filmmaking',
        'speculative-nh': 'Speculative Natural History — Science-grounded AI-generated "future-casts" of ecosystems under climate stress',
        'urban-rewilding': 'Urban Rewilding — Wildlife adapting to industrial/urban ruins',
        'biocultural-history': 'Biocultural History — Prestige essays exploring deep-time connection between landscapes and civilizations',
        'blue-chip-2': 'Blue Chip 2.0 — Ultra-scarcity "Verified Real" captures of rare behaviors with zero human footprint',
        'indigenous-wisdom': 'Indigenous Wisdom — Co-created narratives with traditional ecological knowledge (TEK)',
        'ecological-biography': 'Ecological Biography — Decades-long "Deep Time" tracking of single organisms via autonomous units',
        'extreme-micro': 'Extreme Micro — Visual "Alien" content using nano-tech and electron microscopy at the cellular level',
        'astro-ecology': 'Astro-Ecology — "The Orbital View" using planetary data/satellites to show global system cycles',
        // Shared
        'process-doc': 'The "Process" Doc — Meta-commentary on the difficulty and ethics of the shoot/investigation as proof-of-work',

        // Factual
        'true-crime': 'True Crime — Serialized investigation uncovering crimes, mysteries, or fraud with high suspense',
        'historical-biography': 'Historical Biography — Prestige narrative focusing on a pivotal historical figure or era',
        'science-tech': 'Science & Tech — Access-driven tech or scientific breakthroughs shaping the future',
        'pop-culture': 'Pop Culture — Nostalgia, scandal, or phenomena driving cultural conversations',
        'social-issue': 'Social Issue — Urgent, character-driven narratives highlighting systemic global issues',
        'investigative': 'Investigative Journalism — Journalistic deep dive exposing corruption, cover-ups, or systemic failures',
        'survival': 'Survival — Real-life survival stories pushing human limits against the odds',
    };
    const genreLabel = genrePreference ? genreLabels[genrePreference] || genrePreference : null;
    const genreNote = genreLabel
        ? `\n🎭 GENRE LENS (USER-SELECTED): The user has requested the narrative be framed through a **${genreLabel}** genre lens. Prioritize this genre in your Layer 2 Cross-Genre Import analysis. Your Primary Narrative Form recommendation MUST use this genre lens. Still provide an Alternative Form using a DIFFERENT genre for contrast.\n`
        : '';

    // ─── GENRE LOCK: Enforced across ALL agents when user selects a genre ──────
    const genreLock = genreLabel
        ? `\n\n🔒 GENRE LOCK (DEFAULT — USER-SELECTED FROM UI):\nThe user has locked this pitch to the **${genreLabel}** genre via the UI dropdown. This is the default genre unless the seed text explicitly specifies a different genre.\n- ALL narrative structure, tone, camera language, pacing, sound design, and scoring criteria MUST serve this genre.\n- Do NOT drift into survival thriller, underdog, or any other genre convention unless it IS the locked genre.\n- If you reference narrative techniques, they must come from the locked genre's playbook — not from generic ${docTypeLabel} conventions.\n- The Market Analyst's Narrative Mandate is SUBORDINATE to this genre lock. If the Analyst recommended a different form, OVERRIDE it with the locked genre.\n- Violation of the genre lock will be flagged as GENRE DRIFT and rejected.\n- EXCEPTION: If the seed text explicitly names a different genre (e.g. "make this a comedy"), the seed text takes priority over this UI lock.\n`
        : '';
    // ─── SEED OVERRIDE RULE ──────────────────────────────────
    // The seed text is the user's free-form creative input and is the HIGHEST
    // priority source of truth.  If the seed explicitly specifies a genre,
    // platform, delivery year, scientific premise, location, species, or any
    // other production parameter, those seed-level directives MUST override the
    // corresponding UI-derived settings (platform, year, genre dropdown, etc.).
    const seedOverrideNote = `\n\n⚡ SEED OVERRIDE RULE: The user's seed text is the highest-priority creative brief. If the seed text explicitly specifies a genre, platform, delivery year, target audience, scientific premise, species, location, or any other production parameter, those directives OVERRIDE the corresponding UI settings below. The UI settings (platform, year, genre) are defaults — the seed text is the final word.\n`;

    // ─── LANGUAGE DETECTION ────────────────────────────────────
    // Detect the input language of the seed idea and instruct all agents
    // to respond in the same language.
    const detectLanguage = (text) => {
        const lower = text.toLowerCase();
        // German
        if (/\b(und|der|die|das|ist|ein|eine|von|mit|den|des|dem|für|auf|nicht|sich|über|auch|nach|wie|oder|aber|wenn|noch|mehr|hat|sind|wird|kann|werden|haben|bei|aus|nur|als)\b/.test(lower)) return 'German';
        // French
        if (/\b(les|des|une|est|dans|pour|qui|sur|avec|par|sont|pas|ont|mais|cette|tout|aux|ses|leurs|nous|vous|ils|elle|lui|leur|été|peut|fait|comme|aussi|dont|très|où|sans)\b/.test(lower)) return 'French';
        // Spanish
        if (/\b(los|las|una|del|por|con|para|que|como|más|pero|esta|ese|son|han|fue|hay|ser|está|tiene|puede|todo|desde|también|donde|entre|cuando|sobre|muy|sin)\b/.test(lower)) return 'Spanish';
        // Italian
        if (/\b(gli|una|del|della|dei|delle|per|con|che|sono|nella|nel|dalla|sul|alla|questo|questa|anche|come|più|tra|fra|dove|quando|perché|molto|ogni|tutto|stato|essere)\b/.test(lower)) return 'Italian';
        // Portuguese
        if (/\b(uma|dos|das|para|com|que|por|como|mais|mas|esta|são|tem|foi|pode|todo|desde|também|onde|entre|quando|sobre|muito|sem|cada|outro)\b/.test(lower)) return 'Portuguese';
        // Dutch
        if (/\b(een|het|van|voor|met|dat|zijn|niet|ook|maar|worden|heeft|kan|deze|naar|uit|bij|nog|wel|hun|alle|over|meer|dan|als|geen|moet|hier|daar)\b/.test(lower)) return 'Dutch';
        return null; // Default: English (no instruction needed)
    };
    const detectedLanguage = detectLanguage(seedIdea);
    const languageNote = detectedLanguage
        ? `\n\n🌐 OUTPUT LANGUAGE (MANDATORY): The user's seed idea is written in **${detectedLanguage}**. You MUST write your ENTIRE output in **${detectedLanguage}**. This applies to ALL sections — analysis, headers, recommendations, creative writing, everything. Technical terms, proper nouns, and industry-standard English terminology (e.g., "Blue Chip", "Netflix", "pitch deck") may remain in English, but all prose, analysis, and creative content MUST be in ${detectedLanguage}. This is NON-NEGOTIABLE.\n`
        : '';

    const optionsSuffix = seedOverrideNote + platformNote + yearNote + directiveNote + genreNote + languageNote;

    // Retrieve relevant knowledge from the vector store (no-op if empty)
    // Two parallel queries: (1) topic-matched content, (2) narrative form signals
    let knowledgeContext = '';
    let narrativeContext = '';
    try {
        [knowledgeContext, narrativeContext] = await Promise.all([
            retrieveContext(seedIdea),
            retrieveNarrativeContext(),
        ]);
    } catch (e) {
        console.warn('Knowledge retrieval skipped:', e.message);
    }

    let kbBlock = knowledgeContext ? `\n\n${knowledgeContext}\n\n` : '';

    // narrativeKbBlock is injected specifically into Market Analyst and Genre Strategist
    // — the agents responsible for setting narrative form for all downstream agents
    const narrativeKbBlock = narrativeContext
        ? `\n\n${narrativeContext}\n\n⚡ NARRATIVE FORM MANDATE: The signals above are LIVE industry data on what narrative formats commissioners are actively buying, what formats are gaining momentum, and what is experiencing fatigue. Your Narrative Strategy Recommendation (Section 7) MUST be grounded in these signals — not generic assumptions. Reference specific format trends from the signals when justifying your recommended narrative form.\n\n`
        : '';

    // ─── SEED FIDELITY GUARD ─────────────────────────────
    // Prevents concept drift: every agent is anchored to the user's original idea
    const seedAnchor = `\n⚠️ SEED FIDELITY — ABSOLUTE RULE: The user's original concept is the ANCHOR for this entire pipeline. Your job is to ENHANCE, RESEARCH, and DEEPEN this seed idea — NOT replace it with a different concept. If the user names a specific book, title, species, location, narrator, presenter, or visual approach, those are NON-NEGOTIABLE. You may add scientific depth, production detail, and creative texture, but the core concept must remain recognizably the user's idea. Do NOT pivot to a tangentially related but different topic just because your research surfaced it.\n\nOriginal seed: "${seedIdea}"\n`;

    // ─── WILDLIFE FOCUS GUARD ────────────────────────────
    // Detects when the user explicitly asks for wildlife/animal content and prevents
    // the pipeline from drifting into a human-centric story.
    // Only active in wildlife mode — factual mode handles human subjects by design.
    const wildlifeKeywords = /\b(wildlife|animal|species|creature|fauna|beast|predator|prey|mammal|reptile|bird|insect|fish|amphibian|primate|carnivore|herbivore)\b/i;
    const isWildlifeSeed = !isFactual && wildlifeKeywords.test(seedIdea);
    const wildlifeFocusGuard = isWildlifeSeed
        ? `\n\n🐾 WILDLIFE FOCUS GUARD — ACTIVE:
The user explicitly requested a WILDLIFE story. This means:
- The **protagonist** of this narrative MUST be an animal (species, individual, or population) — NOT a human.
- Humans may appear as supporting context (researchers, conservationists, local communities) but they are NEVER the emotional center or dramatic protagonist.
- The story's dramatic arc, tension, stakes, and resolution must belong to the ANIMAL — its survival, behavior, ecology, or journey.
- Do NOT replace the wildlife narrative with a human-interest story that merely happens near animals (e.g., a deminer, a ranger, a scientist's personal journey). The human is the lens, the animal is the story.
- If your research surfaces a compelling human angle that you believe is genuinely stronger than a wildlife-first approach, you MUST:
  1. Still deliver the WILDLIFE-FIRST version as your primary output
  2. Flag the human angle as: [HUMAN ANGLE SUGGESTED — AUTHOR APPROVAL REQUIRED] with a brief justification based on market trends
- Violation of this guard will be flagged as WILDLIFE DRIFT and the output will be rejected.
`
        : '';


    // ═══════════════════════════════════════════════════════
    // PHASE 0 — DISCOVERY SCOUT
    // Skipped in Grand Narrative Mode — story leads, science follows.
    // ═══════════════════════════════════════════════════════
    if (!grandNarrativeMode && !shouldSkip('discovery')) {
        cbs.onPhaseStart(0, '🔬 Scouting Recent Discoveries');

        let discoveryBrief = '';
        try {
            discoveryBrief = await mutatedAgentStep(
                DISCOVERY_SCOUT,
                `${seedAnchor}Search for recent ${isFactual ? 'research, investigations, and developments' : 'scientific discoveries, novel behaviors, and new species'} related to: "${seedIdea}"${optionsSuffix}${genreLock}\n\nFocus on findings from the last 12 months that could make a ${docTypeLabel} genuinely unprecedented.${genreLabel ? ` Prioritize discoveries relevant to the **${genreLabel}** genre lens.` : ''}\n\n⛔ ANTI-DRIFT RULE (CRITICAL): Your Discovery Brief must ONLY surface findings that DIRECTLY support the user's stated seed concept. If the seed names a specific presenter, host, or person (e.g., a YouTube creator, journalist, filmmaker), search for what THEY are known for and what subjects THEY cover — do NOT invent a random ${isFactual ? 'subject' : 'species or location'} they have never been associated with. If the seed names a specific ${isFactual ? 'subject, person, or event' : 'species or location'}, your findings must be about THAT ${isFactual ? 'subject' : 'species or location'} — not a tangentially related one your search happened to surface. If you cannot find relevant discoveries for the exact seed concept, return a Null Result — do NOT substitute a different concept. A Discovery Brief that introduces a ${isFactual ? 'new subject' : 'new species or location'} not present in the seed is a PIPELINE FAILURE.\n\nReturn a structured Discovery Brief.`,
                cbs,
                { tools: [{ googleSearch: {} }] }
            );
        } catch (e) {
            console.warn('Discovery Scout skipped:', e.message);
            discoveryBrief = '(Discovery Scout: No recent scientific discoveries found for this seed idea. Downstream agents should proceed using existing knowledge and the Market Analyst\'s own research. Do NOT treat this as a gap — it simply means no novel signals were found in the initial search.)';
        }
        ctx._discoveryBrief = discoveryBrief;
        checkpoint_('discovery', 0);
        cbs.onPhaseComplete(0);
    }

    let discoveryBrief = ctx._discoveryBrief || '';

    // ─── DRIFT GATE ──────────────────────────────────────────────────────────
    // Binary checkpoint: validates the Discovery Brief is relevant to the seed.
    // Runs without Google Search (text comparison only — cheap and fast).
    // Max 2 retries if FAIL, then continues with a warning.
    if (discoveryBrief && !shouldSkip('discovery')) {
        const MAX_GATE_RETRIES = 2;
        let gateAttempts = 0;
        let gatePassed = false;

        while (gateAttempts < MAX_GATE_RETRIES && !gatePassed) {
            gateAttempts++;
            let gateRaw = '';
            try {
                gateRaw = await mutatedAgentStep(
                    DRIFT_GATE,
                    `Seed idea: "${seedIdea}"\n\nDiscovery Brief:\n${discoveryBrief}`,
                    cbs
                    // No Google Search — pure text comparison
                );
            } catch (e) {
                console.warn('Drift Gate error:', e.message);
                break; // If Gate itself fails, proceed without blocking
            }

            // Parse the JSON response
            let gateResult = null;
            try {
                const jsonMatch = gateRaw.match(/\{[\s\S]*\}/);
                if (jsonMatch) gateResult = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.warn('Drift Gate: could not parse JSON response, proceeding.');
                break;
            }

            if (!gateResult) break;

            if (gateResult.status === 'PASS') {
                gatePassed = true;
                console.log(`Drift Gate: PASS (${gateResult.confidence}) — ${gateResult.alignment_summary}`);
            } else if (gateResult.status === 'FAIL' && gateAttempts < MAX_GATE_RETRIES) {
                // Re-run Scout with tighter constraints from Gate's recommendation
                console.warn(`Drift Gate: FAIL (${gateResult.drift_type}) — ${gateResult.explanation}`);
                cbs.onPhaseStart(0, '🔬 Re-Scouting (Drift Gate triggered)');
                try {
                    discoveryBrief = await mutatedAgentStep(
                        DISCOVERY_SCOUT,
                        `${seedAnchor}${gateResult.recommendation}\n\nSearch for recent scientific discoveries related to: "${seedIdea}"${optionsSuffix}${genreLock}\n\n⛔ ANTI-DRIFT RULE: Stay STRICTLY on the seed topic. The previous search drifted. Do NOT repeat that drift.\n\nReturn a structured Discovery Brief.`,
                        cbs,
                        { tools: [{ googleSearch: {} }] }
                    );
                    ctx._discoveryBrief = discoveryBrief;
                } catch (e) {
                    console.warn('Scout re-run failed:', e.message);
                    break;
                }
                cbs.onPhaseComplete(0);
            } else {
                // Final FAIL after retries — log and continue with warning
                console.warn(`Drift Gate: FAIL after ${gateAttempts} attempts. Proceeding with warning.`);
                discoveryBrief = `⚠️ DRIFT GATE WARNING: The Discovery Brief may not be fully aligned with the seed idea. Downstream agents: treat the Brief as background context only — the seed is the anchor.\n\n${discoveryBrief}`;
            }
        }
    }
    // ⚠️ ANTI-DRIFT WARNING injected with every Discovery Brief:
    // The Brief provides scientific depth — it must NOT be treated as a concept replacement.
    // If the Brief introduces species or locations not present in the original seed, IGNORE those elements.
    const discoveryBlock = grandNarrativeMode
        ? `\n\n--- GRAND NARRATIVE MODE ---\n🌍 The Discovery Scout has been bypassed. This pipeline is operating in Grand Narrative Mode: the story leads, and science follows.\n\nDownstream agents: do NOT anchor the pitch to recent discoveries or "what was published in the last 12 months." Instead, build from the full depth of established science — deep time, evolutionary history, ecological systems, long-arc behavioral research. The narrative should feel timeless and monumental, not newsy.\n\nScience must still be hard-sourced. All specific claims (numbers, dates, species counts, named researchers, comparative superlatives) require verifiable sources. The difference is that those sources can be foundational texts, long-term studies, or established consensus — not just recent publications.\n\n--- END GRAND NARRATIVE MODE ---\n\n`
        : discoveryBrief
            ? `\n\n--- DISCOVERY BRIEF (Recent Scientific Findings) ---\n⚠️ DOWNSTREAM AGENTS: This Brief provides scientific depth to SUPPORT the seed idea. If it mentions species, locations, or concepts NOT present in the original seed, treat those as background context only — do NOT build your output around them. The seed is the anchor.\n\n${discoveryBrief}\n--- END DISCOVERY BRIEF ---\n\n`
            : '';

    // ═══════════════════════════════════════════════════════
    // PHASE 1 — THE BRAINSTORM
    // ═══════════════════════════════════════════════════════
    if (!shouldSkip('marketMandate')) {
        cbs.onPhaseStart(1, 'The Brainstorm');

        ctx.marketMandate = await mutatedAgentStep(
            MARKET_ANALYST,
            `${seedAnchor}The seed idea is: "${seedIdea}"${kbBlock}${narrativeKbBlock}${discoveryBlock}${optionsSuffix}Analyze this against current market trends. You MUST include: specific buyer slate gaps with platform names, 3 trend examples with series names and years, competitive differentiation against the top 3 closest existing titles, and a budget tier recommendation. Output your full Market Mandate.`,
            cbs,
            { tools: [{ googleSearch: {} }] }
        );
        checkpoint_('marketMandate', 1);
    }

    // ─── PATCH 5: Rule-Based Narrative Mandate ──────────────────────
    // Deterministic JS function (zero LLM calls). Merges Genre Strategist + Market Analyst
    // into a labeled 4-option menu. Auto-selects COLLISION unless Genre Lock overrides.
    function buildNarrativeMandate(marketOutput, genreSuggestions, isGenreLocked, lockedGenreLabel) {
        // Extract Market Analyst's narrative recommendation
        const marketMatch = marketOutput.match(/(?:Narrative Strategy|Narrative Form|Recommended Form|Primary Recommendation)[^:]*:?\s*\**([^\n]+)/i);
        const marketPick = marketMatch ? marketMatch[1].trim().replace(/\*+$/g, '').trim() : null;

        // Extract Genre Strategist's top pick (first genre in the array)
        const creativePick = (genreSuggestions && genreSuggestions.length > 0)
            ? genreSuggestions[0].genreName
            : null;

        // Build the 4-option labeled menu
        const options = [];
        if (marketPick) options.push(`  • MARKET PICK: "${marketPick}" — recommended by the Market Analyst based on buyer slate gaps and trends.`);
        if (creativePick) options.push(`  • CREATIVE PICK: "${creativePick}" — recommended by the Genre Strategist based on creative fit (market-blind).`);
        if (marketPick && creativePick && marketPick !== creativePick) {
            options.push(`  • COLLISION: Merge "${creativePick}" + "${marketPick}" — combine the creative novelty of the Genre Strategist with the market intelligence of the Analyst.`);
        }
        options.push(`  • SAFE DEFAULT: "${isFactual ? 'Investigative Journalism' : 'Blue Chip 2.0'}" — classic prestige ${docTypeLabel} format.`);

        // Auto-select: Genre Lock wins, then COLLISION if available, else MARKET PICK
        let selected;
        if (isGenreLocked && lockedGenreLabel) {
            selected = `GENRE LOCK OVERRIDE: "${lockedGenreLabel}" (user-selected from UI — supersedes all recommendations)`;
        } else if (marketPick && creativePick && marketPick !== creativePick) {
            selected = `COLLISION: "${creativePick}" × "${marketPick}"`;
        } else if (marketPick) {
            selected = `MARKET PICK: "${marketPick}"`;
        } else if (creativePick) {
            selected = `CREATIVE PICK: "${creativePick}"`;
        } else {
            selected = `SAFE DEFAULT: "Blue Chip 2.0"`;
        }

        return {
            menuText: options.join('\n'),
            selected,
            narrativeForm: marketPick || creativePick || 'Blue Chip 2.0',
        };
    }

    // Retrieve genre suggestions from context (already run in Phase 0 or via opts)
    const genreSuggestions = ctx._genreSuggestions || opts._genreSuggestions || null;
    const isGenreLocked = !!genreLabel;
    const mandateResult = buildNarrativeMandate(ctx.marketMandate, genreSuggestions, isGenreLocked, genreLabel);
    const narrativeForm = mandateResult.narrativeForm;
    const narrativeMandate = `\n\n🎭 NARRATIVE MANDATE (BINDING — rule-based, zero API calls):\n\nAvailable narrative forms:\n${mandateResult.menuText}\n\n✅ SELECTED: ${mandateResult.selected}\n\nALL agents MUST respect this form. Do NOT default to survival thriller unless this IS the selected form. Your output — structure, tone, camera language, pacing, and scoring criteria — must serve this narrative form, not a generic thriller template.\n`;

    // ─── PARALLEL RESEARCH: Chief Scientist + Field Producer ──────
    // Both agents receive the Market Mandate but work independently.
    // The Producer works from the seed text (no fact sheet yet) for speed.
    const needScientist = !shouldSkip('animalFactSheet');
    const needProducer = !shouldSkip('logisticsBreakdown');

    if (needScientist && needProducer) {
        const [scientistResult, producerResult] = await Promise.all([
            mutatedAgentStep(
                CHIEF_SCIENTIST,
                `${seedAnchor}The seed idea is: "${seedIdea}"${kbBlock}${discoveryBlock}${optionsSuffix}${genreLock}${narrativeMandate}Here is the Market Mandate from the Market Analyst:\n\n${ctx.marketMandate}\n\n${scientistInstruction}`,
                cbs,
                { tools: [{ googleSearch: {} }] }
            ),
            mutatedAgentStep(
                FIELD_PRODUCER,
                `${seedAnchor}The seed idea is: "${seedIdea}"${kbBlock}${genreLock}${narrativeMandate}\n\nHere is the Market Mandate from the Market Analyst:\n\n${ctx.marketMandate}\n\n${producerParallelNote}\n\nAssess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Your equipment, crew, and shooting approach recommendations MUST serve the declared genre — different genres demand different production setups. Output your full Logistics & Feasibility Breakdown.`,
                cbs
            )
        ]);
        ctx.animalFactSheet = scientistResult;
        ctx.logisticsBreakdown = producerResult;
        checkpoint_('animalFactSheet', 1);
        checkpoint_('logisticsBreakdown', 1);
    } else if (needScientist) {
        ctx.animalFactSheet = await mutatedAgentStep(
            CHIEF_SCIENTIST,
            `${seedAnchor}The seed idea is: "${seedIdea}"${kbBlock}${discoveryBlock}${optionsSuffix}${genreLock}${narrativeMandate}Here is the Market Mandate from the Market Analyst:\n\n${ctx.marketMandate}\n\n${scientistInstruction}`,
            cbs,
            { tools: [{ googleSearch: {} }] }
        );
        checkpoint_('animalFactSheet', 1);
    } else if (needProducer) {
        ctx.logisticsBreakdown = await mutatedAgentStep(
            FIELD_PRODUCER,
            `${seedAnchor}The seed idea is: "${seedIdea}"${kbBlock}${genreLock}${narrativeMandate}\n\n${producerSoloNote}${ctx.animalFactSheet}\n\nAssess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Your equipment, crew, and shooting approach recommendations MUST serve the declared genre — different genres demand different production setups. Output your full Logistics & Feasibility Breakdown.`,
            cbs
        );
        checkpoint_('logisticsBreakdown', 1);
    }

    // ─── SCIENCE GATE: Severity-classified pivot loop (Patch 4) ──────
    const sciRejection = detectRejection(ctx.animalFactSheet);
    let scienceAttempts = 0;
    if (sciRejection.rejected) {
        const sciSeverity = classifySeverity(ctx.animalFactSheet, 'SCIENTIFIC');

        if (sciSeverity === 'CATASTROPHIC') {
            // FAIL-FAST: Biologically impossible seed → kill immediately with user-facing memo
            cbs.onPhaseStart(1, '💀 CATASTROPHIC — Seed is biologically impossible');
            const killMemo = `## ⛔ PIPELINE KILLED — CATASTROPHIC SCIENTIFIC FAILURE\n\nThe Chief Scientist has determined that this seed idea is **biologically impossible**. No amount of iteration can fix a fundamentally broken premise.\n\n### Scientist's Assessment:\n${ctx.animalFactSheet}\n\n### Original Seed:\n"${seedIdea}"\n\n**Action:** Please revise your seed idea with a scientifically valid premise and try again.`;
            cbs.onPhaseComplete(1);
            clearCheckpoint();
            return killMemo;
        }

        // RECOVERABLE: ≤3 pivots
        while (detectRejection(ctx.animalFactSheet).rejected && scienceAttempts < maxRevisions) {
            scienceAttempts++;
            cbs.onPhaseStart(1, `🔄 Science Pivot — Attempt ${scienceAttempts}/${maxRevisions}`);

            ctx.animalFactSheet = await mutatedAgentStep(
                CHIEF_SCIENTIST,
                `## SCIENCE PIVOT REQUIRED
${genreLock}
Your previous assessment flagged this idea as scientifically problematic:

### Your Rejection:
${ctx.animalFactSheet}

### Original Seed Idea:
"${seedIdea}"

### Market Context:
${ctx.marketMandate}

The pipeline does NOT kill ideas — it ITERATES them. Your job now:

1. **Identify what IS scientifically valid** in the seed idea — what elements can be preserved?
2. **Propose the CLOSEST viable alternative** — keep the spirit/theme of the original idea but make it scientifically sound. If the user wanted "deep ocean survival," find a real deep ocean survival behavior. If they wanted "predator-prey in the Arctic," find one that exists.
3. **Maintain the user's intent** — they chose this topic for a reason. Don't pivot to something completely unrelated.
4. **Produce a complete ${factSheetLabel}** with all required sections${isFactual ? '' : ' (Primary Species, Antagonist, Vulnerability Window, Novelty, B-Story, Biome, Ethics, Visual Payoff)'}${genreLabel ? `
5. **Respect the genre lock** — your proposed alternative MUST serve the **${genreLabel}** genre. Select behaviors and framing that fit this genre's conventions.` : ''}

You are a CREATIVE SCIENTIST, not a gatekeeper. Find a way to make it work.`,
                cbs,
                { tools: [{ googleSearch: {} }] }
            );
        }
    }

    // If Science Gate pivoted (species changed), re-run Producer with updated fact sheet
    if (scienceAttempts > 0 && !detectRejection(ctx.animalFactSheet).rejected) {
        cbs.onPhaseStart(1, '🔄 Updating Logistics for Science Pivot');
        ctx.logisticsBreakdown = await mutatedAgentStep(
            FIELD_PRODUCER,
            `${seedAnchor}The seed idea is: "${seedIdea}"${kbBlock}${genreLock}${narrativeMandate}\n\n${isFactual ? 'The Chief Investigator revised the research after a pivot. Here is the UPDATED Research Fact Sheet' : 'The Chief Scientist revised the science after a pivot. Here is the UPDATED Animal Fact Sheet'}:\n\n${ctx.animalFactSheet}\n\nUpdate your logistics assessment to match the revised ${isFactual ? 'subject, locations, and access requirements' : 'species, location, and behavior'}. Assess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Output your REVISED Logistics & Feasibility Breakdown.`,
            cbs
        );
        checkpoint_('logisticsBreakdown', 1);
    }

    // ─── ETHICAL GATE: Severity-classified revision loop (Patch 4) ─────────
    const ethicsCheck = detectRejection(ctx.logisticsBreakdown);
    if (ethicsCheck.rejected) {
        const ethSeverity = classifySeverity(ctx.logisticsBreakdown, 'ETHICAL');

        if (ethSeverity === 'CATASTROPHIC') {
            // FAIL-FAST: Concept fundamentally requires unethical methods → kill immediately
            cbs.onPhaseStart(2, '💀 CATASTROPHIC — Concept requires unethical filming');
            const killMemo = `## ⛔ PIPELINE KILLED — CATASTROPHIC ETHICAL FAILURE\n\nThe Field Producer has determined that this concept **fundamentally requires unethical filming methods**. There is no observational alternative.\n\n### Producer's Assessment:\n${ctx.logisticsBreakdown}\n\n### Original Seed:\n"${seedIdea}"\n\n**Action:** Please revise your seed idea to eliminate the need for harmful filming techniques and try again.`;
            cbs.onPhaseComplete(2);
            clearCheckpoint();
            return killMemo;
        }
        // STAGE 1: Give Field Producer a second chance with explicit calibration
        cbs.onPhaseStart(2, '🔄 Ethical Review — Proportionality Check');

        ctx.logisticsBreakdown = await mutatedAgentStep(
            FIELD_PRODUCER,
            `## ETHICAL PROPORTIONALITY RE-CHECK

Your initial assessment flagged ethical concerns and triggered a pipeline halt. Before we kill this idea, we need you to re-evaluate with a PROPORTIONALITY TEST.

### Your Original Rejection:
${ctx.logisticsBreakdown}

### The Seed Idea:
"${seedIdea}"

### The Scientist's Fact Sheet:
${ctx.animalFactSheet}

RE-EVALUATE by answering these questions:
1. **Are the "violations" about filming NATURALLY OCCURRING behavior?** If yes, this is NOT an ethical violation. Planet Earth, Dynasties, and Frozen Planet all film natural predation, death, and distress. Observing nature is not causing it.
2. **Are you rejecting based on ANOTHER AGENT'S suggestion?** If the Scientist suggested something questionable (e.g., "clear ant nests"), that's THEIR suggestion — simply don't include it in YOUR logistics plan. Don't reject the whole concept because of someone else's idea.
3. **Could you film this concept ethically using standard observational techniques?** Remote cameras, hides, autonomous drones, probe lenses, long-lens observation — would any of these work without the problematic methods?

If the concept CAN be filmed ethically by removing specific problematic methods → PROCEED with a full logistics plan that EXCLUDES those methods. Note what you excluded and why.

If the concept FUNDAMENTALLY REQUIRES unethical methods (there is NO observational alternative) → Re-issue your ⛔ ETHICAL REJECTION.`,
            cbs
        );

        cbs.onPhaseComplete(2);

        // STAGE 2: If still rejected, iterate with Scientist proposing ethical alternatives
        let ethicsAttempts = 0;
        while (detectRejection(ctx.logisticsBreakdown).rejected && ethicsAttempts < maxRevisions) {
            ethicsAttempts++;
            cbs.onPhaseStart(1, `🔄 Ethical Pivot — Attempt ${ethicsAttempts}/${maxRevisions}`);

            // Ask the Scientist to propose an ethically filmable approach
            ctx.animalFactSheet = await mutatedAgentStep(
                CHIEF_SCIENTIST,
                `## ETHICAL PIVOT REQUIRED
${genreLock}
The Field Producer has flagged ethical concerns with the proposed filming approach — even after a proportionality re-check. We need an alternative approach that preserves the core idea but is ethically filmable using standard observational techniques.

### Field Producer's Ethical Concerns:
${ctx.logisticsBreakdown}

### Your Previous Fact Sheet:
${ctx.animalFactSheet}

### Original Seed Idea:
"${seedIdea}"

Your job:
1. **Keep the core idea** — same general theme, location, or species if possible
2. **Remove or replace any methods the Field Producer flagged** — propose filming approaches that use ONLY observational techniques (remote cameras, hides, long lenses, autonomous drones, probe lenses)
3. **If the specific behavior is the problem**, propose a DIFFERENT behavior of the same or closely related species that achieves the same cinematic effect without ethical issues
4. **Produce a revised complete ${factSheetLabel}** — ensure the ethical red flags section explicitly addresses the Field Producer's concerns with specific mitigation protocols${genreLabel ? `
5. **Respect the genre lock** — your revised approach MUST still serve the **${genreLabel}** genre.` : ''}

The pipeline iterates, it does not kill. Find a way.`,
                cbs,
                { tools: [{ googleSearch: {} }] }
            );

            // Re-run Field Producer on the revised approach
            ctx.logisticsBreakdown = await mutatedAgentStep(
                FIELD_PRODUCER,
                `The seed idea is: "${seedIdea}"${kbBlock}${genreLock}${narrativeMandate}\n\nHere is the REVISED ${factSheetLabel} from the ${isFactual ? 'Chief Investigator' : 'Chief Scientist'} (revised to address your previous ethical concerns):\n\n${ctx.animalFactSheet}\n\nAssess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Your equipment and crew recommendations MUST serve the ${genreLabel ? `locked genre ("${genreLabel}")` : 'declared narrative form'} — different genres demand different production setups. Output your full Logistics & Feasibility Breakdown.`,
                cbs
            );

            // ─── FIX 3: Synchronize Market Mandate on Pivot ──────────
            ctx.marketMandate = await mutatedAgentStep(
                MARKET_ANALYST,
                `${seedAnchor}The seed idea is: "${seedIdea}"${kbBlock}${discoveryBlock}${optionsSuffix}${wildlifeFocusGuard}${genreLock}\n\nThe ${isFactual ? 'Chief Investigator' : 'Chief Scientist'} and Field Producer have PIVOTED the core concept to address ethical/scientific concerns.\n\nHere is their REVISED ${factSheetLabel}:\n${ctx.animalFactSheet}\n\nRe-evaluate the market viability of this NEW pivoted approach. Do your target platforms and narrative form recommendations change? Output your revised Market Mandate based on this new reality.`,
                cbs
            );
        }
    }

    cbs.onPhaseComplete(1);

    // ═══════════════════════════════════════════════════════
    // PHASE 2 — DRAFT V1
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(2, 'Draft V1');

    // ─── LATE-BINDING RAG: Re-query with finalized science (Fix 5) ─────
    if (ctx.animalFactSheet) {
        try {
            const draftKbContext = await retrieveContext(ctx.animalFactSheet.slice(0, 500));
            if (draftKbContext) {
                kbBlock = `\n\n${draftKbContext}\n\n`; // Override global kbBlock with pivoted science
            }
        } catch (e) {
            console.warn('Draft RAG update failed:', e.message);
        }
    }

    // ─── SPECIES DRIFT GUARD ─────────────────────────────
    // Extract the hero species from the Scientist's output to enforce Zero Species Drift
    let heroSpecies = null;
    try { // Fix 4: Structured Data (JSON) for Guards
        const speciesExtraction = await callAgent(
            'You are a strict data extractor. Read the provided text and identify the primary/hero animal species. Return ONLY valid JSON with a single key "primarySpecies" containing the name of the animal. Example: {"primarySpecies": "Snow Leopard"}',
            ctx.animalFactSheet,
            { responseFormat: 'json' }
        );
        const parsed = JSON.parse(speciesExtraction);
        if (parsed.primarySpecies && parsed.primarySpecies.toLowerCase() !== 'none') {
            heroSpecies = parsed.primarySpecies;
        }
    } catch (e) {
        console.warn('Structured species extraction failed, falling back to regex:', e.message);
        const speciesMatch = ctx.animalFactSheet.match(/(?:Primary Species|Hero Species|Hero Animal)[^:]*:\s*\**([^(*\n]+)/i);
        heroSpecies = speciesMatch ? speciesMatch[1].trim().replace(/\*+$/, '').trim() : null;
    }

    const speciesGuard = heroSpecies
        ? `\n\n⚠️ ZERO SPECIES DRIFT ENFORCEMENT: Your hero species MUST be "${heroSpecies}" as identified by the Chief Scientist. If you change, swap, or substitute this species for a different animal, your output will be flagged as SPECIES DRIFT and REJECTED. You may creatively reinterpret the angle, but the animal stays.\n`
        : '';

    if (!shouldSkip('draftV1')) {
        ctx.draftV1 = await mutatedAgentStep(
            STORY_PRODUCER,
            `${seedAnchor}The seed idea is: "${seedIdea}"${kbBlock}${discoveryBlock}${optionsSuffix}${speciesGuard}${wildlifeFocusGuard}${genreLock}${narrativeMandate}\n\nHere are the team's inputs:\n\n### Market Mandate\n${ctx.marketMandate}\n\n### ${factSheetLabel}\n${ctx.animalFactSheet}\n\n### Logistics & Feasibility\n${ctx.logisticsBreakdown}\n\nSynthesize all of this into a complete pitch narrative.\n\nCRITICAL: ${genreLabel ? `The user has LOCKED the genre to "${genreLabel}". Your ENTIRE output — structure, tone, camera language, pacing, narration style, sound design — must serve this genre. Do NOT import conventions from other genres.` : `The Market Analyst has recommended a **Narrative Form** in their Market Mandate (Section 7: Narrative Strategy Recommendation). You MUST follow it. Read their Primary and Alternative recommendations, choose one, and build your entire output around it.`}\n\nDeliver ALL elements specified in your output format instructions for the chosen narrative form, plus ALL universal elements (${isFactual ? 'Societal Impact, Visual Signature Moments, Technology Justification, A/V Script Excerpt' : 'Anthropocene Reality, Visual Signature Moments, Technology Justification, A/V Script Excerpt'}).\n\nDo NOT default to survival thriller unless ${genreLabel ? `the locked genre IS survival thriller` : `the Market Analyst specifically recommended it`}. Adopt the locked genre's conventions fully.${isFactual ? '' : '\n\nEnsure the B-Story species is woven into the narrative, not just mentioned as a footnote.'}`,
            cbs
        );
        checkpoint_('draftV1', 2);
    }

    cbs.onPhaseComplete(2);

    // ═══════════════════════════════════════════════════════
    // PHASE 2.5 — THE PROVOCATEUR (Chaos Engine)
    // ═══════════════════════════════════════════════════════
    if (chaosConfig.provocateur && !shouldSkip('provocation')) {
        cbs.onPhaseStart(2.5, '🔥 The Provocateur');

        ctx.provocation = await mutatedAgentStep(
            PROVOCATEUR,
            `You are reviewing this Draft V1 pitch. Read it. Find the lie. Break it open.

### The Seed Idea
"${seedIdea}"

### The Market Mandate (what the industry wants)
${ctx.marketMandate}

### The Science (what's real)
${ctx.animalFactSheet}

### Draft V1 (the "safe" version)
${ctx.draftV1}

This draft was built by a pipeline of experts: a Market Analyst, a Chief Scientist, a Field Producer, and a Story Producer. They are all very good at their jobs. They have produced a pitch that is commissionable, defensible, and risk-mitigated.

Your job: find the moment where "commissionable" became "forgettable." Find the element that everyone agreed on because nobody challenged it. Find the polite lie this pitch tells about its subject.

Then break it. Offer something dangerous.

⚠️ DOMAIN CONSTRAINT (ABSOLUTE RULE):
You may ONLY propose changes to: narrative form, perspective, structure, tone, narrator identity, timeline, emotional framing, thematic angle.
You may NEVER propose changes to: species, animal behavior, filming methods, locations, crew, equipment, budget, or scientific facts.
If you believe the science is wrong, say so in your Kill Shot — but your Pivot must stay within the narrative domain. The Science Firewall is absolute.

Output your response in the EXACT format specified in your instructions: Kill Shot, Pivot, Argument, Fatal Question. No preamble.`,
            cbs
        );

        checkpoint_('provocation', 2.5);

        // ─── ROBUST FATAL QUESTION EXTRACTION ───────────────────
        if (cbs.onChaosEvent) {
            let fatalQuestion = null;

            // Stage 1: Standard Regex (Looking for the specific header)
            const fqMatch = ctx.provocation.match(/(?:Fatal Question|❓)[:\s]*\n?([\s\S]*?)(?:\n##|\n---|$)/i);

            if (fqMatch && fqMatch[1].trim()) {
                fatalQuestion = fqMatch[1].trim();
            } else {
                // Stage 2: Fallback — Find the last sentence ending in a question mark
                const sentences = ctx.provocation.split(/[.!\n]/);
                const lastQuestion = sentences.reverse().find(s => s.trim().endsWith('?'));

                if (lastQuestion) {
                    fatalQuestion = lastQuestion.trim();
                } else {
                    // Stage 3: Hard Fallback — Just take the last non-empty line
                    const lines = ctx.provocation.trim().split('\n').filter(l => l.length > 0);
                    fatalQuestion = lines[lines.length - 1];
                }
            }

            cbs.onChaosEvent('fatalQuestion', {
                fullProvocation: ctx.provocation,
                fatalQuestion: fatalQuestion
            });
        }

        cbs.onPhaseComplete(2.5);
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 3 — THE MURDER BOARD
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(3, 'The Murder Board');

    if (!shouldSkip('rejectionMemo')) {
        ctx.rejectionMemo = await mutatedAgentStep(
            COMMISSIONING_EDITOR,
            `Review the following Draft V1 pitch package:${kbBlock}${genreLock}${narrativeMandate}\n\n### Seed Idea\n"${seedIdea}"\n\n### Market Mandate\n${ctx.marketMandate}\n\n### ${factSheetLabel}\n${ctx.animalFactSheet}\n\n### Logistics & Feasibility\n${ctx.logisticsBreakdown}\n\n### Draft Script (V1)\n${ctx.draftV1}\n\nThis is the FIRST review. Attack across all 14 vectors.\n\nCRITICAL FOR VECTORS 7 & 8: ${genreLabel ? `The user has LOCKED the genre to "${genreLabel}". Evaluate the draft EXCLUSIVELY against this genre's cinematic standards. If the draft drifts into another genre's conventions, flag it as GENRE DRIFT — this is a FATAL FLAW.` : `The Market Analyst declared a narrative form in the Market Mandate. Use THAT form's cinematic standard for your Narrative Integrity Test and Commission Test — do NOT default to survival thriller criteria unless that IS the declared form.`}\n\nQuote specific failing passages. Find at LEAST two substantive flaws. Score honestly — most first drafts land 60-80, but greenlight (85+) if genuinely broadcast-ready.`,
            cbs
        );
        checkpoint_('rejectionMemo', 3);
    }

    cbs.onPhaseComplete(3);

    // ═══════════════════════════════════════════════════════
    // PHASE 4 — THE REVISION
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(4, 'The Revision');

    if (!shouldSkip('revisionDirectives')) {
        const provocateurBlock = ctx.provocation
            ? `\n\n### 🔥 The Provocateur's Challenge\nThe Provocateur has also reviewed Draft V1 and offers a radically different perspective. You do NOT have to follow it — but you must CONSIDER it. If any element of the provocation would strengthen the pitch without breaking it, incorporate it. If the Fatal Question reveals a real weakness, address it.\n\n${ctx.provocation}\n\nYou now have TWO voices: the Commissioning Editor (telling you what's wrong) and the Provocateur (telling you what's missing). Your revision directives should synthesize both.\n\n`
            : '';

        ctx.revisionDirectives = await mutatedAgentStep(
            SHOWRUNNER,
            `The Commissioning Editor has REJECTED Draft V1 with this memo:\n\n${ctx.rejectionMemo}${provocateurBlock}\n\nOriginal team outputs:\n- Market Mandate: ${ctx.marketMandate}\n- ${factSheetLabel}: ${ctx.animalFactSheet}\n- Logistics: ${ctx.logisticsBreakdown}\n- Draft V1 Script: ${ctx.draftV1}${genreLock}${narrativeMandate}\n\nParse the rejection. Identify exactly what needs to change and which agents are responsible.\n\nCRITICAL: ${genreLabel ? `The genre is LOCKED to "${genreLabel}". ALL revision directives MUST enforce this genre. If the draft drifted into another genre, your primary directive is to pull it back. Issue camera, sound, and narration directives specific to this genre.` : `Review the Market Analyst's Narrative Mandate. Ensure ALL revision directives are consistent with the declared narrative form.`} Do NOT push the draft toward survival thriller unless that IS the ${genreLabel ? 'locked genre' : 'mandate'}. Issue camera, sound, and narration directives appropriate to the form.\n\nOutput clear revision directives for each agent.`,
            cbs
        );
        checkpoint_('revisionDirectives', 4);
    }

    if (!shouldSkip('revisedScience')) {
        ctx.revisedScience = await mutatedAgentStep(
            CHIEF_SCIENTIST,
            `The Showrunner has issued these revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}${genreLock}\n\nYour original ${factSheetLabel} was:\n${ctx.animalFactSheet}\n\nRevise your output to address the critique. ${isFactual ? 'Strengthen sourcing and deepen the investigative angle.' : 'Include a reliable B-Story backup species if demanded. Ensure the visual payoff description supports CINEMATIC proximity shooting, not just scientific observation.'}${genreLabel ? ` Your revised ${isFactual ? 'fact sheet' : 'fact sheet'} MUST serve the locked genre ("${genreLabel}") — select ${isFactual ? 'angles and framing' : 'behaviors and framing'} that fit this genre's conventions.` : ''} Output a REVISED ${factSheetLabel}.`,
            cbs
        );
        checkpoint_('revisedScience', 4);
    }

    if (!shouldSkip('revisedLogistics')) {
        ctx.revisedLogistics = await mutatedAgentStep(
            FIELD_PRODUCER,
            `The Showrunner has issued these revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}${genreLock}${narrativeMandate}\n\nYour original Logistics Breakdown was:\n${ctx.logisticsBreakdown}\n\nThe revised science is:\n${ctx.revisedScience}\n\nRevise your output. Ensure camera, sound, and crew upgrades are appropriate to the ${genreLabel ? `locked genre ("${genreLabel}")` : 'declared narrative form'} — a forensic investigation may need macro-probe rigs and laboratory setups, while a vérité film needs long-lens patience rigs and minimal crew footprint. Ensure contingency plans include B-roll backup sequences.\n\nOutput a REVISED Logistics & Feasibility Breakdown.`,
            cbs
        );
        checkpoint_('revisedLogistics', 4);
    }

    if (!shouldSkip('draftV2')) {
        // ─── CHAOS ENGINE: Creative Accident ───────────────────
        let accidentBlock = '';
        if (chaosConfig.accidents) {
            const accident = generateAccident(ctx);
            accidentBlock = `\n\n═══════════════════════════════════════════\n🎲 CREATIVE ACCIDENT (from the Chaos Engine)\n═══════════════════════════════════════════\n\nBefore you revise, consider this challenge. You don't HAVE to use it. But if it triggers something — if it opens a door you hadn't seen — follow it.\n\n**${accident.layer}${accident.reference ? ` — inspired by ${accident.reference}` : ''}**\n\n${accident.prompt}\n\n⚠️ RESEARCH FIREWALL: This accident may ONLY influence your narrative structure, tone, format, or storytelling approach. It must NEVER cause you to alter, exaggerate, or invent ${isFactual ? 'factual claims, historical events, or verified data' : 'biological facts, animal behavior, or ecological science'}. The ${isFactual ? 'research' : 'science'} is sacred — only the WAY you tell the story can change.\n\nRemember: you are free to ignore this. But the best revisions come from the collision of discipline and surprise.\n═══════════════════════════════════════════\n\n`;

            if (cbs.onChaosEvent) {
                cbs.onChaosEvent('accident', accident);
            }
        }

        ctx.draftV2 = await mutatedAgentStep(
            STORY_PRODUCER,
            `${accidentBlock}The Showrunner has issued revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}${speciesGuard}${wildlifeFocusGuard}${genreLock}${narrativeMandate}\n\nRevised inputs:\n- Market Mandate: ${ctx.marketMandate}\n- Revised ${factSheetLabel}: ${ctx.revisedScience}\n- Revised Logistics: ${ctx.revisedLogistics}\n\nYour original Draft V1 was:\n${ctx.draftV1}\n\nRewrite the script addressing ALL critique points. FORM-SPECIFIC UPGRADE CHECKLIST — apply the standards for the ${genreLabel ? `LOCKED genre ("${genreLabel}")` : 'DECLARED narrative form'}:\n✓ Commit fully to the ${genreLabel ? 'locked genre\'s' : 'declared form\'s'} cinematic language\n✓ Every key moment must have defined visual AND audio signatures appropriate to the genre\n✓ Narration style must match the genre\n✓ B-Story woven in — the secondary species must serve the chosen genre, not just be backup\n✓ Do NOT drift into survival thriller or any other genre's conventions unless that IS the ${genreLabel ? 'locked genre' : 'declared form'}\n\nOutput a REVISED 3-Act narrative and dual-column A/V script with sound design notes (Draft V2).`,
            cbs
        );
        checkpoint_('draftV2', 4);
    }

    if (!shouldSkip('greenlightReview')) {
        ctx.greenlightReview = await mutatedAgentStep(
            COMMISSIONING_EDITOR,
            `You previously rejected the Draft V1 with this memo:\n\n${ctx.rejectionMemo}${genreLock}${narrativeMandate}\n\nThe team has revised their work. Here is Draft V2:\n\n### Revised ${factSheetLabel}\n${ctx.revisedScience}\n\n### Revised Logistics\n${ctx.revisedLogistics}\n\n### Draft Script (V2)\n${ctx.draftV2}\n\nReview the revisions. Check:\n1. Have the fatal flaws been addressed?\n2. Does the pitch NOW commit fully to the ${genreLabel ? `locked genre ("${genreLabel}")` : 'declared narrative form'} (not defaulting to thriller)?\n3. Camera, sound, and narration language — are they appropriate for the ${genreLabel ? 'LOCKED genre' : 'DECLARED form'}?\n4. B-Story: woven into the genre, not just listed as backup?\n${genreLabel ? `5. GENRE DRIFT CHECK: Flag ANY element that belongs to a different genre\'s conventions.\n` : ''}\nScore the revised pitch. If genuinely resolved, Greenlight (85+). If not, explain what still needs work.`,
            cbs
        );
        checkpoint_('greenlightReview', 4);
    }

    // ─── QUALITY GATE: Multi-draft revision loop ──────────────
    let currentDraft = ctx.draftV2;
    let currentReview = ctx.greenlightReview;
    let currentScore = extractScore(currentReview);
    let draftNumber = 2;
    let bestDraft = currentDraft;
    let bestScore = currentScore ?? 0;
    let bestReview = currentReview;

    while (draftNumber < 2 + maxRevisions) {
        draftNumber++;
        cbs.onPhaseStart(4, `🔄 Quality Revision — Draft V${draftNumber}`);

        // Showrunner issues tighter revision directives
        const tighterDirectives = await mutatedAgentStep(
            SHOWRUNNER,
            `The Commissioning Editor scored Draft V${draftNumber - 1} at ${currentScore}/100. This is revision attempt ${draftNumber - 2} of ${maxRevisions}.${genreLock}

### Editor's Review (${currentScore}/100):
${currentReview}

### The Draft That Failed:
${currentDraft}

### Original Seed Idea:
"${seedIdea}"

Issue SURGICAL revision directives. Focus ONLY on the specific failings the Editor identified. Do not request a complete rewrite — target the exact weaknesses.${genreLabel ? ` Ensure ALL directives enforce the locked genre ("${genreLabel}"). If genre drift was flagged, make genre compliance your PRIMARY directive.` : ''}`,
            cbs
        );

        // Story Producer writes the next draft
        currentDraft = await mutatedAgentStep(
            STORY_PRODUCER,
            `Draft V${draftNumber - 1} scored ${currentScore}/100 — below threshold. Here are the Showrunner's targeted revision directives:\n\n${tighterDirectives}${speciesGuard}${wildlifeFocusGuard}${genreLock}${narrativeMandate}\n\nYour previous draft:\n${currentDraft}\n\nRevised inputs:\n- Market Mandate: ${ctx.marketMandate}\n- ${factSheetLabel}: ${ctx.revisedScience || ctx.animalFactSheet}\n- Logistics: ${ctx.revisedLogistics || ctx.logisticsBreakdown}\n\nFix the SPECIFIC issues identified. Do not regress on elements that were already working. Output Draft V${draftNumber}.`,
            cbs
        );

        // Editor reviews the new draft
        currentReview = await mutatedAgentStep(
            COMMISSIONING_EDITOR,
            `This is Draft V${draftNumber} — revision attempt ${draftNumber - 2} of ${maxRevisions}.${genreLock}\n\nPrevious review (V${draftNumber - 1}, ${currentScore}/100):\n${currentReview}\n\n### Draft Script (V${draftNumber}):\n${currentDraft}\n\nReview the revisions. Have the specific failings been addressed?${genreLabel ? ` Check for GENRE DRIFT — the genre is locked to "${genreLabel}".` : ''} Score the revised pitch honestly.`,
            cbs
        );

        currentScore = extractScore(currentReview);

        // Track the best version
        if (currentScore !== null && currentScore > bestScore) {
            bestScore = currentScore;
            bestDraft = currentDraft;
            bestReview = currentReview;
        }
    }

    // Use the best draft achieved
    ctx.draftV2 = bestDraft;
    ctx.greenlightReview = bestReview;

    cbs.onPhaseComplete(4);

    // ═══════════════════════════════════════════════════════
    // PHASE 5 — FINAL OUTPUT
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(5, 'Final Output — Master Pitch Deck');

    // ─── PATCH 2: Context Compressor (rule-based, zero API calls) ──────
    // Builds a ~800 token XML <state_payload> for the Showrunner.
    // Full texts passed AFTER the payload as fallback.
    function compressContext(editorReview, editorScoreNum, provocation, draft, mandate) {
        const scoreStr = editorScoreNum !== null ? `${editorScoreNum}/100` : 'N/A';

        // Extract MUST_FIX items (look for common rejection patterns)
        const mustFixMatch = editorReview.match(/(?:must[- ]fix|fatal flaw|critical|major issue|fail)[^\n]*(?:\n[^#\n][^\n]*)*/gi);
        const mustFix = mustFixMatch
            ? mustFixMatch.map(m => m.trim()).slice(0, 5).join('\n  ')
            : 'No explicit MUST_FIX items found.';

        // Extract strengths
        const strengthMatch = editorReview.match(/(?:strength|work(?:s|ing) well|standout|excellent|strong)[^\n]*(?:\n[^#\n][^\n]*)*/gi);
        const strengths = strengthMatch
            ? strengthMatch.map(m => m.trim()).slice(0, 3).join('\n  ')
            : 'No explicit strengths extracted.';

        // Extract draft outline (first 2-3 sentences per act)
        const actMatches = draft.match(/(?:#{1,3}\s*)?(?:Act (?:I{1,3}|[1-3]|One|Two|Three))[^\n]*/gi);
        let draftOutline = '';
        if (actMatches) {
            for (const actHeader of actMatches.slice(0, 3)) {
                const actIdx = draft.indexOf(actHeader);
                const actContent = draft.slice(actIdx, actIdx + 500);
                const sentences = actContent.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
                draftOutline += `  ${sentences.substring(0, 200)}\n`;
            }
        }
        if (!draftOutline) {
            draftOutline = draft.substring(0, 300) + '...';
        }

        return `<state_payload>
  <editor_verdict>
    <score>${scoreStr}</score>
    <must_fix>
  ${mustFix}
    </must_fix>
    <strengths>
  ${strengths}
    </strengths>
  </editor_verdict>
  <provocateur_challenge>
${provocation || '  (No provocateur challenge this run.)'}
  </provocateur_challenge>
  <draft_outline>
${draftOutline}
  </draft_outline>
  <narrative_mandate>${mandate.substring(0, 300)}</narrative_mandate>
</state_payload>`;
    }

    const compressedScore = extractScore(ctx.greenlightReview);
    const statePayload = compressContext(
        ctx.greenlightReview,
        compressedScore,
        ctx.provocation || '',
        ctx.draftV2,
        narrativeMandate
    );

    // ─── CONTEXT COMPACTION (Market Mandate — kept) ─────────────────
    const compactMandate = (() => {
        const sections = [];
        const narrativeSection = ctx.marketMandate.match(/(?:#{1,3}\s*(?:\d+[\.\\)]\s*)?(?:Narrative Strategy|Narrative Form|Narrative Architecture)[^\n]*\n)([\s\S]*?)(?=\n#{1,3}\s|\n\d+[\.\\)]\s[A-Z]|$)/i);
        if (narrativeSection) sections.push('**Narrative Strategy:** ' + narrativeSection[1].trim().substring(0, 500));
        const platformSection = ctx.marketMandate.match(/(?:#{1,3}\s*(?:\d+[\.\\)]\s*)?(?:Platform|Buyer|Target)[^\n]*\n)([\s\S]*?)(?=\n#{1,3}\s|\n\d+[\.\\)]\s[A-Z]|$)/i);
        if (platformSection) sections.push('**Platform Fit:** ' + platformSection[1].trim().substring(0, 300));
        const budgetSection = ctx.marketMandate.match(/(?:#{1,3}\s*(?:\d+[\.\\)]\s*)?(?:Budget)[^\n]*\n)([\s\S]*?)(?=\n#{1,3}\s|\n\d+[\.\\)]\s[A-Z]|$)/i);
        if (budgetSection) sections.push('**Budget:** ' + budgetSection[1].trim().substring(0, 200));
        return sections.length > 0 ? sections.join('\n\n') : ctx.marketMandate.substring(0, 1000) + '\n\n[… truncated for context efficiency]';
    })();


    if (!shouldSkip('finalPitchDeck')) {
        ctx.finalPitchDeck = await mutatedAgentStep(
            SHOWRUNNER,
            `The Commissioning Editor has completed their review. Compile the final compact pitch card.${kbBlock}${wildlifeFocusGuard}${genreLock}

### 📦 Compressed State Payload (PRIMARY — read this first)
${statePayload}

### Market Mandate (Key Directives)
${compactMandate}

### Story Producer's Draft Narrative
${ctx.draftV2}

### Full Editor Review (FALLBACK)
${ctx.greenlightReview}

Internally decide whether to incorporate the Provocateur's challenge — but do NOT include any meta-commentary about provocation in your output.

Output ONLY these 5 sections — nothing else:

1. **Title** — As a prominent ## heading. Evocative, marketable, unique.
2. **Logline** — One sentence, max 25 words, hook + stakes + what makes this story unique. Uniqueness must come from the STORY (subject, behavior, scientific revelation, narrative angle) — NEVER from camera technology or production techniques. Format: **Logline:** followed by the sentence.
3. **Summary** — 3-5 sentences selling the project to a non-specialist. Cinematic, vivid, irresistible. Format: **Summary:** followed by the paragraph.
4. **Best For** — Top 1-3 platforms (e.g., Netflix, Apple TV+, BBC Studios, Disney+, Amazon Prime, ZDF/ARTE) with a one-line justification per platform. Format: **Best For:** followed by the list.
5. **Sources** — Apply the three-tier model from your system prompt:
   - **Tier 1 hard claims** in the Summary (specific numbers, statistics, population counts, precise dates): search-verify each one. Cite with URL. If you can't find a source, rewrite or remove.
   - **Tier 2 contextual texture** (general ecological context, widely-understood patterns): no source needed.
   - **Tier 3 narrative framing** (emotional language, metaphors): no source needed.
   - **Seed facts** (names, roles, affiliations from the user's original seed): verify via search. If verified, no citation. If wrong, flag: "⚠️ Seed fact unverified: [claim]".

CRITICAL FORMAT RULES:
- Output ONLY these 5 sections — no A/V scripts, no logistics, no market analysis
- No agent commentary, no preamble, no "Okay, Showrunner here", no "INCORPORATING PROVOCATION" lines
- Start directly with the ## Title heading
- This must be clean, compact, and presentation-ready.`,
            cbs,
            { tools: [{ googleSearch: {} }] } // Needs search for Tier 1 claim verification and seed fact verification

        );
        checkpoint_('finalPitchDeck', 5);
    }

    cbs.onPhaseComplete(5);

    // ═══════════════════════════════════════════════════════
    // PHASE 6 — THE GATEKEEPER
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(6, 'The Gatekeeper');

    ctx.gatekeeperVerdict = await mutatedAgentStep(
        ADVERSARY,
        `You are reviewing a COMPLETED Master Pitch Deck. This is the final gate before it goes to commissioners.${kbBlock}${optionsSuffix}${wildlifeFocusGuard}${genreLock}

Run your full audit: Canon Audit, YouTuber Check, Lawsuit Check, Boring Check.${genreLabel ? ` Additionally, run a GENRE COMPLIANCE CHECK — verify the pitch consistently serves the locked genre ("${genreLabel}") throughout all sections. Flag any elements that drift into another genre's conventions.` : ''}${isWildlifeSeed ? ` Additionally, run a WILDLIFE PROTAGONIST CHECK — the user explicitly requested a wildlife story. Verify that the pitch's protagonist is an ANIMAL (species, individual, or population), NOT a human. If the pitch centers a human protagonist (e.g., a researcher, ranger, deminer, or conservationist) with animals as background, flag this as WILDLIFE DRIFT and REJECT.` : ''}

### The Pitch Deck to Review
${ctx.finalPitchDeck}

### Original Seed Idea
"${seedIdea}"

Deliver your verdict in the specified format. Be brutal. Be specific. Cite exact series/episodes if this is derivative.`,
        cbs,
        { tools: [{ googleSearch: {} }] }
    );

    cbs.onPhaseComplete(6);

    // ─── ADVERSARY GATE: Revision loop instead of kill switch ──────
    let gatekeeperScore = extractScore(ctx.gatekeeperVerdict);
    let verdictUpper = ctx.gatekeeperVerdict.toUpperCase();
    let isHardReject = verdictUpper.includes('BURN IT DOWN') ||
        (verdictUpper.includes('REJECTED') && !verdictUpper.includes('GREENLIT'));
    let isFatalScore = gatekeeperScore !== null && gatekeeperScore < 80; // Fix 2: < 80 instead of < 40 to close pardon loophole
    let adversaryAttempts = 0;

    while ((isHardReject || isFatalScore) && adversaryAttempts < maxRevisions) {
        adversaryAttempts++;
        cbs.onPhaseStart(6, `🔄 Gatekeeper Revision — Attempt ${adversaryAttempts}/${maxRevisions}`);

        // Feed Adversary critique back to Showrunner for revision
        ctx.finalPitchDeck = await mutatedAgentStep(
            SHOWRUNNER,
            `The Gatekeeper has REJECTED this pitch (${gatekeeperScore ?? '?'}/100). This is revision attempt ${adversaryAttempts} of ${maxRevisions}.${genreLock}

### Gatekeeper's Critique:
${ctx.gatekeeperVerdict}

### Current Pitch Card:
${ctx.finalPitchDeck}

### Original Seed Idea:
"${seedIdea}"

Address the Gatekeeper's SPECIFIC concerns and produce a REVISED compact pitch card with ONLY these 5 sections:
1. **Title** — ## heading
2. **Logline** — One sentence, max 25 words. No camera tech or production techniques — sell the story, not the gear.
3. **Summary** — 3-5 sentences, cinematic and compelling
4. **Best For** — Top 1-3 platforms with one-line justification each
5. **Sources** — Use your Google Search tool to verify each source. For every factual claim in the Summary: either find a real URL that directly supports it, or rewrite the claim to match what a real source actually says. Do NOT invent URLs. Do NOT carry forward unverified URLs from the previous pitch card.

CRITICAL: Output ONLY these 5 sections. No preamble, no agent meta-commentary, no "INCORPORATING PROVOCATION" lines. Start with the ## Title heading.`,
            cbs,
            { tools: [{ googleSearch: {} }] }
        );


        // Adversary reviews the revision
        ctx.gatekeeperVerdict = await mutatedAgentStep(
            ADVERSARY,
            `You previously REJECTED this pitch (${gatekeeperScore ?? '?'}/100). The Showrunner has revised it based on your critique. This is revision ${adversaryAttempts} of ${maxRevisions}.${kbBlock}${optionsSuffix}${genreLock}

### Your Previous Critique:
${ctx.gatekeeperVerdict}

### REVISED Pitch Deck:
${ctx.finalPitchDeck}

### Original Seed Idea:
"${seedIdea}"

Re-evaluate. Have your core concerns been addressed? Run your full audit again.${genreLabel ? ` Include a GENRE COMPLIANCE CHECK — verify the pitch serves the locked genre ("${genreLabel}") throughout.` : ''} If the revision genuinely fixes the problems, you MAY upgrade your verdict. If the core issues persist, explain what SPECIFICALLY still fails.`,
            cbs,
            { tools: [{ googleSearch: {} }] }
        );

        // Re-evaluate
        gatekeeperScore = extractScore(ctx.gatekeeperVerdict);
        verdictUpper = ctx.gatekeeperVerdict.toUpperCase();
        isHardReject = verdictUpper.includes('BURN IT DOWN') ||
            (verdictUpper.includes('REJECTED') && !verdictUpper.includes('GREENLIT'));
        isFatalScore = gatekeeperScore !== null && gatekeeperScore < 80;
    }

    // Pipeline complete — clear checkpoint
    clearCheckpoint();

    // ─── PATCH 3: Defamation Guard (post-pipeline scan) ─────────
    const defamationRisk = classifyDefamation(ctx.finalPitchDeck);
    if (defamationRisk === 'CRITICAL') {
        // Strip the problematic content and return a warning
        const defamWarning = `## ⚠️ DEFAMATION GUARD — Content Flagged\n\nThe final pitch card references real individuals in a potentially defamatory fictional context. The content has been held for review.\n\n**Risk Level:** CRITICAL\n\nPlease review the output and remove any fictional negative attributions to real people before publishing.\n\n---\n\n${ctx.finalPitchDeck}`;
        clearCheckpoint();
        return sanitizeFinalOutput(defamWarning);
    }

    // Return the compact pitch card only (Title, Logline, Summary, Best For)
    // ─── URL VALIDATOR: strip broken/hallucinated source links before delivery ───
    try {
        const validated = await validateSources(ctx.finalPitchDeck);
        if (validated.summary.broken > 0) {
            console.warn(`URL Validator: ${validated.note}`);
        }
        clearCheckpoint();
        return sanitizeFinalOutput(validated.output);
    } catch (e) {
        console.warn('URL Validator failed, returning unvalidated output:', e.message);
        clearCheckpoint();
        return sanitizeFinalOutput(ctx.finalPitchDeck);
    }
}

/**
 * Strip agent meta-commentary and roleplay preambles from the final deck output.
 * These patterns occur when LLMs break character and narrate their process.
 */
function sanitizeFinalOutput(text) {
    // Strip outer code fences (```markdown...``` or ```...```) that LLMs sometimes wrap around output
    let cleaned = text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, '$1');

    // The compact output format starts with a ## Title heading.
    // Strip EVERYTHING before the first ## heading — this removes all preamble,
    // action plans, meta-commentary, "Here's the revised pitch card:" etc.
    const titleMatch = cleaned.match(/^(## .+)/m);
    if (titleMatch) {
        cleaned = cleaned.slice(cleaned.indexOf(titleMatch[0]));
    }

    // Remove agent routing like "(Routed to Scientific Consultant/Scriptwriter)"
    cleaned = cleaned.replace(/\(Routed to [^)]+\)/gi, '');

    // Remove "INCORPORATING PROVOCATION" meta-commentary that leaks from the prompt
    cleaned = cleaned.replace(/\n*INCORPORATING PROVOCATION:.*(?:\n(?!##|$|\*\*).*)*/gi, '');

    // Strip trailing meta-sections the LLM sometimes appends after the pitch card.
    // The pitch card has 5 sections: Title (##), Logline, Summary, Best For, Sources.
    // Anything that starts a new ## heading after the title (like "Revision Directives",
    // "Action Items", "Notes", "Key Changes") is meta-commentary and must be stripped.
    const lines = cleaned.split('\n');
    let cutIndex = -1;
    for (let i = 1; i < lines.length; i++) { // Start at 1 to skip the title itself
        const line = lines[i].trim();
        if (/^##\s+/.test(line)) {
            // This is a second ## heading — everything from here is meta-commentary
            cutIndex = i;
            break;
        }
    }
    if (cutIndex > 0) {
        cleaned = lines.slice(0, cutIndex).join('\n');
    }

    // Remove trailing meta-commentary after the pitch card content
    // (e.g., "Let me know if you'd like adjustments..." or "---\n\nAction Items:...")
    cleaned = cleaned.replace(/\n---\n+(?:\*\*Action Items?\b[\s\S]*|(?:Let me know|I hope|Is there|Would you|Do you|Shall I)[\s\S]*)$/i, '');
    cleaned = cleaned.replace(/\n+(?:Let me know|I hope|Is there|Would you|Do you|Shall I)\b[^\n]*$/i, '');

    // Clean up excessive leading/trailing whitespace
    cleaned = cleaned.trim();

    return cleaned;
}

/**
 * Run the Treatment Assessment pipeline.
 * Takes an existing treatment/draft, assesses it, then optimizes it.
 *
 * 4 Phases:
 *   1. Analysis  — Market Analyst, Chief Scientist, Field Producer assess the script
 *   2. Murder Board — Commissioning Editor tears it apart
 *   3. Revision — Showrunner directs revisions, Story Producer rewrites, Editor re-reviews
 *   4. Final Output — Optimized Master Pitch Deck
 *
 * @param {string} existingScript — the submitted script
 * @param {object} cbs — UI callbacks
 * @param {number|null} productionYear — optional year for temporal calibration
 */
export async function runAssessment(existingScript, cbs, productionYear = null) {
    const ctx = { existingScript };

    // ─── Anti-hallucination directive (injected into every prompt) ─────
    const FACTUAL_GROUNDING = `

⛔ ABSOLUTE RULE — ZERO HALLUCINATION:
- You may ONLY reference people, locations, organizations, species, and facts that are EXPLICITLY stated in the submitted treatment. Do NOT invent names, researchers, experts, locations, or production details.
- If the treatment mentions "a YouTuber" without naming them, refer to them as "the YouTuber" — do NOT fabricate a name.
- When suggesting new angles, scientists, or techniques in recommendations, you MUST flag them as: [SUGGESTED — VERIFY BEFORE USE]. Never present invented details as established fact.
- If you don't know something, say "the treatment does not specify" — do NOT fill gaps with fabricated information.
- Violation of this rule renders the entire assessment useless.

🛡️ CHARACTER INTEGRITY — ABSOLUTE RULE:
- ASSUME ALL PEOPLE IN THE TREATMENT ARE GOOD PEOPLE. Every person mentioned is a professional with valid motivations and genuine passion. They may disagree, have different methods, or create tension — but they are fundamentally good.
- NEVER use pejorative language for anyone in the treatment. The following words are BANNED when describing people from the treatment: reckless, manipulative, villain, antagonist, deceitful, unethical, irresponsible, fame-hungry, fame-driven, exploitative, suspect, suspicious.
- Tension between characters must be framed as a difference in philosophy, methodology, or priorities — NOT as good vs. bad. Both sides have legitimate perspectives.
- If the treatment describes a YouTuber and a cinematographer with different approaches, BOTH are professionals whose methods have merit. Frame the tension as a generational or philosophical clash, not a moral failing.
- You may sharpen dramatic tension, but NEVER by demonizing anyone. If you suggest reframing a character arc, flag it as [CHARACTER REFRAME — AUTHOR APPROVAL REQUIRED].
`;

    // Retrieve relevant knowledge
    let knowledgeContext = '';
    try {
        knowledgeContext = await retrieveContext(existingScript.slice(0, 500));
    } catch (e) {
        console.warn('Knowledge retrieval skipped:', e.message);
    }
    const kbBlock = knowledgeContext ? `\n\n${knowledgeContext}\n\n` : '';

    // ─── Temporal Calibration ─────────────────────────────
    let calibration = '';
    if (productionYear) {
        const currentYear = new Date().getFullYear();
        const age = currentYear - productionYear;
        calibration = `\n\n⚠️ TEMPORAL CALIBRATION: This script is from ${productionYear} (${age} years ago). You MUST calibrate your assessment to that era:
- **Market context**: Evaluate against the competitive landscape of ${productionYear}, not ${currentYear}. What were buyers commissioning then? What were the trending formats?
- **Technology**: Judge camera tech, VFX, and production methods against ${productionYear}-era capabilities. Do NOT penalize for not using equipment that didn't exist yet.
- **Competitive titles**: Compare against shows that existed by ${productionYear}, not later productions this may have influenced.
- **Innovation credit**: If this script introduced techniques or approaches that are now common, give FULL credit for originality — it was pioneering at the time.
- **Legacy impact**: Note if this production influenced the genre or spawned imitators.
Do NOT evaluate this as a new ${currentYear} pitch. Evaluate it as a ${productionYear} production assessed on its own merits and era.\n\n`;
    }

    // ═══════════════════════════════════════════════════════
    // PHASE 1 — ANALYSIS
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(1, 'Script Analysis');

    ctx.marketAssessment = await agentStep(
        MARKET_ANALYST,
        `You are reviewing an EXISTING wildlife script/draft. Do NOT generate a new concept — analyze what's already here.${FACTUAL_GROUNDING}${calibration}${kbBlock}

### The Submitted Script
${existingScript}

Assess this script's market positioning${productionYear ? ` in the context of the ${productionYear} commissioning landscape` : ' against current market trends and buyer mandates'}. Output:
1. **Market Fit Score** (1-100) — ${productionYear ? `how well this fit the market IN ${productionYear}` : "how well this fits today's market"}
2. **Strengths** — what buyers ${productionYear ? 'responded to (or would have responded to)' : 'would respond to'}
3. **Competitive Position** — ${productionYear ? `name the top competing titles at that time and how this differentiated` : 'how does this stand out vs current competition?'}
4. **Weaknesses** — market blind spots, missing hooks, or oversaturated angles${productionYear ? ' for that era' : ''}
5. ${productionYear ? '**Legacy Impact** — did this production influence the genre? What did it spawn?' : '**Recommendations** — specific changes to improve market viability'}

Use markdown formatting.`,
        cbs
    );

    ctx.scienceAssessment = await agentStep(
        CHIEF_SCIENTIST,
        `You are reviewing an EXISTING wildlife script/draft for scientific accuracy and novelty.${FACTUAL_GROUNDING}${calibration}

### The Submitted Script
${existingScript}

### Market Assessment
${ctx.marketAssessment}

Assess the scientific content${productionYear ? ` against the state of biological knowledge in ${productionYear}` : ''}. Output:
1. **Scientific Accuracy Score** (1-100) — are the behavioral claims correct${productionYear ? ` based on what was known in ${productionYear}?` : '?'}
2. **Novelty Score** (1-100) — how fresh ${productionYear ? `was this vs. what had been filmed by ${productionYear}` : "is this vs. what's been filmed before"}?
3. **Factual Issues** — any inaccuracies, outdated science, or misleading claims
4. **Cinematic Science** — does the script translate biological imperatives into visual spectacle, or does it read like a textbook?
5. **B-Story Integration** — is the secondary species woven into the narrative or just a footnote?

Use markdown formatting.`,
        cbs
    );

    ctx.logisticsAssessment = await agentStep(
        FIELD_PRODUCER,
        `You are reviewing an EXISTING wildlife script/draft for production feasibility.${FACTUAL_GROUNDING}${calibration}

### The Submitted Script
${existingScript}

### Science Assessment
${ctx.scienceAssessment}

Assess the logistics and feasibility${productionYear ? ` with ${productionYear}-era production capabilities` : ''}. Output:
1. **Feasibility Score** (1-100)
2. **Camera & Visual Language** — does the script call for proximity/subjective POV shots (blue-chip standard) or clinical/static observation? What should change?
3. **Sound Design** — does the script define a hyper-real soundscape or rely on generic ambient audio?
4. **Production Risks** — weather, permits, animal unpredictability, access issues
5. **Budget Assessment** — ${productionYear ? 'was the budget realistic for that era?' : 'budget red flags and estimated cost tier'}
6. **Timeline Estimate** — how long would this take to shoot?

Use markdown formatting.`,
        cbs
    );

    cbs.onPhaseComplete(1);

    // ═══════════════════════════════════════════════════════
    // PHASE 2 — THE MURDER BOARD
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(2, 'The Murder Board');

    ctx.critique = await agentStep(
        COMMISSIONING_EDITOR,
        `You are reviewing an EXISTING wildlife script submitted for assessment. This is NOT a generated draft — it was written externally.${FACTUAL_GROUNDING}${calibration}

### The Submitted Script
${existingScript}

### Market Assessment
${ctx.marketAssessment}

### Scientific Assessment
${ctx.scienceAssessment}

### Logistics Assessment
${ctx.logisticsAssessment}

Stress-test this script across ALL 7 vectors:
1. **Cliché Detector** — any visual, narrative beat, or narration line ${productionYear ? `that was already overused by ${productionYear}` : 'the audience has seen before'}? Quote the line.
2. **Cinematic Genre Test** — does the script treat animals as cinematic protagonists (thriller, survival epic, heist) or as biological specimens? A blue-chip pitch needs GENRE energy.
3. **Proximity & POV** — does the camera language create subjective audience experience, or is it clinical observation from a distance?
4. **Narrative Integrity** — 3-act escalation? Genuine ticking clock? B-Story integration (not just backup)?
5. **Sonic Identity** — does the script define a unique soundscape, or is it silent on audio design?
6. **Budget & Ethics** — do the numbers add up? Any animal welfare concerns?
7. **Market Reality Check** — this is MANDATORY:
   - Name specific market trends that favor OR work against this concept (e.g., "ethical wildlife filmmaking is trending on Netflix post-Seaspiracy" or "African wild dog fatigue — 4 similar pitches in the last 3 years")
   - Cite similar past productions by name and their commercial outcome (commissioned, shelved, audience reception)
   - If the market is saturated with similar concepts, say so plainly: "There have been X similar concepts recently — consider differentiating by..."
   - If a trend supports it, say so: "Market trends in [direction] suggest this could land because..."

Output:
- **Overall Score** (1-100)
- Detailed critique organized by vector, quoting specific passages
- **The Genre Gap** — what cinematic genre should this script embody, and how far is it from that? You MUST justify your genre choice with market reasoning (e.g., which streamers are actively commissioning this genre, what audience trends support it, what recent successes prove demand).
- **Market Position** — one paragraph synthesizing your Market Reality Check into a clear strategic recommendation (pursue / pivot / differentiate)
- **Verdict** — specific directives for what must change

Be ruthless but constructive.`,
        cbs
    );

    cbs.onPhaseComplete(2);

    // ═══════════════════════════════════════════════════════
    // PHASE 3 — THE REVISION
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(3, 'The Optimization');

    ctx.revisionPlan = await agentStep(
        SHOWRUNNER,
        `The Commissioning Editor has critiqued the submitted script. Your job is to create a clear optimization plan that elevates this to BLUE-CHIP CINEMATIC standard.${FACTUAL_GROUNDING}${calibration}

### Original Script
${existingScript}

### Editor's Critique
${ctx.critique}

### Team Assessments
- Market: ${ctx.marketAssessment}
- Science: ${ctx.scienceAssessment}
- Logistics: ${ctx.logisticsAssessment}

Parse all feedback and output:
1. **Genre Assignment** — what cinematic genre should this embody? (thriller, survival epic, heist, horror chase, etc.) You MUST justify WHY this genre — cite market trends, streamer preferences, recent commissioning patterns, or audience appetite that make this genre the smart strategic choice.
2. **Priority Fixes** — rank ordered, most critical first
3. **Preserve List** — elements that must NOT be changed
4. **Camera Language Upgrade** — shift from clinical to proximity/subjective POV
5. **Sound Design Directive** — define the hyper-real soundscape
6. **Narration Style** — sparse, poetic, let-the-visuals-breathe (not expository)
7. **Rewrite Directives** — specific instructions for the Story Producer

Be specific and actionable.`,
        cbs
    );

    ctx.optimizedScript = await agentStep(
        STORY_PRODUCER,
        `You are OPTIMIZING an existing wildlife script to BLUE-CHIP CINEMATIC standard. Preserve the core vision while transforming the storytelling.${FACTUAL_GROUNDING}${calibration}

CRITICAL: You are rewriting, NOT inventing. Every person, place, and species in your output must come from the original treatment. If you suggest adding a new character, expert, or location that is NOT in the original, you MUST mark it as [SUGGESTED — VERIFY] and explain why it would strengthen the pitch. Never present invented additions as if they were part of the original.

### Original Script
${existingScript}

### Showrunner's Optimization Plan
${ctx.revisionPlan}

### Key Assessments
- Market: ${ctx.marketAssessment}
- Science: ${ctx.scienceAssessment}

Critical upgrades to apply:
— **Genre-ify**: Treat the animal as a cinematic protagonist in a specific genre (the Showrunner's assignment). The iguana vs. snakes in Planet Earth II was a HORROR-THRILLER ESCAPE, not a "predator-prey study."
— **Proximity over detail**: Replace clinical wide shots with ground-level, gimbal-tracking subjective POV. The audience should feel the terrain.
— **Sonic subjectivity**: Define hyper-real foley — claws scraping, heartbeats, wind fading in moments of exhaustion.
— **Sparse narration**: Cut expository lines. Use short, poetic, resonant phrases. Let silences breathe.
— **B-Story integration**: The secondary species must raise stakes for the primary, not exist as a footnote.

Output:
1. **Key Changes Made** — bullet list of transformations
2. **The Optimized Script** — full 3-Act narrative outline + dual-column A/V script (min 8 rows) with sound design notes and 3 visual signature moments

Use markdown formatting.`,
        cbs
    );

    ctx.finalReview = await agentStep(
        COMMISSIONING_EDITOR,
        `You previously critiqued the original submitted script with this assessment:${FACTUAL_GROUNDING}

${ctx.critique}

The team has optimized the script. Here is the revised version:

### Optimized Script
${ctx.optimizedScript}

Review the optimization:
1. Has the GENRE GAP been closed? Does it now feel cinematic, not clinical?
2. Camera language — proximity/subjective POV vs. clinical observation?
3. Sound design — hyper-real foley vs. generic ambient?
4. Narration — sparse/poetic vs. expository?
5. B-Story integration — woven in or stapled on?
6. Score the revised script (1-100)
7. Compare to original — quantify the improvement
8. Final verdict: Greenlight or further revision needed?`,
        cbs
    );

    cbs.onPhaseComplete(3);

    // ═══════════════════════════════════════════════════════
    // PHASE 4 — FINAL OUTPUT
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(4, 'Final Output — Optimized Pitch Deck');

    ctx.finalPitchDeck = await agentStep(
        SHOWRUNNER,
        `Compile the final compact pitch card from the assessment and revision process.${FACTUAL_GROUNDING}${calibration}

### Optimized Script
${ctx.optimizedScript}

### Editor's Final Review
${ctx.finalReview}

Output ONLY these 4 sections — nothing else:

1. **Title** — As a prominent ## heading. Keep original if strong, or propose a better one.
2. **Logline** — One sentence, max 25 words, hook + stakes + what makes this story unique. Uniqueness must come from the STORY (subject, behavior, scientific revelation, narrative angle) — NEVER from camera technology or production techniques. Format: **Logline:** followed by the sentence.
3. **Summary** — 3-5 sentences selling the project to a non-specialist. Cinematic, vivid, irresistible. Format: **Summary:** followed by the paragraph.
4. **Best For** — Top 1-3 platforms (e.g., Netflix, Apple TV+, BBC Studios, Disney+, Amazon Prime, ZDF/ARTE) with a one-line justification per platform. Format: **Best For:** followed by the list.

CRITICAL FORMAT RULES:
- Output ONLY these 4 sections — no A/V scripts, no logistics, no market analysis
- No preamble, no agent commentary
- Start directly with the ## Title heading
- Clean, compact, and presentation-ready.`,
        cbs
    );

    cbs.onPhaseComplete(4);

    // ─── Compose final document: 3 sections ─────────────────
    const cleanPitchCard = sanitizeFinalOutput(ctx.finalPitchDeck);

    // Extract scores for the quality scorecard
    const beforeMatch = ctx.critique.match(/overall\s*score[:\s]*(\d{1,3})/i);
    const afterMatch = ctx.finalReview.match(/score[:\s]*(\d{1,3})/i);
    const beforeScore = beforeMatch ? parseInt(beforeMatch[1], 10) : null;
    const afterScore = afterMatch ? parseInt(afterMatch[1], 10) : null;

    // Build quality scorecard
    let scorecard = '';
    if (beforeScore !== null && afterScore !== null) {
        const beforeColor = beforeScore >= 70 ? '#37b24d' : beforeScore >= 50 ? '#f59f00' : '#e03131';
        const afterColor = afterScore >= 70 ? '#37b24d' : afterScore >= 50 ? '#f59f00' : '#e03131';
        scorecard = `

---

## Quality Scorecard

| | Score | |
|---|---|---|
| **Original Treatment** | **${beforeScore}/100** | ${'█'.repeat(Math.round(beforeScore / 5))}${'░'.repeat(20 - Math.round(beforeScore / 5))} |
| **Optimized Version** | **${afterScore}/100** | ${'█'.repeat(Math.round(afterScore / 5))}${'░'.repeat(20 - Math.round(afterScore / 5))} |

**Improvement: +${afterScore - beforeScore} points**`;
    }

    const fullOutput = [
        `# Assessment`,
        ``,
        ctx.critique,
        ``,
        `---`,
        ``,
        `# Optimized Pitch Card`,
        ``,
        cleanPitchCard,
        scorecard,
    ].join('\n');

    return fullOutput;
}

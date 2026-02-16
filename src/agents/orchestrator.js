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
} from './personas.js';
import { retrieveContext } from '../knowledge/rag.js';
import { saveCheckpoint, clearCheckpoint } from '../pipelineState.js';

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
    const result = await callAgent(agent.systemPrompt, prompt, agentOpts);
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
export async function runPipeline(seedIdea, cbs, opts = {}) {
    const { platform = null, year = null, directive = null, checkpoint = null, maxRevisions = 3, genrePreference = null } = opts;

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
        'process-doc': 'The "Process" Doc — Meta-commentary on the difficulty and ethics of the shoot as proof-of-work',
        'symbiotic-pov': 'Symbiotic POV — Extreme immersion via on-animal cameras and bio-logging data',
    };
    const genreLabel = genrePreference ? genreLabels[genrePreference] || genrePreference : null;
    const genreNote = genreLabel
        ? `\n🎭 GENRE LENS (USER-SELECTED): The user has requested the narrative be framed through a **${genreLabel}** genre lens. Prioritize this genre in your Layer 2 Cross-Genre Import analysis. Your Primary Narrative Form recommendation MUST use this genre lens. Still provide an Alternative Form using a DIFFERENT genre for contrast.\n`
        : '';

    // ─── GENRE LOCK: Enforced across ALL agents when user selects a genre ──────
    const genreLock = genreLabel
        ? `\n\n🔒 GENRE LOCK (DEFAULT — USER-SELECTED FROM UI):\nThe user has locked this pitch to the **${genreLabel}** genre via the UI dropdown. This is the default genre unless the seed text explicitly specifies a different genre.\n- ALL narrative structure, tone, camera language, pacing, sound design, and scoring criteria MUST serve this genre.\n- Do NOT drift into survival thriller, underdog, or any other genre convention unless it IS the locked genre.\n- If you reference narrative techniques, they must come from the locked genre's playbook — not from generic wildlife documentary conventions.\n- The Market Analyst's Narrative Mandate is SUBORDINATE to this genre lock. If the Analyst recommended a different form, OVERRIDE it with the locked genre.\n- Violation of the genre lock will be flagged as GENRE DRIFT and rejected.\n- EXCEPTION: If the seed text explicitly names a different genre (e.g. "make this a comedy"), the seed text takes priority over this UI lock.\n`
        : '';
    // ─── SEED OVERRIDE RULE ──────────────────────────────────
    // The seed text is the user's free-form creative input and is the HIGHEST
    // priority source of truth.  If the seed explicitly specifies a genre,
    // platform, delivery year, scientific premise, location, species, or any
    // other production parameter, those seed-level directives MUST override the
    // corresponding UI-derived settings (platform, year, genre dropdown, etc.).
    const seedOverrideNote = `\n\n⚡ SEED OVERRIDE RULE: The user's seed text is the highest-priority creative brief. If the seed text explicitly specifies a genre, platform, delivery year, target audience, scientific premise, species, location, or any other production parameter, those directives OVERRIDE the corresponding UI settings below. The UI settings (platform, year, genre) are defaults — the seed text is the final word.\n`;

    const optionsSuffix = seedOverrideNote + platformNote + yearNote + directiveNote + genreNote;

    // Retrieve relevant knowledge from the vector store (no-op if empty)
    let knowledgeContext = '';
    try {
        knowledgeContext = await retrieveContext(seedIdea);
    } catch (e) {
        console.warn('Knowledge retrieval skipped:', e.message);
    }

    const kbBlock = knowledgeContext ? `\n\n${knowledgeContext}\n\n` : '';

    // ═══════════════════════════════════════════════════════
    // PHASE 0 — DISCOVERY SCOUT
    // ═══════════════════════════════════════════════════════
    if (!shouldSkip('discovery')) {
        cbs.onPhaseStart(0, '🔬 Scouting Recent Discoveries');

        let discoveryBrief = '';
        try {
            discoveryBrief = await agentStep(
                DISCOVERY_SCOUT,
                `Search for recent scientific discoveries, novel behaviors, and new species related to: "${seedIdea}"${optionsSuffix}${genreLock}\n\nFocus on findings from the last 12 months that could make a wildlife documentary genuinely unprecedented.${genreLabel ? ` Prioritize discoveries relevant to the **${genreLabel}** genre lens.` : ''} Return a structured Discovery Brief.`,
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

    const discoveryBrief = ctx._discoveryBrief || '';
    const discoveryBlock = discoveryBrief ? `\n\n--- DISCOVERY BRIEF (Recent Scientific Findings) ---\n${discoveryBrief}\n--- END DISCOVERY BRIEF ---\n\n` : '';

    // ═══════════════════════════════════════════════════════
    // PHASE 1 — THE BRAINSTORM
    // ═══════════════════════════════════════════════════════
    if (!shouldSkip('marketMandate')) {
        cbs.onPhaseStart(1, 'The Brainstorm');

        ctx.marketMandate = await agentStep(
            MARKET_ANALYST,
            `The seed idea is: "${seedIdea}"${kbBlock}${discoveryBlock}${optionsSuffix}Analyze this against current market trends. You MUST include: specific buyer slate gaps with platform names, 3 trend examples with series names and years, competitive differentiation against the top 3 closest existing titles, and a budget tier recommendation. Output your full Market Mandate.`,
            cbs,
            { tools: [{ googleSearch: {} }] }
        );
        checkpoint_('marketMandate', 1);
    }

    // ─── NARRATIVE MANDATE EXTRACTION ─────────────────────────────
    // Extract the narrative strategy from the Market Analyst's output and thread it
    // as a binding directive to all downstream agents (similar to speciesGuard).
    const narrativeMatch = ctx.marketMandate.match(/(?:Narrative Strategy|Narrative Form|Recommended Form|Primary Recommendation)[^:]*:?\s*\**([^\n]+)/i);
    const narrativeForm = narrativeMatch ? narrativeMatch[1].trim().replace(/\*+$/g, '').trim() : null;
    const narrativeMandate = narrativeForm
        ? `\n\n🎭 NARRATIVE MANDATE (BINDING): The Market Analyst has recommended the following narrative form: "${narrativeForm}". ALL agents MUST respect this form. Do NOT default to survival thriller unless this IS the recommended form. Your output — structure, tone, camera language, pacing, and scoring criteria — must serve this narrative form, not a generic thriller template.\n`
        : '';

    if (!shouldSkip('animalFactSheet')) {
        ctx.animalFactSheet = await agentStep(
            CHIEF_SCIENTIST,
            `The seed idea is: "${seedIdea}"${kbBlock}${discoveryBlock}${optionsSuffix}${genreLock}${narrativeMandate}Here is the Market Mandate from the Market Analyst:\n\n${ctx.marketMandate}\n\nBased on this, propose novel animal behaviors with peer-reviewed citations. You MUST include: the primary species with scientific name and biological mechanism, a mandatory B-Story backup species, exact location/seasonality, ethical considerations, and the visual payoff. Output your full Animal Fact Sheet.`,
            cbs,
            { tools: [{ googleSearch: {} }] }
        );
        checkpoint_('animalFactSheet', 1);
    }

    // ─── SCIENCE GATE: Pivot loop instead of kill switch ──────
    let scienceAttempts = 0;
    while (detectRejection(ctx.animalFactSheet).rejected && scienceAttempts < maxRevisions) {
        scienceAttempts++;
        cbs.onPhaseStart(1, `🔄 Science Pivot — Attempt ${scienceAttempts}/${maxRevisions}`);

        // Ask the Scientist to propose the closest viable alternative
        ctx.animalFactSheet = await agentStep(
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
4. **Produce a complete Animal Fact Sheet** with all required sections (Primary Species, Antagonist, Vulnerability Window, Novelty, B-Story, Biome, Ethics, Visual Payoff)${genreLabel ? `
5. **Respect the genre lock** — your proposed alternative MUST serve the **${genreLabel}** genre. Select behaviors and framing that fit this genre's conventions.` : ''}

You are a CREATIVE SCIENTIST, not a gatekeeper. Find a way to make it work.`,
            cbs,
            { tools: [{ googleSearch: {} }] }
        );
    }

    if (!shouldSkip('logisticsBreakdown')) {
        ctx.logisticsBreakdown = await agentStep(
            FIELD_PRODUCER,
            `The seed idea is: "${seedIdea}"${kbBlock}${genreLock}${narrativeMandate}\n\nHere is the Animal Fact Sheet from the Chief Scientist:\n\n${ctx.animalFactSheet}\n\nAssess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Your equipment, crew, and shooting approach recommendations MUST serve the declared genre — different genres demand different production setups. Output your full Logistics & Feasibility Breakdown.`,
            cbs
        );
        checkpoint_('logisticsBreakdown', 1);
    }

    // ─── ETHICAL GATE: Two-stage revision loop ─────────
    const ethicsCheck = detectRejection(ctx.logisticsBreakdown);
    if (ethicsCheck.rejected) {
        // STAGE 1: Give Field Producer a second chance with explicit calibration
        cbs.onPhaseStart(2, '🔄 Ethical Review — Proportionality Check');

        ctx.logisticsBreakdown = await agentStep(
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
            ctx.animalFactSheet = await agentStep(
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
4. **Produce a revised complete Animal Fact Sheet** — ensure the ethical red flags section explicitly addresses the Field Producer's concerns with specific mitigation protocols${genreLabel ? `
5. **Respect the genre lock** — your revised approach MUST still serve the **${genreLabel}** genre.` : ''}

The pipeline iterates, it does not kill. Find a way.`,
                cbs,
                { tools: [{ googleSearch: {} }] }
            );

            // Re-run Field Producer on the revised approach
            ctx.logisticsBreakdown = await agentStep(
                FIELD_PRODUCER,
                `The seed idea is: "${seedIdea}"${kbBlock}${genreLock}${narrativeMandate}\n\nHere is the REVISED Animal Fact Sheet from the Chief Scientist (revised to address your previous ethical concerns):\n\n${ctx.animalFactSheet}\n\nAssess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Your equipment and crew recommendations MUST serve the ${genreLabel ? `locked genre ("${genreLabel}")` : 'declared narrative form'} — different genres demand different production setups. Output your full Logistics & Feasibility Breakdown.`,
                cbs
            );
        }
    }

    cbs.onPhaseComplete(1);

    // ═══════════════════════════════════════════════════════
    // PHASE 2 — DRAFT V1
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(2, 'Draft V1');

    // ─── SPECIES DRIFT GUARD ─────────────────────────────
    // Extract the hero species from the Scientist's output to enforce Zero Species Drift
    const speciesMatch = ctx.animalFactSheet.match(/(?:Primary Species|Hero Species|Hero Animal)[^:]*:\s*\**([^(*\n]+)/i);
    const heroSpecies = speciesMatch ? speciesMatch[1].trim().replace(/\*+$/, '').trim() : null;
    const speciesGuard = heroSpecies
        ? `\n\n⚠️ ZERO SPECIES DRIFT ENFORCEMENT: Your hero species MUST be "${heroSpecies}" as identified by the Chief Scientist. If you change, swap, or substitute this species for a different animal, your output will be flagged as SPECIES DRIFT and REJECTED. You may creatively reinterpret the angle, but the animal stays.\n`
        : '';

    if (!shouldSkip('draftV1')) {
        ctx.draftV1 = await agentStep(
            STORY_PRODUCER,
            `The seed idea is: "${seedIdea}"${kbBlock}${discoveryBlock}${optionsSuffix}${speciesGuard}${genreLock}${narrativeMandate}\n\nHere are the team's inputs:\n\n### Market Mandate\n${ctx.marketMandate}\n\n### Animal Fact Sheet\n${ctx.animalFactSheet}\n\n### Logistics & Feasibility\n${ctx.logisticsBreakdown}\n\nSynthesize all of this into a complete pitch narrative.\n\nCRITICAL: ${genreLabel ? `The user has LOCKED the genre to "${genreLabel}". Your ENTIRE output — structure, tone, camera language, pacing, narration style, sound design — must serve this genre. Do NOT import conventions from other genres.` : `The Market Analyst has recommended a **Narrative Form** in their Market Mandate (Section 7: Narrative Strategy Recommendation). You MUST follow it. Read their Primary and Alternative recommendations, choose one, and build your entire output around it.`}\n\nDeliver ALL elements specified in your output format instructions for the chosen narrative form, plus ALL universal elements (Anthropocene Reality, Visual Signature Moments, Technology Justification, A/V Script Excerpt).\n\nDo NOT default to survival thriller unless ${genreLabel ? `the locked genre IS survival thriller` : `the Market Analyst specifically recommended it`}. Adopt the locked genre's conventions fully.\n\nEnsure the B-Story species is woven into the narrative, not just mentioned as a footnote.`,
            cbs
        );
        checkpoint_('draftV1', 2);
    }

    cbs.onPhaseComplete(2);

    // ═══════════════════════════════════════════════════════
    // PHASE 3 — THE MURDER BOARD
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(3, 'The Murder Board');

    if (!shouldSkip('rejectionMemo')) {
        ctx.rejectionMemo = await agentStep(
            COMMISSIONING_EDITOR,
            `Review the following Draft V1 pitch package:${kbBlock}${genreLock}${narrativeMandate}\n\n### Seed Idea\n"${seedIdea}"\n\n### Market Mandate\n${ctx.marketMandate}\n\n### Animal Fact Sheet\n${ctx.animalFactSheet}\n\n### Logistics & Feasibility\n${ctx.logisticsBreakdown}\n\n### Draft Script (V1)\n${ctx.draftV1}\n\nThis is the FIRST review. Attack across all 14 vectors.\n\nCRITICAL FOR VECTORS 7 & 8: ${genreLabel ? `The user has LOCKED the genre to "${genreLabel}". Evaluate the draft EXCLUSIVELY against this genre's cinematic standards. If the draft drifts into another genre's conventions, flag it as GENRE DRIFT — this is a FATAL FLAW.` : `The Market Analyst declared a narrative form in the Market Mandate. Use THAT form's cinematic standard for your Narrative Integrity Test and Commission Test — do NOT default to survival thriller criteria unless that IS the declared form.`}\n\nQuote specific failing passages. Find at LEAST two substantive flaws. Score honestly — most first drafts land 60-80, but greenlight (85+) if genuinely broadcast-ready.`,
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
        ctx.revisionDirectives = await agentStep(
            SHOWRUNNER,
            `The Commissioning Editor has REJECTED Draft V1 with this memo:\n\n${ctx.rejectionMemo}\n\nOriginal team outputs:\n- Market Mandate: ${ctx.marketMandate}\n- Animal Fact Sheet: ${ctx.animalFactSheet}\n- Logistics: ${ctx.logisticsBreakdown}\n- Draft V1 Script: ${ctx.draftV1}${genreLock}${narrativeMandate}\n\nParse the rejection. Identify exactly what needs to change and which agents are responsible.\n\nCRITICAL: ${genreLabel ? `The genre is LOCKED to "${genreLabel}". ALL revision directives MUST enforce this genre. If the draft drifted into another genre, your primary directive is to pull it back. Issue camera, sound, and narration directives specific to this genre.` : `Review the Market Analyst's Narrative Mandate. Ensure ALL revision directives are consistent with the declared narrative form.`} Do NOT push the draft toward survival thriller unless that IS the ${genreLabel ? 'locked genre' : 'mandate'}. Issue camera, sound, and narration directives appropriate to the form.\n\nOutput clear revision directives for each agent.`,
            cbs
        );
        checkpoint_('revisionDirectives', 4);
    }

    if (!shouldSkip('revisedScience')) {
        ctx.revisedScience = await agentStep(
            CHIEF_SCIENTIST,
            `The Showrunner has issued these revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}${genreLock}\n\nYour original Animal Fact Sheet was:\n${ctx.animalFactSheet}\n\nRevise your output to address the critique. Include a reliable B-Story backup species if demanded. Ensure the visual payoff description supports CINEMATIC proximity shooting, not just scientific observation.${genreLabel ? ` Your revised fact sheet MUST serve the locked genre ("${genreLabel}") — select behaviors and framing that fit this genre's conventions.` : ''} Output a REVISED Animal Fact Sheet.`,
            cbs
        );
        checkpoint_('revisedScience', 4);
    }

    if (!shouldSkip('revisedLogistics')) {
        ctx.revisedLogistics = await agentStep(
            FIELD_PRODUCER,
            `The Showrunner has issued these revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}${genreLock}${narrativeMandate}\n\nYour original Logistics Breakdown was:\n${ctx.logisticsBreakdown}\n\nThe revised science is:\n${ctx.revisedScience}\n\nRevise your output. Ensure camera, sound, and crew upgrades are appropriate to the ${genreLabel ? `locked genre ("${genreLabel}")` : 'declared narrative form'} — a forensic investigation may need macro-probe rigs and laboratory setups, while a vérité film needs long-lens patience rigs and minimal crew footprint. Ensure contingency plans include B-roll backup sequences.\n\nOutput a REVISED Logistics & Feasibility Breakdown.`,
            cbs
        );
        checkpoint_('revisedLogistics', 4);
    }

    if (!shouldSkip('draftV2')) {
        ctx.draftV2 = await agentStep(
            STORY_PRODUCER,
            `The Showrunner has issued revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}${speciesGuard}${genreLock}${narrativeMandate}\n\nRevised inputs:\n- Market Mandate: ${ctx.marketMandate}\n- Revised Animal Fact Sheet: ${ctx.revisedScience}\n- Revised Logistics: ${ctx.revisedLogistics}\n\nYour original Draft V1 was:\n${ctx.draftV1}\n\nRewrite the script addressing ALL critique points. FORM-SPECIFIC UPGRADE CHECKLIST — apply the standards for the ${genreLabel ? `LOCKED genre ("${genreLabel}")` : 'DECLARED narrative form'}:\n✓ Commit fully to the ${genreLabel ? 'locked genre\'s' : 'declared form\'s'} cinematic language\n✓ Every key moment must have defined visual AND audio signatures appropriate to the genre\n✓ Narration style must match the genre\n✓ B-Story woven in — the secondary species must serve the chosen genre, not just be backup\n✓ Do NOT drift into survival thriller or any other genre's conventions unless that IS the ${genreLabel ? 'locked genre' : 'declared form'}\n\nOutput a REVISED 3-Act narrative and dual-column A/V script with sound design notes (Draft V2).`,
            cbs
        );
        checkpoint_('draftV2', 4);
    }

    if (!shouldSkip('greenlightReview')) {
        ctx.greenlightReview = await agentStep(
            COMMISSIONING_EDITOR,
            `You previously rejected the Draft V1 with this memo:\n\n${ctx.rejectionMemo}${genreLock}${narrativeMandate}\n\nThe team has revised their work. Here is Draft V2:\n\n### Revised Animal Fact Sheet\n${ctx.revisedScience}\n\n### Revised Logistics\n${ctx.revisedLogistics}\n\n### Draft Script (V2)\n${ctx.draftV2}\n\nReview the revisions. Check:\n1. Have the fatal flaws been addressed?\n2. Does the pitch NOW commit fully to the ${genreLabel ? `locked genre ("${genreLabel}")` : 'declared narrative form'} (not defaulting to thriller)?\n3. Camera, sound, and narration language — are they appropriate for the ${genreLabel ? 'LOCKED genre' : 'DECLARED form'}?\n4. B-Story: woven into the genre, not just listed as backup?\n${genreLabel ? `5. GENRE DRIFT CHECK: Flag ANY element that belongs to a different genre\'s conventions.\n` : ''}\nScore the revised pitch. If genuinely resolved, Greenlight (85+). If not, explain what still needs work.`,
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
        const tighterDirectives = await agentStep(
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
        currentDraft = await agentStep(
            STORY_PRODUCER,
            `Draft V${draftNumber - 1} scored ${currentScore}/100 — below threshold. Here are the Showrunner's targeted revision directives:\n\n${tighterDirectives}${speciesGuard}${genreLock}${narrativeMandate}\n\nYour previous draft:\n${currentDraft}\n\nRevised inputs:\n- Market Mandate: ${ctx.marketMandate}\n- Animal Fact Sheet: ${ctx.revisedScience || ctx.animalFactSheet}\n- Logistics: ${ctx.revisedLogistics || ctx.logisticsBreakdown}\n\nFix the SPECIFIC issues identified. Do not regress on elements that were already working. Output Draft V${draftNumber}.`,
            cbs
        );

        // Editor reviews the new draft
        currentReview = await agentStep(
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

    // ─── CONTEXT COMPACTION ─────────────────────────────────
    // The Showrunner doesn't need the full Market Mandate analysis (competitive
    // landscape detail, slate gap analysis, etc.). Extract key directives only.
    const compactMandate = (() => {
        const sections = [];
        // Extract narrative strategy section
        const narrativeSection = ctx.marketMandate.match(/(?:#{1,3}\s*(?:\d+[\.\)]\s*)?(?:Narrative Strategy|Narrative Form|Narrative Architecture)[^\n]*\n)([\s\S]*?)(?=\n#{1,3}\s|\n\d+[\.\)]\s[A-Z]|$)/i);
        if (narrativeSection) sections.push('**Narrative Strategy:** ' + narrativeSection[1].trim().substring(0, 500));
        // Extract platform recommendation
        const platformSection = ctx.marketMandate.match(/(?:#{1,3}\s*(?:\d+[\.\)]\s*)?(?:Platform|Buyer|Target)[^\n]*\n)([\s\S]*?)(?=\n#{1,3}\s|\n\d+[\.\)]\s[A-Z]|$)/i);
        if (platformSection) sections.push('**Platform Fit:** ' + platformSection[1].trim().substring(0, 300));
        // Extract budget tier
        const budgetSection = ctx.marketMandate.match(/(?:#{1,3}\s*(?:\d+[\.\)]\s*)?(?:Budget)[^\n]*\n)([\s\S]*?)(?=\n#{1,3}\s|\n\d+[\.\)]\s[A-Z]|$)/i);
        if (budgetSection) sections.push('**Budget:** ' + budgetSection[1].trim().substring(0, 200));
        // Fallback: if extraction fails, use first 1000 chars
        return sections.length > 0 ? sections.join('\n\n') : ctx.marketMandate.substring(0, 1000) + '\n\n[… truncated for context efficiency]';
    })();

    if (!shouldSkip('finalPitchDeck')) {
        ctx.finalPitchDeck = await agentStep(
            SHOWRUNNER,
            `The Commissioning Editor has given the Greenlight. Compile the final compact pitch card.${kbBlock}${genreLock}

Use ALL of the following approved materials to distill the essence:

### Market Mandate (Key Directives)
${compactMandate}

### Final A/V Scriptment (Draft V2)
${ctx.draftV2}

### Editor's Final Review
${ctx.greenlightReview}

Output ONLY these 4 sections — nothing else:

1. **Title** — As a prominent ## heading. Evocative, marketable, unique.
2. **Logline** — One sentence, max 25 words, hook + stakes + uniqueness. Format: **Logline:** followed by the sentence.
3. **Summary** — 3-5 sentences selling the project to a non-specialist. Cinematic, vivid, irresistible. Format: **Summary:** followed by the paragraph.
4. **Best For** — Top 1-3 platforms (e.g., Netflix, Apple TV+, BBC Studios, Disney+, Amazon Prime, ZDF/ARTE) with a one-line justification per platform. Format: **Best For:** followed by the list.

CRITICAL FORMAT RULES:
- Output ONLY these 4 sections — no A/V scripts, no logistics, no market analysis, no scientific backbone
- No agent commentary, no preamble, no "Okay, Showrunner here"
- Do NOT include action items, revision directives, or routing instructions
- Start directly with the ## Title heading
- This must be clean, compact, and presentation-ready.`,
            cbs
        );
        checkpoint_('finalPitchDeck', 5);
    }

    cbs.onPhaseComplete(5);

    // ═══════════════════════════════════════════════════════
    // PHASE 6 — THE GATEKEEPER
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(6, 'The Gatekeeper');

    ctx.gatekeeperVerdict = await agentStep(
        ADVERSARY,
        `You are reviewing a COMPLETED Master Pitch Deck. This is the final gate before it goes to commissioners.${kbBlock}${optionsSuffix}${genreLock}

Run your full audit: Canon Audit, YouTuber Check, Lawsuit Check, Boring Check.${genreLabel ? ` Additionally, run a GENRE COMPLIANCE CHECK — verify the pitch consistently serves the locked genre ("${genreLabel}") throughout all sections. Flag any elements that drift into another genre's conventions.` : ''}

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
    let isFatalScore = gatekeeperScore !== null && gatekeeperScore < 40;
    let adversaryAttempts = 0;

    while ((isHardReject || isFatalScore) && adversaryAttempts < maxRevisions) {
        adversaryAttempts++;
        cbs.onPhaseStart(6, `🔄 Gatekeeper Revision — Attempt ${adversaryAttempts}/${maxRevisions}`);

        // Feed Adversary critique back to Showrunner for revision
        ctx.finalPitchDeck = await agentStep(
            SHOWRUNNER,
            `The Gatekeeper has REJECTED this pitch (${gatekeeperScore ?? '?'}/100). This is revision attempt ${adversaryAttempts} of ${maxRevisions}.${genreLock}

### Gatekeeper's Critique:
${ctx.gatekeeperVerdict}

### Current Pitch Card:
${ctx.finalPitchDeck}

### Original Seed Idea:
"${seedIdea}"

Address the Gatekeeper's SPECIFIC concerns and produce a REVISED compact pitch card with ONLY these 4 sections:
1. **Title** — ## heading
2. **Logline** — One sentence, max 25 words
3. **Summary** — 3-5 sentences, cinematic and compelling
4. **Best For** — Top 1-3 platforms with one-line justification each

CRITICAL: Output ONLY these 4 sections. No preamble, no agent meta-commentary. Start with the ## Title heading.`,
            cbs
        );

        // Adversary reviews the revision
        ctx.gatekeeperVerdict = await agentStep(
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
        isFatalScore = gatekeeperScore !== null && gatekeeperScore < 40;
    }

    // Pipeline complete — clear checkpoint
    clearCheckpoint();

    // Return the compact pitch card only (Title, Logline, Summary, Best For)
    return sanitizeFinalOutput(ctx.finalPitchDeck);
}

/**
 * Strip agent meta-commentary and roleplay preambles from the final deck output.
 * These patterns occur when LLMs break character and narrate their process.
 */
function sanitizeFinalOutput(text) {
    // Strip outer code fences (```markdown...``` or ```...```) that LLMs sometimes wrap around output
    let cleaned = text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, '$1');

    // Remove roleplay preambles like "Okay, Showrunner here. Processing the..."
    cleaned = cleaned.replace(/^(?:Okay|Alright|Right)[,.]\s*(?:Showrunner|Editor|Scientist|Producer|Analyst|Gatekeeper)\s+here[.!]?[\s\S]*?(?=(?:^#|^\*\*Working Title|^\*\*Master Pitch))/mi, '');

    // Remove "Action Items:" blocks that are routing instructions
    cleaned = cleaned.replace(/\n*(?:^|\n)\*\*Action Items[:\s]*\*\*[\s\S]*?(?=(?:^#{1,3} |^\*\*(?:Working Title|Logline|Executive Summary)))/mi, '');
    cleaned = cleaned.replace(/\n*(?:^|\n)Action Items:[\s\S]*?(?=(?:^#{1,3} |^\*\*(?:Working Title|Logline|Executive Summary)))/mi, '');

    // Remove agent routing like "(Routed to Scientific Consultant/Scriptwriter)"
    cleaned = cleaned.replace(/\(Routed to [^)]+\)/gi, '');

    // Remove any remaining "Processing the..." preambles
    cleaned = cleaned.replace(/^Processing the[\s\S]*?(?=(?:^#|^\*\*))/mi, '');

    // Clean up excessive leading whitespace
    cleaned = cleaned.replace(/^\s+/, '');

    return cleaned;
}

/**
 * Run the Script Assessment pipeline.
 * Takes an existing script/draft, assesses it, then optimizes it.
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
        `You are reviewing an EXISTING wildlife script/draft. Do NOT generate a new concept — analyze what's already here.${calibration}${kbBlock}

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
        `You are reviewing an EXISTING wildlife script/draft for scientific accuracy and novelty.${calibration}

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
        `You are reviewing an EXISTING wildlife script/draft for production feasibility.${calibration}

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
        `You are reviewing an EXISTING wildlife script submitted for assessment. This is NOT a generated draft — it was written externally.${calibration}

### The Submitted Script
${existingScript}

### Market Assessment
${ctx.marketAssessment}

### Scientific Assessment
${ctx.scienceAssessment}

### Logistics Assessment
${ctx.logisticsAssessment}

Stress-test this script across ALL 6 vectors:
1. **Cliché Detector** — any visual, narrative beat, or narration line ${productionYear ? `that was already overused by ${productionYear}` : 'the audience has seen before'}? Quote the line.
2. **Cinematic Genre Test** — does the script treat animals as cinematic protagonists (thriller, survival epic, heist) or as biological specimens? A blue-chip pitch needs GENRE energy.
3. **Proximity & POV** — does the camera language create subjective audience experience, or is it clinical observation from a distance?
4. **Narrative Integrity** — 3-act escalation? Genuine ticking clock? B-Story integration (not just backup)?
5. **Sonic Identity** — does the script define a unique soundscape, or is it silent on audio design?
6. **Budget & Ethics** — do the numbers add up? Any animal welfare concerns?

Output:
- **Overall Score** (1-100)
- Detailed critique organized by vector, quoting specific passages
- **The Genre Gap** — what cinematic genre should this script embody, and how far is it from that?
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
        `The Commissioning Editor has critiqued the submitted script. Your job is to create a clear optimization plan that elevates this to BLUE-CHIP CINEMATIC standard.${calibration}

### Original Script
${existingScript}

### Editor's Critique
${ctx.critique}

### Team Assessments
- Market: ${ctx.marketAssessment}
- Science: ${ctx.scienceAssessment}
- Logistics: ${ctx.logisticsAssessment}

Parse all feedback and output:
1. **Genre Assignment** — what cinematic genre should this embody? (thriller, survival epic, heist, horror chase, etc.)
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
        `You are OPTIMIZING an existing wildlife script to BLUE-CHIP CINEMATIC standard. Preserve the core vision while transforming the storytelling.${calibration}

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
        `You previously critiqued the original submitted script with this assessment:

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
        `Compile the final compact pitch card from the assessment and revision process.${calibration}

### Optimized Script
${ctx.optimizedScript}

### Editor's Final Review
${ctx.finalReview}

Output ONLY these 4 sections — nothing else:

1. **Title** — As a prominent ## heading. Keep original if strong, or propose a better one.
2. **Logline** — One sentence, max 25 words, hook + stakes + uniqueness. Format: **Logline:** followed by the sentence.
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

    return sanitizeFinalOutput(ctx.finalPitchDeck);
}

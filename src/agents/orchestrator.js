import { callAgent } from './gemini.js';
import {
    MARKET_ANALYST,
    CHIEF_SCIENTIST,
    FIELD_PRODUCER,
    STORY_PRODUCER,
    COMMISSIONING_EDITOR,
    SHOWRUNNER,
    ADVERSARY,
} from './personas.js';
import { retrieveContext } from '../knowledge/rag.js';

/**
 * Helper: show a thinking card, call the agent, then fill the card.
 * Optionally accepts agentOpts.tools for Gemini tool use (e.g. Google Search).
 */
async function agentStep(agent, prompt, { onAgentThinking, onAgentOutput }, agentOpts = {}) {
    onAgentThinking(agent);
    const result = await callAgent(agent.systemPrompt, prompt, agentOpts);
    onAgentOutput(agent, result);
    return result;
}

const MAX_REVISIONS = 3;

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
 * @param {number|null} [opts.year] — target production year
 * @returns {Promise<string>} — the final Master Pitch Deck
 */
export async function runPipeline(seedIdea, cbs, opts = {}) {
    const ctx = { seedIdea };
    const { platform = null, year = null } = opts;

    // Build optional context strings
    const platformNote = platform ? `\n\n🎯 TARGET PLATFORM: This pitch is being developed specifically for **${platform}**. Tailor all recommendations — tone, format, budget tier, episode structure — to ${platform}'s commissioning style and audience.\n` : '';
    const yearNote = year ? `\n📅 TARGET PRODUCTION YEAR: ${year}. Calibrate all technology, market, and trend references to this year.\n` : '';
    const optionsSuffix = platformNote + yearNote;

    // Retrieve relevant knowledge from the vector store (no-op if empty)
    let knowledgeContext = '';
    try {
        knowledgeContext = await retrieveContext(seedIdea);
    } catch (e) {
        console.warn('Knowledge retrieval skipped:', e.message);
    }

    const kbBlock = knowledgeContext ? `\n\n${knowledgeContext}\n\n` : '';

    // ═══════════════════════════════════════════════════════
    // PHASE 1 — THE BRAINSTORM
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(1, 'The Brainstorm');

    ctx.marketMandate = await agentStep(
        MARKET_ANALYST,
        `The seed idea is: "${seedIdea}"${kbBlock}${optionsSuffix}Analyze this against current market trends. You MUST include: specific buyer slate gaps with platform names, 3 trend examples with series names and years, competitive differentiation against the top 3 closest existing titles, and a budget tier recommendation. Output your full Market Mandate.`,
        cbs,
        { tools: [{ googleSearch: {} }] }
    );

    ctx.animalFactSheet = await agentStep(
        CHIEF_SCIENTIST,
        `The seed idea is: "${seedIdea}"${kbBlock}${optionsSuffix}Here is the Market Mandate from the Market Analyst:\n\n${ctx.marketMandate}\n\nBased on this, propose novel animal behaviors with peer-reviewed citations. You MUST include: the primary species with scientific name and biological mechanism, a mandatory B-Story backup species, exact location/seasonality, ethical considerations, and the visual payoff. Output your full Animal Fact Sheet.`,
        cbs,
        { tools: [{ googleSearch: {} }] }
    );

    // ─── SCIENCE GATE: Pivot loop instead of kill switch ──────
    let scienceAttempts = 0;
    while (detectRejection(ctx.animalFactSheet).rejected && scienceAttempts < MAX_REVISIONS) {
        scienceAttempts++;
        cbs.onPhaseStart(1, `🔄 Science Pivot — Attempt ${scienceAttempts}/${MAX_REVISIONS}`);

        // Ask the Scientist to propose the closest viable alternative
        ctx.animalFactSheet = await agentStep(
            CHIEF_SCIENTIST,
            `## SCIENCE PIVOT REQUIRED

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
4. **Produce a complete Animal Fact Sheet** with all required sections (Primary Species, Antagonist, Vulnerability Window, Novelty, B-Story, Biome, Ethics, Visual Payoff)

You are a CREATIVE SCIENTIST, not a gatekeeper. Find a way to make it work.`,
            cbs,
            { tools: [{ googleSearch: {} }] }
        );
    }

    ctx.logisticsBreakdown = await agentStep(
        FIELD_PRODUCER,
        `The seed idea is: "${seedIdea}"${kbBlock}\n\nHere is the Animal Fact Sheet from the Chief Scientist:\n\n${ctx.animalFactSheet}\n\nAssess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Output your full Logistics & Feasibility Breakdown.`,
        cbs
    );

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
        while (detectRejection(ctx.logisticsBreakdown).rejected && ethicsAttempts < MAX_REVISIONS) {
            ethicsAttempts++;
            cbs.onPhaseStart(1, `🔄 Ethical Pivot — Attempt ${ethicsAttempts}/${MAX_REVISIONS}`);

            // Ask the Scientist to propose an ethically filmable approach
            ctx.animalFactSheet = await agentStep(
                CHIEF_SCIENTIST,
                `## ETHICAL PIVOT REQUIRED

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
4. **Produce a revised complete Animal Fact Sheet** — ensure the ethical red flags section explicitly addresses the Field Producer's concerns with specific mitigation protocols

The pipeline iterates, it does not kill. Find a way.`,
                cbs,
                { tools: [{ googleSearch: {} }] }
            );

            // Re-run Field Producer on the revised approach
            ctx.logisticsBreakdown = await agentStep(
                FIELD_PRODUCER,
                `The seed idea is: "${seedIdea}"${kbBlock}\n\nHere is the REVISED Animal Fact Sheet from the Chief Scientist (revised to address your previous ethical concerns):\n\n${ctx.animalFactSheet}\n\nAssess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Output your full Logistics & Feasibility Breakdown.`,
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

    ctx.draftV1 = await agentStep(
        STORY_PRODUCER,
        `The seed idea is: "${seedIdea}"${kbBlock}${optionsSuffix}${speciesGuard}\n\nHere are the team's inputs:\n\n### Market Mandate\n${ctx.marketMandate}\n\n### Animal Fact Sheet\n${ctx.animalFactSheet}\n\n### Logistics & Feasibility\n${ctx.logisticsBreakdown}\n\nSynthesize all of this into:\n1. A 3-Act narrative outline with a SPECIFIC ticking clock, at least 3 escalating obstacles in Act 2, a midpoint reversal, and a resonant closing image\n2. 3 visual signature "hero shots" described with camera angle, lens, and biological action\n3. A dual-column A/V script excerpt (minimum 8 rows) with sound design notes\n\nCRITICAL CINEMATIC STANDARD: Treat the animal as a cinematic protagonist in a GENRE (thriller, survival epic, heist, horror chase). The iguana vs. snakes in Planet Earth II was a HORROR-THRILLER ESCAPE, not a "predator-prey study." Genre-ify your narrative.\n\nCamera language must emphasize PROXIMITY and SUBJECTIVE POV — ground-level gimbal tracking, not clinical observation from distance. The audience must feel the terrain, the heat, the urgency.\n\nDefine a HYPER-REAL SOUNDSCAPE — claws scraping on rock, heartbeats in moments of exhaustion, wind fading. Not generic ambient audio.\n\nNarration must be SPARSE and POETIC. Cut expository lines. Let silences breathe. "He is a trespasser in his own land" > "The lizard must compete for territory."\n\nEnsure the B-Story species is woven into the narrative, not just mentioned as a footnote.`,
        cbs
    );

    cbs.onPhaseComplete(2);

    // ═══════════════════════════════════════════════════════
    // PHASE 3 — THE MURDER BOARD
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(3, 'The Murder Board');

    ctx.rejectionMemo = await agentStep(
        COMMISSIONING_EDITOR,
        `Review the following Draft V1 pitch package:${kbBlock}\n\n### Seed Idea\n"${seedIdea}"\n\n### Market Mandate\n${ctx.marketMandate}\n\n### Animal Fact Sheet\n${ctx.animalFactSheet}\n\n### Logistics & Feasibility\n${ctx.logisticsBreakdown}\n\n### Draft Script (V1)\n${ctx.draftV1}\n\nThis is the FIRST review. Attack across all 6 vectors: Cliché Detector, Unicorn Hunt, Disneyfication Scan, Budget Reality Check, Narrative Integrity, and PR/Ethics Risk.\n\nADDITIONALLY test the CINEMATIC STANDARD:\n- Does it feel like a GENRE piece (thriller, survival epic) or a clinical biology lecture?\n- Camera language: proximity/subjective POV or clinical observation from distance?\n- Sound design: hyper-real foley or generic ambient?\n- Narration: sparse/poetic or expository?\n- B-Story: woven in or just listed as backup?\n\nQuote specific failing passages. Find at LEAST two substantive flaws and score UNDER 85.`,
        cbs
    );

    cbs.onPhaseComplete(3);

    // ═══════════════════════════════════════════════════════
    // PHASE 4 — THE REVISION
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(4, 'The Revision');

    ctx.revisionDirectives = await agentStep(
        SHOWRUNNER,
        `The Commissioning Editor has REJECTED Draft V1 with this memo:\n\n${ctx.rejectionMemo}\n\nOriginal team outputs:\n- Market Mandate: ${ctx.marketMandate}\n- Animal Fact Sheet: ${ctx.animalFactSheet}\n- Logistics: ${ctx.logisticsBreakdown}\n- Draft V1 Script: ${ctx.draftV1}\n\nParse the rejection. Identify exactly what needs to change and which agents are responsible. Include directives on:\n- Genre assignment (what cinematic genre should this embody?)\n- Camera language upgrade (proximity/subjective POV)\n- Sound design directive (hyper-real soundscape)\n- Narration style (sparse, let visuals breathe)\n\nOutput clear revision directives for each agent.`,
        cbs
    );

    ctx.revisedScience = await agentStep(
        CHIEF_SCIENTIST,
        `The Showrunner has issued these revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}\n\nYour original Animal Fact Sheet was:\n${ctx.animalFactSheet}\n\nRevise your output to address the critique. Include a reliable B-Story backup species if demanded. Ensure the visual payoff description supports CINEMATIC proximity shooting, not just scientific observation. Output a REVISED Animal Fact Sheet.`,
        cbs
    );

    ctx.revisedLogistics = await agentStep(
        FIELD_PRODUCER,
        `The Showrunner has issued these revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}\n\nYour original Logistics Breakdown was:\n${ctx.logisticsBreakdown}\n\nThe revised science is:\n${ctx.revisedScience}\n\nRevise your output. CRITICAL UPGRADES:\n- Add stabilized proximity rigs (gimbal, probe lens, low-angle tracking) to camera equipment\n- Include a dedicated sound recordist with contact microphone and hydrophone capabilities for hyper-real foley\n- Ensure contingency plans include B-roll backup sequences\n\nOutput a REVISED Logistics & Feasibility Breakdown.`,
        cbs
    );

    ctx.draftV2 = await agentStep(
        STORY_PRODUCER,
        `The Showrunner has issued revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}${speciesGuard}\n\nRevised inputs:\n- Market Mandate: ${ctx.marketMandate}\n- Revised Animal Fact Sheet: ${ctx.revisedScience}\n- Revised Logistics: ${ctx.revisedLogistics}\n\nYour original Draft V1 was:\n${ctx.draftV1}\n\nRewrite the script addressing ALL critique points. CINEMATIC UPGRADE CHECKLIST:\n✓ Genre energy — this must feel like a [thriller/survival epic/heist], not a biology lecture\n✓ Proximity POV — ground-level, gimbal-tracking, subjective camera, not clinical wide shots\n✓ Hyper-real foley — every key moment has a defined sound (claws, heartbeats, wind)\n✓ Sparse narration — cut expository lines, use short poetic phrases, let silences work\n✓ B-Story woven in — the secondary species raises stakes for the primary, not just backup\n\nOutput a REVISED 3-Act narrative and dual-column A/V script with sound design notes (Draft V2).`,
        cbs
    );

    ctx.greenlightReview = await agentStep(
        COMMISSIONING_EDITOR,
        `You previously rejected the Draft V1 with this memo:\n\n${ctx.rejectionMemo}\n\nThe team has revised their work. Here is Draft V2:\n\n### Revised Animal Fact Sheet\n${ctx.revisedScience}\n\n### Revised Logistics\n${ctx.revisedLogistics}\n\n### Draft Script (V2)\n${ctx.draftV2}\n\nReview the revisions. Check:\n1. Have the fatal flaws been addressed?\n2. Does it now feel CINEMATIC — like a genre piece, not a biology lecture?\n3. Camera language: proximity/subjective POV achieved?\n4. Sound design: hyper-real foley defined?\n5. Narration: sparse/poetic, not expository?\n\nScore the revised pitch. If genuinely resolved, Greenlight (85+). If not, explain what still needs work.`,
        cbs
    );

    // ─── QUALITY GATE: Multi-draft revision loop ──────────────
    let currentDraft = ctx.draftV2;
    let currentReview = ctx.greenlightReview;
    let currentScore = extractScore(currentReview);
    let draftNumber = 2;
    let bestDraft = currentDraft;
    let bestScore = currentScore ?? 0;
    let bestReview = currentReview;

    while (currentScore !== null && currentScore < 70 && draftNumber < 2 + MAX_REVISIONS) {
        draftNumber++;
        cbs.onPhaseStart(4, `🔄 Quality Revision — Draft V${draftNumber}`);

        // Showrunner issues tighter revision directives
        const tighterDirectives = await agentStep(
            SHOWRUNNER,
            `The Commissioning Editor scored Draft V${draftNumber - 1} at ${currentScore}/100 — below the 70/100 threshold. This is revision attempt ${draftNumber - 2} of ${MAX_REVISIONS}.

### Editor's Review (${currentScore}/100):
${currentReview}

### The Draft That Failed:
${currentDraft}

### Original Seed Idea:
"${seedIdea}"

Issue SURGICAL revision directives. Focus ONLY on the specific failings the Editor identified. Do not request a complete rewrite — target the exact weaknesses.`,
            cbs
        );

        // Story Producer writes the next draft
        currentDraft = await agentStep(
            STORY_PRODUCER,
            `Draft V${draftNumber - 1} scored ${currentScore}/100 — below threshold. Here are the Showrunner's targeted revision directives:\n\n${tighterDirectives}${speciesGuard}\n\nYour previous draft:\n${currentDraft}\n\nRevised inputs:\n- Market Mandate: ${ctx.marketMandate}\n- Animal Fact Sheet: ${ctx.revisedScience || ctx.animalFactSheet}\n- Logistics: ${ctx.revisedLogistics || ctx.logisticsBreakdown}\n\nFix the SPECIFIC issues identified. Do not regress on elements that were already working. Output Draft V${draftNumber}.`,
            cbs
        );

        // Editor reviews the new draft
        currentReview = await agentStep(
            COMMISSIONING_EDITOR,
            `This is Draft V${draftNumber} — revision attempt ${draftNumber - 2} of ${MAX_REVISIONS}.\n\nPrevious review (V${draftNumber - 1}, ${currentScore}/100):\n${currentReview}\n\n### Draft Script (V${draftNumber}):\n${currentDraft}\n\nReview the revisions. Have the specific failings been addressed? Score the revised pitch. If genuinely resolved, Greenlight (85+). If not, explain what SPECIFICALLY still needs work.`,
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

    ctx.finalPitchDeck = await agentStep(
        SHOWRUNNER,
        `The Commissioning Editor has given the Greenlight. Compile the final Master Pitch Deck.${kbBlock}

Use ALL of the following approved materials:

### Market Mandate
${ctx.marketMandate}

### Revised Scientific Backbone
${ctx.revisedScience}

### Revised Logistics & Camera Tech
${ctx.revisedLogistics}

### Final A/V Scriptment (Draft V2)
${ctx.draftV2}

### Editor's Final Review
${ctx.greenlightReview}

Format the output as a cohesive, beautifully structured Master Pitch Deck with these sections:
1. **Working Title** — Evocative, marketable, unique (not generic)
2. **Logline** — One sentence, max 25 words, with hook + stakes + uniqueness
3. **Market Attractiveness Rating: XX/100** — A single overall commercial viability score. Assess across: (a) buyer demand alignment, (b) competitive whitespace, (c) trend momentum, (d) budget-to-value ratio, (e) global audience reach potential. Show the score prominently as "## 🎯 Market Attractiveness: XX/100" followed by a 1-2 sentence justification.
4. **Executive Summary** — 2-3 paragraphs selling the project to a non-specialist. Lead with visual spectacle.
5. **Market Justification** — Include specific buyer names and slate gaps
6. **Scientific Backbone & Backup B-Story** — Both species with biological credibility
7. **Logistics & Required Camera Tech** — Budget range, shoot duration, key equipment, proximity rigs, sound design capabilities, risk mitigation
8. **The Final A/V Scriptment:**
   - Full 3-Act Summary with ticking clock threaded throughout
   - Dual-Column Script Table (minimum 8 rows, with hyper-real sound design notes)
   - 3 Visual Signature Moments described in detail (camera angle, lens, motion style)

Quality Checks Before Finalizing:
- Ensure NO contradictions between sections
- The ticking clock must be referenced in EVERY section
- Logline must accurately reflect what the script delivers
- Budget tier must match market recommendation
- Remove any remaining anthropomorphic language
- Camera language must emphasize proximity/subjective POV throughout
- Narration in the script must be sparse and poetic, not expository

This must read as ONE cohesive, polished document — not a collage of agent outputs.`,
        cbs
    );

    cbs.onPhaseComplete(5);

    // ═══════════════════════════════════════════════════════
    // PHASE 6 — THE GATEKEEPER
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(6, 'The Gatekeeper');

    ctx.gatekeeperVerdict = await agentStep(
        ADVERSARY,
        `You are reviewing a COMPLETED Master Pitch Deck. This is the final gate before it goes to commissioners.${kbBlock}${optionsSuffix}

Run your full audit: Canon Audit, YouTuber Check, Lawsuit Check, Boring Check.

### The Pitch Deck to Review
${ctx.finalPitchDeck}

### Original Seed Idea
"${seedIdea}"

Deliver your verdict in the specified format. Be brutal. Be specific. Cite exact series/episodes if this is derivative.`,
        cbs
    );

    cbs.onPhaseComplete(6);

    // ─── ADVERSARY GATE: Revision loop instead of kill switch ──────
    let gatekeeperScore = extractScore(ctx.gatekeeperVerdict);
    let verdictUpper = ctx.gatekeeperVerdict.toUpperCase();
    let isHardReject = verdictUpper.includes('BURN IT DOWN') ||
        (verdictUpper.includes('REJECTED') && !verdictUpper.includes('GREENLIT'));
    let isFatalScore = gatekeeperScore !== null && gatekeeperScore < 40;
    let adversaryAttempts = 0;

    while ((isHardReject || isFatalScore) && adversaryAttempts < MAX_REVISIONS) {
        adversaryAttempts++;
        cbs.onPhaseStart(6, `🔄 Gatekeeper Revision — Attempt ${adversaryAttempts}/${MAX_REVISIONS}`);

        // Feed Adversary critique back to Showrunner for revision
        ctx.finalPitchDeck = await agentStep(
            SHOWRUNNER,
            `The Gatekeeper has REJECTED this pitch (${gatekeeperScore ?? '?'}/100). This is revision attempt ${adversaryAttempts} of ${MAX_REVISIONS}.

### Gatekeeper's Critique:
${ctx.gatekeeperVerdict}

### Current Pitch Deck:
${ctx.finalPitchDeck}

### Original Seed Idea:
"${seedIdea}"

Address the Gatekeeper's SPECIFIC concerns:
1. If they flagged derivative content — differentiate more aggressively, find a unique angle
2. If they flagged market saturation — pivot the positioning or target a different platform
3. If they flagged scientific/factual issues — correct them using the approved science
4. If they flagged boring/generic — sharpen the hook, raise the stakes, add cinematic specificity

Produce a REVISED Master Pitch Deck. Do not just change wording — address the structural concerns.`,
            cbs
        );

        // Adversary reviews the revision
        ctx.gatekeeperVerdict = await agentStep(
            ADVERSARY,
            `You previously REJECTED this pitch (${gatekeeperScore ?? '?'}/100). The Showrunner has revised it based on your critique. This is revision ${adversaryAttempts} of ${MAX_REVISIONS}.${kbBlock}${optionsSuffix}

### Your Previous Critique:
${ctx.gatekeeperVerdict}

### REVISED Pitch Deck:
${ctx.finalPitchDeck}

### Original Seed Idea:
"${seedIdea}"

Re-evaluate. Have your core concerns been addressed? Run your full audit again. If the revision genuinely fixes the problems, you MAY upgrade your verdict. If the core issues persist, explain what SPECIFICALLY still fails.`,
            cbs
        );

        // Re-evaluate
        gatekeeperScore = extractScore(ctx.gatekeeperVerdict);
        verdictUpper = ctx.gatekeeperVerdict.toUpperCase();
        isHardReject = verdictUpper.includes('BURN IT DOWN') ||
            (verdictUpper.includes('REJECTED') && !verdictUpper.includes('GREENLIT'));
        isFatalScore = gatekeeperScore !== null && gatekeeperScore < 40;
    }

    // Always append the Gatekeeper's verdict — never block
    return ctx.finalPitchDeck + '\n\n---\n\n' + ctx.gatekeeperVerdict;
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
        `Compile the final Optimized Pitch Deck from the assessment and revision process.${calibration}

### Original Submitted Script
${existingScript}

### Market Assessment
${ctx.marketAssessment}

### Scientific Assessment
${ctx.scienceAssessment}

### Logistics Assessment
${ctx.logisticsAssessment}

### Optimized Script
${ctx.optimizedScript}

### Editor's Final Review
${ctx.finalReview}

Format the output as a cohesive Master Pitch Deck with these sections:
1. **Working Title** — Evocative and marketable (keep original if strong)
2. **Logline** — Max 25 words, hook + stakes + uniqueness
3. **🎯 Market Attractiveness: XX/100** — Overall commercial viability score with 1-2 sentence justification${productionYear ? `, calibrated to the ${productionYear} market` : ''}
4. **Executive Summary** — 2-3 paragraphs, lead with visual spectacle
5. **Assessment Summary** — What was changed and why (before/after comparison)
6. **Market Justification**${productionYear ? ` — calibrated to ${productionYear} competitive landscape` : ''}
7. **Scientific Backbone & B-Story**
8. **Logistics & Camera Tech** — including proximity/POV rigs and sound design capabilities
9. **The Optimized A/V Scriptment** — 3-Act structure with ticking clock + dual-column script (min 8 rows) + 3 visual signature moments + hyper-real sound design notes

Quality Checks:
- This must read as ONE cohesive document
- No contradictions between sections
- Ticking clock threaded throughout
- Narration must be sparse and poetic, not expository
- Camera language must emphasize proximity and subjective POV

Make it presentation-ready.`,
        cbs
    );

    cbs.onPhaseComplete(4);

    return ctx.finalPitchDeck;
}

import { callAgent } from './gemini.js';
import {
    MARKET_ANALYST,
    CHIEF_SCIENTIST,
    FIELD_PRODUCER,
    STORY_PRODUCER,
    COMMISSIONING_EDITOR,
    SHOWRUNNER,
} from './personas.js';
import { retrieveContext } from '../knowledge/rag.js';

/**
 * Helper: show a thinking card, call the agent, then fill the card.
 */
async function agentStep(agent, prompt, { onAgentThinking, onAgentOutput }) {
    onAgentThinking(agent);
    const result = await callAgent(agent.systemPrompt, prompt);
    onAgentOutput(agent, result);
    return result;
}

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
 * Run the full 5-phase multi-agent pipeline.
 *
 * @param {string} seedIdea — the user's seed idea
 * @param {object} cbs
 * @param {function} cbs.onPhaseStart — (phaseNumber, phaseName)
 * @param {function} cbs.onAgentThinking — (agent) — fired BEFORE the API call
 * @param {function} cbs.onAgentOutput — (agent, outputText) — fired AFTER the API call
 * @param {function} cbs.onPhaseComplete — (phaseNumber)
 * @returns {Promise<string>} — the final Master Pitch Deck
 */
export async function runPipeline(seedIdea, cbs) {
    const ctx = { seedIdea };

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
        `The seed idea is: "${seedIdea}"${kbBlock}Analyze this against current market trends. You MUST include: specific buyer slate gaps with platform names, 3 trend examples with series names and years, competitive differentiation against the top 3 closest existing titles, and a budget tier recommendation. Output your full Market Mandate.`,
        cbs
    );

    ctx.animalFactSheet = await agentStep(
        CHIEF_SCIENTIST,
        `The seed idea is: "${seedIdea}"${kbBlock}Here is the Market Mandate from the Market Analyst:\n\n${ctx.marketMandate}\n\nBased on this, propose novel animal behaviors with peer-reviewed citations. You MUST include: the primary species with scientific name and biological mechanism, a mandatory B-Story backup species, exact location/seasonality, ethical considerations, and the visual payoff. Output your full Animal Fact Sheet.`,
        cbs
    );

    // ─── KILL SWITCH: Check for scientific rejection ──────
    const scienceCheck = detectRejection(ctx.animalFactSheet);
    if (scienceCheck.rejected) {
        cbs.onPhaseComplete(1);

        // Skip straight to final output — a brutal rejection memo
        cbs.onPhaseStart(2, '⛔ Pipeline Halted — Scientific Rejection');

        ctx.finalPitchDeck = await agentStep(
            SHOWRUNNER,
            `## ⛔ PIPELINE HALTED — SCIENTIFIC REJECTION

The Chief Scientist has REJECTED this idea as scientifically invalid. The pipeline is being terminated.

### Original Seed Idea
"${seedIdea}"

### Market Analyst's Assessment
${ctx.marketMandate}

### Chief Scientist's REJECTION
${ctx.animalFactSheet}

Your job: Write a BRUTAL, no-nonsense INTERNAL REJECTION MEMO.

Format it as:
## INTERNAL REJECTION MEMO
**TO:** Creative Development Team
**FROM:** Executive Producer (Showrunner)
**PROJECT:** [derive name from seed idea]
**STATUS:** DEAD ON ARRIVAL
**FINAL SCORE: 0/100**

Include:
1. **The Verdict** — one scathing paragraph summarizing why this is dead
2. **Scientific Impossibilities** — itemize every scientific failure the Scientist identified
3. **Why This Cannot Be Fixed** — explain why no amount of revision can save a fundamentally impossible premise
4. **Reputational Risk** — what would happen to the production company if this were pitched to Disney+/BBC/Netflix
5. **Final Note** — a memorable closing line that makes it clear this idea should never be resurrected

Do NOT suggest alternative ideas. Do NOT try to salvage any element. This idea is DEAD.`,
            cbs
        );

        cbs.onPhaseComplete(2);
        return ctx.finalPitchDeck;
    }

    ctx.logisticsBreakdown = await agentStep(
        FIELD_PRODUCER,
        `The seed idea is: "${seedIdea}"\n\nHere is the Animal Fact Sheet from the Chief Scientist:\n\n${ctx.animalFactSheet}\n\nAssess the feasibility with PRODUCER-GRADE specificity. You MUST include: exact camera equipment with model names, crew composition, shoot duration with seasonal windows, itemized budget estimate with actual dollar ranges, permit requirements, risk/contingency plans, and a Unicorn Test probability score. Output your full Logistics & Feasibility Breakdown.`,
        cbs
    );

    // ─── KILL SWITCH: Check for ethical rejection ─────────
    const ethicsCheck = detectRejection(ctx.logisticsBreakdown);
    if (ethicsCheck.rejected) {
        cbs.onPhaseComplete(1);

        cbs.onPhaseStart(2, '⛔ Pipeline Halted — Ethical Rejection');

        ctx.finalPitchDeck = await agentStep(
            SHOWRUNNER,
            `## ⛔ PIPELINE HALTED — ETHICAL REJECTION

The Field Producer has REJECTED this idea due to severe ethical violations. The pipeline is being terminated.

### Original Seed Idea
"${seedIdea}"

### Chief Scientist's Assessment
${ctx.animalFactSheet}

### Field Producer's REJECTION
${ctx.logisticsBreakdown}

Your job: Write a BRUTAL, no-nonsense INTERNAL REJECTION MEMO.

Format it as:
## INTERNAL REJECTION MEMO
**TO:** Creative Development Team
**FROM:** Executive Producer (Showrunner)
**PROJECT:** [derive name from seed idea]
**STATUS:** DEAD ON ARRIVAL — ETHICAL VIOLATION
**FINAL SCORE: 0/100**

Include:
1. **The Verdict** — one scathing paragraph on the ethical failures
2. **Ethical Violations** — itemize every violation the Field Producer identified
3. **Legal & PR Exposure** — what lawsuits, permit revocations, or PR disasters would result
4. **Industry Consequences** — how this would affect the production company's reputation and future commissions
5. **Final Note** — a memorable closing line

Do NOT suggest ethical alternatives. Do NOT try to salvage. This approach is DEAD.`,
            cbs
        );

        cbs.onPhaseComplete(2);
        return ctx.finalPitchDeck;
    }

    cbs.onPhaseComplete(1);

    // ═══════════════════════════════════════════════════════
    // PHASE 2 — DRAFT V1
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(2, 'Draft V1');

    ctx.draftV1 = await agentStep(
        STORY_PRODUCER,
        `The seed idea is: "${seedIdea}"\n\nHere are the team's inputs:\n\n### Market Mandate\n${ctx.marketMandate}\n\n### Animal Fact Sheet\n${ctx.animalFactSheet}\n\n### Logistics & Feasibility\n${ctx.logisticsBreakdown}\n\nSynthesize all of this into:\n1. A 3-Act narrative outline with a SPECIFIC ticking clock, at least 3 escalating obstacles in Act 2, a midpoint reversal, and a resonant closing image\n2. 3 visual signature "hero shots" described with camera angle, lens, and biological action\n3. A dual-column A/V script excerpt (minimum 8 rows) with sound design notes\n\nCRITICAL CINEMATIC STANDARD: Treat the animal as a cinematic protagonist in a GENRE (thriller, survival epic, heist, horror chase). The iguana vs. snakes in Planet Earth II was a HORROR-THRILLER ESCAPE, not a "predator-prey study." Genre-ify your narrative.\n\nCamera language must emphasize PROXIMITY and SUBJECTIVE POV — ground-level gimbal tracking, not clinical observation from distance. The audience must feel the terrain, the heat, the urgency.\n\nDefine a HYPER-REAL SOUNDSCAPE — claws scraping on rock, heartbeats in moments of exhaustion, wind fading. Not generic ambient audio.\n\nNarration must be SPARSE and POETIC. Cut expository lines. Let silences breathe. "He is a trespasser in his own land" > "The lizard must compete for territory."\n\nEnsure the B-Story species is woven into the narrative, not just mentioned as a footnote.`,
        cbs
    );

    cbs.onPhaseComplete(2);

    // ═══════════════════════════════════════════════════════
    // PHASE 3 — THE MURDER BOARD
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(3, 'The Murder Board');

    ctx.rejectionMemo = await agentStep(
        COMMISSIONING_EDITOR,
        `Review the following Draft V1 pitch package:\n\n### Seed Idea\n"${seedIdea}"\n\n### Market Mandate\n${ctx.marketMandate}\n\n### Animal Fact Sheet\n${ctx.animalFactSheet}\n\n### Logistics & Feasibility\n${ctx.logisticsBreakdown}\n\n### Draft Script (V1)\n${ctx.draftV1}\n\nThis is the FIRST review. Attack across all 6 vectors: Cliché Detector, Unicorn Hunt, Disneyfication Scan, Budget Reality Check, Narrative Integrity, and PR/Ethics Risk.\n\nADDITIONALLY test the CINEMATIC STANDARD:\n- Does it feel like a GENRE piece (thriller, survival epic) or a clinical biology lecture?\n- Camera language: proximity/subjective POV or clinical observation from distance?\n- Sound design: hyper-real foley or generic ambient?\n- Narration: sparse/poetic or expository?\n- B-Story: woven in or just listed as backup?\n\nQuote specific failing passages. Find at LEAST two substantive flaws and score UNDER 85.`,
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
        `The Showrunner has issued revision directives based on a Commissioning Editor rejection:\n\n${ctx.revisionDirectives}\n\nRevised inputs:\n- Market Mandate: ${ctx.marketMandate}\n- Revised Animal Fact Sheet: ${ctx.revisedScience}\n- Revised Logistics: ${ctx.revisedLogistics}\n\nYour original Draft V1 was:\n${ctx.draftV1}\n\nRewrite the script addressing ALL critique points. CINEMATIC UPGRADE CHECKLIST:\n✓ Genre energy — this must feel like a [thriller/survival epic/heist], not a biology lecture\n✓ Proximity POV — ground-level, gimbal-tracking, subjective camera, not clinical wide shots\n✓ Hyper-real foley — every key moment has a defined sound (claws, heartbeats, wind)\n✓ Sparse narration — cut expository lines, use short poetic phrases, let silences work\n✓ B-Story woven in — the secondary species raises stakes for the primary, not just backup\n\nOutput a REVISED 3-Act narrative and dual-column A/V script with sound design notes (Draft V2).`,
        cbs
    );

    ctx.greenlightReview = await agentStep(
        COMMISSIONING_EDITOR,
        `You previously rejected the Draft V1 with this memo:\n\n${ctx.rejectionMemo}\n\nThe team has revised their work. Here is Draft V2:\n\n### Revised Animal Fact Sheet\n${ctx.revisedScience}\n\n### Revised Logistics\n${ctx.revisedLogistics}\n\n### Draft Script (V2)\n${ctx.draftV2}\n\nReview the revisions. Check:\n1. Have the fatal flaws been addressed?\n2. Does it now feel CINEMATIC — like a genre piece, not a biology lecture?\n3. Camera language: proximity/subjective POV achieved?\n4. Sound design: hyper-real foley defined?\n5. Narration: sparse/poetic, not expository?\n\nScore the revised pitch. If genuinely resolved, Greenlight (85+). If not, explain what still needs work.`,
        cbs
    );

    cbs.onPhaseComplete(4);

    // ═══════════════════════════════════════════════════════
    // PHASE 5 — FINAL OUTPUT
    // ═══════════════════════════════════════════════════════
    cbs.onPhaseStart(5, 'Final Output — Master Pitch Deck');

    ctx.finalPitchDeck = await agentStep(
        SHOWRUNNER,
        `The Commissioning Editor has given the Greenlight. Compile the final Master Pitch Deck.

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

    return ctx.finalPitchDeck;
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

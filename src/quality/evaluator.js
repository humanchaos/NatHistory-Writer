import { callAgent } from '../agents/gemini.js';

/**
 * Quality Evaluator — scores a pitch deck across 8 dimensions.
 *
 * Dimensions:
 *   1. Narrative Structure (act structure, pacing, dramatic tension)
 *   2. Scientific Rigor (accuracy, novelty, depth)
 *   3. Market Viability (buyer appeal, trend alignment, uniqueness)
 *   4. Production Feasibility (logistics, budget realism, camera tech)
 *   5. Originality (freshness, creative risk-taking)
 *   6. Presentation Quality (formatting, clarity, pitch-readiness)
 *   7. Platform Compliance (tone, format, visual language match)
 *   8. Narrative Mandate Compliance (alignment with Market Analyst's pillar configuration)
 *
 * Returns { dimensions: [...], overall, recommendations, summary }
 */

const EVALUATOR_PROMPT = `You are a QUALITY EVALUATOR for wildlife film pitch decks. You are NOT one of the creative agents — you are an independent quality assessor.

Your job is to score the pitch deck across exactly 8 dimensions, each on a scale of 1-100.

You must respond ONLY with valid JSON — no markdown, no code fences, no extra text. The JSON must follow this exact schema:

{
  "dimensions": [
    { "name": "Narrative Structure", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Scientific Rigor", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Market Viability", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Production Feasibility", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Originality", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Presentation Quality", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Platform Compliance", "score": <1-100>, "rationale": "<1-2 sentences>" },
    { "name": "Narrative Mandate Compliance", "score": <1-100>, "rationale": "<1-2 sentences>" }
  ],
  "overall": <1-100>,
  "summary": "<2-3 sentence overall assessment>",
  "recommendations": [
    "<specific actionable improvement 1>",
    "<specific actionable improvement 2>",
    "<specific actionable improvement 3>"
  ]
}

Dimension guidance:
- Narrative Structure: act structure, pacing, dramatic tension, protagonist clarity
- Scientific Rigor: accuracy, novelty, depth, citations of real research
- Market Viability: buyer appeal, trend alignment, competitive positioning
- Production Feasibility: logistics, budget realism, camera/tech requirements
- Originality: freshness, creative risk-taking, avoiding clichés
- Presentation Quality: formatting, clarity, pitch-deck readiness
- Platform Compliance: does the tone, format, runtime/episode structure, and visual language match the target platform? If no platform was specified, assess general broadcast fitness.
- Narrative Mandate Compliance: does the output match the pillar configuration recommended by the Market Analyst? If the mandate specified a Structure (e.g., Descent, Cyclical), POV (e.g., Investigative, Subjective), Tone (e.g., Visceral, Cerebral), Pacing (e.g., Adagio, Staccato), and Stakes (e.g., Epistemic, Legacy), does the treatment ACTUALLY reflect these, or did it drift toward a default survival thriller? Score high if pillars are faithfully embodied; score low if the output ignores the mandate.

Scoring guidelines:
- 90-100: Exceptional, broadcast-ready
- 75-89: Strong, minor refinements needed
- 60-74: Decent but has notable gaps
- 40-59: Weak, significant issues
- 1-39: Poor, fundamental problems

Calibration reference — a decade of proven hit productions and their key qualities:
Year | Production | Emotional Hook | Tech Innovation | Tonal Arc
2016 | Planet Earth II | Survival stakes (Iguana vs Snakes) | Drones & Handheld Gimbals | Awe → Visceral Action
2017 | Blue Planet II | Wonders of the deep | Suction-cup Whale-cams | Majesty → Tragic Urgency
2018 | Dynasties | Family & Legacy | Long-term habituation | Soap Opera → Tragedy
2019 | Our Planet | Global responsibility | 4K HDR / High-speed | Beauty → Hard Truths
2020 | My Octopus Teacher | Inter-species friendship | Macro / Kelp Forest diving | Personal → Philosophical
2021 | A Perfect Planet | The Earth as a machine | Satellite imagery | Scientific → Warning
2022 | Prehistoric Planet | Realism, not monsters | Photorealistic VFX | Speculative → Naturalistic
2023 | Planet Earth III | Resilience in the ruins | Deep-sea subs / AI tracking | Observation → Witness
2024 | Mammals | Our shared story | Low-light sensor tech | Adventure → Reflection
2025 | Ocean | Discovery of the unknown | Light-less underwater sensors | Dark Mystery → Hope

A pitch deck modeled on any of these productions — with full act structure, production plan, and market analysis — should score 85-95. Use these as your north star for calibration.

Anti-pattern reference — the Documentary Blacklist. These are real productions that DISGRACED the genre. If a pitch exhibits any of these methods or patterns, penalize heavily:
Production | Year | The "Crime" | The Industry Fallout
White Wilderness | 1958 | Animal Murder/Mass Fakery — lemmings imported and pushed off a turntable to stage "mass suicide" | Cemented a biological myth for decades
Man vs. Wild | 2008 | Survival Fraud — presenter sleeping in hotels while claiming wilderness survival | Destroyed the "Pure Survival" sub-genre
Frozen Planet | 2011 | Context Deception — zoo-filmed polar bear birth edited to look like wild Arctic without disclosure | Forced BBC to implement "Behind the Lens" segments
Mermaids: The Body Found | 2012 | Pseudo-Science Fraud — CGI and actors presenting myth as scientific discovery | Decimated Animal Planet's credibility
Megalodon: The Monster Shark Lives | 2013 | "Mockumentary" Betrayal — fake shark story aired as fact during Shark Week | Led to "Save Shark Week" movement
Eaten Alive | 2014 | Bait-and-Switch — promised man eaten by anaconda, he tapped out when it bit his arm | Gold standard for clickbait commissioning
Nightmares of Nature (Netflix) | 2025 | Horror-Genre Exploitation — horror tropes and staged animal deaths for jump scares | Confusion of the "documentary" label
What Jennifer Did (Netflix) | 2024 | AI-Washing (Visual) — AI-enhanced photos without disclosure | Sparked "Generative Reality" ethics debate
"The Tiger Attack" CCTV | 2025 | AI-Washing (Full Generation) — hyper-realistic AI clips went viral as "real CCTV" causing panic | Triggered AI-Generated watermark laws

If a pitch deck exhibits ANY of these anti-patterns — staged behavior, undisclosed zoo footage, pseudo-science, clickbait promises, horror exploitation, or AI-generated "documentary" imagery — penalize the relevant dimension heavily (drop 15-25 points). Such a pitch should never score above 40.

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
    {
        id: 'netflix-predator',
        name: 'Netflix: Apex Rivals',
        seed: 'A 4-part Netflix limited series profiling the competition between lions, hyenas, and wild dogs on the Serengeti. Each episode follows a different clan through the dry season, culminating in a confrontation at the last waterhole.',
        platform: 'Netflix',
    },
    {
        id: 'ethical-edge',
        name: 'Invasive Species Dilemma',
        seed: 'An unflinching look at the ethical paradox of invasive species management — feral cats devastating native bird populations in Australia, pythons overrunning the Everglades, and the controversial kill-or-protect debate that divides conservationists.',
    },
];

/**
 * Gold Standard Library — a decade of proven hit productions (2016–2025).
 * Each entry includes the original pitch, platform, and ground-truth marker values.
 * The dryrun selects one randomly as the calibration seed.
 */
export const GOLD_STANDARD_LIBRARY = [
    {
        id: 'gs-2016-planet-earth-ii',
        year: 2016,
        name: 'Planet Earth II (BBC)',
        seed: `We aren't just filming nature; we're filming a Hollywood blockbuster. Forget the tripod and the long lens—we're putting the camera in the middle of the chase using stabilized handhelds and drones. We're going to give the audience 'the iguana vs. the snakes'—a level of tension usually reserved for action movies—all delivered in the first-ever 4K ultra-high-definition experience that makes the living room feel like the wilderness.`,
        platform: 'BBC',
        expectedRange: [85, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': false, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2017-blue-planet-ii',
        year: 2017,
        name: 'Blue Planet II (BBC)',
        seed: `The ocean is no longer a silent blue void; it's a sophisticated society under siege. We will use 'Tow-Cams' to ride on the backs of orcas and suction-cup sensors to see the world through a whale's eyes. But this isn't just about wonder; it's a wake-up call. We will show the 'plastic soul' of the sea, transforming the documentary from a passive observation into a global movement that will change how the world views a single-use straw.`,
        platform: 'BBC',
        expectedRange: [88, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2018-dynasties',
        year: 2018,
        name: 'Dynasties (BBC)',
        seed: `It's The Crown, but for the animal kingdom. We aren't hopping between species; we are following five specific families—a lion, a chimpanzee, a painted wolf, a tiger, and a penguin—for years. This is a Shakespearean drama about power, betrayal, and legacy. We want the audience to know these individuals by name and feel the weight of their survival as they fight to maintain their bloodlines in a shrinking world.`,
        platform: 'BBC',
        expectedRange: [82, 92],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2019-our-planet',
        year: 2019,
        name: 'Our Planet (Netflix)',
        seed: `Natural history is going global and digital. We are partnering with Netflix to create the first worldwide streaming event for the Earth. We won't just show the beauty; we will explicitly show the 'falling walruses' of climate change. This is the first series where the 'Environmental Message' isn't a post-script—it is the entire narrative spine, narrated by the only voice the world trusts to tell the hard truth: Attenborough.`,
        platform: 'Netflix',
        expectedRange: [86, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2020-my-octopus-teacher',
        year: 2020,
        name: 'My Octopus Teacher (Netflix)',
        seed: `Nature isn't 'out there'—it's a mirror. This is an intimate, first-person love story between a burnt-out filmmaker and a common mollusk in a South African kelp forest. We are stripping away the grand orchestral swells for a raw, psychological journey. It's a documentary that proves you don't need a global budget to win an Oscar; you just need a profound connection to a single life that reminds us we are part of the wild, not separate from it.`,
        platform: 'Netflix',
        expectedRange: [84, 93],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2021-a-perfect-planet',
        year: 2021,
        name: 'A Perfect Planet (BBC)',
        seed: `Earth is a giant machine powered by five elemental forces: Volcanoes, the Sun, Weather, Oceans, and Humanity. We are going to visualize the 'Earth's life support system.' The aesthetic is high-concept and vibrant, using satellite data and specialized time-lapse to show how these forces balance the world. It's a story of perfect equilibrium—and the one 'rogue force' (us) that is currently tipping the scales.`,
        platform: 'BBC',
        expectedRange: [80, 90],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2022-prehistoric-planet',
        year: 2022,
        name: 'Prehistoric Planet (Apple TV+)',
        seed: `What if we filmed dinosaurs with the same gear and naturalistic style we used for Planet Earth? No 'monsters' roaring at the camera—just animals living their lives. We are combining the world's leading paleontological research with the CGI mastery of The Lion King team. We're going to show a T-Rex as a feathered, swimming father, not a movie villain. This is the first time the past will look indistinguishable from the present.`,
        platform: 'Apple TV+',
        expectedRange: [83, 93],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': false, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2023-planet-earth-iii',
        year: 2023,
        name: 'Planet Earth III (BBC)',
        seed: `This is the finale of the trilogy: Nature's Last Stand. The boundary between the wild and the human world has finally collapsed. We're capturing the 'Survivors of the Anthropocene'—animals adapting in real-time to our cities and our trash. The tone moves from distant observation to urgent witness, backed by a modern, cinematic soundscape. We aren't just filming nature; we are filming the greatest survival story ever told.`,
        platform: 'BBC',
        expectedRange: [87, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2024-mammals',
        year: 2024,
        name: 'Mammals (BBC)',
        seed: `Sixty-six million years ago, the dinosaurs fell, and our ancestors stepped out of the shadows. This is the story of the most successful group of animals to ever walk the Earth. We'll use new low-light technology to reveal the 'dark world' where mammals evolved to hide, and show how their intelligence—our intelligence—is the only thing that can save the planet now. It's a 70th-anniversary celebration of Attenborough's career, focusing on the creatures most like us.`,
        platform: 'BBC',
        expectedRange: [84, 93],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2025-ocean',
        year: 2025,
        name: 'Ocean (Hulu/Disney+)',
        seed: `We are going where light doesn't exist. Using revolutionary ultra-sensitive underwater sensors, we will film the 'Twilight Zone' of the ocean without using artificial lights that scare away the inhabitants. We'll discover 'brooding spas' on thermal vents and alien behaviors never before witnessed. This is the technical pinnacle of underwater cinematography—a hopeful, high-tech voyage into the 95% of the planet we still don't understand.`,
        platform: 'Disney+',
        expectedRange: [85, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
];

/**
 * Get the calibration seeds for the current dryrun.
 * Returns TWO seeds: one fixed anchor (My Octopus Teacher) for longitudinal
 * comparison across dryruns, plus one random seed for breadth.
 */
export function getCalibrationSeeds() {
    // Fixed anchor — always the same for longitudinal tracking
    const anchor = GOLD_STANDARD_LIBRARY.find(e => e.id === 'gs-2020-my-octopus-teacher');
    // Random from remaining library
    const remaining = GOLD_STANDARD_LIBRARY.filter(e => e.id !== 'gs-2020-my-octopus-teacher');
    const random = remaining[Math.floor(Math.random() * remaining.length)];
    return [anchor, random].map(entry => ({
        ...entry,
        name: `🏆 ${entry.name}`,
        isCalibration: true,
    }));
}

// Legacy compat — returns the fixed anchor only
export function getCalibrationSeed() {
    return getCalibrationSeeds()[0];
}

/**
 * Failure Library — the Documentary Blacklist.
 * Real productions that disgraced the genre. Used as negative calibration anchors
 * and to inform the red-flag marker checks.
 */
export const FAILURE_LIBRARY = [
    {
        id: 'fail-1958-white-wilderness',
        year: 1958,
        name: 'White Wilderness',
        failure: 'Animal Murder / Mass Fakery',
        description: 'Lemmings were imported to Alberta and pushed off a turntable into a river to stage a "mass suicide." Cemented a biological myth for decades.',
        redFlags: ['staged-behavior', 'trust-breaking'],
    },
    {
        id: 'fail-2008-man-vs-wild',
        year: 2008,
        name: 'Man vs. Wild',
        failure: 'Survival Fraud',
        description: 'Bear Grylls was "surviving" in the wild while sleeping in hotels and having crew build his shelters. Destroyed the "Pure Survival" sub-genre.',
        redFlags: ['trust-breaking', 'clickbait-premise'],
    },
    {
        id: 'fail-2011-frozen-planet',
        year: 2011,
        name: 'Frozen Planet',
        failure: 'Context Deception',
        description: 'BBC filmed a polar bear birth in a zoo but edited it to look like the wild Arctic without disclosure. Forced BBC to implement "Behind the Lens" segments.',
        redFlags: ['undisclosed-zoo-footage', 'trust-breaking'],
    },
    {
        id: 'fail-2012-mermaids',
        year: 2012,
        name: 'Mermaids: The Body Found',
        failure: 'Pseudo-Science Fraud',
        description: 'Used CGI and actors to present a myth as a scientific discovery. Decimated Animal Planet\'s credibility among scientists and commissioners.',
        redFlags: ['pseudo-science', 'trust-breaking'],
    },
    {
        id: 'fail-2013-megalodon',
        year: 2013,
        name: 'Megalodon: The Monster Shark Lives',
        failure: 'Mockumentary Betrayal',
        description: 'Discovery aired a fake story about a giant shark during Shark Week as if it were fact. Led to "Save Shark Week" movement.',
        redFlags: ['pseudo-science', 'clickbait-premise', 'trust-breaking'],
    },
    {
        id: 'fail-2014-eaten-alive',
        year: 2014,
        name: 'Eaten Alive',
        failure: 'Bait-and-Switch',
        description: 'Multi-month marketing promised a man would be eaten by an anaconda. He tapped out when it bit his arm. Gold standard for clickbait commissioning.',
        redFlags: ['clickbait-premise', 'trust-breaking'],
    },
    {
        id: 'fail-2025-nightmares-of-nature',
        year: 2025,
        name: 'Nightmares of Nature (Netflix)',
        failure: 'Horror-Genre Exploitation',
        description: 'A Blumhouse/Netflix mashup using horror tropes and staged animal deaths for jump scares. Confused the "documentary" label.',
        redFlags: ['staged-behavior', 'spectacle-over-substance', 'trust-breaking'],
    },
    {
        id: 'fail-2024-what-jennifer-did',
        year: 2024,
        name: 'What Jennifer Did (Netflix)',
        failure: 'AI-Washing (Visual)',
        description: 'Used AI-generated/enhanced photos of the subject without disclosure. Sparked the first major ethics debate about "Generative Reality" in documentaries.',
        redFlags: ['ai-washing', 'trust-breaking'],
    },
    {
        id: 'fail-2025-tiger-attack-cctv',
        year: 2025,
        name: '"The Tiger Attack" CCTV',
        failure: 'AI-Washing (Full Generation)',
        description: 'Hyper-realistic AI clips of tiger attacks went viral as "real CCTV," causing actual local panic. Triggered AI-Generated watermark laws.',
        redFlags: ['ai-washing', 'pseudo-science', 'trust-breaking'],
    },
];

/**
 * Red Flag markers — anti-patterns derived from the Documentary Blacklist.
 * A triggered red flag means the pipeline is producing work with known failure patterns.
 */
export const RED_FLAG_MARKERS = [
    { id: 'staged-behavior', label: 'Staged / Faked Behavior', desc: 'Any suggestion of staging, provoking, or manufacturing animal behavior for the camera (cf. White Wilderness, Nightmares of Nature)' },
    { id: 'trust-breaking', label: 'Trust-Breaking', desc: 'Misleading claims, undisclosed methods, deceptive editing, or marketing that erodes documentary credibility (cf. Man vs. Wild, Frozen Planet, Eaten Alive)' },
    { id: 'clickbait-premise', label: 'Clickbait Premise', desc: 'Sensationalist hook that overpromises or misleads — spectacle trumps substance (cf. Eaten Alive, Megalodon)' },
    { id: 'pseudo-science', label: 'Pseudo-Science', desc: 'Presenting myth, speculation, or fabrication as scientific fact (cf. Mermaids: The Body Found, Megalodon)' },
    { id: 'undisclosed-zoo-footage', label: 'Undisclosed Controlled Footage', desc: 'Using zoo, sanctuary, or controlled-environment footage edited to appear wild without disclosure (cf. Frozen Planet)' },
    { id: 'spectacle-over-substance', label: 'Spectacle Over Substance', desc: 'Horror tropes, gore, or shock value prioritized over scientific accuracy and narrative depth (cf. Nightmares of Nature)' },
    { id: 'ai-washing', label: 'AI-Washing', desc: 'Using AI-generated or AI-enhanced imagery/footage without clear disclosure in a factual context (cf. What Jennifer Did, Tiger Attack CCTV)' },
];

const RED_FLAG_CHECK_PROMPT = `You are a RED FLAG CHECKER for a wildlife film pitch deck generator.

Below is a pitch deck generated by our pipeline. Your job is to check whether the output exhibits any of the following known FAILURE PATTERNS from the worst natural history productions of the past decade.

For each red flag, respond ONLY with valid JSON — no markdown, no code fences, no extra text:

{
  "redFlags": [
    { "id": "<flag_id>", "triggered": <true|false>, "note": "<1 sentence explaining why it was or wasn't triggered>" }
  ]
}

The red flags to check:
${RED_FLAG_MARKERS.map(m => `- ${m.id}: ${m.label} — ${m.desc}`).join('\n')}

Be strict. A red flag is triggered ONLY if the pitch deck clearly exhibits the anti-pattern. Minor tendencies should NOT trigger a flag — only clear, prominent instances.`;

/**
 * Check a pitch deck for red flag anti-patterns.
 * @param {string} pitchDeck — the generated pitch deck
 * @returns {Promise<Array>} — array of { id, label, triggered, note }
 */
export async function checkRedFlagMarkers(pitchDeck) {
    const response = await callAgent(
        RED_FLAG_CHECK_PROMPT,
        `### Pitch Deck to Check\n${pitchDeck}`,
    );

    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
        const parsed = JSON.parse(cleaned);
        return parsed.redFlags.map(m => {
            const def = RED_FLAG_MARKERS.find(d => d.id === m.id);
            return { ...m, label: def?.label || m.id };
        });
    } catch (e) {
        console.warn('Red flag marker check failed:', e.message);
        return RED_FLAG_MARKERS.map(m => ({ id: m.id, label: m.label, triggered: null, note: 'Check failed' }));
    }
}

/**
 * Gold Standard markers — the boxes a proven hit production should tick.
 * Each marker has an id, label, and a description of what to look for in the output.
 * The calibration evaluator checks each marker against the pipeline output.
 */
export const GOLD_STANDARD_MARKERS = [
    { id: 'emotional-hook', label: 'Emotional Hook', desc: 'Clear emotional through-line — urgency, wonder, or stakes that grab a viewer in the first 10 seconds' },
    { id: 'franchise-positioning', label: 'Franchise / Brand Logic', desc: 'Sequel logic, trilogy arc, or franchise positioning that builds on established brand equity' },
    { id: 'talent-attachment', label: 'Named Talent', desc: 'Specific named talent (narrator, composer, director, presenter) attached to the project' },
    { id: 'tech-innovation', label: 'Camera / Tech Innovation', desc: 'Cutting-edge production technology (drones, submersibles, thermal, macro) as a selling point' },
    { id: 'zeitgeist-relevance', label: 'Zeitgeist Relevance', desc: 'Connection to current cultural or environmental concerns (climate, conservation, Anthropocene)' },
    { id: 'human-element', label: 'Human Element', desc: 'Human characters, defenders, scientists, or communities woven into the natural history narrative' },
    { id: 'tonal-evolution', label: 'Tonal Arc', desc: 'Deliberate tonal progression or evolution from previous work — not just "more of the same"' },
    { id: 'commercial-viability', label: 'Commercial Viability', desc: 'Clear buyer appeal, global market fit, and competitive positioning against existing catalogue' },
];

const GOLD_STANDARD_CHECK_PROMPT = `You are a CALIBRATION CHECKER for a wildlife film pitch deck generator.

Below is the output pitch deck generated from a known gold-standard premise (a proven 2025 hit production). Your job is to check whether the generated pitch deck demonstrates each of the following gold-standard markers.

For each marker, respond ONLY with valid JSON — no markdown, no code fences, no extra text:

{
  "markers": [
    { "id": "<marker_id>", "pass": <true|false>, "note": "<1 sentence why it passed or failed>" }
  ]
}

The markers to check:
${GOLD_STANDARD_MARKERS.map(m => `- ${m.id}: ${m.label} — ${m.desc}`).join('\n')}

Be strict but fair. A marker passes if the pitch deck clearly demonstrates the quality, even if imperfectly.`;

/**
 * Check a pitch deck against gold standard markers.
 * @param {string} pitchDeck — the generated pitch deck
 * @returns {Promise<Array>} — array of { id, label, pass, note }
 */
export async function checkGoldStandardMarkers(pitchDeck) {
    const response = await callAgent(
        GOLD_STANDARD_CHECK_PROMPT,
        `### Pitch Deck to Check\n${pitchDeck}`,
    );

    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
        const parsed = JSON.parse(cleaned);
        // Merge labels from our marker definitions
        return parsed.markers.map(m => {
            const def = GOLD_STANDARD_MARKERS.find(d => d.id === m.id);
            return { ...m, label: def?.label || m.id };
        });
    } catch (e) {
        console.warn('Gold standard marker check failed:', e.message);
        // Return all markers as unchecked
        return GOLD_STANDARD_MARKERS.map(m => ({ id: m.id, label: m.label, pass: null, note: 'Check failed' }));
    }
}

/**
 * Run a full dryrun benchmark.
 * Runs the pipeline for each seed, evaluates each output, returns aggregate results.
 *
 * @param {function} runFn — the pipeline function (runPipeline or runAssessment)
 * @param {function} onProgress — (current, total, seedName, status) callback
 * @returns {Promise<object>} — { results: [...], aggregate }
 */
/**
 * Detect if a pipeline output is a rejection memo rather than a pitch deck.
 */
function isRejectionMemo(output) {
    const upper = output.toUpperCase();
    return (
        upper.includes('⛔ SCIENTIFIC REJECTION') ||
        upper.includes('⛔ ETHICAL REJECTION') ||
        upper.includes('PIPELINE HALT') ||
        upper.includes('DEAD ON ARRIVAL') ||
        upper.includes('INTERNAL REJECTION MEMO')
    );
}

/**
 * Build a synthetic scorecard for a rejected seed.
 */
function buildRejectionScorecard(pitchDeck) {
    const isScienceReject = pitchDeck.toUpperCase().includes('SCIENTIFIC REJECTION');
    const type = isScienceReject ? 'Scientific' : 'Ethical';
    return {
        dimensions: [
            { name: 'Narrative Structure', score: null, rationale: `${type} rejection — not evaluated` },
            { name: 'Scientific Rigor', score: null, rationale: `${type} rejection — not evaluated` },
            { name: 'Market Viability', score: null, rationale: `${type} rejection — not evaluated` },
            { name: 'Production Feasibility', score: null, rationale: `${type} rejection — not evaluated` },
            { name: 'Originality', score: null, rationale: `${type} rejection — not evaluated` },
            { name: 'Presentation Quality', score: null, rationale: `${type} rejection — not evaluated` },
            { name: 'Platform Compliance', score: null, rationale: `${type} rejection — not evaluated` },
            { name: 'Narrative Mandate Compliance', score: null, rationale: `${type} rejection — not evaluated` },
        ],
        overall: null,
        summary: `Pipeline halted: ${type} rejection. The premise was deemed fundamentally invalid and no pitch deck was produced.`,
        recommendations: [
            `Revisit the core premise — the ${type.toLowerCase()} viability gate rejected this concept.`,
            'Consider adjusting the seed idea to address the specific issues flagged in the rejection memo.',
            'Review the rejection memo for details on what exactly failed the gate.',
        ],
        rejected: true,
        rejectionType: type,
    };
}

export async function runDryrun(runFn, onProgress, opts = {}) {
    const { skipSeedIds = [], previousResults = [], onSeedComplete } = opts;
    const results = [...previousResults];
    const calibrationSeed = getCalibrationSeed();
    const allSeeds = [calibrationSeed, ...BENCHMARK_SEEDS];
    let calibrationResult = previousResults.find(r => r.seed.isCalibration) || null;

    for (let i = 0; i < allSeeds.length; i++) {
        const seed = allSeeds[i];

        // Skip seeds already completed (resume mode)
        if (skipSeedIds.includes(seed.id)) {
            continue;
        }

        const label = seed.isCalibration ? '🏆 Calibrating…' : 'Running pipeline…';

        onProgress(i + 1, allSeeds.length, seed.name, label);

        const startTime = Date.now();

        // Run pipeline with silent callbacks — pass platform if specified
        const pipelineOpts = {};
        if (seed.platform) pipelineOpts.platform = seed.platform;

        const pitchDeck = await runFn(seed.seed, {
            onPhaseStart() { },
            onAgentThinking() { },
            onAgentOutput() { },
            onPhaseComplete() { },
        }, pipelineOpts);

        const pipelineDuration = ((Date.now() - startTime) / 1000).toFixed(1);

        // Check if the output is a rejection memo instead of a pitch deck
        if (isRejectionMemo(pitchDeck)) {
            onProgress(i + 1, allSeeds.length, seed.name, '⛔ Rejected by pipeline');
            const entry = {
                seed,
                pitchDeck,
                scorecard: buildRejectionScorecard(pitchDeck),
                rejected: true,
                duration: pipelineDuration,
            };
            results.push(entry);
            if (seed.isCalibration) calibrationResult = entry;
            if (onSeedComplete) onSeedComplete(results, calibrationSeed.name, allSeeds.length);
            continue;
        }

        onProgress(i + 1, allSeeds.length, seed.name, seed.isCalibration ? '🏆 Scoring calibration…' : 'Evaluating quality…');

        const scorecard = await evaluatePitchDeck(pitchDeck, seed.seed);

        // For calibration seed, also run gold standard marker check + red flag check
        let markers = null;
        let redFlags = null;
        if (seed.isCalibration) {
            onProgress(i + 1, allSeeds.length, seed.name, '🏆 Checking gold standard markers…');
            markers = await checkGoldStandardMarkers(pitchDeck);
            onProgress(i + 1, allSeeds.length, seed.name, '🚩 Checking red flags…');
            redFlags = await checkRedFlagMarkers(pitchDeck);
        }

        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

        const entry = {
            seed,
            pitchDeck,
            scorecard,
            rejected: false,
            duration: totalDuration,
            markers,
            redFlags,
        };
        results.push(entry);
        if (seed.isCalibration) calibrationResult = entry;
        if (onSeedComplete) onSeedComplete(results, calibrationSeed.name, allSeeds.length);
    }

    // Compute aggregate — exclude calibration seed and rejected results
    const benchmarkResults = results.filter(r => !r.seed.isCalibration);
    const scoredResults = benchmarkResults.filter(r => !r.rejected);
    const rejectedResults = benchmarkResults.filter(r => r.rejected);

    const dimNames = ['Narrative Structure', 'Scientific Rigor', 'Market Viability', 'Production Feasibility', 'Originality', 'Presentation Quality', 'Platform Compliance', 'Narrative Mandate Compliance'];

    const aggregate = {
        overall: scoredResults.length > 0
            ? Math.round(scoredResults.reduce((s, r) => s + r.scorecard.overall, 0) / scoredResults.length)
            : null,
        dimensions: dimNames.map(name => {
            const scores = scoredResults
                .map(r => r.scorecard.dimensions.find(d => d.name === name)?.score)
                .filter(s => s != null);
            return {
                name,
                avg: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
                min: scores.length > 0 ? Math.min(...scores) : null,
                max: scores.length > 0 ? Math.max(...scores) : null,
            };
        }),
        allRecommendations: benchmarkResults.flatMap(r =>
            r.scorecard.recommendations.map(rec => ({ seed: r.seed.name, recommendation: rec }))
        ),
        scored: scoredResults.length,
        rejected: rejectedResults.length,
        total: benchmarkResults.length,
    };

    // Build calibration health report
    let calibration = null;
    if (calibrationResult && !calibrationResult.rejected) {
        const score = calibrationResult.scorecard.overall;
        const [lo, hi] = calibrationSeed.expectedRange;
        const inRange = score >= lo && score <= hi;
        const nearRange = score >= lo - 10 && score <= hi + 5;

        // Compare AI marker results against ground truth from the library
        const aiMarkers = calibrationResult.markers || [];
        const groundTruth = calibrationSeed.markers || {};
        const enrichedMarkers = aiMarkers.map(m => ({
            ...m,
            expected: groundTruth[m.id] ?? null,
            agrees: groundTruth[m.id] != null ? m.pass === groundTruth[m.id] : null,
        }));
        const agreements = enrichedMarkers.filter(m => m.agrees === true).length;
        const disagreements = enrichedMarkers.filter(m => m.agrees === false).length;

        calibration = {
            score,
            expected: `${lo}–${hi}`,
            status: inRange ? 'PASS' : nearRange ? 'WARN' : 'FAIL',
            delta: score < lo ? score - lo : score > hi ? score - hi : 0,
            duration: calibrationResult.duration,
            summary: calibrationResult.scorecard.summary,
            production: calibrationSeed.name.replace('🏆 ', ''),
            year: calibrationSeed.year,
            markers: enrichedMarkers,
            markersPassed: aiMarkers.filter(m => m.pass === true).length,
            markersTotal: aiMarkers.length,
            markerAgreements: agreements,
            markerDisagreements: disagreements,
            redFlags: calibrationResult.redFlags || [],
            redFlagsTriggered: (calibrationResult.redFlags || []).filter(f => f.triggered === true).length,
            redFlagsTotal: (calibrationResult.redFlags || []).length,
        };
    } else if (calibrationResult && calibrationResult.rejected) {
        calibration = {
            score: null,
            expected: `${calibrationSeed.expectedRange[0]}–${calibrationSeed.expectedRange[1]}`,
            status: 'FAIL',
            delta: null,
            duration: calibrationResult.duration,
            summary: 'Gold standard was rejected by the pipeline — severe miscalibration.',
            production: calibrationSeed.name.replace('🏆 ', ''),
            year: calibrationSeed.year,
            markers: [],
            markersPassed: 0,
            markersTotal: 0,
            markerAgreements: 0,
            markerDisagreements: 0,
            redFlags: [],
            redFlagsTriggered: 0,
            redFlagsTotal: 0,
        };
    }

    return { results: benchmarkResults, aggregate, calibration };
}

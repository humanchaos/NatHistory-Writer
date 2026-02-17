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

Calibration reference — award-winning productions across Oscar, Wildscreen, and Jackson Wild festivals (2010–2025):
Year | Oscar: Best Doc | Wildscreen: Golden Panda | Wildscreen: Best Script | Jackson Wild: Grand Teton | Jackson Wild: Best Writing
2025 | No Other Land | Trade Secret | Underdogs | YANUNI | A Real Bug's Life
2024 | 20 Days in Mariupol | Billy & Molly | Billy & Molly | Turtle Walker | Lions of Skeleton Coast
2023 | Navalny | (Off-year) | (Off-year) | Path of the Panther | Patrick and the Whale
2022 | Summer of Soul | My Garden of 1000 Bees | My Garden of 1000 Bees | The Territory | Path of the Panther
2021 | My Octopus Teacher | (Off-year) | (Off-year) | My Octopus Teacher | My Octopus Teacher
2020 | American Factory | My Octopus Teacher | My Octopus Teacher | My Octopus Teacher | The Elephant Queen
2019 | Free Solo | (Off-year) | (Off-year) | The Biggest Little Farm | The Biggest Little Farm
2018 | Icarus | Rise of the Warrior Apes | The Last Animals | Laws of the Lizard (SM*) | Laws of the Lizard (SM*)
2017 | O.J.: Made in America | (Off-year) | (Off-year) | The Ivory Game | The Ivory Game
2016 | Amy | The Ivory Game | Jago: A Life Underwater | Light on Earth (SM*) | Light on Earth (SM*)
2015 | Citizenfour | (Off-year) | (Off-year) | Jago: A Life Underwater | Jago: A Life Underwater
2014 | 20 Feet from Stardom | On a River in Ireland | On a River in Ireland | Particle Fever (SM*) | Particle Fever (SM*)
2013 | Searching for Sugar Man | (Off-year) | (Off-year) | On a River in Ireland | On a River in Ireland
2012 | Undefeated | My Life as a Turkey | My Life as a Turkey | My Life as a Turkey (SM*) | My Life as a Turkey (SM*)
2011 | Inside Job | (Off-year) | (Off-year) | Broken Tail | Broken Tail
2010 | The Cove | Life: Challenges of Life | Broken Tail | Into Eternity (SM*) | Into Eternity (SM*)

(SM* = Science/Nature Media category)

A pitch deck that could realistically compete for a Wildscreen Golden Panda or Jackson Wild Grand Teton — with full act structure, production plan, and market analysis — should score 85-95. These award winners are your north star for calibration. Note: the Oscar column provides general documentary context; the Wildscreen and Jackson Wild columns are the specific natural history benchmarks.

Anti-pattern reference — the Documentary Blacklist. These are real productions that DISGRACED the genre. If a pitch exhibits any of these methods or patterns, penalize heavily:
Production | Year | The "Crime" | The Industry Fallout
White Wilderness | 1958 | Animal Murder/Mass Fakery. Lemmings were imported to Alberta and pushed off a turntable into a river to stage a "mass suicide." | Cemented a biological myth for decades. The ultimate "Do Not Follow" blueprint.
Man vs. Wild | 2008 | Survival Fraud. Bear Grylls was "surviving" in the wild while actually sleeping in hotels and having a crew build his "natural" shelters. | Destroyed the "Pure Survival" sub-genre. Every presenter show now requires a "Safety & Logistics" disclaimer.
Frozen Planet | 2011 | Context Deception. The BBC filmed a polar bear birth in a zoo but edited it to look like the wild Arctic without disclosure. | Forced the BBC to implement "Behind the Lens" segments for every major series to regain trust.
Mermaids: The Body Found | 2012 | Pseudo-Science Fraud. Used CGI and actors to present a myth as a scientific discovery. | High ratings, but decimated Animal Planet's credibility among scientists and serious commissioners.
Megalodon: The Monster Shark Lives | 2013 | The "Mockumentary" Betrayal. Discovery aired a fake story about a giant shark during Shark Week as if it were fact. | Led to a massive "Save Shark Week" movement from the scientific community.
Eaten Alive | 2014 | The Bait-and-Switch. A multi-month marketing campaign promised a man would be eaten by an anaconda. He tapped out when it bit his arm. | The gold standard for "Clickbait Commissioning" that insults the audience's intelligence.
Nightmares of Nature (Netflix) | 2025 | Horror-Genre Exploitation. A Blumhouse/Netflix mashup that used "horror movie" tropes and staged animal deaths for jump scares. | Backlash over animal welfare and "staged" deaths in a format that confused the "documentary" label.
What Jennifer Did (Netflix) | 2024 | AI-Washing (Visual). Used AI-generated/enhanced photos of the subject to make them "look better" in 4K without disclosure. | Sparked the first major mainstream ethics debate about "Generative Reality" in documentaries.
"The Tiger Attack" CCTV | 2025 | AI-Washing (Full Generation). Hyper-realistic AI clips of tiger attacks in India/Russia went viral as "real CCTV," causing actual local panic. | Triggered 2025 laws in several countries requiring "AI-Generated" watermarks on all "factual" media.

If a pitch deck exhibits ANY of these anti-patterns — staged behavior, undisclosed zoo footage, pseudo-science, clickbait promises, horror exploitation, or AI-generated "documentary" imagery — penalize the relevant dimension heavily (drop 15-25 points). Such a pitch should never score above 40.

Scoring calibration: Use the award-winning productions in the table above as your north star. A pitch that matches the quality markers of a Wildscreen Golden Panda or Jackson Wild Grand Teton winner — specific named talent, full act structure with deliberate tonal progression, production plan with concrete equipment and budget, human story thread, and credible market analysis — should score 85-95. A competent pitch with some gaps should score 65-80. A weak pitch with major issues should score 40-64. Do NOT compress all outputs into a narrow band — differentiate between adequate and exceptional work.`;

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
 * Gold Standard Library — Wildscreen & Jackson Wild award winners (2012–2025).
 * Each entry includes a reconstructed pitch seed, awards context, and ground-truth markers.
 * The dryrun selects one randomly as the calibration seed.
 */
export const GOLD_STANDARD_LIBRARY = [
    {
        id: 'gs-2012-my-life-as-a-turkey',
        year: 2012,
        name: 'My Life as a Turkey (PBS/BBC)',
        awards: 'Wildscreen Golden Panda, Wildscreen Best Script, Jackson Wild Grand Teton, Jackson Wild Best Writing',
        seed: `What if a human could become a wild animal's parent — not in a zoo, but in the wild? Naturalist Joe Hutto raised sixteen wild turkey poults from eggs in the Florida flatwoods, and they imprinted on him as their mother. For over a year, he lived among them — learning their language, protecting them from predators, watching their complex social hierarchies form. This is a first-person psychological journey into the mind of another species, told through the eyes of the only human they ever trusted.`,
        platform: 'PBS',
        expectedRange: [85, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': false, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2016-the-ivory-game',
        year: 2016,
        name: 'The Ivory Game (Netflix)',
        awards: 'Wildscreen Golden Panda, Jackson Wild Grand Teton',
        seed: `This is a wildlife thriller shot like a spy film. We follow undercover intelligence operatives, frontline rangers, and activists as they infiltrate the global ivory trafficking network — from African poaching grounds to Chinese carving factories. The stakes are existential: African elephants face extinction within a generation. We're embedding with the people risking their lives to stop it, using hidden cameras and covert operations to expose the corruption. Executive produced by Leonardo DiCaprio, this is conservation filmmaking as geopolitical espionage.`,
        platform: 'Netflix',
        expectedRange: [85, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2016-jago',
        year: 2016,
        name: 'Jago: A Life Underwater (BBC/Netflix)',
        awards: 'Wildscreen Best Script, Jackson Wild Grand Teton',
        seed: `Rohani is eighty years old. He is one of the last Bajau Laut — the 'sea nomads' of Indonesia — who has spent six decades hunting fish on a single breath. No tanks, no wetsuits, just a handmade spear and lungs that defy science. We are filming the final chapter of a 1,000-year-old maritime culture that is vanishing. The underwater cinematography will be intimate and unhurried, following Rohani's movements as he glides through reef systems with a grace that trained divers can't replicate. This is an elegy for a way of life the modern world is extinguishing.`,
        platform: 'BBC',
        expectedRange: [84, 93],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2019-biggest-little-farm',
        year: 2019,
        name: 'The Biggest Little Farm (Neon)',
        awards: 'Jackson Wild Grand Teton, Jackson Wild Best Writing',
        seed: `A filmmaker and a chef leave Los Angeles with a dream: transform 200 acres of dead, lifeless soil into a self-sustaining farm that works WITH nature, not against it. Over eight years, we document every triumph and disaster — the coyotes eating the chickens, the snails devouring the crops, the cover crops that slowly bring the soil back to life. This is a real-time ecological experiment: can regenerative farming actually work at scale? The answer is beautiful, messy, and genuinely surprising. It's the anti-industrial-agriculture manifesto the world needs right now.`,
        platform: 'Theatrical',
        expectedRange: [85, 93],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': false, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2020-my-octopus-teacher',
        year: 2020,
        name: 'My Octopus Teacher (Netflix)',
        awards: 'Oscar Best Documentary, Wildscreen Golden Panda, Jackson Wild Grand Teton, Jackson Wild Best Writing',
        seed: `This is an intimate, first-person love story between Craig Foster — a burnt-out South African filmmaker — and a wild common octopus (Octopus vulgaris) in the kelp forests of False Bay, Cape Town. Over a year of daily free-diving, Foster forms an extraordinary bond with this single octopus, witnessing her hunting strategies, her encounters with pajama sharks, and ultimately her reproduction and death. We are stripping away the grand orchestral swells for a raw, psychological journey narrated by Foster himself. No crew, no scuba tanks — just one man and one octopus in the cold Atlantic kelp. It's a documentary that proves you don't need a global budget to win an Oscar; you just need a profound connection to a single life that reminds us we are part of the wild, not separate from it.`,
        platform: 'Netflix',
        expectedRange: [88, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2022-my-garden-of-1000-bees',
        year: 2022,
        name: 'My Garden of a Thousand Bees (BBC/PBS)',
        awards: 'Wildscreen Golden Panda, Wildscreen Best Script',
        seed: `During lockdown, wildlife filmmaker Martin Dohrn turned his cameras on his own Bristol back garden — and discovered over sixty species of bee living in a world we walk past every day. Using a custom-built 'Frankencam' and lenses crafted at his kitchen table, he captured behaviors never filmed before: territorial battles between scissor bees, leaf-cutting construction projects, and the daily dramas playing out at a scale we can't see with the naked eye. This is the cheapest blue-chip film ever made — and the proof that the most extraordinary nature is right outside your door.`,
        platform: 'BBC/PBS',
        expectedRange: [85, 94],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2023-path-of-the-panther',
        year: 2023,
        name: 'Path of the Panther (Nat Geo/Disney+)',
        awards: 'Jackson Wild Grand Teton',
        seed: `The Florida panther is America's most endangered large mammal — fewer than 200 survive. Photographer Carlton Ward Jr. spent five years deploying 500,000 camera trap images across the Florida Wildlife Corridor to prove that these ghost cats still roam. We are building a documentary that turns camera-trap data into a conservation thriller: can we prove, through irrefutable visual evidence, that the Corridor must be protected before developers pave it over? This film doesn't just document an endangered species — it aims to change legislation.`,
        platform: 'Disney+',
        expectedRange: [84, 93],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2024-billy-and-molly',
        year: 2024,
        name: 'Billy & Molly: An Otter Love Story (Nat Geo/Disney+)',
        awards: 'Wildscreen Golden Panda, Wildscreen Best Script',
        seed: `On the remote Shetland Islands, a weathered fisherman named Billy finds a half-drowned otter pup and brings her back to life. What unfolds is an extraordinary interspecies friendship — Molly the otter moves freely between the wild sea and Billy's cottage, choosing to return every day. From Silverback Films, shot in 4K against the raw beauty of Shetland's coastline, orcas, and seabird colonies, this is a deeply personal story about loneliness, grief, and the wild creature that healed a man's heart. It's My Octopus Teacher — but with a protagonist who talks back.`,
        platform: 'Disney+',
        expectedRange: [86, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2025-yanuni',
        year: 2025,
        name: 'YANUNI (Theatrical)',
        awards: 'Jackson Wild Grand Teton',
        seed: `In the Brazilian Amazon, Indigenous chief Juma Xipaia has survived assassination attempts to protect her ancestral lands from illegal mining and logging. Co-produced by Leonardo DiCaprio and directed by Richard Ladkani, this is a conservation epic told through the eyes of a woman who embodies the resistance. We follow Juma and her husband — a former Special Forces ranger turned environmental agent — as they fight a corrupt system that values extraction over existence. 'YANUNI' is the name of Juma's unborn daughter — and the future she is fighting to protect.`,
        platform: 'Theatrical',
        expectedRange: [85, 95],
        markers: { 'emotional-hook': true, 'franchise-positioning': false, 'talent-attachment': true, 'tech-innovation': false, 'zeitgeist-relevance': true, 'human-element': true, 'tonal-evolution': true, 'commercial-viability': true },
    },
    {
        id: 'gs-2025-a-real-bugs-life',
        year: 2025,
        name: "A Real Bug's Life (Nat Geo/Disney+)",
        awards: 'Jackson Wild Best Writing',
        seed: `What if we took the charm and drama of Pixar's 'A Bug's Life' and made it real? Using motion-controlled macro rigs, ultra high-speed lenses, and cutting-edge probe cameras, we are going to shrink the audience down to insect scale and tell the stories of nine micro-worlds — from the streets of New York to the rainforests of Latin America. Narrated by Awkwafina, each episode follows a bug protagonist through a complete dramatic arc: survival, rivalry, courtship, parenthood. This is natural history filmmaking at a scale that makes an ant look like a dinosaur.`,
        platform: 'Disney+',
        expectedRange: [84, 93],
        markers: { 'emotional-hook': true, 'franchise-positioning': true, 'talent-attachment': true, 'tech-innovation': true, 'zeitgeist-relevance': true, 'human-element': false, 'tonal-evolution': true, 'commercial-viability': true },
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
    { id: 'tonal-evolution', label: 'Tonal Arc', desc: 'Deliberate tonal progression WITHIN the pitch — the emotional journey shifts across acts (e.g., wonder → tension → devastation → hope), not a flat single-tone treatment' },
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

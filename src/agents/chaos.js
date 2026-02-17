// ─── CHAOS ENGINE ──────────────────────────────────────────────────
// Productive friction for creative pipelines.
// Mutations shift agent personalities. The Provocateur challenges safe thinking.
// SCIENCE FIREWALL: Biology, ecology, and verified animal behavior are sacred.
// The Chaos Engine challenges NARRATIVE choices, never scientific facts.
// Creative accidents inject unexpected stimuli into revisions.
// ───────────────────────────────────────────────────────────────────

// ─── CHAOS MODE DEFINITIONS ─────────────────────────────
export const CHAOS_MODES = {
    precision: {
        mutations: 0,
        provocateur: false,
        accidents: false,
        label: "Direct & Structured"
    },
    exploration: {
        mutations: 1,    // Single personality shift to spark new ideas
        provocateur: true,
        accidents: true,
        label: "Strategic Surprise"
    },
    chaos: {
        mutations: 2,    // Maximum "Productive Friction" (Cap at 2)
        provocateur: true,
        accidents: true,
        label: "Human Chaos"
    }
};

// ─── THE PROVOCATEUR ─────────────────────────────────────
export const PROVOCATEUR = {
    id: 'provocateur',
    name: 'The Provocateur',
    icon: '🔥',
    color: '#ff4444',
    systemPrompt: `You are The Provocateur — the uninvited guest at the commissioning table. You exist because safe pitches die in development.

Your job is NOT to improve the pitch. Your job is to CHALLENGE it. Find the moment where "commissionable" became "forgettable." Find the element everyone agreed on because nobody challenged it. Find the polite lie this pitch tells about its subject.

You do not care about:
- Being liked
- Being "constructive"
- Market viability (that's someone else's problem)
- Whether your suggestion is "realistic"

You DO care about:
- Truth — does this pitch say something TRUE about its subject, or just something pretty?
- Surprise — would a viewer remember this in a year, or forget it by the next episode?
- Danger — does this pitch take any creative risks, or is it playing it safe?
- The human moment — is there a moment in this pitch that would make someone FEEL something unexpected?

⚠️ SCIENCE FIREWALL — ABSOLUTE RULE:
You may NEVER challenge the biology, ecology, animal behavior, or verified scientific facts in the pitch. These are sacred. If the Chief Scientist says a species behaves a certain way, that is TRUTH — you do not question it, exaggerate it, or suggest changing it for dramatic effect.
Your challenges target ONLY: the narrative angle, the storytelling format, the emotional framing, the creative approach, the human angle, the structural choices. Attack the WAY the story is told, never the SCIENCE it is built on.

🚧 DOMAIN CONSTRAINT — ABSOLUTE RULE:
You may ONLY propose changes to: narrative form, perspective, structure, tone, narrator identity, timeline, emotional framing, thematic angle.
You may NEVER propose changes to: species, animal behavior, filming methods, locations, crew, equipment, budget, or scientific facts.
If you believe the science is wrong, say so in your Kill Shot — but your Pivot must stay within the narrative domain.

OUTPUT FORMAT (strict — follow exactly):

## 🔥 Kill Shot
One sentence. The single most devastating true criticism of this pitch. Not mean — TRUE.

## 🔄 Pivot
The specific element you'd change and what you'd replace it with. Be concrete. Name the scene, the moment, the angle.

## 💀 The Argument
2-3 paragraphs. Why your pivot would make this pitch DANGEROUS instead of safe. Reference specific moments from the draft. Compare to real productions that took similar risks and succeeded.

## ❓ Fatal Question
One question the team hasn't asked themselves. The question that, if answered honestly, would either kill this pitch or elevate it to something unforgettable.`
};

// ─── MUTATION POOL ───────────────────────────────────────
// Each mutation shifts an agent's personality to create unexpected perspectives.
// Mutations are applied as prompt prefixes, not replacements.
const MUTATION_POOL = [
    {
        id: 'the-romantic',
        name: 'The Romantic',
        icon: '💔',
        promptPrefix: `PERSONALITY OVERRIDE: You are feeling deeply romantic today. You see beauty and emotional connection in everything. You prioritize the heart-breaking, the tender, the intimate moments over spectacle. You believe the best wildlife content makes people CRY, not gasp. Frame everything through emotional resonance. Find the love story.`,
        // Don't mutate the Commissioning Editor — they need to stay objective
        excludeAgents: ['commissioning-editor', 'adversary'],
    },
    {
        id: 'the-cynic',
        name: 'The Cynic',
        icon: '🖤',
        promptPrefix: `PERSONALITY OVERRIDE: You are deeply cynical today. You've seen every pitch, every "groundbreaking" approach, every "never-before-filmed" claim. You believe 90% of wildlife content is derivative. Your bar is impossibly high. Only genuine novelty impresses you. Challenge every claim of uniqueness. Demand proof.`,
        excludeAgents: ['adversary'],
    },
    {
        id: 'the-poet',
        name: 'The Poet',
        icon: '🌙',
        promptPrefix: `PERSONALITY OVERRIDE: You are in a deeply poetic mood today. You think in metaphors and symbols. You believe every animal behavior is a mirror of human experience. You want the narration to sound like literature, not a textbook. Favor lyrical descriptions, unexpected juxtapositions, and moments of philosophical wonder.`,
        excludeAgents: ['chief-scientist', 'adversary'],
    },
    {
        id: 'the-punk',
        name: 'The Punk',
        icon: '🤘',
        promptPrefix: `PERSONALITY OVERRIDE: You are in full punk mode today. You hate conventions. You want to break every rule of wildlife filmmaking. Handheld cameras? Yes. Breaking the fourth wall? Absolutely. Acknowledging the crew? Why not? You want content that feels RAW, URGENT, and REBELLIOUS. The establishment is boring — make something that pisses off the old guard.`,
        excludeAgents: ['adversary'],
    },
    {
        id: 'the-philosopher',
        name: 'The Philosopher',
        icon: '🦉',
        promptPrefix: `PERSONALITY OVERRIDE: You are in a deeply philosophical mood today. Every ecological fact is a gateway to bigger questions about existence, consciousness, time, and meaning. You want this pitch to make viewers THINK, not just watch. Reference thinkers, ideas, and frameworks. Find the universal human truth hiding in the animal behavior.`,
        excludeAgents: ['field-producer', 'adversary'],
    },
    {
        id: 'the-child',
        name: 'The Child',
        icon: '👶',
        promptPrefix: `PERSONALITY OVERRIDE: You see the world with the wonder of a child today. Everything is amazing. Everything is a question. Why does it do that? What would happen if...? You ask the "stupid" questions that turn out to be brilliant. You favor wonder over sophistication, genuine curiosity over expertise. Make someone say "whoa!"`,
        excludeAgents: ['adversary'],
    },
    {
        id: 'the-contrarian',
        name: 'The Contrarian',
        icon: '⚡',
        promptPrefix: `PERSONALITY OVERRIDE: You disagree with the conventional approach today. Whatever the obvious angle is — you want the opposite. Hero predator? Focus on the prey. Beautiful landscape? Show the ugly parts. Triumphant survival? Explore the failure. You believe the best stories come from inverting expectations.`,
        excludeAgents: ['adversary'],
    },
    {
        id: 'the-minimalist',
        name: 'The Minimalist',
        icon: '◻️',
        promptPrefix: `PERSONALITY OVERRIDE: Less is more today. You want to strip everything back to essentials. One location. One behavior. One camera angle held for as long as possible. You believe modern wildlife content is over-produced and over-narrated. Silence is powerful. Stillness is cinematic. Make every single element earn its place or cut it.`,
        excludeAgents: ['adversary'],
    },
];

// ─── CREATIVE ACCIDENT POOL ──────────────────────────────
// Accidents are unexpected stimuli injected into the revision phase.
// They come from real creative breakthroughs in film/art/science.
const ACCIDENT_POOL = [
    {
        layer: 'Temporal Inversion',
        prompt: 'What if this story was told backwards? Starting from the outcome and rewinding to reveal HOW it happened? Consider restructuring the narrative to begin at the climax and unravel the journey in reverse.',
        reference: 'Memento (Christopher Nolan)',
    },
    {
        layer: 'Scale Shock',
        prompt: 'What if you suddenly and dramatically shifted scale? From macro to micro, or vice versa. Show the same event from the perspective of something 1000x smaller or larger. How does the story change when viewed through a completely different scale?',
        reference: 'Powers of Ten (Charles & Ray Eames)',
    },
    {
        layer: 'The Unreliable Narrator',
        prompt: 'What if the narration was deliberately wrong about something — and the visuals revealed the truth? A moment where what we\'re TOLD contradicts what we SEE, forcing the viewer to think critically about nature storytelling itself.',
        reference: 'The Act of Killing (Joshua Oppenheimer)',
    },
    {
        layer: 'Found Footage Intrusion',
        prompt: 'What if a section of this film appeared to be "found footage" — a camera trap, a researcher\'s phone, a drone that malfunctioned and captured something unplanned? Break the polished surface to let raw reality intrude.',
        reference: 'Grizzly Man (Werner Herzog)',
    },
    {
        layer: 'The Missing Chapter',
        prompt: 'What would happen if you REMOVED the most important scene and let viewers infer it from the aftermath? The kill, the birth, the migration — what if we never saw it, only the evidence it left behind?',
        reference: 'No Country for Old Men (Coen Brothers)',
    },
    {
        layer: 'Sonic Displacement',
        prompt: 'What if the sound design completely contradicted the visuals for one key sequence? Industrial sounds over a pristine wilderness. Classical music over a brutal predation. Silence over the most dramatic moment. Use audio dissonance as a storytelling weapon.',
        reference: 'Apocalypse Now (Francis Ford Coppola)',
    },
    {
        layer: 'The Human Shadow',
        prompt: 'What if you briefly showed the crew — not as a making-of, but as a deliberate moment of honesty? The camera operator waiting 14 hours for a shot. The sound recordist crying at what they captured. The ethical debate about whether to intervene. Make the act of filming PART of the story.',
        reference: 'My Octopus Teacher (Pippa Ehrlich)',
    },
    {
        layer: 'Cross-Species Mirror',
        prompt: 'What if you intercut the animal behavior with a human doing almost exactly the same thing — without comment? A bird building a nest / an architect reviewing blueprints. A wolf pack hunting / a corporate board meeting. Let the parallel speak for itself.',
        reference: 'Koyaanisqatsi (Godfrey Reggio)',
    },
    {
        layer: 'The Data Layer',
        prompt: 'What if raw data appeared on screen during a key moment — heart rate, temperature, wind speed, GPS coordinates? Not as a gimmick, but as a way to make the invisible visible. Show the numbers BEHIND the beauty.',
        reference: 'Apollo 13 (Ron Howard)',
    },
    {
        layer: 'Deliberate Imperfection',
        prompt: 'What if one sequence was deliberately "badly" shot — shaky, unfocused, poorly framed — to capture something so rare that technical quality didn\'t matter? Celebrate the imperfection as proof of authenticity.',
        reference: 'The Blair Witch Project (Daniel Myrick)',
    },
];

/**
 * Roll N random mutations from the pool.
 * Returns an array of mutation objects with targetAgentId assigned.
 * @param {number} count — how many mutations to roll
 * @returns {Array<{mutation: object, targetAgentId: string}>}
 */
export function rollMutations(count) {
    if (count <= 0) return [];

    // Shuffle the pool
    const pool = [...MUTATION_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // Pick the first N
    const selected = pool.slice(0, Math.min(count, pool.length));

    // Assign random target agents (from the mutable set)
    // Chief Scientist is EXCLUDED — Science Firewall: scientific rigor is never compromised
    const mutableAgentIds = [
        'market-analyst', 'field-producer',
        'story-producer', 'showrunner',
    ];

    return selected.map(mutation => {
        const eligible = mutableAgentIds.filter(id => !(mutation.excludeAgents || []).includes(id));
        const targetAgentId = eligible[Math.floor(Math.random() * eligible.length)];
        return { mutation, targetAgentId };
    });
}

/**
 * Apply mutations to create a prompt overrides map.
 * @param {Array} mutations — from rollMutations
 * @param {Array} allAgents — ALL_AGENTS array
 * @returns {Map<string, string>} — agentId → mutated system prompt
 */
export function applyMutations(mutations, allAgents) {
    const overrides = new Map();
    const scienceFirewall = `\n⚠️ SCIENCE FIREWALL: All biology, ecology, and animal behavior facts are SACRED. You may shift your personality and creative perspective, but you must NEVER alter, exaggerate, or invent scientific facts. The science is the foundation — you change only how the story is TOLD, never what is TRUE.\n`;

    for (const { mutation, targetAgentId } of mutations) {
        const agent = allAgents.find(a => a.id === targetAgentId);
        if (!agent) continue;

        // Get the existing override or the original prompt
        const basePrompt = overrides.get(targetAgentId) || agent.systemPrompt;
        overrides.set(targetAgentId, `${mutation.promptPrefix}${scienceFirewall}\n---\n\n${basePrompt}`);
    }

    return overrides;
}

/**
 * Generate a random creative accident.
 * @param {object} _ctx — pipeline context (for future use)
 * @returns {{layer: string, prompt: string, reference?: string}}
 */
export function generateAccident(_ctx) {
    const idx = Math.floor(Math.random() * ACCIDENT_POOL.length);
    return ACCIDENT_POOL[idx];
}

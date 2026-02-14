import { initGemini, createChat, callAgent } from './agents/gemini.js';
import { runPipeline, runAssessment } from './agents/orchestrator.js';
import { saveRun, getRuns, deleteRun, getRunById } from './history.js';
import { chunkText } from './knowledge/chunker.js';
import { embedBatch } from './knowledge/embeddings.js';
import { addDocument, listDocuments, deleteDocument } from './knowledge/vectorStore.js';
import { evaluatePitchDeck, runDryrun } from './quality/evaluator.js';
import {
    MARKET_ANALYST,
    CHIEF_SCIENTIST,
    FIELD_PRODUCER,
    STORY_PRODUCER,
    COMMISSIONING_EDITOR,
    SHOWRUNNER,
    ADVERSARY,
} from './agents/personas.js';
import { marked } from 'marked';
import { exportDOCX } from './export.js';

// ─── Markdown Renderer (powered by marked) ───────────
marked.setOptions({ breaks: true, gfm: true });

function md(text) {
    if (!text) return '';
    return marked.parse(text);
}

// ─── Init ─────────────────────────────────────────────
try {
    initGemini();
} catch (err) {
    if (err.message === 'MISSING_API_KEY') {
        showError('API key missing. Set VITE_GEMINI_API_KEY in your .env file and restart.');
    }
}

// ─── DOM References ───────────────────────────────────
const seedForm = document.getElementById('seed-form');
const seedInput = document.getElementById('seed-input');
const launchBtn = document.getElementById('launch-btn');
const simulationEl = document.getElementById('simulation');
const timelineEl = document.getElementById('timeline');
const pitchDeckEl = document.getElementById('pitch-deck');
const pitchDeckContent = document.getElementById('pitch-deck-content');
const errorToast = document.getElementById('error-toast');
const errorMessage = document.getElementById('error-message');
const errorDismiss = document.getElementById('error-dismiss');

// Panel elements
const knowledgePanel = document.getElementById('knowledge-panel');
const historyPanel = document.getElementById('history-panel');
const panelOverlay = document.getElementById('panel-overlay');
const btnKnowledge = document.getElementById('btn-knowledge');
const btnHistory = document.getElementById('btn-history');
const kbBadge = document.getElementById('kb-badge');
const historyBadge = document.getElementById('history-badge');

// Knowledge elements
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const uploadProgress = document.getElementById('upload-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const docList = document.getElementById('doc-list');

// History elements
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');

// Q&A elements
const qaChat = document.getElementById('qa-chat');
const qaMessages = document.getElementById('qa-messages');
const qaForm = document.getElementById('qa-form');
const qaInput = document.getElementById('qa-input');
const qaSend = document.getElementById('qa-send');

// Chat state
let chatSession = null;
let lastPitchDeck = '';
let lastSeedIdea = '';

// Deck action buttons
const btnCopyDeck = document.getElementById('btn-copy-deck');
const btnExportDOCX = document.getElementById('btn-export-docx');
const btnChatHelp = document.getElementById('btn-chat-help');

btnCopyDeck.addEventListener('click', async () => {
    if (!lastPitchDeck) return;
    try {
        await navigator.clipboard.writeText(lastPitchDeck);
        btnCopyDeck.textContent = '✓ Copied!';
        setTimeout(() => { btnCopyDeck.textContent = '📋 Copy'; }, 2000);
    } catch {
        showError('Failed to copy to clipboard');
    }
});

btnExportDOCX.addEventListener('click', async () => {
    if (!lastPitchDeck) return;
    try {
        btnExportDOCX.textContent = '⏳ Exporting…';
        await exportDOCX(lastPitchDeck, 'Master Pitch Deck');
        btnExportDOCX.textContent = '✓ Exported!';
        setTimeout(() => { btnExportDOCX.textContent = '📄 Export DOCX'; }, 2000);
    } catch (err) {
        showError(`Export failed: ${err.message}`);
        btnExportDOCX.textContent = '📄 Export DOCX';
    }
});

btnChatHelp.addEventListener('click', () => {
    qaInput.value = '/help';
    qaForm.dispatchEvent(new Event('submit'));
});

// Scorecard elements
const scorecardEl = document.getElementById('scorecard');
const scorecardOverall = document.getElementById('scorecard-overall');
const scorecardDims = document.getElementById('scorecard-dims');
const scorecardRecs = document.getElementById('scorecard-recs');

// Dryrun elements
const btnDryrun = document.getElementById('btn-dryrun');
const dryrunOverlay = document.getElementById('dryrun-overlay');
const dryrunClose = document.getElementById('dryrun-close');
const dryrunStart = document.getElementById('dryrun-start');
const dryrunStartArea = document.getElementById('dryrun-start-area');
const dryrunProgress = document.getElementById('dryrun-progress');
const dryrunProgressFill = document.getElementById('dryrun-progress-fill');
const dryrunProgressText = document.getElementById('dryrun-progress-text');
const dryrunResults = document.getElementById('dryrun-results');

// ─── Error Handling ───────────────────────────────────
function showError(msg) {
    errorMessage.textContent = msg;
    errorToast.classList.remove('hidden');
    requestAnimationFrame(() => errorToast.classList.add('visible'));
}

errorDismiss.addEventListener('click', () => {
    errorToast.classList.remove('visible');
    setTimeout(() => errorToast.classList.add('hidden'), 400);
});

// ─── Phase UI Helpers ─────────────────────────────────
function setPhaseActive(n) {
    document.querySelectorAll('.phase-dot').forEach(dot => {
        if (parseInt(dot.dataset.phase) === n) dot.classList.add('active');
    });
    // Activate the connector before this phase
    const connectors = document.querySelectorAll('.phase-connector');
    if (n > 1 && connectors[n - 2]) connectors[n - 2].classList.add('active');
}

function setPhaseCompleted(n) {
    const dot = document.querySelector(`.phase-dot[data-phase="${n}"]`);
    if (dot) {
        dot.classList.remove('active');
        dot.classList.add('completed');
    }
    const connectors = document.querySelectorAll('.phase-connector');
    if (n > 1 && connectors[n - 2]) {
        connectors[n - 2].classList.remove('active');
        connectors[n - 2].classList.add('completed');
    }
}

let currentPhaseBlock = null;

function createPhaseBlock(phaseNumber, phaseName) {
    const block = document.createElement('div');
    block.className = 'phase-block';
    block.dataset.phase = phaseNumber;
    block.innerHTML = `
    <div class="phase-block-header">
      <span class="phase-number">${phaseNumber}</span>
      <span class="phase-title">Phase ${phaseNumber} — ${phaseName}</span>
    </div>
  `;
    timelineEl.appendChild(block);
    currentPhaseBlock = block;
}

function createAgentCard(agent) {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.style.setProperty('--agent-color', agent.color);
    card.innerHTML = `
    <div class="agent-card-header">
      <span class="agent-icon">${agent.icon}</span>
      <span class="agent-name" style="color: ${agent.color}">${agent.name}</span>
      <span class="agent-status thinking">Thinking…</span>
    </div>
    <div class="agent-card-body">
      <div class="agent-output">
        <div class="thinking-skeleton">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;
    if (currentPhaseBlock) {
        currentPhaseBlock.appendChild(card);
    } else {
        timelineEl.appendChild(card);
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return card;
}

function fillAgentCard(card, outputText) {
    const outputEl = card.querySelector('.agent-output');
    const statusEl = card.querySelector('.agent-status');
    outputEl.innerHTML = md(outputText);
    statusEl.textContent = 'Complete';
    statusEl.classList.remove('thinking');
    statusEl.classList.add('complete');
}

// ─── Panel Controls ───────────────────────────────────
function openPanel(panel) {
    // Close other panels
    document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
    panel.classList.remove('hidden');
    requestAnimationFrame(() => {
        panel.classList.add('open');
        panelOverlay.classList.remove('hidden');
        panelOverlay.classList.add('visible');
    });
}

function closeAllPanels() {
    document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
    panelOverlay.classList.remove('visible');
    setTimeout(() => panelOverlay.classList.add('hidden'), 300);
}

btnKnowledge.addEventListener('click', () => {
    if (knowledgePanel.classList.contains('open')) {
        closeAllPanels();
    } else {
        openPanel(knowledgePanel);
        refreshDocList();
    }
});

btnHistory.addEventListener('click', () => {
    if (historyPanel.classList.contains('open')) {
        closeAllPanels();
    } else {
        openPanel(historyPanel);
        refreshHistoryList();
    }
});

panelOverlay.addEventListener('click', closeAllPanels);

document.querySelectorAll('.panel-close').forEach(btn => {
    btn.addEventListener('click', closeAllPanels);
});

// ─── Knowledge Base: File Upload ──────────────────────
browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
});

async function handleFiles(fileList) {
    for (const file of fileList) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['txt', 'md', 'text', 'markdown'].includes(ext)) {
            showError(`Unsupported file type: .${ext}. Use .txt or .md files.`);
            continue;
        }

        try {
            const text = await file.text();
            const chunks = chunkText(text);
            if (chunks.length === 0) {
                showError(`File "${file.name}" is empty or too short.`);
                continue;
            }

            // Show progress
            uploadProgress.classList.remove('hidden');
            progressFill.style.width = '0%';
            progressText.textContent = `Embedding "${file.name}"… 0/${chunks.length}`;

            const embeddings = await embedBatch(chunks, (current, total) => {
                const pct = Math.round((current / total) * 100);
                progressFill.style.width = `${pct}%`;
                progressText.textContent = `Embedding "${file.name}"… ${current}/${total}`;
            });

            progressText.textContent = 'Saving to knowledge base…';
            await addDocument(file.name, chunks, embeddings);

            uploadProgress.classList.add('hidden');
            refreshDocList();
        } catch (err) {
            uploadProgress.classList.add('hidden');
            showError(`Failed to process "${file.name}": ${err.message}`);
        }
    }
}

async function refreshDocList() {
    const docs = await listDocuments();
    docList.innerHTML = '';

    // Update badge
    if (docs.length > 0) {
        kbBadge.textContent = docs.length;
        kbBadge.classList.remove('hidden');
    } else {
        kbBadge.classList.add('hidden');
    }

    if (docs.length === 0) {
        docList.innerHTML = '<p class="panel-empty">No documents uploaded yet.</p>';
        return;
    }

    docs.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'doc-item';
        item.innerHTML = `
      <span class="doc-item-icon">📄</span>
      <div class="doc-item-info">
        <div class="doc-item-name">${doc.filename}</div>
        <div class="doc-item-meta">${doc.chunkCount} chunks · ${new Date(doc.addedAt).toLocaleDateString()}</div>
      </div>
      <button class="doc-item-delete" title="Remove">🗑️</button>
    `;
        item.querySelector('.doc-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteDocument(doc.id);
            refreshDocList();
        });
        docList.appendChild(item);
    });
}

// ─── History Panel ────────────────────────────────────
function refreshHistoryList() {
    const runs = getRuns();
    historyList.innerHTML = '';

    // Update badge
    if (runs.length > 0) {
        historyBadge.textContent = runs.length;
        historyBadge.classList.remove('hidden');
        historyEmpty.classList.add('hidden');
    } else {
        historyBadge.classList.add('hidden');
        historyEmpty.classList.remove('hidden');
    }

    runs.forEach(run => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const date = new Date(run.timestamp);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        item.innerHTML = `
      <div class="history-item-title">${run.title || 'Untitled'}</div>
      <div class="history-item-seed">${run.seedIdea}</div>
      <div class="history-item-footer">
        <span class="history-item-date">${dateStr}</span>
        <button class="history-item-delete">Delete</button>
      </div>
    `;
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('history-item-delete')) return;
            showSavedPitchDeck(run);
            closeAllPanels();
        });
        item.querySelector('.history-item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRun(run.id);
            refreshHistoryList();
        });
        historyList.appendChild(item);
    });
}

function showSavedPitchDeck(run) {
    simulationEl.classList.add('hidden');
    pitchDeckContent.innerHTML = md(run.finalPitchDeck);
    pitchDeckEl.classList.remove('hidden');

    // Extract and display Gatekeeper badges
    updateGatekeeperBadges(run.finalPitchDeck);

    pitchDeckEl.scrollIntoView({ behavior: 'smooth' });

    // Initialize Q&A chat for the saved run
    initChatSession(run.finalPitchDeck);
}

// ─── Mode Toggle ──────────────────────────────────────

/**
 * Extract the Gatekeeper's score, verdict, and platform from the final output
 * and populate the header badges.
 */
function updateGatekeeperBadges(text) {
    const badgesEl = document.getElementById('gatekeeper-badges');
    const scoreBadge = document.getElementById('gatekeeper-score-badge');
    const platformBadge = document.getElementById('gatekeeper-platform-badge');

    const scoreMatch = text.match(/Score:\s*(\d{1,3})\s*\/\s*100/i);
    const platformMatch = text.match(/Ideal\s+For:\s*\*{0,2}([^*\n]+)\*{0,2}/i);
    const verdictMatch = text.match(/The\s+Verdict:\s*\*{0,2}(GREENLIT|REJECTED|BURN IT DOWN)[^*]*\*{0,2}/i);

    if (scoreMatch || platformMatch) {
        badgesEl.classList.remove('hidden');

        if (scoreMatch) {
            const score = parseInt(scoreMatch[1], 10);
            const verdict = verdictMatch ? verdictMatch[1].trim().toUpperCase() : '';
            let colorClass = 'score-red';
            if (score >= 80) colorClass = 'score-green';
            else if (score >= 60) colorClass = 'score-amber';
            else if (score >= 40) colorClass = 'score-orange';

            const verdictLabel = verdict.includes('GREENLIT') ? '✅' : verdict.includes('BURN') ? '🔥' : '⛔';
            scoreBadge.textContent = `${verdictLabel} ${score}/100`;
            scoreBadge.className = `gatekeeper-badge gatekeeper-score ${colorClass}`;
        }

        if (platformMatch) {
            platformBadge.textContent = `📺 Ideal for ${platformMatch[1].trim()}`;
            platformBadge.className = 'gatekeeper-badge gatekeeper-platform';
        }
    } else {
        badgesEl.classList.add('hidden');
    }
}
let currentMode = 'seed'; // 'seed' or 'script'
const phaseIndicator = document.getElementById('phase-indicator');
const productionYearInput = document.getElementById('production-year');
const targetPlatformInput = document.getElementById('target-platform');

document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentMode = tab.dataset.mode;

        if (currentMode === 'script') {
            seedInput.placeholder = 'Paste your existing wildlife script or draft here…';
            seedInput.rows = 10;
            launchBtn.querySelector('.btn-text').textContent = 'Assess & Optimize →';
        } else {
            seedInput.placeholder = 'e.g., A sequence about survival in the deep ocean abyss…';
            seedInput.rows = 3;
            launchBtn.querySelector('.btn-text').textContent = 'Launch Simulation';
        }
    });
});

function buildPhaseIndicator(totalPhases) {
    phaseIndicator.innerHTML = '';
    for (let i = 1; i <= totalPhases; i++) {
        const dot = document.createElement('span');
        dot.className = 'phase-dot';
        dot.dataset.phase = i;
        dot.textContent = i;
        phaseIndicator.appendChild(dot);
        if (i < totalPhases) {
            const conn = document.createElement('span');
            conn.className = 'phase-connector';
            phaseIndicator.appendChild(conn);
        }
    }
}

// ─── Main Flow ────────────────────────────────────────
let latestAgentCard = null;

const pipelineCallbacks = {
    onPhaseStart(phaseNumber, phaseName) {
        setPhaseActive(phaseNumber);
        createPhaseBlock(phaseNumber, phaseName);
    },
    onAgentThinking(agent) {
        latestAgentCard = createAgentCard(agent);
    },
    onAgentOutput(agent, outputText) {
        if (latestAgentCard) {
            fillAgentCard(latestAgentCard, outputText);
        }
    },
    onPhaseComplete(phaseNumber) {
        setPhaseCompleted(phaseNumber);
    },
};

seedForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const inputText = seedInput.value.trim();
    if (!inputText) return;

    const isAssessment = currentMode === 'script';
    const totalPhases = isAssessment ? 4 : 6;

    // Disable form
    launchBtn.disabled = true;
    launchBtn.querySelector('.btn-text').textContent = 'Running…';

    // Build phase indicator for the correct number of phases
    buildPhaseIndicator(totalPhases);

    // Show simulation
    simulationEl.classList.remove('hidden');
    timelineEl.innerHTML = '';
    pitchDeckEl.classList.add('hidden');
    scorecardEl.classList.add('hidden');

    // Scroll to simulation
    simulationEl.scrollIntoView({ behavior: 'smooth' });

    try {
        const prodYear = productionYearInput.value ? parseInt(productionYearInput.value, 10) : null;
        const targetPlatform = targetPlatformInput.value || null;
        const finalPitchDeck = isAssessment
            ? await runAssessment(inputText, pipelineCallbacks, prodYear)
            : await runPipeline(inputText, pipelineCallbacks, { platform: targetPlatform, year: prodYear });

        // Track the seed idea for /rerun
        lastSeedIdea = inputText;

        // Save to history
        saveRun({ seedIdea: inputText, finalPitchDeck });

        // Show pitch deck
        pitchDeckContent.innerHTML = md(finalPitchDeck);
        pitchDeckEl.classList.remove('hidden');

        // Extract and display Gatekeeper badges
        updateGatekeeperBadges(finalPitchDeck);

        pitchDeckEl.scrollIntoView({ behavior: 'smooth' });

        // Initialize Q&A chat
        initChatSession(finalPitchDeck);

        // Auto-score quality (non-blocking)
        autoScore(finalPitchDeck, inputText);
    } catch (err) {
        console.error('Pipeline error:', err);
        showError(`Pipeline error: ${err.message}`);
    } finally {
        launchBtn.disabled = false;
        launchBtn.querySelector('.btn-text').textContent = isAssessment
            ? 'Assess & Optimize →'
            : 'Launch Simulation';
    }
});

// ─── Chat Refinement Engine ───────────────────────────
// Revision history for undo support
let revisionHistory = [];

// Agent-on-demand lookup table
const AGENT_COMMANDS = {
    '/market': { agent: MARKET_ANALYST, label: '📊 Market Analyst', tools: [{ googleSearch: {} }] },
    '/science': { agent: CHIEF_SCIENTIST, label: '🔬 Chief Scientist', tools: [{ googleSearch: {} }] },
    '/producer': { agent: FIELD_PRODUCER, label: '🎥 Field Producer', tools: [] },
    '/story': { agent: STORY_PRODUCER, label: '✍️ Story Producer', tools: [] },
    '/editor': { agent: COMMISSIONING_EDITOR, label: '⚔️ Commissioning Editor', tools: [] },
    '/showrunner': { agent: SHOWRUNNER, label: '🎬 Showrunner', tools: [] },
    '/gatekeeper': { agent: ADVERSARY, label: '🛡️ Gatekeeper', tools: [] },
};

function buildRefinementPrompt(deck) {
    return `You are a senior wildlife documentary consultant helping refine a Master Pitch Deck.
You operate in THREE modes based on the user's input:

═══════════════════════════════════════════
MODE 1 — ANSWER (default)
═══════════════════════════════════════════
When the user asks a QUESTION (who, what, why, how, explain, tell me, etc.), answer it
from context. Be concise, use markdown formatting.

═══════════════════════════════════════════
MODE 2 — REWRITE (surface edits)
═══════════════════════════════════════════
For SMALL, LOCALIZED changes — improving wording, sharpening a logline, fixing a specific
paragraph, tweaking tone. These are cosmetic edits that don't change the fundamental concept.

Respond with a rewrite block in this EXACT format:

<rewrite>
<section>The section title or description being replaced (e.g., "Logline", "Act 2", "A/V Script")</section>
<original>
The exact original text being replaced (copy from the current deck)
</original>
<revised>
Your rewritten version in full markdown
</revised>
<rationale>One sentence explaining what changed and why</rationale>
</rewrite>

You can include multiple <rewrite> blocks if the edit affects multiple sections.
You may add brief commentary BEFORE the rewrite block, but the block itself must be present.

═══════════════════════════════════════════
MODE 3 — RERUN (fundamental changes)
═══════════════════════════════════════════
For FUNDAMENTAL changes that affect the entire pitch — changing the narrative angle,
adding/changing a host or presenter, switching species, changing the story structure,
pivoting the concept, changing the target audience, or any request that would require
ALL sections of the deck to be reconsidered.

These changes CANNOT be handled by swapping a few paragraphs. They require the entire
multi-agent pipeline to re-run with the new creative direction.

USE MODE 3 when the user's request involves ANY of these:
- Changing the narrative perspective or angle (e.g., "make it about a host")
- Adding or changing a presenter/host character
- Fundamentally changing the story structure (e.g., "make it a heist movie")
- Switching primary species or location
- Pivoting the entire concept direction
- Any change that would affect MORE than 3 sections of the deck

Respond with EXACTLY this format:

<rerun>The user's creative direction summarized as a clear, actionable directive for the production team</rerun>

Followed by a brief explanation of why this requires a full pipeline rerun.

DECISION GUIDE — REWRITE vs RERUN:
- "Sharpen the logline" → REWRITE (one section, cosmetic)
- "Make Act 2 more tense" → REWRITE (one section, tone)
- "Add a host who explores the wild" → RERUN (fundamental narrative shift)
- "Change the species to snow leopards" → RERUN (changes everything)
- "Frame it as a survival thriller" → RERUN (genre pivot, affects all sections)
- "Make the narration more poetic" → REWRITE (style, localized)
- "Center the story on human-wildlife conflict" → RERUN (concept pivot)

CRITICAL RULES:
- If the user says "rewrite", "change", "make it", "improve", "sharpen", "fix" — evaluate scope first
- The <original> text in REWRITE must be a real excerpt from the current deck
- Never use MODE 2 or MODE 3 when the user is just asking a question
- When in doubt between REWRITE and RERUN, prefer RERUN — it's better to rebuild than to patch

═══════════════════════════════════════════
CURRENT PITCH DECK
═══════════════════════════════════════════

${deck}`;
}

function initChatSession(pitchDeck) {
    lastPitchDeck = pitchDeck;
    revisionHistory = [];
    qaMessages.innerHTML = '';

    chatSession = createChat(buildRefinementPrompt(pitchDeck));

    // Send an initial context-setting message silently
    chatSession.send('I have received the Master Pitch Deck. I am ready to answer questions about it or make refinements. The user can also use slash commands like /gatekeeper, /market, /science, /editor to invoke specific agents.').catch(() => { });

    // Update the revision badge
    updateRevisionBadge();
}

function updateRevisionBadge() {
    const badge = document.getElementById('revision-badge');
    if (badge) {
        if (revisionHistory.length > 0) {
            badge.textContent = `v${revisionHistory.length + 1}`;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

// Parse <rewrite> blocks from assistant response
function parseRewriteBlocks(text) {
    const blocks = [];
    const regex = /<rewrite>([\s\S]*?)<\/rewrite>/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const inner = match[1];
        const section = inner.match(/<section>([\s\S]*?)<\/section>/i)?.[1]?.trim() || 'Unknown Section';
        const original = inner.match(/<original>([\s\S]*?)<\/original>/i)?.[1]?.trim() || '';
        const revised = inner.match(/<revised>([\s\S]*?)<\/revised>/i)?.[1]?.trim() || '';
        const rationale = inner.match(/<rationale>([\s\S]*?)<\/rationale>/i)?.[1]?.trim() || '';
        blocks.push({ section, original, revised, rationale, fullMatch: match[0] });
    }
    return blocks;
}

// Get text outside of rewrite blocks (commentary)
function getCommentary(text) {
    return text.replace(/<rewrite>[\s\S]*?<\/rewrite>/gi, '').trim();
}

// Apply a rewrite to the live deck
function applyRewrite(original, revised) {
    // Save current state for undo
    revisionHistory.push(lastPitchDeck);

    // Try exact match first, then fuzzy (first 80 chars)
    if (lastPitchDeck.includes(original)) {
        lastPitchDeck = lastPitchDeck.replace(original, revised);
    } else {
        // Fuzzy: find the closest matching section by looking for the first line
        const firstLine = original.split('\n')[0].trim();
        if (firstLine && lastPitchDeck.includes(firstLine)) {
            // Find the paragraph containing this line and replace it
            const sections = lastPitchDeck.split(/\n(?=#{1,4} )/);
            for (let i = 0; i < sections.length; i++) {
                if (sections[i].includes(firstLine)) {
                    sections[i] = revised;
                    break;
                }
            }
            lastPitchDeck = sections.join('\n');
        } else {
            // Fallback: append the revision
            lastPitchDeck += '\n\n' + revised;
        }
    }

    // Re-render the pitch deck
    pitchDeckContent.innerHTML = md(lastPitchDeck);

    // Pulse animation on the deck
    pitchDeckContent.classList.add('deck-updated');
    setTimeout(() => pitchDeckContent.classList.remove('deck-updated'), 1500);

    // Update badges
    updateGatekeeperBadges(lastPitchDeck);
    updateRevisionBadge();

    // Update the chat session's context with the new deck
    chatSession = createChat(buildRefinementPrompt(lastPitchDeck));
    chatSession.send('The deck has been updated with the accepted revision. I am ready for further refinements.').catch(() => { });
}

// Render a rewrite proposal with Accept/Reject
function renderRewriteProposal(block, container) {
    const proposal = document.createElement('div');
    proposal.className = 'rewrite-proposal';
    proposal.innerHTML = `
        <div class="rewrite-header">
            <span class="rewrite-icon">✏️</span>
            <span class="rewrite-section">${block.section}</span>
        </div>
        <div class="rewrite-rationale">${block.rationale}</div>
        <div class="rewrite-content">${md(block.revised)}</div>
        <div class="rewrite-actions">
            <button class="rewrite-accept">✓ Accept</button>
            <button class="rewrite-reject">✗ Reject</button>
        </div>
    `;

    proposal.querySelector('.rewrite-accept').addEventListener('click', () => {
        applyRewrite(block.original, block.revised);
        proposal.classList.add('rewrite-accepted');
        proposal.querySelector('.rewrite-actions').innerHTML = '<span class="rewrite-status accepted">✓ Applied to deck</span>';
    });

    proposal.querySelector('.rewrite-reject').addEventListener('click', () => {
        proposal.classList.add('rewrite-rejected');
        proposal.querySelector('.rewrite-actions').innerHTML = '<span class="rewrite-status rejected">✗ Discarded</span>';
    });

    container.appendChild(proposal);
}

// Handle agent-on-demand slash commands
async function handleAgentCommand(command, typingMsg) {
    const cmd = AGENT_COMMANDS[command];
    if (!cmd) return false;

    typingMsg.className = 'qa-msg assistant agent-result';
    typingMsg.innerHTML = `<div class="agent-invoking"><span class="dots"><span></span><span></span><span></span></span> Invoking ${cmd.label}…</div>`;

    try {
        const agentPrompt = `You are reviewing the following Master Pitch Deck. Run your full analysis and provide your assessment.

### Master Pitch Deck
${lastPitchDeck}

Deliver your complete analysis in your standard format.`;

        const result = await callAgent(cmd.agent.systemPrompt, agentPrompt, { tools: cmd.tools });

        typingMsg.innerHTML = `
            <div class="agent-result-header">
                <span class="agent-result-icon">${cmd.agent.icon}</span>
                <span class="agent-result-name">${cmd.agent.name}</span>
            </div>
            <div class="agent-result-content">${md(result)}</div>
        `;
    } catch (err) {
        typingMsg.innerHTML = `<em>Error invoking ${cmd.label}: ${err.message}</em>`;
    }

    return true;
}

// Handle /undo command
function handleUndo() {
    if (revisionHistory.length === 0) return 'No revisions to undo.';

    lastPitchDeck = revisionHistory.pop();
    pitchDeckContent.innerHTML = md(lastPitchDeck);
    updateGatekeeperBadges(lastPitchDeck);
    updateRevisionBadge();

    // Update chat context
    chatSession = createChat(buildRefinementPrompt(lastPitchDeck));
    chatSession.send('The deck has been reverted to the previous version.').catch(() => { });

    return `✓ Reverted to v${revisionHistory.length + 1}. ${revisionHistory.length} revision(s) remaining in history.`;
}

// Main chat submit handler
qaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = qaInput.value.trim();
    if (!question || !chatSession) return;

    // Add user message
    const userMsg = document.createElement('div');
    userMsg.className = 'qa-msg user';
    userMsg.textContent = question;
    qaMessages.appendChild(userMsg);
    qaInput.value = '';

    // Add typing indicator
    const typingMsg = document.createElement('div');
    typingMsg.className = 'qa-msg assistant typing';
    typingMsg.innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
    qaMessages.appendChild(typingMsg);
    qaMessages.scrollTop = qaMessages.scrollHeight;

    // Disable input
    qaSend.disabled = true;
    qaInput.disabled = true;

    try {
        const lowerQ = question.toLowerCase().trim();

        // Handle /undo
        if (lowerQ === '/undo') {
            typingMsg.className = 'qa-msg assistant';
            typingMsg.innerHTML = md(handleUndo());
        }
        // Handle /rerun
        else if (lowerQ.startsWith('/rerun')) {
            const directive = question.slice(6).trim();
            if (!directive) {
                typingMsg.className = 'qa-msg assistant';
                typingMsg.innerHTML = md('**Usage:** `/rerun <your creative direction>`\n\nExample: `/rerun The story must center on a host who leaves the studio and confronts the wild`');
            } else if (!lastSeedIdea) {
                typingMsg.className = 'qa-msg assistant';
                typingMsg.innerHTML = md('No previous pipeline run found. Run the pipeline first, then use `/rerun`.');
            } else {
                // Save current deck for undo
                revisionHistory.push(lastPitchDeck);

                typingMsg.className = 'qa-msg assistant rerun-progress';
                typingMsg.innerHTML = `<div class="agent-invoking"><span class="dots"><span></span><span></span><span></span></span> Re-running full pipeline with directive…</div><div class="rerun-log" id="rerun-log"></div>`;

                const rerunLog = typingMsg.querySelector('#rerun-log');
                const addLog = (msg) => {
                    const entry = document.createElement('div');
                    entry.className = 'rerun-log-entry';
                    entry.innerHTML = msg;
                    rerunLog.appendChild(entry);
                    qaMessages.scrollTop = qaMessages.scrollHeight;
                };

                try {
                    const rerunCallbacks = {
                        onPhaseStart: (n, name) => addLog(`<span class="rerun-phase">Phase ${n}:</span> ${name}`),
                        onAgentThinking: (agent) => addLog(`<span class="rerun-agent">${agent.icon} ${agent.name}</span> thinking…`),
                        onAgentOutput: (agent) => addLog(`<span class="rerun-agent">${agent.icon} ${agent.name}</span> ✓ complete`),
                        onPhaseComplete: () => { },
                    };

                    const prodYear = productionYearInput.value ? parseInt(productionYearInput.value, 10) : null;
                    const targetPlatform = targetPlatformInput.value || null;

                    const newDeck = await runPipeline(lastSeedIdea, rerunCallbacks, {
                        platform: targetPlatform,
                        year: prodYear,
                        directive: directive,
                    });

                    // Update everything
                    lastPitchDeck = newDeck;
                    pitchDeckContent.innerHTML = md(newDeck);
                    pitchDeckContent.classList.add('deck-updated');
                    setTimeout(() => pitchDeckContent.classList.remove('deck-updated'), 1500);
                    updateGatekeeperBadges(newDeck);
                    updateRevisionBadge();
                    saveRun({ seedIdea: lastSeedIdea, finalPitchDeck: newDeck });

                    // Rebuild chat session with new deck
                    chatSession = createChat(buildRefinementPrompt(newDeck));
                    chatSession.send('The deck has been completely regenerated with the directive: ' + directive).catch(() => { });

                    addLog(`<strong>✅ Pipeline complete — deck updated (v${revisionHistory.length + 1})</strong>`);
                } catch (err) {
                    addLog(`<strong>❌ Pipeline failed: ${err.message}</strong>`);
                }
            }
        }
        // Handle /help
        else if (lowerQ === '/help') {
            typingMsg.className = 'qa-msg assistant';
            typingMsg.innerHTML = md(`**Available commands:**
- \`/market\` — Re-run Market Analyst assessment
- \`/science\` — Re-run Chief Scientist verification
- \`/producer\` — Re-run Field Producer logistics
- \`/story\` — Re-run Story Producer review
- \`/editor\` — Re-run Commissioning Editor critique
- \`/showrunner\` — Re-run Showrunner analysis
- \`/gatekeeper\` — Re-run Gatekeeper audit
- \`/score\` — Re-run Quality Evaluator
- \`/rerun <direction>\` — **Re-run full pipeline** with creative direction
- \`/undo\` — Revert last accepted edit
- \`/copy\` — Copy deck to clipboard
- \`/export\` — Export as DOCX

**Edit directives:** "Rewrite the logline", "Make Act 2 darker", "Sharpen the hook"
**Questions:** "Why this species?", "Explain the market positioning"`);
        }
        // Handle /copy
        else if (lowerQ === '/copy') {
            await navigator.clipboard.writeText(lastPitchDeck);
            typingMsg.className = 'qa-msg assistant';
            typingMsg.innerHTML = md('✓ Pitch deck copied to clipboard.');
        }
        // Handle /score
        else if (lowerQ === '/score') {
            typingMsg.className = 'qa-msg assistant';
            typingMsg.innerHTML = '<div class="agent-invoking"><span class="dots"><span></span><span></span><span></span></span> Running Quality Evaluator…</div>';
            try {
                const scorecard = await evaluatePitchDeck(lastPitchDeck, 'Refinement evaluation');
                renderScorecard(scorecard);
                scorecardEl.classList.remove('hidden');
                typingMsg.innerHTML = md(`✓ Quality Scorecard updated — Overall: **${scorecard.overall}/100**`);
            } catch (err) {
                typingMsg.innerHTML = `<em>Error running evaluator: ${err.message}</em>`;
            }
        }
        // Handle agent commands
        else if (AGENT_COMMANDS[lowerQ]) {
            await handleAgentCommand(lowerQ, typingMsg);
        }
        // Regular chat (questions + edit directives + auto-rerun detection)
        else {
            const response = await chatSession.send(question);

            // Check for <rerun> tag first (Mode 3 — fundamental changes)
            const rerunMatch = response.match(/<rerun>([\s\S]*?)<\/rerun>/i);
            if (rerunMatch && lastSeedIdea) {
                const directive = rerunMatch[1].trim();
                const commentary = response.replace(/<rerun>[\s\S]*?<\/rerun>/gi, '').trim();

                typingMsg.className = 'qa-msg assistant';
                typingMsg.innerHTML = `
                    ${commentary ? md(commentary) : ''}
                    <div class="rewrite-proposal rerun-proposal">
                        <div class="rewrite-header">
                            <span class="rewrite-icon">🔄</span>
                            <span class="rewrite-section">Full Pipeline Rerun</span>
                        </div>
                        <div class="rewrite-rationale">${directive}</div>
                        <div class="rewrite-actions">
                            <button class="rewrite-accept rerun-accept-btn">🚀 Rerun Pipeline</button>
                            <button class="rewrite-reject rerun-reject-btn">✗ Cancel</button>
                        </div>
                    </div>
                `;

                // Wire up the rerun accept button
                typingMsg.querySelector('.rerun-accept-btn').addEventListener('click', async () => {
                    const actionsEl = typingMsg.querySelector('.rewrite-actions');
                    actionsEl.innerHTML = '<span class="rewrite-status accepted">🔄 Running full pipeline…</span>';

                    // Save current deck for undo
                    revisionHistory.push(lastPitchDeck);

                    // Add progress log
                    const logEl = document.createElement('div');
                    logEl.className = 'rerun-log';
                    logEl.id = 'rerun-log-auto';
                    typingMsg.querySelector('.rerun-proposal').appendChild(logEl);

                    const addLog = (msg) => {
                        const entry = document.createElement('div');
                        entry.className = 'rerun-log-entry';
                        entry.innerHTML = msg;
                        logEl.appendChild(entry);
                        qaMessages.scrollTop = qaMessages.scrollHeight;
                    };

                    try {
                        const rerunCallbacks = {
                            onPhaseStart: (n, name) => addLog(`<span class="rerun-phase">Phase ${n}:</span> ${name}`),
                            onAgentThinking: (agent) => addLog(`<span class="rerun-agent">${agent.icon} ${agent.name}</span> thinking…`),
                            onAgentOutput: (agent) => addLog(`<span class="rerun-agent">${agent.icon} ${agent.name}</span> ✓ complete`),
                            onPhaseComplete: () => { },
                        };

                        const prodYear = productionYearInput.value ? parseInt(productionYearInput.value, 10) : null;
                        const targetPlatform = targetPlatformInput.value || null;

                        const newDeck = await runPipeline(lastSeedIdea, rerunCallbacks, {
                            platform: targetPlatform,
                            year: prodYear,
                            directive: directive,
                        });

                        // Update everything
                        lastPitchDeck = newDeck;
                        pitchDeckContent.innerHTML = md(newDeck);
                        pitchDeckContent.classList.add('deck-updated');
                        setTimeout(() => pitchDeckContent.classList.remove('deck-updated'), 1500);
                        updateGatekeeperBadges(newDeck);
                        updateRevisionBadge();
                        saveRun({ seedIdea: lastSeedIdea, finalPitchDeck: newDeck });

                        // Rebuild chat session with new deck
                        chatSession = createChat(buildRefinementPrompt(newDeck));
                        chatSession.send('The deck has been completely regenerated with the directive: ' + directive).catch(() => { });

                        addLog(`<strong>✅ Pipeline complete — deck updated (v${revisionHistory.length + 1})</strong>`);
                    } catch (err) {
                        addLog(`<strong>❌ Pipeline failed: ${err.message}</strong>`);
                    }
                });

                // Wire up cancel button
                typingMsg.querySelector('.rerun-reject-btn').addEventListener('click', () => {
                    typingMsg.querySelector('.rewrite-actions').innerHTML = '<span class="rewrite-status rejected">✗ Cancelled</span>';
                    typingMsg.querySelector('.rerun-proposal').classList.add('rewrite-rejected');
                });

            } else {
                // Check for rewrite blocks (Mode 2)
                const blocks = parseRewriteBlocks(response);
                const commentary = getCommentary(response);

                if (blocks.length > 0) {
                    // Has rewrite proposals
                    typingMsg.className = 'qa-msg assistant';
                    typingMsg.innerHTML = commentary ? md(commentary) : '';

                    for (const block of blocks) {
                        renderRewriteProposal(block, typingMsg);
                    }
                } else {
                    // Pure Q&A response (Mode 1)
                    typingMsg.className = 'qa-msg assistant';
                    typingMsg.innerHTML = md(response);
                }
            }
        }
    } catch (err) {
        typingMsg.className = 'qa-msg assistant';
        typingMsg.innerHTML = `<em>Error: ${err.message}</em>`;
    } finally {
        qaSend.disabled = false;
        qaInput.disabled = false;
        qaInput.focus();
        qaMessages.scrollTop = qaMessages.scrollHeight;
    }
});

// ─── Quality Scorecard Renderer ─────────────────────────
function scoreClass(score) {
    if (score >= 90) return 'score-excellent';
    if (score >= 75) return 'score-good';
    if (score >= 60) return 'score-decent';
    return 'score-weak';
}

function scoreColor(score) {
    if (score >= 90) return '#00d4aa';
    if (score >= 75) return '#4dabf7';
    if (score >= 60) return '#ffa94d';
    return '#ff6b6b';
}

function renderScorecard(scorecard) {
    scorecardEl.classList.remove('hidden');

    scorecardOverall.textContent = scorecard.overall;
    scorecardOverall.className = `scorecard-overall ${scoreClass(scorecard.overall)}`;

    scorecardDims.innerHTML = scorecard.dimensions.map(d => `
        <div class="dim-card">
            <div class="dim-card-top">
                <span class="dim-name">${d.name}</span>
                <span class="dim-score ${scoreClass(d.score)}">${d.score}</span>
            </div>
            <div class="dim-bar">
                <div class="dim-bar-fill" style="width: ${d.score}%; background: ${scoreColor(d.score)}"></div>
            </div>
            <div class="dim-rationale">${d.rationale}</div>
        </div>
    `).join('');

    scorecardRecs.innerHTML = `
        <h4>💡 Optimization Recommendations</h4>
        ${scorecard.recommendations.map(r => `<div class="rec-item">${r}</div>`).join('')}
    `;
}

async function autoScore(pitchDeck, seedIdea) {
    try {
        const scorecard = await evaluatePitchDeck(pitchDeck, seedIdea);
        renderScorecard(scorecard);
    } catch (err) {
        console.warn('Auto-scoring failed:', err.message);
    }
}

// ─── Dryrun Benchmark ───────────────────────────────
btnDryrun.addEventListener('click', () => {
    dryrunOverlay.classList.remove('hidden');
    dryrunStartArea.classList.remove('hidden');
    dryrunProgress.classList.add('hidden');
    dryrunResults.classList.add('hidden');
});

dryrunClose.addEventListener('click', () => {
    dryrunOverlay.classList.add('hidden');
});

dryrunOverlay.addEventListener('click', (e) => {
    if (e.target === dryrunOverlay) dryrunOverlay.classList.add('hidden');
});

dryrunStart.addEventListener('click', async () => {
    dryrunStartArea.classList.add('hidden');
    dryrunProgress.classList.remove('hidden');
    dryrunResults.classList.add('hidden');
    dryrunStart.disabled = true;

    try {
        const { results, aggregate } = await runDryrun(runPipeline, (current, total, seedName, status) => {
            const pct = Math.round(((current - 1) / total + (status.includes('Evaluating') ? 0.5 : 0) / total) * 100);
            dryrunProgressFill.style.width = `${pct}%`;
            dryrunProgressText.textContent = `[${current}/${total}] ${seedName}: ${status}`;
        });

        dryrunProgressFill.style.width = '100%';
        dryrunProgressText.textContent = 'Complete!';

        // Render results
        dryrunResults.classList.remove('hidden');

        const hasScored = aggregate.overall != null;
        const aggregateLabel = aggregate.rejected > 0
            ? `Aggregate Quality Score (${aggregate.scored}/${aggregate.total} scored, ${aggregate.rejected} rejected)`
            : 'Aggregate Quality Score';

        dryrunResults.innerHTML = `
            <div class="dryrun-aggregate">
                <div class="dryrun-aggregate-score ${hasScored ? scoreClass(aggregate.overall) : 'score-na'}">${hasScored ? aggregate.overall : '—'}</div>
                <div class="dryrun-aggregate-label">${aggregateLabel}</div>
            </div>

            <div class="dryrun-dim-grid">
                ${aggregate.dimensions.map(d => `
                    <div class="dryrun-dim-card">
                        <div class="dryrun-dim-name">${d.name}</div>
                        <div class="dryrun-dim-avg ${d.avg != null ? scoreClass(d.avg) : 'score-na'}">${d.avg != null ? d.avg : '—'}</div>
                        <div class="dryrun-dim-range">${d.min != null ? `${d.min}–${d.max}` : 'N/A'}</div>
                    </div>
                `).join('')}
            </div>

            <div class="dryrun-seed-results">
                <h4>Individual Results</h4>
                ${results.map(r => {
            if (r.rejected) {
                return `
                            <div class="dryrun-seed-card dryrun-seed-rejected">
                                <div class="dryrun-seed-card-header">
                                    <span class="dryrun-seed-name">${r.seed.name}</span>
                                    <span class="dryrun-seed-score score-rejected">⛔ REJECTED</span>
                                </div>
                                <div class="dryrun-seed-summary">${r.scorecard.summary}</div>
                            </div>
                        `;
            }
            return `
                        <div class="dryrun-seed-card">
                            <div class="dryrun-seed-card-header">
                                <span class="dryrun-seed-name">${r.seed.name}</span>
                                <span class="dryrun-seed-score ${scoreClass(r.scorecard.overall)}">${r.scorecard.overall}</span>
                            </div>
                            <div class="dryrun-seed-summary">${r.scorecard.summary}</div>
                        </div>
                    `;
        }).join('')}
            </div>

            <div class="dryrun-recs">
                <h4>💡 Cross-Seed Recommendations</h4>
                ${aggregate.allRecommendations.map(r => `
                    <div class="dryrun-rec-item">
                        ${r.recommendation}
                        <span class="dryrun-rec-seed"> — ${r.seed}</span>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (err) {
        showError(`Dryrun failed: ${err.message}`);
    } finally {
        dryrunStart.disabled = false;
    }
});

// ─── Init badges on page load ─────────────────────────
(async () => {
    try {
        const docs = await listDocuments();
        if (docs.length > 0) {
            kbBadge.textContent = docs.length;
            kbBadge.classList.remove('hidden');
        }
    } catch { }

    const runs = getRuns();
    if (runs.length > 0) {
        historyBadge.textContent = runs.length;
        historyBadge.classList.remove('hidden');
    }
})();

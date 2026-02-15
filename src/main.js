import { initGemini, createChat, callAgent } from './agents/gemini.js';
import { runPipeline, runAssessment } from './agents/orchestrator.js';
import { saveRun, getRuns, deleteRun, getRunById, saveDryrunResult, getDryrunResults } from './history.js';
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
    ALL_AGENTS,
} from './agents/personas.js';
import { marked } from 'marked';
import { exportDOCX } from './export.js';

// Google Search grounding for the refinement chat
const SEARCH_TOOLS = [{ googleSearch: {} }];

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
const dryrunHistory = document.getElementById('dryrun-history');

// Prompt editor elements
const promptEditorOverlay = document.getElementById('prompt-editor-overlay');
const promptEditorIcon = document.getElementById('prompt-editor-icon');
const promptEditorName = document.getElementById('prompt-editor-name');
const promptEditorTextarea = document.getElementById('prompt-editor-textarea');
const promptEditorStatus = document.getElementById('prompt-editor-status');
const promptEditorClose = document.getElementById('prompt-editor-close');
const promptEditorCancel = document.getElementById('prompt-editor-cancel');
const promptEditorSave = document.getElementById('prompt-editor-save');

// Agent lookup map
const AGENT_MAP = Object.fromEntries(ALL_AGENTS.map(a => [a.id, a]));
let currentEditingAgent = null;

function openPromptEditor(agent) {
    currentEditingAgent = agent;
    promptEditorIcon.textContent = agent.icon;
    promptEditorName.textContent = agent.name;
    promptEditorName.style.color = agent.color;
    promptEditorTextarea.value = agent.systemPrompt;
    promptEditorStatus.textContent = '';
    promptEditorOverlay.classList.remove('hidden');
    // Focus textarea after animation
    setTimeout(() => promptEditorTextarea.focus(), 100);
}

function closePromptEditor() {
    promptEditorOverlay.classList.add('hidden');
    currentEditingAgent = null;
}

// Wire agent chip clicks
document.querySelectorAll('.agent-chip[data-agent-id]').forEach(chip => {
    chip.addEventListener('click', () => {
        const agent = AGENT_MAP[chip.dataset.agentId];
        if (agent) openPromptEditor(agent);
    });
});

// Save prompt
promptEditorSave.addEventListener('click', () => {
    if (!currentEditingAgent) return;
    currentEditingAgent.systemPrompt = promptEditorTextarea.value;
    promptEditorStatus.textContent = '✓ Prompt saved';
    setTimeout(() => closePromptEditor(), 600);
});

// Cancel / close
promptEditorCancel.addEventListener('click', closePromptEditor);
promptEditorClose.addEventListener('click', closePromptEditor);
promptEditorOverlay.addEventListener('click', (e) => {
    if (e.target === promptEditorOverlay) closePromptEditor();
});

// Escape key closes
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !promptEditorOverlay.classList.contains('hidden')) {
        closePromptEditor();
    }
});

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
async function refreshHistoryList() {
    const runs = await getRuns();
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
        item.querySelector('.history-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteRun(run.id);
            await refreshHistoryList();
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
        // Remove the waiting message once work begins
        const waitMsg = document.getElementById('pipeline-wait-msg');
        if (waitMsg) waitMsg.remove();
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

    const rawInput = seedInput.value.trim();
    if (!rawInput) return;

    // Split by newlines, trim, remove blanks
    const seeds = rawInput.split('\n').map(s => s.trim()).filter(Boolean);
    if (seeds.length === 0) return;

    const isAssessment = currentMode === 'script';
    const isBatch = seeds.length > 1;

    // Disable form
    launchBtn.disabled = true;
    launchBtn.querySelector('.btn-text').textContent = isBatch ? `Running 0/${seeds.length}…` : 'Running…';

    // Show simulation
    simulationEl.classList.remove('hidden');
    timelineEl.innerHTML = '';
    pitchDeckEl.classList.add('hidden');
    scorecardEl.classList.add('hidden');
    simulationEl.scrollIntoView({ behavior: 'smooth' });

    // Add a coffee-break waiting message
    const waitTips = [
        '☕ Grab a cup of coffee while you wait.',
        '🚶 Talk to a stranger. You might learn something.',
        '🌿 Step outside and take a deep breath.',
        '📖 Read a page of that book you\'ve been meaning to start.',
        '🎧 Put on your favourite song — this takes about as long.',
        '🧘 Close your eyes for 60 seconds. Seriously.',
        '🪟 Look out the window. Notice something new.',
    ];
    const waitMsg = document.createElement('div');
    waitMsg.className = 'pipeline-wait-msg';
    waitMsg.id = 'pipeline-wait-msg';
    waitMsg.innerHTML = `<span class="wait-spinner"></span> <span>${waitTips[Math.floor(Math.random() * waitTips.length)]}</span>`;
    timelineEl.appendChild(waitMsg);

    // Batch banner (only for multi-seed)
    let batchBanner = null;
    if (isBatch) {
        batchBanner = document.createElement('div');
        batchBanner.className = 'batch-banner';
        batchBanner.innerHTML = `<span class="batch-progress">🌱 Seed 1/${seeds.length}</span><span class="batch-seed-name">${seeds[0]}</span>`;
        simulationEl.insertBefore(batchBanner, simulationEl.firstChild);
    }

    const prodYear = productionYearInput.value ? parseInt(productionYearInput.value, 10) : null;
    const targetPlatform = targetPlatformInput.value || null;
    const batchResults = []; // { seed, pitchDeck }

    try {
        for (let i = 0; i < seeds.length; i++) {
            const seedText = seeds[i];

            // Update batch banner
            if (batchBanner) {
                batchBanner.innerHTML = `<span class="batch-progress">🌱 Seed ${i + 1}/${seeds.length}</span><span class="batch-seed-name">${seedText}</span>`;
                launchBtn.querySelector('.btn-text').textContent = `Running ${i + 1}/${seeds.length}…`;
            }

            // Reset phase indicator + timeline for each seed
            autoImprovementAttempts = 0; // Reset for each new pipeline run
            const totalPhases = isAssessment ? 4 : 6;
            buildPhaseIndicator(totalPhases);
            timelineEl.innerHTML = '';

            const finalPitchDeck = isAssessment
                ? await runAssessment(seedText, pipelineCallbacks, prodYear)
                : await runPipeline(seedText, pipelineCallbacks, { platform: targetPlatform, year: prodYear });

            batchResults.push({ seed: seedText, pitchDeck: finalPitchDeck });

            // Save each run to history individually
            await saveRun({ seedIdea: seedText, finalPitchDeck });

            // Auto-score each (non-blocking)
            autoScore(finalPitchDeck, seedText);
        }

        // Remove batch banner
        if (batchBanner) batchBanner.remove();

        // Track last seed for /rerun
        lastSeedIdea = batchResults[batchResults.length - 1].seed;

        // ─── Display results ───
        if (batchResults.length === 1) {
            // Single seed — classic display
            const { pitchDeck } = batchResults[0];
            pitchDeckContent.innerHTML = md(pitchDeck);
            pitchDeckEl.classList.remove('hidden');
            updateGatekeeperBadges(pitchDeck);
            pitchDeckEl.scrollIntoView({ behavior: 'smooth' });
            initChatSession(pitchDeck);
        } else {
            // Multi-seed — tabbed display
            const tabBar = document.createElement('div');
            tabBar.className = 'batch-tabs';
            batchResults.forEach((r, idx) => {
                const tab = document.createElement('button');
                tab.className = `batch-tab${idx === 0 ? ' active' : ''}`;
                tab.textContent = `🌱 ${r.seed.length > 40 ? r.seed.slice(0, 37) + '…' : r.seed}`;
                tab.dataset.index = idx;
                tab.addEventListener('click', () => {
                    tabBar.querySelectorAll('.batch-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    pitchDeckContent.innerHTML = md(batchResults[idx].pitchDeck);
                    updateGatekeeperBadges(batchResults[idx].pitchDeck);
                    initChatSession(batchResults[idx].pitchDeck);
                    lastSeedIdea = batchResults[idx].seed;
                });
                tabBar.appendChild(tab);
            });

            // Remove any existing tab bar
            pitchDeckEl.querySelector('.batch-tabs')?.remove();
            pitchDeckEl.insertBefore(tabBar, pitchDeckContent);

            // Show first result
            pitchDeckContent.innerHTML = md(batchResults[0].pitchDeck);
            pitchDeckEl.classList.remove('hidden');
            updateGatekeeperBadges(batchResults[0].pitchDeck);
            pitchDeckEl.scrollIntoView({ behavior: 'smooth' });
            initChatSession(batchResults[0].pitchDeck);
        }

        // Show chat toast
        const toast = document.createElement('div');
        toast.className = 'chat-ready-toast';
        toast.innerHTML = isBatch ? `💬 ${batchResults.length} pitch decks ready — refinement chat below` : '💬 Refinement chat ready below';
        toast.addEventListener('click', () => {
            document.getElementById('qa-section').scrollIntoView({ behavior: 'smooth' });
            toast.remove();
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('visible'), 100);
        setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 500); }, 6000);
    } catch (err) {
        console.error('Pipeline error:', err);
        showError(`Pipeline error: ${err.message}`);
        if (batchBanner) batchBanner.remove();
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
- Changing the narrative perspective or angle
- Adding or changing a presenter/host character
- Fundamentally changing the story structure
- Switching primary species or location
- Pivoting the entire concept direction
- Any change that would affect MORE than 3 sections of the deck
- The user says "implement all suggestions" or asks for sweeping changes
- The user asks to reach a specific score target (e.g., "get it to 90", "reach 85")

YOUR OUTPUT MUST contain this EXACT XML tag — this is machine-parsed, not human-read:

<rerun>your one-paragraph directive summarizing the creative change</rerun>

EXAMPLE 1 — User says "Add a host who confronts the wild":
<rerun>Restructure the entire pitch around a charismatic presenter-host who leaves the studio and enters the field. All sections must be rewritten to feature the host's journey as the narrative spine, with species encounters framed through the host's perspective rather than pure observational wildlife filmmaking.</rerun>

This requires a full rerun because adding a host changes the narrative structure, scriptment, visual approach, and talent requirements across every section.

EXAMPLE 2 — User says "implement all the suggestions to reach score 85":
<rerun>Apply all identified improvements: strengthen the ecological imperative with verified conservation data, elevate existential stakes beyond simple survival, substantiate key animal behaviors with peer-reviewed sources, and ensure the host/presenter profile is compelling for the target platform. Target overall quality score of 85+.</rerun>

This requires a full rerun because the changes span every section of the deck.

CRITICAL: You MUST output the <rerun>...</rerun> XML tag. Do NOT describe what a rerun would do in plain text. The tag triggers an automated pipeline — without it, nothing happens.

DECISION GUIDE — REWRITE vs RERUN:
- "Sharpen the logline" → REWRITE (one section, cosmetic)
- "Make Act 2 more tense" → REWRITE (one section, tone)
- "Add a host who explores the wild" → RERUN (fundamental narrative shift)
- "Change the species to snow leopards" → RERUN (changes everything)
- "Frame it as a survival thriller" → RERUN (genre pivot, affects all sections)
- "Make the narration more poetic" → REWRITE (style, localized)
- "Implement all suggestions" → RERUN (sweeping multi-section changes)
- "Can you get it to 90?" → RERUN (score-target improvement across all sections)

CRITICAL RULES:
- If the user says "rewrite", "change", "make it", "improve", "sharpen", "fix" — evaluate scope first
- The <original> text in REWRITE must be a real excerpt from the current deck
- Never use MODE 2 or MODE 3 when the user is just asking a question
- When in doubt between REWRITE and RERUN, prefer RERUN — it's better to rebuild than to patch
- NEVER output the phrase "The user's creative direction summarized" — that is a template instruction, not output

═══════════════════════════════════════════
CURRENT PITCH DECK
═══════════════════════════════════════════

${deck}`;
}

function initChatSession(pitchDeck) {
    lastPitchDeck = pitchDeck;
    revisionHistory = [];
    qaMessages.innerHTML = '';

    chatSession = createChat(buildRefinementPrompt(pitchDeck), { tools: SEARCH_TOOLS });

    // Send an initial context-setting message silently
    chatSession.send('I have received the Master Pitch Deck. I am ready to answer questions about it or make refinements. The user can also use slash commands like /gatekeeper, /market, /science, /editor to invoke specific agents.').catch(() => { });

    // Add welcome hints
    const welcomeMsg = document.createElement('div');
    welcomeMsg.className = 'qa-msg assistant chat-welcome';
    welcomeMsg.innerHTML = `
        <div class="welcome-hints">
            <div class="hint-line">💬 <em>"Why this species?"</em> · <em>"Explain the market positioning"</em></div>
            <div class="hint-line">✏️ <em>"Sharpen the logline"</em> · <em>"Make Act 2 darker"</em></div>
            <div class="hint-line">🔄 <em>"Add a presenter host"</em> · <em>"Frame it as a thriller"</em></div>
            <div class="hint-line">🤖 <span>/gatekeeper</span> · <span>/market</span> · <span>/score</span> · <span>/rerun</span> · <span>/help</span></div>
        </div>
    `;

    qaMessages.appendChild(welcomeMsg);

    // Update the revision badge
    updateRevisionBadge();
}

function updateRevisionBadge() {
    const badge = document.getElementById('revision-badge');
    const deckBadge = document.getElementById('deck-version-badge');
    const version = revisionHistory.length + 1;

    if (badge) {
        if (revisionHistory.length > 0) {
            badge.textContent = `v${version}`;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    if (deckBadge) {
        deckBadge.textContent = revisionHistory.length > 0 ? `v${version}` : '';
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

// Match a rewrite to a deck section by heading similarity
function matchBySection(sectionHint, revised) {
    const normalizedHint = sectionHint.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const sections = lastPitchDeck.split(/\n(?=#{1,4} )/);
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < sections.length; i++) {
        const heading = (sections[i].match(/^#{1,4}\s+(.+)$/m) || [])[1] || '';
        const normalizedHeading = heading.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (!normalizedHeading) continue;

        // Score: exact match > contains > word overlap
        if (normalizedHeading === normalizedHint) {
            bestIdx = i; break;
        }
        const hintWords = normalizedHint.split(/\s+/);
        const headingWords = normalizedHeading.split(/\s+/);
        const overlap = hintWords.filter(w => headingWords.includes(w)).length;
        const score = overlap / Math.max(hintWords.length, 1);
        if (score > bestScore && score >= 0.5) {
            bestScore = score;
            bestIdx = i;
        }
    }

    if (bestIdx >= 0) {
        sections[bestIdx] = revised;
        lastPitchDeck = sections.join('\n');
        return true;
    }
    return false;
}

// Apply a rewrite to the live deck
async function applyRewrite(original, revised, sectionHint) {
    // Save current state for undo
    revisionHistory.push(lastPitchDeck);

    // Strategy 1: Exact substring match (best case — LLM copied verbatim)
    if (lastPitchDeck.includes(original)) {
        lastPitchDeck = lastPitchDeck.replace(original, revised);
    }
    // Strategy 2: Section-heading match using the <section> hint
    else if (sectionHint && matchBySection(sectionHint, revised)) {
        // matchBySection updates lastPitchDeck directly and returns true on success
    }
    // Strategy 3: First-line fuzzy match
    else {
        const firstLine = original.split('\n')[0].trim();
        if (firstLine && lastPitchDeck.includes(firstLine)) {
            const sections = lastPitchDeck.split(/\n(?=#{1,4} )/);
            for (let i = 0; i < sections.length; i++) {
                if (sections[i].includes(firstLine)) {
                    sections[i] = revised;
                    break;
                }
            }
            lastPitchDeck = sections.join('\n');
        } else {
            // Last resort: try section hint even with partial matching
            const normalizedHint = sectionHint?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
            const sections = lastPitchDeck.split(/\n(?=#{1,4} )/);
            let matched = false;
            for (let i = 0; i < sections.length; i++) {
                const heading = (sections[i].match(/^#{1,4}\s+(.+)$/m) || [])[1] || '';
                const normalizedHeading = heading.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normalizedHint && normalizedHeading.includes(normalizedHint)) {
                    sections[i] = revised;
                    matched = true;
                    break;
                }
            }
            if (matched) {
                lastPitchDeck = sections.join('\n');
            } else {
                // Absolute fallback — replace the section by best similarity
                console.warn('[Rewrite] No match found for section:', sectionHint, '— appending');
                lastPitchDeck += '\n\n' + revised;
            }
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

    // Update the chat session's context WITHOUT destroying conversation history
    // Instead of recreating the session, inject the updated section so the LLM
    // retains memory of what was discussed and what the user's intent was.
    chatSession.send(
        `[CONTEXT UPDATE] The user accepted a rewrite. The deck has been updated.\n\nHere is the current full deck for your reference:\n\n${lastPitchDeck}\n\nContinue assisting with refinements. You remember everything discussed so far.`
    ).catch(() => { });

    // Auto-save to history so refinements aren't lost on tab close
    if (lastSeedIdea) {
        await saveRun({ seedIdea: lastSeedIdea, finalPitchDeck: lastPitchDeck });
    }
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

    proposal.querySelector('.rewrite-accept').addEventListener('click', async () => {
        await applyRewrite(block.original, block.revised, block.section);
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
    chatSession = createChat(buildRefinementPrompt(lastPitchDeck), { tools: SEARCH_TOOLS });

    return `✓ Reverted to v${revisionHistory.length + 1}. ${revisionHistory.length} revision(s) remaining in history.`;
}

// Main chat submit handler
// Shared rerun pipeline execution (used by /rerun and auto-detected <rerun> tags)
async function executeRerun(directive, containerEl) {
    // Save current deck for undo
    revisionHistory.push(lastPitchDeck);

    // Set up progress UI
    containerEl.className = 'qa-msg assistant rerun-progress';
    containerEl.innerHTML = `<div class="agent-invoking"><span class="dots"><span></span><span></span><span></span></span> Re-running full pipeline with directive…</div><div class="rerun-log" id="rerun-log"></div>`;

    const rerunLog = containerEl.querySelector('#rerun-log') || containerEl.querySelector('.rerun-log');
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
        await saveRun({ seedIdea: lastSeedIdea, finalPitchDeck: newDeck });

        // Rebuild chat session with new deck (full rerun justifies a fresh session)
        chatSession = createChat(buildRefinementPrompt(newDeck), { tools: SEARCH_TOOLS });
        chatSession.send('The deck has been completely regenerated with the directive: ' + directive).catch(() => { });

        // Auto-score the new deck
        autoScore(newDeck, lastSeedIdea);

        addLog(`<strong>✅ Pipeline complete — deck updated (v${revisionHistory.length + 1})</strong>`);
    } catch (err) {
        addLog(`<strong>❌ Pipeline failed: ${err.message}</strong>`);
    }
}

// C3: Textarea auto-expand and Enter/Shift+Enter handling
qaInput.addEventListener('input', () => {
    qaInput.style.height = 'auto';
    qaInput.style.height = Math.min(qaInput.scrollHeight, 120) + 'px';
});
qaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        qaForm.requestSubmit();
    }
});

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
    qaInput.style.height = 'auto';

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
                await executeRerun(directive, typingMsg);
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
        // Handle /export
        else if (lowerQ === '/export') {
            typingMsg.className = 'qa-msg assistant';
            try {
                const title = (lastPitchDeck.match(/^#{1,2}\s+(.+)$/m) || [])[1] || 'Master Pitch Deck';
                await exportDOCX(lastPitchDeck, title.replace(/\*+/g, '').trim());
                typingMsg.innerHTML = md('✓ DOCX exported successfully.');
            } catch (err) {
                typingMsg.innerHTML = `<em>Error exporting: ${err.message}</em>`;
            }
        }
        // Handle /score
        else if (lowerQ === '/score') {
            typingMsg.className = 'qa-msg assistant';
            typingMsg.innerHTML = '<div class="agent-invoking"><span class="dots"><span></span><span></span><span></span></span> Running Quality Evaluator…</div>';
            try {
                const scorecard = await evaluatePitchDeck(lastPitchDeck, 'Refinement evaluation');
                renderScorecard(scorecard);
                scorecardEl.classList.remove('hidden');

                // Sync the header badge with the evaluator score
                const scoreBadge = document.getElementById('gatekeeper-score-badge');
                const badgesEl = document.getElementById('gatekeeper-badges');
                if (scoreBadge && badgesEl) {
                    const s = scorecard.overall;
                    const icon = s >= 80 ? '✅' : s >= 60 ? '⚠️' : '⛔';
                    scoreBadge.textContent = `${icon} ${s}/100`;
                    scoreBadge.className = `gatekeeper-badge gatekeeper-score ${s >= 80 ? 'score-green' : s >= 60 ? 'score-amber' : s >= 40 ? 'score-orange' : 'score-red'}`;
                    badgesEl.classList.remove('hidden');
                }

                // Update verdict text
                const verdictEl = document.getElementById('deck-verdict-text');
                if (verdictEl) {
                    if (s >= 80) {
                        verdictEl.textContent = 'Greenlit & Approved';
                        verdictEl.style.color = '#00d4aa';
                    } else {
                        verdictEl.textContent = `Below Threshold (${s}/100) — needs 80+`;
                        verdictEl.style.color = '#f0a030';
                    }
                }

                typingMsg.innerHTML = md(`✓ Quality Scorecard updated — Overall: **${scorecard.overall}/100**`);

                // C2: Score→Rerun bridge — add "Apply Recommendations" button
                if (scorecard.recommendations && scorecard.recommendations.length > 0 && lastSeedIdea) {
                    const bridgeBtn = document.createElement('button');
                    bridgeBtn.className = 'rewrite-accept score-rerun-btn';
                    bridgeBtn.textContent = '🚀 Apply Recommendations via Full Rerun';
                    bridgeBtn.addEventListener('click', async () => {
                        const directive = `Apply all identified improvements to reach a higher quality score. Specific recommendations: ${scorecard.recommendations.join('; ')}`;
                        bridgeBtn.disabled = true;
                        bridgeBtn.textContent = '🔄 Running…';
                        const rerunMsg = document.createElement('div');
                        rerunMsg.className = 'qa-msg assistant';
                        qaMessages.appendChild(rerunMsg);
                        await executeRerun(directive, rerunMsg);
                        bridgeBtn.textContent = '✅ Done';
                    });
                    typingMsg.appendChild(bridgeBtn);
                }
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

                    try {
                        await executeRerun(directive, typingMsg);
                    } catch (err) {
                        // Error already handled inside executeRerun
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

const MAX_AUTO_IMPROVEMENTS = 2;
let autoImprovementAttempts = 0;

async function autoScore(pitchDeck, seedIdea) {
    const verdictEl = document.getElementById('deck-verdict-text');
    try {
        const scorecard = await evaluatePitchDeck(pitchDeck, seedIdea);
        renderScorecard(scorecard);

        // ─── Update title badge (single source of truth) ──────
        const scoreBadge = document.getElementById('gatekeeper-score-badge');
        const badgesEl = document.getElementById('gatekeeper-badges');
        const s = scorecard.overall;

        if (scoreBadge && badgesEl) {
            const icon = s >= 80 ? '✅' : s >= 60 ? '⚠️' : '⛔';
            scoreBadge.textContent = `${icon} ${s}/100`;
            scoreBadge.className = `gatekeeper-badge gatekeeper-score ${s >= 80 ? 'score-green' : s >= 60 ? 'score-amber' : s >= 40 ? 'score-orange' : 'score-red'}`;
            badgesEl.classList.remove('hidden');
        }

        // ─── Update verdict text ──────
        if (verdictEl) {
            if (s >= 80) {
                verdictEl.textContent = 'Greenlit & Approved';
                verdictEl.style.color = '#00d4aa';
            } else {
                verdictEl.textContent = `Below Threshold (${s}/100) — needs 80+`;
                verdictEl.style.color = '#f0a030';
            }
        }

        // ─── Auto-improvement: if below 80 and we haven't exhausted attempts ──────
        if (s < 80 && autoImprovementAttempts < MAX_AUTO_IMPROVEMENTS && lastSeedIdea) {
            autoImprovementAttempts++;
            const attempt = autoImprovementAttempts;
            const total = MAX_AUTO_IMPROVEMENTS;

            if (verdictEl) {
                verdictEl.textContent = `Auto-improving (${attempt}/${total})… Score: ${s}/100`;
                verdictEl.style.color = '#f0a030';
            }

            // Build a targeted directive from the evaluator's weakest dimensions + recommendations
            const weakDims = scorecard.dimensions
                .filter(d => d.score !== null && d.score < 75)
                .sort((a, b) => a.score - b.score)
                .map(d => `${d.name} (${d.score}/100): ${d.rationale}`)
                .join('\n');

            const recs = scorecard.recommendations
                ? scorecard.recommendations.join('; ')
                : '';

            const directive = `QUALITY EVALUATOR AUTO-IMPROVEMENT (attempt ${attempt}/${total}). Current overall score: ${s}/100 — target is 80+.\n\nWeakest dimensions:\n${weakDims}\n\nRecommendations: ${recs}\n\nFocus on the weakest dimensions. Do not regress on strong areas.`;

            // Create a visible log in the QA panel
            const qaMessages = document.getElementById('qa-messages');
            const rerunMsg = document.createElement('div');
            rerunMsg.className = 'qa-msg assistant';
            rerunMsg.innerHTML = `<strong>🔄 Auto-improvement ${attempt}/${total}</strong> — Evaluator scored ${s}/100, targeting 80+…`;
            if (qaMessages) qaMessages.appendChild(rerunMsg);

            await executeRerun(directive, rerunMsg);
            // Note: executeRerun calls autoScore again via its own flow,
            // so the loop continues automatically if score is still < 80
        } else if (s < 80 && autoImprovementAttempts >= MAX_AUTO_IMPROVEMENTS) {
            // Exhausted auto-improvement attempts
            if (verdictEl) {
                verdictEl.textContent = `Best achievable: ${s}/100 (${MAX_AUTO_IMPROVEMENTS} auto-improvements exhausted)`;
                verdictEl.style.color = '#f0a030';
            }
        }
    } catch (err) {
        console.warn('Auto-scoring failed:', err.message);
        if (verdictEl) {
            verdictEl.textContent = 'Scoring unavailable';
            verdictEl.style.color = '#888';
        }
    }
}

// ─── Dryrun Benchmark ───────────────────────────────
let dryrunRunning = false;
const DRYRUN_STATE_KEY = 'scriptwriter_dryrun_state';

/** Save dryrun state to localStorage for resume */
function saveDryrunState(state) {
    try {
        localStorage.setItem(DRYRUN_STATE_KEY, JSON.stringify(state));
    } catch { }
}

/** Load saved dryrun state */
function loadDryrunState() {
    try {
        const raw = localStorage.getItem(DRYRUN_STATE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

/** Clear saved dryrun state */
function clearDryrunState() {
    localStorage.removeItem(DRYRUN_STATE_KEY);
}

btnDryrun.addEventListener('click', async () => {
    dryrunOverlay.classList.remove('hidden');
    dryrunProgress.classList.add('hidden');
    dryrunResults.classList.add('hidden');

    // Check for saved state to offer resume
    const saved = loadDryrunState();
    if (saved && saved.completedResults && saved.completedResults.length > 0 && !saved.finished) {
        const total = saved.totalSeeds || 6;
        const done = saved.completedResults.length;
        dryrunStartArea.innerHTML = `
            <div class="dryrun-resume-info">
                <p>⏸ Previous run interrupted at <strong>${done}/${total}</strong> seeds</p>
                <p class="dryrun-resume-meta">${saved.calibrationSeedName || 'Unknown calibration seed'} · ${new Date(saved.startedAt).toLocaleString()}</p>
            </div>
            <div class="dryrun-resume-btns">
                <button id="dryrun-resume" class="btn-primary btn-launch">
                    <span class="btn-text">Resume</span>
                    <span class="btn-icon">→</span>
                </button>
                <button id="dryrun-restart" class="btn-secondary">Start Fresh</button>
            </div>
        `;
        dryrunStartArea.classList.remove('hidden');

        document.getElementById('dryrun-resume').addEventListener('click', () => startDryrun(true));
        document.getElementById('dryrun-restart').addEventListener('click', () => {
            clearDryrunState();
            resetDryrunStartArea();
            startDryrun(false);
        });
    } else {
        resetDryrunStartArea();
    }

    // Show past dryruns history
    await renderDryrunHistory();
});

function resetDryrunStartArea() {
    dryrunStartArea.innerHTML = `
        <button id="dryrun-start" class="btn-primary btn-launch">
            <span class="btn-text">Start Benchmark</span>
            <span class="btn-icon">→</span>
        </button>
    `;
    dryrunStartArea.classList.remove('hidden');
    document.getElementById('dryrun-start').addEventListener('click', () => startDryrun(false));
}

dryrunClose.addEventListener('click', () => {
    if (dryrunRunning) return; // Block close during active run
    dryrunOverlay.classList.add('hidden');
});

dryrunOverlay.addEventListener('click', (e) => {
    if (dryrunRunning) return; // Block dismiss during active run
    if (e.target === dryrunOverlay) dryrunOverlay.classList.add('hidden');
});

async function renderDryrunHistory() {
    const past = await getDryrunResults();
    if (past.length === 0) {
        dryrunHistory.innerHTML = '';
        return;
    }

    const rows = past.slice(0, 10).map(dr => {
        const date = new Date(dr.timestamp);
        const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const score = dr.aggregate?.overall;
        const calStatus = dr.calibration?.status || '—';
        const calIcon = calStatus === 'PASS' ? '✅' : calStatus === 'WARN' ? '⚠️' : calStatus === 'FAIL' ? '⛔' : '—';
        const calProd = dr.calibration?.production ? `${dr.calibration.year} · ${dr.calibration.production}` : '';
        const seedScores = (dr.seeds || []).map(s => {
            if (s.rejected) return '<span class="drh-seed score-rejected">⛔</span>';
            const cls = s.score >= 80 ? 'score-high' : s.score >= 60 ? 'score-mid' : 'score-low';
            return `<span class="drh-seed ${cls}">${s.score}</span>`;
        }).join('');

        return `
            <div class="drh-row">
                <span class="drh-date">${dateStr} ${timeStr}</span>
                <span class="drh-score ${score != null ? (score >= 80 ? 'score-high' : score >= 60 ? 'score-mid' : 'score-low') : 'score-na'}">${score ?? '—'}</span>
                <span class="drh-cal" title="${calProd}">${calIcon}</span>
                <span class="drh-seeds">${seedScores}</span>
            </div>
        `;
    }).join('');

    // Build dimension trend chart (when ≥2 dryruns exist)
    let trendHtml = '';
    if (past.length >= 2) {
        // Aggregate dimension scores per dryrun (oldest → newest for sparkline)
        const chronological = past.slice(0, 10).reverse();
        const dimNames = ['Narrative Structure', 'Scientific Rigor', 'Market Viability', 'Production Feasibility', 'Originality', 'Presentation Quality', 'Platform Compliance'];
        const dimColors = ['#da77f2', '#20c997', '#00d4aa', '#ffd43b', '#ff6b6b', '#339af0', '#845ef7'];
        const dimAgents = ['Story Producer', 'Chief Scientist', 'Market Analyst', 'Field Producer', 'Story Producer', 'Showrunner', 'Story Producer'];

        // Extract average dimension score per dryrun
        const dimSeries = dimNames.map((name, dimIdx) => {
            const pts = chronological.map(dr => {
                const seeds = (dr.seeds || []).filter(s => !s.rejected && s.dimensions?.length > dimIdx);
                if (seeds.length === 0) return null;
                const avg = seeds.reduce((sum, s) => sum + (s.dimensions[dimIdx]?.score || 0), 0) / seeds.length;
                return Math.round(avg);
            }).filter(v => v !== null);
            return { name, pts, color: dimColors[dimIdx], agent: dimAgents[dimIdx] };
        }).filter(d => d.pts.length >= 2);

        if (dimSeries.length > 0) {
            const sparklines = dimSeries.map(d => {
                const min = Math.min(...d.pts, 0);
                const max = Math.max(...d.pts, 100);
                const range = max - min || 1;
                const w = 80, h = 24;
                const points = d.pts.map((v, i) => {
                    const x = d.pts.length === 1 ? w / 2 : (i / (d.pts.length - 1)) * w;
                    const y = h - ((v - min) / range) * h;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                }).join(' ');
                const latest = d.pts[d.pts.length - 1];
                const prev = d.pts[d.pts.length - 2];
                const delta = latest - prev;
                const arrow = delta > 2 ? '↑' : delta < -2 ? '↓' : '→';
                const arrowCls = delta > 2 ? 'trend-up' : delta < -2 ? 'trend-down' : 'trend-flat';
                const scoreCls = latest >= 80 ? 'score-high' : latest >= 60 ? 'score-mid' : 'score-low';

                return `
                    <div class="drh-trend-row" title="${d.agent}">
                        <span class="drh-trend-label">${d.name.split(' ')[0]}</span>
                        <svg class="drh-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
                            <polyline points="${points}" fill="none" stroke="${d.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <span class="drh-trend-score ${scoreCls}">${latest}</span>
                        <span class="drh-trend-delta ${arrowCls}">${arrow}${Math.abs(delta) > 2 ? Math.abs(delta) : ''}</span>
                    </div>
                `;
            }).join('');

            trendHtml = `
                <div class="drh-trends">
                    <div class="drh-trend-title">📈 Dimension Trends</div>
                    ${sparklines}
                </div>
            `;
        }
    }

    dryrunHistory.innerHTML = `
        <div class="drh-container">
            <div class="drh-header">📊 Past Dryruns</div>
            <div class="drh-table">
                <div class="drh-row drh-header-row">
                    <span class="drh-date">Date</span>
                    <span class="drh-score">Score</span>
                    <span class="drh-cal">Cal</span>
                    <span class="drh-seeds">Seeds</span>
                </div>
                ${rows}
            </div>
            ${trendHtml}
        </div>
    `;
}

async function startDryrun(resume) {
    dryrunStartArea.classList.add('hidden');
    dryrunHistory.innerHTML = '';
    dryrunProgress.classList.remove('hidden');
    dryrunResults.classList.add('hidden');
    dryrunRunning = true;
    dryrunClose.classList.add('disabled');

    try {
        const savedState = resume ? loadDryrunState() : null;
        const skipSeedIds = savedState ? (savedState.completedResults || []).map(r => r.seed.id) : [];

        const { results, aggregate, calibration } = await runDryrun(runPipeline, (current, total, seedName, status) => {
            const pct = Math.round(((current - 1) / total + (status.includes('Evaluating') ? 0.5 : 0) / total) * 100);
            dryrunProgressFill.style.width = `${pct}%`;
            dryrunProgressText.textContent = `[${current}/${total}] ${seedName}: ${status}`;
        }, {
            skipSeedIds,
            previousResults: savedState ? savedState.completedResults : [],
            onSeedComplete: (completedResults, calibrationSeedName, totalSeeds) => {
                saveDryrunState({
                    completedResults,
                    calibrationSeedName,
                    totalSeeds,
                    startedAt: savedState?.startedAt || new Date().toISOString(),
                    finished: false,
                });
            },
        });

        dryrunProgressFill.style.width = '100%';
        dryrunProgressText.textContent = 'Complete!';
        clearDryrunState();

        // Persist dryrun result to IndexedDB
        await saveDryrunResult({ results, aggregate, calibration });

        // Render results
        dryrunResults.classList.remove('hidden');

        const hasScored = aggregate.overall != null;
        const aggregateLabel = aggregate.rejected > 0
            ? `Aggregate Quality Score (${aggregate.scored}/${aggregate.total} scored, ${aggregate.rejected} rejected)`
            : 'Aggregate Quality Score';

        // Calibration health banner
        const calBanner = calibration ? (() => {
            const icon = calibration.status === 'PASS' ? '✅' : calibration.status === 'WARN' ? '⚠️' : '⛔';
            const cls = calibration.status === 'PASS' ? 'cal-pass' : calibration.status === 'WARN' ? 'cal-warn' : 'cal-fail';
            const scoreText = calibration.score != null ? `${calibration.score}/100` : 'N/A';
            const deltaText = calibration.delta && calibration.delta !== 0 ? ` (${calibration.delta > 0 ? '+' : ''}${calibration.delta})` : '';
            const prodLabel = calibration.production ? `${calibration.year} · ${calibration.production}` : 'Gold Standard';
            const agreementText = calibration.markerDisagreements > 0
                ? ` · ⚠️ ${calibration.markerDisagreements} disagree with ground truth`
                : ' · all markers agree with ground truth';
            const markerList = calibration.markers && calibration.markers.length > 0
                ? `<div class="cal-markers">
                    <div class="cal-markers-header">✅ Gold Standard Checklist (${calibration.markersPassed}/${calibration.markersTotal}${agreementText})</div>
                    ${calibration.markers.map(m => {
                    const agreeIcon = m.agrees === true ? '' : m.agrees === false ? ' <span class="cal-marker-disagree">⚠️ disagrees</span>' : '';
                    return `
                        <div class="cal-marker ${m.pass === true ? 'cal-marker-pass' : m.pass === false ? 'cal-marker-fail' : 'cal-marker-na'}">
                            <span class="cal-marker-icon">${m.pass === true ? '✅' : m.pass === false ? '❌' : '❓'}</span>
                            <span class="cal-marker-label">${m.label}${agreeIcon}</span>
                            <span class="cal-marker-note">${m.note || ''}</span>
                        </div>
                    `;
                }).join('')}
                </div>`
                : '';
            const redFlagList = calibration.redFlags && calibration.redFlags.length > 0
                ? `<div class="cal-markers cal-redflags">
                    <div class="cal-markers-header">🚩 Red Flag Scan (${calibration.redFlagsTriggered}/${calibration.redFlagsTotal} triggered${calibration.redFlagsTriggered === 0 ? ' — all clear' : ' — WARNING'})</div>
                    ${calibration.redFlags.map(f => `
                        <div class="cal-marker ${f.triggered === true ? 'cal-marker-redflag' : f.triggered === false ? 'cal-marker-clear' : 'cal-marker-na'}">
                            <span class="cal-marker-icon">${f.triggered === true ? '🚩' : f.triggered === false ? '✅' : '❓'}</span>
                            <span class="cal-marker-label">${f.label}</span>
                            <span class="cal-marker-note">${f.note || ''}</span>
                        </div>
                    `).join('')}
                </div>`
                : '';
            return `
                <div class="calibration-banner ${cls}">
                    <div class="cal-header">${icon} Calibration ${calibration.status} — ${prodLabel}</div>
                    <div class="cal-detail">Scored <strong>${scoreText}</strong>${deltaText} · Expected: ${calibration.expected} · ⏱ ${calibration.duration}s</div>
                    <div class="cal-summary">${calibration.summary}</div>
                    ${markerList}
                    ${redFlagList}
                </div>
            `;
        })() : '';

        dryrunResults.innerHTML = `
            ${calBanner}

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
                                    <span class="dryrun-seed-name">${r.seed.name}${r.seed.platform ? ` <span class="dryrun-platform-badge">${r.seed.platform}</span>` : ''}</span>
                                    <span class="dryrun-seed-score score-rejected">⛔ REJECTED</span>
                                </div>
                                <div class="dryrun-seed-summary">${r.scorecard.summary}</div>
                                <div class="dryrun-seed-timing">⏱ ${r.duration}s</div>
                            </div>
                        `;
            }
            return `
                        <div class="dryrun-seed-card">
                            <div class="dryrun-seed-card-header">
                                <span class="dryrun-seed-name">${r.seed.name}${r.seed.platform ? ` <span class="dryrun-platform-badge">${r.seed.platform}</span>` : ''}</span>
                                <span class="dryrun-seed-score ${scoreClass(r.scorecard.overall)}">${r.scorecard.overall}</span>
                            </div>
                            <div class="dryrun-seed-dims">
                                ${r.scorecard.dimensions.map(d => `
                                    <span class="dryrun-seed-dim" title="${d.rationale}">
                                        ${d.name}: <strong class="${scoreClass(d.score)}">${d.score}</strong>
                                    </span>
                                `).join('')}
                            </div>
                            <div class="dryrun-seed-summary">${r.scorecard.summary}</div>
                            <div class="dryrun-seed-timing">⏱ ${r.duration}s</div>
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
        dryrunRunning = false;
        dryrunClose.classList.remove('disabled');
    }
}

// ─── Init badges on page load ─────────────────────────
(async () => {
    try {
        const docs = await listDocuments();
        if (docs.length > 0) {
            kbBadge.textContent = docs.length;
            kbBadge.classList.remove('hidden');
        }
    } catch { }

    const runs = await getRuns();
    if (runs.length > 0) {
        historyBadge.textContent = runs.length;
        historyBadge.classList.remove('hidden');
    }
})();

import { initGemini, createChat } from './agents/gemini.js';
import { runPipeline, runAssessment } from './agents/orchestrator.js';
import { saveRun, getRuns, deleteRun, getRunById } from './history.js';
import { chunkText } from './knowledge/chunker.js';
import { embedBatch } from './knowledge/embeddings.js';
import { addDocument, listDocuments, deleteDocument } from './knowledge/vectorStore.js';
import { evaluatePitchDeck, runDryrun } from './quality/evaluator.js';

// ─── Markdown Renderer ────────────────────────────────
function md(text) {
    if (!text) return '';
    let html = text
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Tables — convert pipe-delimited rows
    html = html.replace(
        /^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)*)/gm,
        (_, headerRow, _sep, bodyRows) => {
            const headers = headerRow.split('|').filter(Boolean).map(h => h.trim());
            const thCells = headers.map(h => `<th>${h}</th>`).join('');
            const rows = bodyRows.trim().split('\n').map(row => {
                const cells = row.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
            return `<table><thead><tr>${thCells}</tr></thead><tbody>${rows}</tbody></table>`;
        }
    );

    // Headers
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold & italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');

    // Lists
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.+<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Paragraphs
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p>\s*<(h[1-4]|table|ul|ol|blockquote|hr)/g, '<$1');
    html = html.replace(/<\/(h[1-4]|table|ul|ol|blockquote)>\s*<\/p>/g, '</$1>');
    html = html.replace(/<hr>\s*<\/p>/g, '<hr>');
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
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
    pitchDeckEl.scrollIntoView({ behavior: 'smooth' });

    // Initialize Q&A chat for the saved run
    initChatSession(run.finalPitchDeck);
}

// ─── Mode Toggle ──────────────────────────────────────
let currentMode = 'seed'; // 'seed' or 'script'
const phaseIndicator = document.getElementById('phase-indicator');
const yearField = document.getElementById('year-field');
const productionYearInput = document.getElementById('production-year');

document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentMode = tab.dataset.mode;

        if (currentMode === 'script') {
            seedInput.placeholder = 'Paste your existing wildlife script or draft here…';
            seedInput.rows = 10;
            launchBtn.querySelector('.btn-text').textContent = 'Assess & Optimize →';
            yearField.classList.remove('hidden');
        } else {
            seedInput.placeholder = 'e.g., A sequence about survival in the deep ocean abyss…';
            seedInput.rows = 3;
            launchBtn.querySelector('.btn-text').textContent = 'Launch Simulation';
            yearField.classList.add('hidden');
            productionYearInput.value = '';
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
    const totalPhases = isAssessment ? 4 : 5;

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
        const finalPitchDeck = isAssessment
            ? await runAssessment(inputText, pipelineCallbacks, prodYear)
            : await runPipeline(inputText, pipelineCallbacks);

        // Save to history
        saveRun({ seedIdea: inputText, finalPitchDeck });

        // Show pitch deck
        pitchDeckContent.innerHTML = md(finalPitchDeck);
        pitchDeckEl.classList.remove('hidden');
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

// ─── Results Q&A Chat ─────────────────────────────────
function initChatSession(pitchDeck) {
    lastPitchDeck = pitchDeck;
    qaMessages.innerHTML = '';

    chatSession = createChat(
        `You are a helpful assistant discussing the results of a wildlife film scriptment process.
You have access to the complete Master Pitch Deck that was generated. Answer questions about the content,
explain creative decisions, suggest improvements, compare alternatives, or help refine specific sections.
Be concise but thorough. Use markdown formatting for clarity.

Here is the full Master Pitch Deck:\n\n${pitchDeck}`
    );

    // Send an initial context-setting message silently
    chatSession.send('I have received the Master Pitch Deck. I\'m ready to answer questions about it.').catch(() => { });
}

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
        const response = await chatSession.send(question);

        // Replace typing with response
        typingMsg.className = 'qa-msg assistant';
        typingMsg.innerHTML = md(response);
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
        dryrunResults.innerHTML = `
            <div class="dryrun-aggregate">
                <div class="dryrun-aggregate-score ${scoreClass(aggregate.overall)}">${aggregate.overall}</div>
                <div class="dryrun-aggregate-label">Aggregate Quality Score</div>
            </div>

            <div class="dryrun-dim-grid">
                ${aggregate.dimensions.map(d => `
                    <div class="dryrun-dim-card">
                        <div class="dryrun-dim-name">${d.name}</div>
                        <div class="dryrun-dim-avg ${scoreClass(d.avg)}">${d.avg}</div>
                        <div class="dryrun-dim-range">${d.min}–${d.max}</div>
                    </div>
                `).join('')}
            </div>

            <div class="dryrun-seed-results">
                <h4>Individual Results</h4>
                ${results.map(r => `
                    <div class="dryrun-seed-card">
                        <div class="dryrun-seed-card-header">
                            <span class="dryrun-seed-name">${r.seed.name}</span>
                            <span class="dryrun-seed-score ${scoreClass(r.scorecard.overall)}">${r.scorecard.overall}</span>
                        </div>
                        <div class="dryrun-seed-summary">${r.scorecard.summary}</div>
                    </div>
                `).join('')}
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

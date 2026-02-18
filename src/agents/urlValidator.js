// ─── URL Validator ────────────────────────────────────────────────────────────
// Post-processing step: validates every source URL in the Showrunner's output
// BEFORE delivering to the user. Deterministic — no LLM involved.
// Run after Showrunner output, before user delivery.

const URL_PATTERN = /https?:\/\/[^\s\])"'<>]+/g;

// Google Grounding API redirect prefix — these are internal redirect URLs,
// not the actual source. We strip them entirely (the publisher name in parens is kept).
const GROUNDING_REDIRECT_PREFIX = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/';

// HTTP status codes that mean "real page exists but we can't read it" (paywall, bot block)
// These are NOT broken links — treat as unverifiable, not removed.
const UNVERIFIABLE_STATUSES = new Set([401, 403, 406, 429]);

// HTTP status codes that definitively mean the page is gone
const BROKEN_STATUSES = new Set([404, 410, 451]);

// Soft 404 signals — page resolves but content is gone
const SOFT_404_SIGNALS = [
    'page not found',
    'article not found',
    "this page doesn't exist",
    'content has been removed',
    'error 404',
    'no longer available',
    '404 not found',
    'page has moved',
];

/**
 * Validates a single URL.
 * Returns: { url, status: 'valid' | 'broken' | 'unverifiable', reason? }
 *
 * Key design principle: we run in the browser, so CORS blocks and network
 * errors are EXPECTED for most external URLs. These are NOT broken links —
 * they are simply unverifiable from the browser. Only definitively broken
 * HTTP responses (404, 410) justify removing a source.
 */
async function validateUrl(url) {
    // Google Grounding redirect URLs are internal artifacts — always strip them
    if (url.startsWith(GROUNDING_REDIRECT_PREFIX)) {
        return { url, status: 'grounding_redirect', reason: 'Google Grounding API internal redirect URL' };
    }

    try {
        // HEAD request to check if URL resolves
        const headResponse = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SourceValidator/1.0)' },
        });

        // Definitively broken — page is gone
        if (BROKEN_STATUSES.has(headResponse.status)) {
            return { url, status: 'broken', reason: `HTTP ${headResponse.status}` };
        }

        // Paywall / bot protection / rate limit — real page, just can't read it
        if (UNVERIFIABLE_STATUSES.has(headResponse.status)) {
            return { url, status: 'unverifiable', reason: `HTTP ${headResponse.status} — likely paywall or bot protection` };
        }

        if (!headResponse.ok) {
            // Any other non-OK status (5xx server errors, etc.) — treat as unverifiable,
            // not broken. Server errors are transient; we shouldn't strip the source.
            return { url, status: 'unverifiable', reason: `HTTP ${headResponse.status} — server error or temporary issue` };
        }

        // GET the page body to check for soft 404s (only if HEAD succeeded)
        try {
            const fullResponse = await fetch(url, {
                signal: AbortSignal.timeout(10000),
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SourceValidator/1.0)' },
            });

            if (UNVERIFIABLE_STATUSES.has(fullResponse.status)) {
                return { url, status: 'unverifiable', reason: `HTTP ${fullResponse.status} on content fetch — likely paywall` };
            }

            if (BROKEN_STATUSES.has(fullResponse.status)) {
                return { url, status: 'broken', reason: `HTTP ${fullResponse.status}` };
            }

            const body = await fullResponse.text();

            // Check for soft 404 indicators
            const bodyLower = body.toLowerCase();
            const isSoft404 = SOFT_404_SIGNALS.some(signal => bodyLower.includes(signal));
            if (isSoft404) {
                return { url, status: 'broken', reason: 'Page resolves but appears to be a soft 404' };
            }

            return { url, status: 'valid' };

        } catch {
            // GET failed after HEAD succeeded — treat as unverifiable (CORS on body read)
            return { url, status: 'unverifiable', reason: 'Content fetch blocked — likely CORS restriction' };
        }

    } catch (error) {
        // Network-level failure: CORS block, DNS failure, timeout, etc.
        // In a browser context, CORS blocks are the norm for external URLs.
        // These are NOT broken links — they are simply unverifiable from the browser.
        const reason = error.name === 'TimeoutError'
            ? 'Request timed out — unverifiable from browser'
            : error.name === 'AbortError'
                ? 'Request aborted — unverifiable from browser'
                : `Network error — ${error.message} (likely CORS or DNS)`;
        return { url, status: 'unverifiable', reason };
    }
}

/**
 * Validates all URLs found in the Showrunner's output text.
 * Returns cleaned output with broken URLs replaced by warning markers,
 * plus a validation summary.
 *
 * Behavior:
 * - 'valid': URL confirmed live — keep as-is
 * - 'unverifiable': URL could not be checked (CORS, paywall, timeout) — keep as-is, no flag
 * - 'broken': URL definitively returns 404/410 — remove and flag
 * - 'grounding_redirect': Google internal redirect URL — strip entirely (keep publisher name)
 */
export async function validateSources(showrunnerOutput) {
    const urls = [...new Set(showrunnerOutput.match(URL_PATTERN) || [])];

    if (urls.length === 0) {
        return {
            output: showrunnerOutput,
            summary: { urls_checked: 0, valid: 0, broken: 0, unverifiable: 0, claims_affected: [] },
        };
    }

    // Validate all URLs in parallel
    const results = await Promise.all(urls.map(validateUrl));

    const summary = {
        urls_checked: results.length,
        valid: 0,
        broken: 0,
        unverifiable: 0,
        claims_affected: [],
    };

    let cleanedOutput = showrunnerOutput;

    for (const result of results) {
        if (result.status === 'valid') {
            summary.valid++;
        } else if (result.status === 'unverifiable') {
            summary.unverifiable++;
            // Keep the URL — it may be real but just blocked from the browser.
            // No visual flag — don't alarm the user about CORS restrictions.
        } else if (result.status === 'grounding_redirect') {
            // Strip the raw Google redirect URL entirely — it's an internal artifact.
            // The publisher name in parentheses after the URL is preserved.
            cleanedOutput = cleanedOutput.replace(result.url, '');
        } else {
            // broken — definitively 404/410 — remove and flag
            summary.broken++;
            summary.claims_affected.push(result.url);
            cleanedOutput = cleanedOutput.replace(
                result.url,
                `[SOURCE REMOVED — link broken: ${result.reason}]`
            );
        }
    }

    // Clean up any double spaces or " — (Publisher)" artifacts left by grounding URL removal
    cleanedOutput = cleanedOutput.replace(/ {2,}/g, ' ');
    cleanedOutput = cleanedOutput.replace(/ — \(/g, ' (');

    return {
        output: cleanedOutput,
        summary,
        note: summary.broken > 0
            ? `${summary.broken} source URL(s) failed validation and were removed.`
            : `All ${summary.valid} source URLs validated successfully.${summary.unverifiable > 0 ? ` ${summary.unverifiable} could not be verified from the browser (CORS/paywall — sources kept).` : ''}`,
    };
}

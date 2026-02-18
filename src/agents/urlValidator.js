// ─── URL Validator ────────────────────────────────────────────────────────────
// Post-processing step: validates every source URL in the Showrunner's output
// BEFORE delivering to the user. Deterministic — no LLM involved.
// Run after Showrunner output, before user delivery.

const URL_PATTERN = /https?:\/\/[^\s\])"'>]+/g;

// HTTP status codes that mean "real page exists but we can't read it" (paywall, bot block)
// These are NOT broken links — treat as unverifiable, not removed.
const UNVERIFIABLE_STATUSES = new Set([401, 403, 406, 429]);

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
 */
async function validateUrl(url) {
    try {
        // Step 1: HEAD request to check if URL resolves
        const headResponse = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SourceValidator/1.0)' },
        });

        // Paywall / bot protection — real page, just can't read it
        if (UNVERIFIABLE_STATUSES.has(headResponse.status)) {
            return { url, status: 'unverifiable', reason: `HTTP ${headResponse.status} — likely paywall or bot protection` };
        }

        if (!headResponse.ok) {
            return { url, status: 'broken', reason: `HTTP ${headResponse.status}` };
        }

        // Step 2: GET the page body to check for soft 404s
        const fullResponse = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SourceValidator/1.0)' },
        });

        // Paywall on GET (sometimes differs from HEAD)
        if (UNVERIFIABLE_STATUSES.has(fullResponse.status)) {
            return { url, status: 'unverifiable', reason: `HTTP ${fullResponse.status} on content fetch — likely paywall` };
        }

        const body = await fullResponse.text();

        // Check for soft 404 indicators
        const bodyLower = body.toLowerCase();
        const isSoft404 = SOFT_404_SIGNALS.some(signal => bodyLower.includes(signal));
        if (isSoft404) {
            return { url, status: 'broken', reason: 'Page resolves but appears to be a soft 404' };
        }

        // Suspiciously short — likely a redirect or empty paywall page
        if (body.length < 500) {
            return { url, status: 'unverifiable', reason: 'Page content unusually short — may be a redirect or paywall' };
        }

        return { url, status: 'valid' };

    } catch (error) {
        const reason = error.name === 'TimeoutError'
            ? 'Request timed out'
            : error.name === 'AbortError'
                ? 'Request aborted'
                : error.message;
        return { url, status: 'broken', reason };
    }
}

/**
 * Validates all URLs found in the Showrunner's output text.
 * Returns cleaned output with broken URLs replaced by warning markers,
 * plus a validation summary.
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
            // Flag but don't remove — paywall sources may still be real
            cleanedOutput = cleanedOutput.replace(
                result.url,
                `${result.url} ⚠️ [unverifiable — ${result.reason}]`
            );
        } else {
            // broken — remove and flag the claim
            summary.broken++;
            summary.claims_affected.push(result.url);
            cleanedOutput = cleanedOutput.replace(
                result.url,
                `[SOURCE REMOVED — link broken: ${result.reason}]`
            );
        }
    }

    return {
        output: cleanedOutput,
        summary,
        note: summary.broken > 0
            ? `${summary.broken} source URL(s) failed validation and were removed.`
            : `All ${summary.valid} source URLs validated successfully.${summary.unverifiable > 0 ? ` ${summary.unverifiable} could not be verified (likely paywalled).` : ''}`,
    };
}

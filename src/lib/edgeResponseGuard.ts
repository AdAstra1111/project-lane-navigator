/**
 * Canonical edge-function response guard.
 * Ensures no HTML/non-JSON response leaks into caller code.
 * IEL: logs violations, never mutates DB.
 */

export interface EdgeNonJsonError {
  ok: false;
  error: {
    code: 'EDGE_NON_JSON_RESPONSE' | 'EDGE_HTML_ERROR' | 'EDGE_JSON_PARSE_FAILED';
    functionName: string;
    httpStatus: number;
    contentType: string;
    requestId: string | null;
    snippet: string;
    occurredAt: string;
  };
}

/** Strip HTML tags, collapse whitespace, cap at maxLen */
function sanitizeSnippet(raw: string, maxLen = 200): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function extractRequestId(headers: Headers): string | null {
  return (
    headers.get('x-request-id') ||
    headers.get('cf-ray') ||
    headers.get('x-served-by') ||
    null
  );
}

/**
 * Parse a fetch Response into JSON safely.
 * If the response is non-JSON (HTML error page, gateway timeout, etc.),
 * throws a structured Error with IEL logging — never raw HTML.
 */
export async function parseEdgeResponse(
  resp: Response,
  functionName: string,
  action?: string,
): Promise<any> {
  const contentType = resp.headers.get('content-type') || '';
  const raw = await resp.text();
  const requestId = extractRequestId(resp.headers);

  // ── Non-JSON detection ──
  if (!contentType.includes('application/json')) {
    const isHtml = raw.trimStart().startsWith('<!') || raw.includes('<html');
    const code = isHtml ? 'EDGE_HTML_ERROR' : 'EDGE_NON_JSON_RESPONSE';

    console.warn(`[${functionName}][IEL] response_content_type_mismatch`, {
      status: resp.status,
      contentType,
      code,
      action,
      requestId,
      snippet: sanitizeSnippet(raw),
    });

    const userMsg =
      resp.status === 502 || resp.status === 504
        ? `Backend service timed out (${resp.status}). Please try again.`
        : `Unexpected response from ${functionName} (${resp.status}). Please retry.`;

    throw Object.assign(new Error(userMsg), {
      structured: true,
      code,
      httpStatus: resp.status,
      requestId,
      snippet: sanitizeSnippet(raw),
    });
  }

  // ── JSON parse guard ──
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`[${functionName}][IEL] json_parse_failed`, {
      status: resp.status,
      action,
      bodyPrefix: raw.slice(0, 200),
    });
    throw Object.assign(new Error(`${functionName} returned malformed data. Please retry.`), {
      structured: true,
      code: 'EDGE_JSON_PARSE_FAILED' as const,
      httpStatus: resp.status,
      requestId,
      snippet: sanitizeSnippet(raw),
    });
  }
}

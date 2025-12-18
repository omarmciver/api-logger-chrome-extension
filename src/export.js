/**
 * Export module for generating API trace files
 * Format: NDJSON (newline-delimited JSON) - one object per line
 */

import { getSession, getCallsBySession } from './db.js';

/**
 * Export a session to JSONL format optimized for consumption
 * @param {string} sessionId
 * @returns {Promise<string>} - JSONL content
 */
export async function exportSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  
  const calls = await getCallsBySession(sessionId);
  
  const lines = [];
  
  // Meta line (first line)
  const meta = {
    type: 'meta',
    format: 'api-trace-jsonl',
    version: 1,
    session: {
      id: session.id,
      name: session.name,
      startedAt: new Date(session.createdAt).toISOString(),
      endedAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : null,
      source: {
        extension: 'API Logger',
        extVersion: '1.0.0',
        tabUrl: session.tabUrl
      }
    },
    summary: generateSummary(calls)
  };
  lines.push(JSON.stringify(meta));
  
  // Call lines
  for (const call of calls) {
    const callLine = {
      type: 'call',
      seq: call.seq,
      id: `call_${call.id}`,
      timestamp: new Date(call.timestamp).toISOString(),
      duration: call.duration,
      
      request: {
        method: call.method,
        url: call.url,
        headers: call.requestHeaders,
        body: formatBody(call.requestBody, call.requestContentType)
      },
      
      response: {
        status: call.status,
        statusText: call.statusText,
        headers: call.responseHeaders,
        body: formatBody(call.responseBody, call.responseContentType, call.responseBodyTruncated)
      }
    };
    
    lines.push(JSON.stringify(callLine));
  }
  
  return lines.join('\n');
}

/**
 * Export session to a more compact format (just the essentials)
 * @param {string} sessionId
 * @returns {Promise<string>}
 */
export async function exportSessionCompact(sessionId) {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  
  const calls = await getCallsBySession(sessionId);
  
  const output = {
    meta: {
      name: session.name,
      url: session.tabUrl,
      recorded: new Date(session.createdAt).toISOString(),
      callCount: calls.length
    },
    calls: calls.map(call => ({
      seq: call.seq,
      method: call.method,
      url: simplifyUrl(call.url),
      status: call.status,
      duration: call.duration,
      request: call.requestBody ? tryParseJson(call.requestBody) : null,
      response: call.responseBody ? tryParseJson(call.responseBody) : null
    }))
  };
  
  return JSON.stringify(output, null, 2);
}

/**
 * Generate summary statistics for context
 */
function generateSummary(calls) {
  const endpoints = {};
  const domains = new Set();
  let errorCount = 0;
  
  for (const call of calls) {
    // Track endpoints
    const key = `${call.method} ${simplifyUrl(call.url)}`;
    endpoints[key] = (endpoints[key] || 0) + 1;
    
    // Track domains
    try {
      const url = new URL(call.url);
      domains.add(url.hostname);
    } catch (e) {}
    
    // Track errors
    if (call.status >= 400) {
      errorCount++;
    }
  }
  
  return {
    calls: calls.length,
    errors: errorCount,
    domains: Array.from(domains),
    endpoints: Object.entries(endpoints)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20) // Top 20 endpoints
  };
}

/**
 * Format body for export
 */
function formatBody(body, contentType, truncated = false) {
  if (!body) return null;
  
  const result = {
    contentType: contentType,
    size: body.length
  };
  
  // Try to parse JSON for cleaner output
  if (contentType?.includes('json')) {
    try {
      result.data = JSON.parse(body);
      return result;
    } catch (e) {}
  }
  
  // Return as text
  result.text = body;
  
  if (truncated) {
    result.truncated = true;
  }
  
  return result;
}

/**
 * Simplify URL by removing query params (keep just the path)
 */
function simplifyUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (e) {
    return url;
  }
}

/**
 * Try to parse JSON, return original if fails
 */
function tryParseJson(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
}

/**
 * Download content as a file
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadFile(content, filename, mimeType = 'application/json') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

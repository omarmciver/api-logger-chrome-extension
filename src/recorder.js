/**
 * Network recorder module using chrome.devtools.network API
 */

import { addCall, updateSession } from './db.js';

let isRecording = false;
let activeSessionId = null;
let requestListener = null;

/**
 * Start recording network requests
 * @param {string} sessionId - The session to record to
 * @param {Function} onCall - Callback when a call is captured
 */
export function startRecording(sessionId, onCall) {
  if (isRecording) {
    console.warn('Already recording');
    return;
  }
  
  activeSessionId = sessionId;
  isRecording = true;
  
  // Update session with current tab URL
  if (chrome.devtools?.inspectedWindow?.tabId) {
    chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, (tab) => {
      if (tab?.url) {
        updateSession(sessionId, { tabUrl: tab.url });
      }
    });
  }
  
  // Create the listener
  requestListener = async (request) => {
    if (!isRecording || !activeSessionId) return;
    
    try {
      const callData = await processRequest(request);
      if (callData) {
        const savedCall = await addCall(activeSessionId, callData);
        if (onCall) {
          onCall(savedCall);
        }
      }
    } catch (error) {
      console.error('Error processing request:', error);
    }
  };
  
  // Attach listener
  chrome.devtools.network.onRequestFinished.addListener(requestListener);
  
  console.log(`Recording started for session: ${sessionId}`);
}

/**
 * Stop recording
 */
export function stopRecording() {
  if (!isRecording) return;
  
  isRecording = false;
  
  if (requestListener) {
    chrome.devtools.network.onRequestFinished.removeListener(requestListener);
    requestListener = null;
  }
  
  // Update session status
  if (activeSessionId) {
    updateSession(activeSessionId, { status: 'stopped' });
  }
  
  activeSessionId = null;
  console.log('Recording stopped');
}

/**
 * Pause recording (keep session active but stop capturing)
 */
export function pauseRecording() {
  if (!isRecording) return;
  
  isRecording = false;
  
  if (requestListener) {
    chrome.devtools.network.onRequestFinished.removeListener(requestListener);
    requestListener = null;
  }
  
  if (activeSessionId) {
    updateSession(activeSessionId, { status: 'paused' });
  }
  
  console.log('Recording paused');
}

/**
 * Resume recording to an existing session
 * @param {string} sessionId
 * @param {Function} onCall
 */
export function resumeRecording(sessionId, onCall) {
  activeSessionId = sessionId;
  startRecording(sessionId, onCall);
  updateSession(sessionId, { status: 'active' });
}

/**
 * Check if currently recording
 * @returns {boolean}
 */
export function getRecordingState() {
  return {
    isRecording,
    activeSessionId
  };
}

/**
 * Process a HAR request entry and extract relevant data
 * @param {Object} request - HAR request entry
 * @returns {Promise<Object>} - Processed call data
 */
async function processRequest(request) {
  const { request: req, response: res, startedDateTime, time } = request;
  
  // Filter: Only capture XHR and Fetch requests (skip images, scripts, etc.)
  // Check by looking at the initiator type or resource type
  const resourceType = request._resourceType || '';
  const isApiCall = isLikelyApiCall(req.url, resourceType, res.content?.mimeType);
  
  if (!isApiCall) {
    return null;
  }
  
  // Get response body
  let responseBody = null;
  let responseBodyTruncated = false;
  
  try {
    responseBody = await getResponseBody(request);
    
    // Truncate large bodies (> 100KB)
    const MAX_BODY_SIZE = 100 * 1024;
    if (responseBody && responseBody.length > MAX_BODY_SIZE) {
      responseBody = responseBody.substring(0, MAX_BODY_SIZE);
      responseBodyTruncated = true;
    }
  } catch (error) {
    console.warn('Could not get response body:', error);
  }
  
  // Extract request body from POST data
  let requestBody = null;
  if (req.postData?.text) {
    requestBody = req.postData.text;
    // Truncate large request bodies
    const MAX_BODY_SIZE = 100 * 1024;
    if (requestBody.length > MAX_BODY_SIZE) {
      requestBody = requestBody.substring(0, MAX_BODY_SIZE) + '\n[TRUNCATED]';
    }
  }
  
  // Build call data
  return {
    method: req.method,
    url: req.url,
    
    // Request
    requestHeaders: filterHeaders(req.headers),
    requestBody: requestBody,
    requestContentType: req.postData?.mimeType || getHeader(req.headers, 'content-type'),
    
    // Response
    status: res.status,
    statusText: res.statusText,
    responseHeaders: filterHeaders(res.headers),
    responseBody: responseBody,
    responseBodyTruncated: responseBodyTruncated,
    responseContentType: res.content?.mimeType || getHeader(res.headers, 'content-type'),
    responseSize: res.content?.size || 0,
    
    // Timing
    startTime: new Date(startedDateTime).getTime(),
    duration: Math.round(time || 0)
  };
}

/**
 * Get response body using getContent()
 * @param {Object} request - HAR request entry
 * @returns {Promise<string>}
 */
function getResponseBody(request) {
  return new Promise((resolve, reject) => {
    request.getContent((content, encoding) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      
      if (encoding === 'base64' && content) {
        try {
          // Decode base64 content
          resolve(atob(content));
        } catch (e) {
          // If decoding fails, return as-is (might be binary)
          resolve(content);
        }
      } else {
        resolve(content);
      }
    });
  });
}

/**
 * Determine if a request is likely an API call (vs static resource)
 */
function isLikelyApiCall(url, resourceType, mimeType) {
  // Include XHR and Fetch
  if (resourceType === 'xhr' || resourceType === 'fetch') {
    return true;
  }
  
  // Check mime type for JSON/XML APIs
  if (mimeType) {
    const apiMimeTypes = [
      'application/json',
      'application/xml',
      'text/xml',
      'application/x-www-form-urlencoded',
      'text/plain'
    ];
    if (apiMimeTypes.some(type => mimeType.includes(type))) {
      return true;
    }
  }
  
  // Check URL patterns that suggest API
  const urlLower = url.toLowerCase();
  const apiPatterns = ['/api/', '/v1/', '/v2/', '/v3/', '/graphql', '/rest/', '.json'];
  if (apiPatterns.some(pattern => urlLower.includes(pattern))) {
    return true;
  }
  
  // Exclude common static resources
  const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.ico', '.map'];
  if (staticExtensions.some(ext => urlLower.endsWith(ext))) {
    return false;
  }
  
  // Default: include if resourceType is document or unknown
  return resourceType === 'document' || !resourceType;
}

/**
 * Filter headers to remove sensitive data and reduce noise
 */
function filterHeaders(headers) {
  if (!headers) return null;
  
  const filtered = {};
  const sensitiveHeaders = ['cookie', 'set-cookie', 'authorization', 'x-api-key', 'api-key'];
  
  for (const header of headers) {
    const name = header.name.toLowerCase();
    
    // Redact sensitive headers
    if (sensitiveHeaders.includes(name)) {
      filtered[name] = '[REDACTED]';
    } else {
      filtered[name] = header.value;
    }
  }
  
  return filtered;
}

/**
 * Get a header value by name
 */
function getHeader(headers, name) {
  if (!headers) return null;
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || null;
}

/**
 * Content Script for MV3 Extension
 * Intercepts network requests and forwards to state machine
 */

let isIntercepting = false;
let originalFetch = null;
let originalXHR = null;

// Listen for state updates from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'stateUpdate') {
    handleStateUpdate(message);
  }
});

function handleStateUpdate(message) {
  if (message.event === 'recordingStarted') {
    startIntercepting();
  } else if (message.event === 'recordingStopped' || message.event === 'recordingPaused') {
    stopIntercepting();
  } else if (message.event === 'recordingResumed') {
    startIntercepting();
  }
}

// Start intercepting network requests
function startIntercepting() {
  if (isIntercepting) return;
  
  isIntercepting = true;
  console.log('Starting network interception');
  
  // Intercept Fetch API
  if (window.fetch && !originalFetch) {
    originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const requestData = extractRequestData('fetch', args);
      
      try {
        const response = await originalFetch.apply(this, args);
        const responseData = await extractResponseData(response.clone());
        
        reportRequest({
          ...requestData,
          response: responseData,
          duration: Date.now() - requestData.timestamp
        });
        
        return response;
      } catch (error) {
        reportRequest({
          ...requestData,
          error: error.message,
          duration: Date.now() - requestData.timestamp
        });
        throw error;
      }
    };
  }
  
  // Intercept XMLHttpRequest
  if (window.XMLHttpRequest && !originalXHR) {
    originalXHR = window.XMLHttpRequest;
    
    const ProxyXHR = function() {
      const xhr = new originalXHR();
      const originalOpen = xhr.open;
      const originalSend = xhr.send;
      
      let requestData = null;
      
      xhr.open = function(method, url, ...args) {
        requestData = {
          type: 'xhr',
          method: method.toUpperCase(),
          url: url,
          headers: {},
          timestamp: Date.now()
        };
        return originalOpen.apply(this, [method, url, ...args]);
      };
      
      xhr.send = function(body) {
        if (requestData) {
          requestData.body = body;
          
          // Capture request headers
          const headers = {};
          this.setRequestHeader = new Proxy(this.setRequestHeader, {
            apply: function(target, thisArg, args) {
              headers[args[0]] = args[1];
              return target.apply(thisArg, args);
            }
          });
          requestData.headers = headers;
        }
        
        // Set up response handling
        this.addEventListener('load', function() {
          if (requestData) {
            reportRequest({
              ...requestData,
              response: {
                status: this.status,
                statusText: this.statusText,
                headers: parseResponseHeaders(this.getAllResponseHeaders()),
                body: this.responseText,
                responseType: this.responseType
              },
              duration: Date.now() - requestData.timestamp
            });
          }
        });
        
        this.addEventListener('error', function() {
          if (requestData) {
            reportRequest({
              ...requestData,
              error: 'Network error',
              duration: Date.now() - requestData.timestamp
            });
          }
        });
        
        return originalSend.apply(this, [body]);
      };
      
      return xhr;
    };
    
    window.XMLHttpRequest = ProxyXHR;
  }
}

// Stop intercepting network requests
function stopIntercepting() {
  if (!isIntercepting) return;
  
  isIntercepting = false;
  console.log('Stopping network interception');
  
  // Restore original methods
  if (originalFetch) {
    window.fetch = originalFetch;
    originalFetch = null;
  }
  
  if (originalXHR) {
    window.XMLHttpRequest = originalXHR;
    originalXHR = null;
  }
}

// Extract request data from various sources
function extractRequestData(type, args) {
  const baseData = {
    type,
    timestamp: Date.now(),
    url: window.location.href,
    initiator: getStackTrace()
  };
  
  if (type === 'fetch') {
    const [resource, options = {}] = args;
    return {
      ...baseData,
      method: (options.method || 'GET').toUpperCase(),
      url: typeof resource === 'string' ? resource : resource.url,
      headers: options.headers || {},
      body: options.body
    };
  }
  
  return baseData;
}

// Extract response data
async function extractResponseData(response) {
  let body = null;
  
  try {
    // Only capture text-based responses to avoid memory issues
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json') || contentType.includes('text/')) {
      body = await response.text();
    }
  } catch (error) {
    // Ignore body extraction errors
  }
  
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    ok: response.ok,
    redirected: response.redirected,
    url: response.url
  };
}

// Parse XHR response headers
function parseResponseHeaders(headerString) {
  const headers = {};
  const lines = headerString.trim().split('\n');
  
  lines.forEach(line => {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length) {
      headers[key.trim()] = valueParts.join(':').trim();
    }
  });
  
  return headers;
}

// Report request to background script
async function reportRequest(requestData) {
  try {
    // Filter out non-API requests (optional - adjust as needed)
    if (!isApiRequest(requestData)) {
      return;
    }
    
    await chrome.runtime.sendMessage({
      action: 'addRequest',
      requestData: {
        ...requestData,
        tabId: await getCurrentTabId(),
        frameId: 0 // Top-level frame
      }
    });
  } catch (error) {
    console.error('Failed to report request:', error);
  }
}

// Determine if request is an API call
function isApiRequest(requestData) {
  const url = requestData.url || '';
  
  // Skip common non-API resources
  if (/\.(png|jpg|jpeg|gif|svg|ico|css|js|woff|woff2|ttf|eot)$/i.test(url)) {
    return false;
  }
  
  // Skip chrome-extension URLs
  if (url.startsWith('chrome-extension://')) {
    return false;
  }
  
  // Include requests to common API patterns
  return /\/api\/|graphql|\.json|ajax|rest/i.test(url) || 
         requestData.headers?.['accept']?.includes('application/json') ||
         requestData.method !== 'GET';
}

// Get current tab ID
async function getCurrentTabId() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getCurrentTabId' }, (response) => {
      resolve(response?.tabId || 0);
    });
  });
}

// Get stack trace for debugging
function getStackTrace() {
  try {
    throw new Error();
  } catch (error) {
    return error.stack.split('\n').slice(3, 6).join('\n'); // Skip error creation frames
  }
}

// Initialize based on current state
chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
  if (response?.success && response.state?.currentState === 'recording') {
    startIntercepting();
  }
});

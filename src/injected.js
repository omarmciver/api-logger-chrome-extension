/**
 * Injected Script for Advanced Network Interception
 * This script is injected into web pages for deeper network monitoring
 */

(function() {
  'use strict';
  
  // Monitor for additional network APIs that content script can't access
  const originalWebSocket = window.WebSocket;
  const originalEventSource = window.EventSource;
  
  // Intercept WebSocket connections
  if (originalWebSocket) {
    window.WebSocket = function(url, protocols) {
      const ws = new originalWebSocket(url, protocols);
      
      // Report WebSocket connection
      window.postMessage({
        type: 'apiLogger',
        event: 'websocket',
        data: {
          url,
          protocols,
          timestamp: Date.now(),
          type: 'connect'
        }
      }, '*');
      
      // Monitor messages
      const originalSend = ws.send;
      ws.send = function(data) {
        window.postMessage({
          type: 'apiLogger',
          event: 'websocket',
          data: {
            url,
            data: typeof data === 'string' ? data : '<binary data>',
            timestamp: Date.now(),
            type: 'send'
          }
        }, '*');
        return originalSend.call(this, data);
      };
      
      // Monitor incoming messages
      ws.addEventListener('message', function(event) {
        window.postMessage({
          type: 'apiLogger',
          event: 'websocket',
          data: {
            url,
            data: typeof event.data === 'string' ? event.data : '<binary data>',
            timestamp: Date.now(),
            type: 'receive'
          }
        }, '*');
      });
      
      // Monitor connection close
      ws.addEventListener('close', function(event) {
        window.postMessage({
          type: 'apiLogger',
          event: 'websocket',
          data: {
            url,
            code: event.code,
            reason: event.reason,
            timestamp: Date.now(),
            type: 'close'
          }
        }, '*');
      });
      
      return ws;
    };
  }
  
  // Intercept Server-Sent Events
  if (originalEventSource) {
    window.EventSource = function(url, eventSourceInitDict) {
      const es = new originalEventSource(url, eventSourceInitDict);
      
      // Report SSE connection
      window.postMessage({
        type: 'apiLogger',
        event: 'sse',
        data: {
          url,
          timestamp: Date.now(),
          type: 'connect'
        }
      }, '*');
      
      // Monitor messages
      es.addEventListener('message', function(event) {
        window.postMessage({
          type: 'apiLogger',
          event: 'sse',
          data: {
            url,
            data: event.data,
            lastEventId: event.lastEventId,
            timestamp: Date.now(),
            type: 'message'
          }
        }, '*');
      });
      
      // Monitor errors
      es.addEventListener('error', function(event) {
        window.postMessage({
          type: 'apiLogger',
          event: 'sse',
          data: {
            url,
            timestamp: Date.now(),
            type: 'error'
          }
        }, '*');
      });
      
      return es;
    };
  }
  
  // Listen for messages from content script
  window.addEventListener('message', function(event) {
    if (event.source !== window || !event.data || event.data.type !== 'apiLogger') {
      return;
    }
    
    // Forward to content script via chrome runtime
    chrome.runtime.sendMessage({
      action: 'addRequest',
      requestData: {
        type: event.data.event,
        ...event.data.data,
        initiator: 'injected'
      }
    }).catch(() => {
      // Ignore errors if content script isn't ready
    });
  });
  
})();

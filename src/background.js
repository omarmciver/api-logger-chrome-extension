/**
 * Background Service Worker for MV3 Extension
 * Manages the recording state machine and handles messages from UI components
 */

import { RecordingStateMachine } from './recording-state-machine.js';

let stateMachine = null;

// Initialize state machine when service worker starts
chrome.runtime.onStartup.addListener(initializeStateMachine);
chrome.runtime.onInstalled.addListener(initializeStateMachine);

async function initializeStateMachine() {
  try {
    stateMachine = new RecordingStateMachine();
    
    // Set up event listeners for state changes
    stateMachine.addEventListener('stateChanged', handleStateChange);
    stateMachine.addEventListener('recordingStarted', handleRecordingStarted);
    stateMachine.addEventListener('recordingPaused', handleRecordingPaused);
    stateMachine.addEventListener('recordingResumed', handleRecordingResumed);
    stateMachine.addEventListener('recordingStopped', handleRecordingStopped);
    stateMachine.addEventListener('exportStarted', handleExportStarted);
    stateMachine.addEventListener('error', handleError);
    stateMachine.addEventListener('stateRecovered', handleStateRecovered);
    
    console.log('Recording state machine initialized');
  } catch (error) {
    console.error('Failed to initialize state machine:', error);
  }
}

// Message handling with race condition protection
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender, sendResponse) {
  if (!stateMachine) {
    sendResponse({ success: false, error: 'State machine not initialized' });
    return;
  }

  const operationId = `${message.action}_${Date.now()}_${Math.random()}`;
  
  try {
    switch (message.action) {
      case 'getState':
        sendResponse({ success: true, state: stateMachine.getState() });
        break;
        
      case 'startRecording':
        await stateMachine.transition('recording', operationId);
        sendResponse({ success: true, state: stateMachine.getState() });
        break;
        
      case 'pauseRecording':
        await stateMachine.transition('paused', operationId);
        sendResponse({ success: true, state: stateMachine.getState() });
        break;
        
      case 'resumeRecording':
        await stateMachine.transition('recording', operationId);
        sendResponse({ success: true, state: stateMachine.getState() });
        break;
        
      case 'stopRecording':
        await stateMachine.transition('stopping', operationId);
        // Wait for stop to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        await stateMachine.transition('idle', `${operationId}_finalize`);
        sendResponse({ success: true, state: stateMachine.getState() });
        break;
        
      case 'exportData':
        if (stateMachine.getState().recordedRequests.length === 0) {
          sendResponse({ success: false, error: 'No data to export' });
          return;
        }
        await stateMachine.transition('exporting', operationId);
        await new Promise(resolve => setTimeout(resolve, 100)); // Allow export to start
        await stateMachine.transition('idle', `${operationId}_finalize`);
        sendResponse({ success: true, state: stateMachine.getState() });
        break;
        
      case 'addRequest':
        const added = stateMachine.addRequest(message.requestData);
        sendResponse({ success: added });
        
        // Notify DevTools panels about new request
        if (added) {
          broadcastToDevTools({ type: 'requestAdded', request: message.requestData });
        }
        break;
        
      case 'clearError':
        if (stateMachine.getState().currentState === 'error') {
          await stateMachine.transition('idle', operationId);
        }
        sendResponse({ success: true, state: stateMachine.getState() });
        break;
        
      case 'getCurrentTabId':
        // This action is deprecated - DevTools panels should use chrome.devtools.inspectedWindow.tabId
        sendResponse({ tabId: 0 });
        break;
        
      default:
        sendResponse({ success: false, error: `Unknown action: ${message.action}` });
    }
  } catch (error) {
    console.error(`Error handling message ${message.action}:`, error);
    sendResponse({ success: false, error: error.message });
  }
}

// Event handlers
function handleStateChange(data) {
  broadcastStateUpdate(data);
}

function handleRecordingStarted(data) {
  console.log('Recording started:', data.sessionId);
  broadcastStateUpdate({ event: 'recordingStarted', ...data });
}

function handleRecordingPaused(data) {
  console.log('Recording paused at:', new Date(data.pauseTime));
  broadcastStateUpdate({ event: 'recordingPaused', ...data });
}

function handleRecordingResumed(data) {
  console.log('Recording resumed after', data.pauseDuration, 'ms pause');
  broadcastStateUpdate({ event: 'recordingResumed', ...data });
}

function handleRecordingStopped(data) {
  console.log('Recording stopped:', data.sessionId, 'with', data.requestCount, 'requests');
  broadcastStateUpdate({ event: 'recordingStopped', ...data });
}

function handleExportStarted(data) {
  console.log('Export started for', data.requestCount, 'requests');
  broadcastStateUpdate({ event: 'exportStarted', ...data });
}

function handleError(data) {
  console.error('State machine error:', data);
  broadcastStateUpdate({ event: 'error', ...data });
}

function handleStateRecovered(data) {
  console.log('State recovered:', data.recoveredState);
  broadcastStateUpdate({ event: 'stateRecovered', ...data });
}

// Broadcast state updates to extension components
async function broadcastStateUpdate(data) {
  try {
    // Notify DevTools panels via runtime messaging
    broadcastToDevTools({ type: 'stateUpdate', ...data });
  } catch (error) {
    console.error('Failed to broadcast state update:', error);
  }
}

// Broadcast to DevTools panels
function broadcastToDevTools(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // DevTools panels may not be listening, ignore errors
  });
}

// Handle service worker termination
chrome.runtime.onSuspend.addListener(() => {
  console.log('Service worker suspending, persisting state...');
  if (stateMachine) {
    stateMachine.persistState();
  }
});

// Periodic state persistence (every 30 seconds)
setInterval(() => {
  if (stateMachine && stateMachine.getState().currentState !== 'idle') {
    stateMachine.persistState();
  }
}, 30000);

/**
 * Popup Script
 * Simple UI for controlling the API logger from the extension icon
 */

class APILoggerPopup {
  constructor() {
    this.currentState = 'idle';
    this.setupUI();
    this.setupMessaging();
    this.initializeState();
  }

  setupUI() {
    this.status = document.getElementById('status');
    this.startBtn = document.getElementById('startBtn');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.exportBtn = document.getElementById('exportBtn');

    // Button event listeners
    this.startBtn.addEventListener('click', () => this.sendMessage('startRecording'));
    this.pauseBtn.addEventListener('click', () => this.sendMessage('pauseRecording'));
    this.stopBtn.addEventListener('click', () => this.sendMessage('stopRecording'));
    this.exportBtn.addEventListener('click', () => this.sendMessage('exportData'));
  }

  setupMessaging() {
    // Listen for messages from background script
    window.addEventListener('message', (event) => {
      if (event.data.type === 'stateUpdate') {
        this.handleStateUpdate(event.data);
      }
    });
  }

  async initializeState() {
    try {
      const response = await this.sendMessage('getState');
      if (response.success) {
        this.updateState(response.state);
      }
    } catch (error) {
      console.error('Failed to initialize state:', error);
    }
  }

  async sendMessage(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  handleStateUpdate(message) {
    if (message.event) {
      // Handle specific events
      switch (message.event) {
        case 'recordingStarted':
          this.updateState({ currentState: 'recording' });
          break;
        case 'recordingPaused':
          this.updateState({ currentState: 'paused' });
          break;
        case 'recordingResumed':
          this.updateState({ currentState: 'recording' });
          break;
        case 'recordingStopped':
          this.updateState({ currentState: 'idle' });
          break;
        case 'error':
          this.updateState({ currentState: 'error' });
          break;
      }
    } else {
      // Direct state update
      this.updateState(message);
    }
  }

  updateState(state) {
    this.currentState = state.currentState;
    
    // Update status display
    this.status.textContent = this.currentState.charAt(0).toUpperCase() + this.currentState.slice(1);
    this.status.className = `status ${this.currentState}`;
    
    // Update button states
    this.startBtn.disabled = this.currentState === 'recording';
    this.pauseBtn.disabled = this.currentState !== 'recording';
    this.stopBtn.disabled = !['recording', 'paused'].includes(this.currentState);
    this.exportBtn.disabled = this.currentState !== 'idle' || (state.recordedRequests || []).length === 0;
  }
}

// Initialize the popup when the script loads
new APILoggerPopup();

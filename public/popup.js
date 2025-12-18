/**
 * Popup Script for MV3 Extension
 * Handles UI interactions and communicates with background state machine
 */

class PopupController {
  constructor() {
    this.elements = {
      status: document.getElementById('status'),
      errorMessage: document.getElementById('error-message'),
      startBtn: document.getElementById('start-btn'),
      pauseBtn: document.getElementById('pause-btn'),
      resumeBtn: document.getElementById('resume-btn'),
      stopBtn: document.getElementById('stop-btn'),
      exportBtn: document.getElementById('export-btn'),
      stats: document.getElementById('stats'),
      sessionId: document.getElementById('session-id'),
      requestCount: document.getElementById('request-count'),
      duration: document.getElementById('duration')
    };
    
    this.currentState = 'idle';
    this.stateData = {};
    this.durationInterval = null;
    
    this.init();
  }
  
  async init() {
    // Get initial state
    await this.updateState();
    
    // Set up event listeners
    this.elements.startBtn.addEventListener('click', () => this.handleAction('startRecording'));
    this.elements.pauseBtn.addEventListener('click', () => this.handleAction('pauseRecording'));
    this.elements.resumeBtn.addEventListener('click', () => this.handleAction('resumeRecording'));
    this.elements.stopBtn.addEventListener('click', () => this.handleAction('stopRecording'));
    this.elements.exportBtn.addEventListener('click', () => this.handleAction('exportData'));
    
    // Listen for state updates from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'stateUpdate') {
        this.handleStateUpdate(message);
      }
    });
    
    // Update duration display periodically
    this.startDurationUpdate();
  }
  
  async handleAction(action) {
    try {
      // Disable all buttons during operation
      this.setButtonsEnabled(false);
      
      const response = await chrome.runtime.sendMessage({ action });
      
      if (!response.success) {
        throw new Error(response.error || 'Unknown error');
      }
      
      this.updateUI(response.state);
    } catch (error) {
      this.showError(error.message);
      // Re-enable buttons on error
      this.setButtonsEnabled(true);
    }
  }
  
  async updateState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getState' });
      if (response.success) {
        this.updateUI(response.state);
      }
    } catch (error) {
      this.showError('Failed to get state: ' + error.message);
    }
  }
  
  handleStateUpdate(message) {
    // Update state data based on the event
    if (message.event === 'stateChanged') {
      this.currentState = message.toState;
      this.stateData = message.stateData;
    } else if (message.event === 'recordingStarted') {
      this.currentState = 'recording';
      this.stateData.sessionId = message.sessionId;
      this.stateData.startTime = Date.now();
    } else if (message.event === 'recordingPaused') {
      this.currentState = 'paused';
      this.stateData.pauseTime = message.pauseTime;
    } else if (message.event === 'recordingResumed') {
      this.currentState = 'recording';
      this.stateData.pauseTime = null;
    } else if (message.event === 'recordingStopped') {
      this.currentState = 'idle';
    } else if (message.event === 'exportStarted') {
      this.currentState = 'exporting';
    } else if (message.event === 'error') {
      this.currentState = 'error';
      this.stateData.error = message;
    }
    
    this.updateUI();
  }
  
  updateUI(state = null) {
    if (state) {
      this.currentState = state.currentState;
      this.stateData = state;
    }
    
    // Update status display
    this.elements.status.textContent = this.formatState(this.currentState);
    this.elements.status.className = `status ${this.currentState}`;
    
    // Update button states
    this.updateButtonStates();
    
    // Update stats
    this.updateStats();
    
    // Hide error message if not in error state
    if (this.currentState !== 'error') {
      this.elements.errorMessage.style.display = 'none';
    }
  }
  
  updateButtonStates() {
    const state = this.currentState;
    
    // Reset all buttons
    this.elements.startBtn.disabled = false;
    this.elements.pauseBtn.disabled = true;
    this.elements.resumeBtn.disabled = true;
    this.elements.stopBtn.disabled = true;
    this.elements.exportBtn.disabled = true;
    
    // Set button states based on current state
    switch (state) {
      case 'idle':
        this.elements.startBtn.disabled = false;
        this.elements.exportBtn.disabled = this.stateData.recordedRequests?.length === 0;
        break;
        
      case 'recording':
        this.elements.pauseBtn.disabled = false;
        this.elements.stopBtn.disabled = false;
        break;
        
      case 'paused':
        this.elements.resumeBtn.disabled = false;
        this.elements.stopBtn.disabled = false;
        break;
        
      case 'stopping':
      case 'exporting':
      case 'resuming':
        // All buttons disabled during transitions
        this.setButtonsEnabled(false);
        break;
        
      case 'error':
        this.elements.stopBtn.disabled = false;
        break;
    }
    
    // Update button text and styles
    this.elements.startBtn.textContent = 'Start Recording';
    this.elements.startBtn.className = 'btn-primary';
    
    this.elements.pauseBtn.textContent = 'Pause Recording';
    this.elements.pauseBtn.className = 'btn-warning';
    
    this.elements.resumeBtn.textContent = 'Resume Recording';
    this.elements.resumeBtn.className = 'btn-success';
    
    this.elements.stopBtn.textContent = 'Stop Recording';
    this.elements.stopBtn.className = 'btn-danger';
    
    this.elements.exportBtn.textContent = 'Export Data';
    this.elements.exportBtn.className = 'btn-secondary';
  }
  
  setButtonsEnabled(enabled) {
    [this.elements.startBtn, this.elements.pauseBtn, this.elements.resumeBtn, 
     this.elements.stopBtn, this.elements.exportBtn].forEach(btn => {
      btn.disabled = !enabled;
    });
  }
  
  updateStats() {
    if (this.currentState === 'idle' && !this.stateData.sessionId) {
      this.elements.stats.style.display = 'none';
      return;
    }
    
    this.elements.stats.style.display = 'block';
    this.elements.sessionId.textContent = this.stateData.sessionId || 'N/A';
    this.elements.requestCount.textContent = this.stateData.recordedRequests?.length || 0;
  }
  
  startDurationUpdate() {
    this.durationInterval = setInterval(() => {
      if (this.currentState === 'recording' && this.stateData.startTime) {
        const elapsed = Date.now() - this.stateData.startTime;
        this.elements.duration.textContent = this.formatDuration(elapsed);
      }
    }, 1000);
  }
  
  formatState(state) {
    const stateLabels = {
      idle: 'Idle',
      recording: 'Recording',
      paused: 'Paused',
      stopping: 'Stopping',
      exporting: 'Exporting',
      error: 'Error',
      resuming: 'Resuming'
    };
    return stateLabels[state] || state;
  }
  
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  showError(message) {
    this.elements.errorMessage.textContent = message;
    this.elements.errorMessage.style.display = 'block';
    
    // Auto-hide error after 5 seconds
    setTimeout(() => {
      if (this.currentState !== 'error') {
        this.elements.errorMessage.style.display = 'none';
      }
    }, 5000);
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});

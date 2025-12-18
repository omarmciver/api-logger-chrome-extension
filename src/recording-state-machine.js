/**
 * Recording State Machine for MV3 Chrome Extension
 * Handles API call recording with proper state management and race condition prevention
 */

export class RecordingStateMachine {
  constructor() {
    this.currentState = 'idle';
    this.stateData = {
      sessionId: null,
      startTime: null,
      pauseTime: null,
      recordedRequests: [],
      pendingOperations: new Set()
    };
    
    // State transition guards
    this.guards = {
      canStart: () => this.currentState === 'idle' || this.currentState === 'error',
      canPause: () => this.currentState === 'recording',
      canResume: () => this.currentState === 'paused',
      canStop: () => ['recording', 'paused', 'error'].includes(this.currentState),
      canExport: () => this.currentState === 'idle' && this.stateData.recordedRequests.length > 0
    };
    
    // Event listeners
    this.listeners = new Map();
    
    // Recovery mechanism for service worker restarts
    this.recoverState();
  }

  // State definitions with allowed transitions
  static STATES = {
    IDLE: 'idle',
    RECORDING: 'recording', 
    PAUSED: 'paused',
    STOPPING: 'stopping',
    EXPORTING: 'exporting',
    ERROR: 'error',
    RESUMING: 'resuming'
  };

  static TRANSITIONS = {
    [RecordingStateMachine.STATES.IDLE]: ['recording'],
    [RecordingStateMachine.STATES.RECORDING]: ['paused', 'stopping', 'error'],
    [RecordingStateMachine.STATES.PAUSED]: ['recording', 'stopping', 'error'],
    [RecordingStateMachine.STATES.STOPPING]: ['idle', 'error'],
    [RecordingStateMachine.STATES.EXPORTING]: ['idle', 'error'],
    [RecordingStateMachine.STATES.ERROR]: ['idle'],
    [RecordingStateMachine.STATES.RESUMING]: ['recording', 'error']
  };

  /**
   * Check if transition is valid
   */
  canTransition(toState) {
    return RecordingStateMachine.TRANSITIONS[this.currentState]?.includes(toState) ?? false;
  }

  /**
   * Atomic state transition with validation
   */
  async transition(toState, operationId = null) {
    if (!this.canTransition(toState)) {
      throw new Error(`Invalid transition from ${this.currentState} to ${toState}`);
    }

    // Prevent concurrent operations
    if (operationId) {
      if (this.stateData.pendingOperations.has(operationId)) {
        throw new Error(`Operation ${operationId} already in progress`);
      }
      this.stateData.pendingOperations.add(operationId);
    }

    const fromState = this.currentState;
    
    try {
      // Pre-transition validation
      if (!this.guards[`can${toState.charAt(0).toUpperCase() + toState.slice(1)}`]?.()) {
        throw new Error(`Guard failed for transition to ${toState}`);
      }

      // Execute transition
      await this.executeTransition(fromState, toState);
      
      // Update state
      this.currentState = toState;
      
      // Persist state for service worker recovery
      await this.persistState();
      
      // Notify listeners
      this.notifyListeners('stateChanged', { fromState, toState, stateData: this.stateData });
      
      return true;
    } catch (error) {
      console.error(`State transition failed: ${fromState} -> ${toState}`, error);
      await this.handleTransitionError(fromState, toState, error);
      throw error;
    } finally {
      if (operationId) {
        this.stateData.pendingOperations.delete(operationId);
      }
    }
  }

  /**
   * Execute state-specific transition logic
   */
  async executeTransition(fromState, toState) {
    switch (toState) {
      case 'recording':
        if (fromState === 'idle') {
          await this.startRecording();
        } else if (fromState === 'paused') {
          await this.resumeRecording();
        }
        break;
        
      case 'paused':
        await this.pauseRecording();
        break;
        
      case 'stopping':
        await this.stopRecording();
        break;
        
      case 'exporting':
        await this.startExport();
        break;
        
      case 'idle':
        if (fromState === 'stopping') {
          await this.finalizeStop();
        } else if (fromState === 'exporting') {
          await this.finalizeExport();
        } else if (fromState === 'error') {
          await this.clearError();
        }
        break;
        
      case 'error':
        await this.handleError();
        break;
    }
  }

  /**
   * Start recording API calls
   */
  async startRecording() {
    this.stateData.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.stateData.startTime = Date.now();
    this.stateData.recordedRequests = [];
    
    // Enable network interception
    await chrome.scripting.executeScript({
      target: { tabId: await this.getActiveTabId() },
      files: ['src/injected.js']
    });
    
    this.notifyListeners('recordingStarted', { sessionId: this.stateData.sessionId });
  }

  /**
   * Pause recording
   */
  async pauseRecording() {
    this.stateData.pauseTime = Date.now();
    this.notifyListeners('recordingPaused', { pauseTime: this.stateData.pauseTime });
  }

  /**
   * Resume recording from paused state
   */
  async resumeRecording() {
    const pauseDuration = Date.now() - this.stateData.pauseTime;
    this.stateData.pauseTime = null;
    this.notifyListeners('recordingResumed', { pauseDuration });
  }

  /**
   * Stop recording
   */
  async stopRecording() {
    // Disable network interception
    try {
      await chrome.scripting.removeCSS({
        target: { tabId: await this.getActiveTabId() },
        files: ['src/injected.js']
      });
    } catch (e) {
      // Ignore errors if script wasn't injected
    }
    
    this.notifyListeners('recordingStopped', { 
      sessionId: this.stateData.sessionId,
      requestCount: this.stateData.recordedRequests.length 
    });
  }

  /**
   * Start export process
   */
  async startExport() {
    this.notifyListeners('exportStarted', { 
      requestCount: this.stateData.recordedRequests.length 
    });
    
    // Export logic would go here
    const exportData = {
      sessionId: this.stateData.sessionId,
      startTime: this.stateData.startTime,
      requests: this.stateData.recordedRequests,
      metadata: {
        userAgent: navigator.userAgent,
        url: window.location.href,
        exportedAt: Date.now()
      }
    };
    
    // Save to downloads
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    await chrome.downloads.download({
      url: url,
      filename: `api-log-${this.stateData.sessionId}.json`,
      saveAs: true
    });
    
    URL.revokeObjectURL(url);
  }

  /**
   * Finalize operations
   */
  async finalizeStop() {
    // Cleanup resources
    this.stateData.recordedRequests = [];
    this.stateData.sessionId = null;
    this.stateData.startTime = null;
  }

  async finalizeExport() {
    // Export complete, keep data for potential re-export
  }

  async clearError() {
    // Reset error state
    this.stateData.error = null;
  }

  async handleError() {
    // Log error and cleanup
    console.error('Recording state machine error:', this.stateData.error);
  }

  async handleTransitionError(fromState, toState, error) {
    this.stateData.error = {
      fromState,
      toState,
      error: error.message,
      timestamp: Date.now()
    };
    
    // Attempt to transition to error state
    try {
      this.currentState = 'error';
      await this.persistState();
      this.notifyListeners('error', this.stateData.error);
    } catch (persistError) {
      console.error('Failed to persist error state:', persistError);
    }
  }

  /**
   * Add API request to recording
   */
  addRequest(requestData) {
    if (this.currentState !== 'recording') {
      return false;
    }
    
    this.stateData.recordedRequests.push({
      ...requestData,
      timestamp: Date.now(),
      sessionId: this.stateData.sessionId
    });
    
    return true;
  }

  /**
   * Get current state info
   */
  getState() {
    return {
      currentState: this.currentState,
      ...this.stateData,
      pendingOperations: Array.from(this.stateData.pendingOperations)
    };
  }

  /**
   * Event listener management
   */
  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  removeEventListener(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  notifyListeners(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Persist state for service worker recovery
   */
  async persistState() {
    try {
      await chrome.storage.local.set({
        recordingState: {
          currentState: this.currentState,
          stateData: this.stateData,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      console.error('Failed to persist state:', error);
    }
  }

  /**
   * Recover state after service worker restart
   */
  async recoverState() {
    try {
      const { recordingState } = await chrome.storage.local.get('recordingState');
      
      if (recordingState && recordingState.timestamp) {
        // Check if state is recent (within last 5 minutes)
        const age = Date.now() - recordingState.timestamp;
        if (age < 5 * 60 * 1000) {
          this.currentState = recordingState.currentState;
          this.stateData = { ...recordingState.stateData };
          
          // If we were recording, we need to reinitialize
          if (this.currentState === 'recording') {
            this.notifyListeners('stateRecovered', { recoveredState: this.currentState });
          }
        } else {
          // State is too old, reset to idle
          await this.resetToIdle();
        }
      }
    } catch (error) {
      console.error('Failed to recover state:', error);
      await this.resetToIdle();
    }
  }

  async resetToIdle() {
    this.currentState = 'idle';
    this.stateData = {
      sessionId: null,
      startTime: null,
      pauseTime: null,
      recordedRequests: [],
      pendingOperations: new Set()
    };
    await this.persistState();
  }

  /**
   * Get active tab ID safely
   */
  async getActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }
    return tab.id;
  }
}

export default RecordingStateMachine;

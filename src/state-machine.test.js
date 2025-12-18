/**
 * Unit tests for RecordingStateMachine
 * Run with: node --experimental-modules state-machine.test.js
 */

import { RecordingStateMachine } from './recording-state-machine.js';

// Mock chrome APIs for testing
global.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {}
    }
  },
  tabs: {
    query: async () => [{ id: 1 }]
  },
  scripting: {
    executeScript: async () => {},
    removeCSS: async () => {}
  },
  downloads: {
    download: async () => {}
  }
};

describe('RecordingStateMachine', () => {
  let stateMachine;

  beforeEach(() => {
    stateMachine = new RecordingStateMachine();
  });

  describe('Initial State', () => {
    test('starts in idle state', () => {
      expect(stateMachine.getState().currentState).toBe('idle');
    });

    test('has empty recorded requests', () => {
      expect(stateMachine.getState().recordedRequests).toEqual([]);
    });
  });

  describe('State Transitions', () => {
    test('can transition from idle to recording', async () => {
      await stateMachine.transition('recording');
      expect(stateMachine.getState().currentState).toBe('recording');
    });

    test('can transition from recording to paused', async () => {
      await stateMachine.transition('recording');
      await stateMachine.transition('paused');
      expect(stateMachine.getState().currentState).toBe('paused');
    });

    test('can transition from paused to recording', async () => {
      await stateMachine.transition('recording');
      await stateMachine.transition('paused');
      await stateMachine.transition('recording');
      expect(stateMachine.getState().currentState).toBe('recording');
    });

    test('can transition from recording to stopping to idle', async () => {
      await stateMachine.transition('recording');
      await stateMachine.transition('stopping');
      await stateMachine.transition('idle');
      expect(stateMachine.getState().currentState).toBe('idle');
    });

    test('rejects invalid transitions', async () => {
      await expect(stateMachine.transition('paused')).rejects.toThrow();
    });
  });

  describe('Operation Guards', () => {
    test('prevents starting when already recording', async () => {
      await stateMachine.transition('recording');
      await expect(stateMachine.transition('recording')).rejects.toThrow();
    });

    test('prevents pausing when not recording', async () => {
      await expect(stateMachine.transition('paused')).rejects.toThrow();
    });

    test('prevents resuming when not paused', async () => {
      await expect(stateMachine.transition('recording')).rejects.toThrow();
    });
  });

  describe('Race Condition Prevention', () => {
    test('prevents concurrent operations with same ID', async () => {
      const operationId = 'test-op';
      const promise1 = stateMachine.transition('recording', operationId);
      const promise2 = stateMachine.transition('paused', operationId);
      
      await promise1;
      await expect(promise2).rejects.toThrow();
    });

    test('allows different operation IDs', async () => {
      await stateMachine.transition('recording', 'op1');
      await stateMachine.transition('paused', 'op2');
      expect(stateMachine.getState().currentState).toBe('paused');
    });
  });

  describe('Request Recording', () => {
    test('adds requests when recording', async () => {
      await stateMachine.transition('recording');
      
      const requestData = {
        url: 'https://api.example.com/data',
        method: 'GET',
        timestamp: Date.now()
      };
      
      const added = stateMachine.addRequest(requestData);
      expect(added).toBe(true);
      expect(stateMachine.getState().recordedRequests).toHaveLength(1);
    });

    test('ignores requests when not recording', () => {
      const requestData = {
        url: 'https://api.example.com/data',
        method: 'GET',
        timestamp: Date.now()
      };
      
      const added = stateMachine.addRequest(requestData);
      expect(added).toBe(false);
      expect(stateMachine.getState().recordedRequests).toHaveLength(0);
    });
  });

  describe('Event Listeners', () => {
    test('notifies listeners on state changes', async () => {
      const mockListener = jest.fn();
      stateMachine.addEventListener('stateChanged', mockListener);
      
      await stateMachine.transition('recording');
      
      expect(mockListener).toHaveBeenCalledWith({
        fromState: 'idle',
        toState: 'recording',
        stateData: expect.any(Object)
      });
    });

    test('allows multiple listeners', async () => {
      const mockListener1 = jest.fn();
      const mockListener2 = jest.fn();
      
      stateMachine.addEventListener('stateChanged', mockListener1);
      stateMachine.addEventListener('stateChanged', mockListener2);
      
      await stateMachine.transition('recording');
      
      expect(mockListener1).toHaveBeenCalled();
      expect(mockListener2).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('transitions to error state on failures', async () => {
      // Mock a failure in transition
      const originalTransition = stateMachine.executeTransition;
      stateMachine.executeTransition = async () => {
        throw new Error('Test error');
      };
      
      await stateMachine.transition('recording');
      
      expect(stateMachine.getState().currentState).toBe('error');
      
      // Restore original method
      stateMachine.executeTransition = originalTransition;
    });

    test('preserves error information', async () => {
      const originalTransition = stateMachine.executeTransition;
      stateMachine.executeTransition = async () => {
        throw new Error('Test error');
      };
      
      await stateMachine.transition('recording');
      
      const state = stateMachine.getState();
      expect(state.error).toBeDefined();
      expect(state.error.error).toBe('Test error');
      
      // Restore original method
      stateMachine.executeTransition = originalTransition;
    });
  });
});

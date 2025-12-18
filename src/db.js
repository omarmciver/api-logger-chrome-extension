/**
 * IndexedDB module for storing API recording sessions and calls
 */

const DB_NAME = 'api-logger';
const DB_VERSION = 1;

let db = null;

/**
 * Initialize the database
 * @returns {Promise<IDBDatabase>}
 */
export async function initDB() {
  if (db) return db;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      reject(request.error);
    };
    
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      // Sessions store
      if (!database.objectStoreNames.contains('sessions')) {
        const sessionsStore = database.createObjectStore('sessions', { keyPath: 'id' });
        sessionsStore.createIndex('byCreatedAt', 'createdAt', { unique: false });
        sessionsStore.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
        sessionsStore.createIndex('byStatus', 'status', { unique: false });
      }
      
      // Calls store
      if (!database.objectStoreNames.contains('calls')) {
        const callsStore = database.createObjectStore('calls', { keyPath: 'id', autoIncrement: true });
        callsStore.createIndex('bySessionId', 'sessionId', { unique: false });
        callsStore.createIndex('bySessionSeq', ['sessionId', 'seq'], { unique: false });
        callsStore.createIndex('bySessionTimestamp', ['sessionId', 'timestamp'], { unique: false });
      }
    };
  });
}

/**
 * Create a new recording session
 * @param {string} name - Session name
 * @returns {Promise<Object>} - Created session
 */
export async function createSession(name) {
  const database = await initDB();
  const session = {
    id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: name || `Session ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
    callCount: 0,
    tabUrl: null
  };
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const request = store.add(session);
    
    request.onsuccess = () => resolve(session);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all sessions
 * @returns {Promise<Object[]>}
 */
export async function getSessions() {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const index = store.index('byUpdatedAt');
    const request = index.getAll();
    
    request.onsuccess = () => {
      // Sort by updatedAt descending (newest first)
      const sessions = request.result.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a session by ID
 * @param {string} sessionId
 * @returns {Promise<Object>}
 */
export async function getSession(sessionId) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const request = store.get(sessionId);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update a session
 * @param {string} sessionId
 * @param {Object} updates
 * @returns {Promise<Object>}
 */
export async function updateSession(sessionId, updates) {
  const database = await initDB();
  
  return new Promise(async (resolve, reject) => {
    const session = await getSession(sessionId);
    if (!session) {
      reject(new Error('Session not found'));
      return;
    }
    
    const updatedSession = {
      ...session,
      ...updates,
      updatedAt: Date.now()
    };
    
    const tx = database.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const request = store.put(updatedSession);
    
    request.onsuccess = () => resolve(updatedSession);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a session and its calls
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function deleteSession(sessionId) {
  const database = await initDB();
  
  return new Promise(async (resolve, reject) => {
    // Delete all calls for this session first
    const calls = await getCallsBySession(sessionId);
    
    const tx = database.transaction(['sessions', 'calls'], 'readwrite');
    const sessionsStore = tx.objectStore('sessions');
    const callsStore = tx.objectStore('calls');
    
    // Delete calls
    for (const call of calls) {
      callsStore.delete(call.id);
    }
    
    // Delete session
    const request = sessionsStore.delete(sessionId);
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Add a call to a session
 * @param {string} sessionId
 * @param {Object} callData
 * @returns {Promise<Object>}
 */
export async function addCall(sessionId, callData) {
  const database = await initDB();
  
  // Get current call count for seq number
  const session = await getSession(sessionId);
  const seq = (session?.callCount || 0) + 1;
  
  const call = {
    sessionId,
    seq,
    timestamp: Date.now(),
    ...callData
  };
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['calls', 'sessions'], 'readwrite');
    const callsStore = tx.objectStore('calls');
    const sessionsStore = tx.objectStore('sessions');
    
    const addRequest = callsStore.add(call);
    
    addRequest.onsuccess = () => {
      call.id = addRequest.result;
      
      // Update session call count
      const sessionRequest = sessionsStore.get(sessionId);
      sessionRequest.onsuccess = () => {
        const session = sessionRequest.result;
        if (session) {
          session.callCount = seq;
          session.updatedAt = Date.now();
          sessionsStore.put(session);
        }
      };
    };
    
    tx.oncomplete = () => resolve(call);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all calls for a session
 * @param {string} sessionId
 * @returns {Promise<Object[]>}
 */
export async function getCallsBySession(sessionId) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction('calls', 'readonly');
    const store = tx.objectStore('calls');
    const index = store.index('bySessionSeq');
    
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]);
    const request = index.getAll(range);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all data
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['sessions', 'calls'], 'readwrite');
    tx.objectStore('sessions').clear();
    tx.objectStore('calls').clear();
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

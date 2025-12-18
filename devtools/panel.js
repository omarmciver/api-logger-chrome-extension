import { initDB, createSession, getSessions, getSession, updateSession, deleteSession, addCall, getCallsBySession, clearAllData } from '../src/db.js';
import { exportSession, exportSessionCompact, downloadFile } from '../src/export.js';

class APILoggerPanel {
  constructor() {
    this.sessions = [];
    this.activeSession = null;
    this.currentCalls = [];
    this.isRecording = false;
    this.isPaused = false;
    this.filterText = '';
    this.networkListener = null;
    
    this.init();
  }
  
  async init() {
    await initDB();
    this.bindUI();
    await this.loadSessions();
  }
  
  bindUI() {
    this.newSessionBtn = document.getElementById('newSessionBtn');
    this.startBtn = document.getElementById('startBtn');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.exportBtn = document.getElementById('exportBtn');
    this.clearAllBtn = document.getElementById('clearAllBtn');
    this.clearRequestsBtn = document.getElementById('clearRequestsBtn');
    this.statusBadge = document.getElementById('statusBadge');
    this.requestCounter = document.getElementById('requestCounter');
    this.sessionsList = document.getElementById('sessionsList');
    this.requestsList = document.getElementById('requestsList');
    this.filterInput = document.getElementById('filterInput');
    
    this.newSessionBtn.onclick = () => this.createNewSession();
    this.startBtn.onclick = () => this.startRecording();
    this.pauseBtn.onclick = () => this.pauseRecording();
    this.stopBtn.onclick = () => this.stopRecording();
    this.exportBtn.onclick = () => this.exportCurrentSession();
    this.clearAllBtn.onclick = () => this.clearAllSessions();
    this.clearRequestsBtn.onclick = () => this.clearCurrentCalls();
    this.filterInput.oninput = (e) => this.setFilter(e.target.value);
  }
  
  async loadSessions() {
    this.sessions = await getSessions();
    this.renderSessions();
    
    const activeSession = this.sessions.find(s => s.status === 'active');
    if (activeSession) {
      await this.selectSession(activeSession.id);
      this.resumeRecordingState();
    }
  }
  
  renderSessions() {
    if (this.sessions.length === 0) {
      this.sessionsList.innerHTML = '<div class="no-sessions">No sessions yet</div>';
      return;
    }
    
    this.sessionsList.innerHTML = this.sessions.map(session => `
      <div class="session-item ${this.activeSession?.id === session.id ? 'active' : ''}" data-id="${session.id}">
        <div class="session-name">
          <span>${this.escapeHtml(session.name)}</span>
          <span class="session-status ${session.status}">${session.status}</span>
        </div>
        <div class="session-meta">
          ${session.callCount} calls · ${this.formatDate(session.createdAt)}
        </div>
        <div class="session-actions">
          ${session.status === 'stopped' ? `
            <button class="resume-btn" data-id="${session.id}">Resume</button>
          ` : ''}
          ${session.status === 'paused' ? `
            <button class="resume-btn" data-id="${session.id}">Continue</button>
          ` : ''}
          <button class="export-btn" data-id="${session.id}">Export</button>
          <button class="delete-btn danger" data-id="${session.id}">Delete</button>
        </div>
      </div>
    `).join('');
    
    this.sessionsList.querySelectorAll('.session-item').forEach(el => {
      el.onclick = (e) => {
        if (!e.target.matches('button')) {
          this.selectSession(el.dataset.id);
        }
      };
    });
    
    this.sessionsList.querySelectorAll('.resume-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.resumeSession(btn.dataset.id);
      };
    });
    
    this.sessionsList.querySelectorAll('.export-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.exportSessionById(btn.dataset.id);
      };
    });
    
    this.sessionsList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.deleteSessionById(btn.dataset.id);
      };
    });
  }
  
  async selectSession(sessionId) {
    this.activeSession = await getSession(sessionId);
    this.currentCalls = await getCallsBySession(sessionId);
    this.renderSessions();
    this.renderCalls();
    this.updateUI();
  }
  
  async createNewSession() {
    if (this.isRecording) {
      await this.stopRecording();
    }
    
    const name = `Session ${new Date().toLocaleString()}`;
    const session = await createSession(name);
    await this.loadSessions();
    await this.selectSession(session.id);
    await this.startRecording();
  }
  
  async resumeSession(sessionId) {
    if (this.isRecording) {
      await this.stopRecording();
    }
    
    await this.selectSession(sessionId);
    await updateSession(sessionId, { status: 'active' });
    await this.startRecording();
  }
  
  async startRecording() {
    if (!this.activeSession) return;
    
    this.isRecording = true;
    this.isPaused = false;
    
    await updateSession(this.activeSession.id, { 
      status: 'active',
      tabUrl: await this.getCurrentTabUrl()
    });
    
    this.attachNetworkListener();
    await this.loadSessions();
    this.updateUI();
  }
  
  resumeRecordingState() {
    if (this.activeSession?.status === 'active') {
      this.isRecording = true;
      this.isPaused = false;
      this.attachNetworkListener();
      this.updateUI();
    }
  }
  
  async pauseRecording() {
    if (!this.isRecording || !this.activeSession) return;
    
    this.isPaused = true;
    this.isRecording = false;
    this.detachNetworkListener();
    
    await updateSession(this.activeSession.id, { status: 'paused' });
    await this.loadSessions();
    this.updateUI();
  }
  
  async stopRecording() {
    this.isRecording = false;
    this.isPaused = false;
    this.detachNetworkListener();
    
    if (this.activeSession) {
      await updateSession(this.activeSession.id, { status: 'stopped' });
      await this.loadSessions();
    }
    this.updateUI();
  }
  
  attachNetworkListener() {
    if (this.networkListener) return;
    
    this.networkListener = async (request) => {
      if (!this.isRecording || !this.activeSession) return;
      
      try {
        const callData = await this.processRequest(request);
        if (callData) {
          const savedCall = await addCall(this.activeSession.id, callData);
          this.currentCalls.push(savedCall);
          this.activeSession.callCount = this.currentCalls.length;
          this.renderCalls();
          this.updateUI();
        }
      } catch (error) {
        console.error('Error processing request:', error);
      }
    };
    
    chrome.devtools.network.onRequestFinished.addListener(this.networkListener);
  }
  
  detachNetworkListener() {
    if (this.networkListener) {
      chrome.devtools.network.onRequestFinished.removeListener(this.networkListener);
      this.networkListener = null;
    }
  }
  
  async processRequest(request) {
    const { request: req, response: res, startedDateTime, time } = request;
    
    const resourceType = request._resourceType || '';
    if (!this.isApiCall(req.url, resourceType, res.content?.mimeType)) {
      return null;
    }
    
    let responseBody = null;
    let truncated = false;
    
    try {
      responseBody = await this.getResponseBody(request);
      const MAX_SIZE = 100 * 1024;
      if (responseBody && responseBody.length > MAX_SIZE) {
        responseBody = responseBody.substring(0, MAX_SIZE);
        truncated = true;
      }
    } catch (e) {}
    
    let requestBody = req.postData?.text || null;
    if (requestBody && requestBody.length > 100 * 1024) {
      requestBody = requestBody.substring(0, 100 * 1024) + '\n[TRUNCATED]';
    }
    
    return {
      method: req.method,
      url: req.url,
      requestHeaders: this.filterHeaders(req.headers),
      requestBody,
      requestContentType: req.postData?.mimeType || this.getHeader(req.headers, 'content-type'),
      status: res.status,
      statusText: res.statusText,
      responseHeaders: this.filterHeaders(res.headers),
      responseBody,
      responseBodyTruncated: truncated,
      responseContentType: res.content?.mimeType || this.getHeader(res.headers, 'content-type'),
      responseSize: res.content?.size || 0,
      startTime: new Date(startedDateTime).getTime(),
      duration: Math.round(time || 0)
    };
  }
  
  getResponseBody(request) {
    return new Promise((resolve, reject) => {
      request.getContent((content, encoding) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        if (encoding === 'base64' && content) {
          try { resolve(atob(content)); }
          catch (e) { resolve(content); }
        } else {
          resolve(content);
        }
      });
    });
  }
  
  isApiCall(url, resourceType, mimeType) {
    if (resourceType === 'xhr' || resourceType === 'fetch') return true;
    
    if (mimeType) {
      const apiTypes = ['application/json', 'application/xml', 'text/xml', 'text/plain'];
      if (apiTypes.some(t => mimeType.includes(t))) return true;
    }
    
    const urlLower = url.toLowerCase();
    const apiPatterns = ['/api/', '/v1/', '/v2/', '/v3/', '/graphql', '/rest/', '.json'];
    if (apiPatterns.some(p => urlLower.includes(p))) return true;
    
    const staticExt = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.ico', '.map'];
    if (staticExt.some(ext => urlLower.endsWith(ext))) return false;
    
    return resourceType === 'document' || !resourceType;
  }
  
  filterHeaders(headers) {
    if (!headers) return null;
    const filtered = {};
    const sensitive = ['cookie', 'set-cookie', 'authorization', 'x-api-key', 'api-key'];
    for (const h of headers) {
      const name = h.name.toLowerCase();
      filtered[name] = sensitive.includes(name) ? '[REDACTED]' : h.value;
    }
    return filtered;
  }
  
  getHeader(headers, name) {
    if (!headers) return null;
    const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return h?.value || null;
  }
  
  renderCalls() {
    const calls = this.filterText 
      ? this.currentCalls.filter(c => 
          c.url.toLowerCase().includes(this.filterText) ||
          c.method.toLowerCase().includes(this.filterText)
        )
      : this.currentCalls;
    
    if (calls.length === 0) {
      this.requestsList.innerHTML = `
        <div class="empty-state">
          <h3>No API calls recorded</h3>
          <p>${this.activeSession ? 'Start recording to capture API calls.' : 'Select or create a session to begin.'}</p>
        </div>
      `;
      return;
    }
    
    this.requestsList.innerHTML = calls.map((call, idx) => `
      <div class="request-row" data-idx="${idx}">
        <span class="method ${call.method}">${call.method}</span>
        <span class="status-code ${this.getStatusClass(call.status)}">${call.status}</span>
        <span class="url" title="${this.escapeHtml(call.url)}">${this.truncateUrl(call.url)}</span>
        <span class="duration">${call.duration}ms</span>
        <span class="time">${this.formatTime(call.timestamp || call.startTime)}</span>
      </div>
      <div class="request-details" id="details-${idx}">
        <div class="detail-section">
          <h4>Request</h4>
          <div class="detail-content">${call.method} ${call.url}
${call.requestHeaders ? '\nHeaders:\n' + JSON.stringify(call.requestHeaders, null, 2) : ''}
${call.requestBody ? '\nBody:\n' + this.formatBody(call.requestBody) : ''}</div>
        </div>
        <div class="detail-section">
          <h4>Response (${call.status} ${call.statusText || ''})</h4>
          <div class="detail-content">${call.responseHeaders ? 'Headers:\n' + JSON.stringify(call.responseHeaders, null, 2) + '\n\n' : ''}${call.responseBody ? 'Body:\n' + this.formatBody(call.responseBody) : '(no body)'}${call.responseBodyTruncated ? '\n[TRUNCATED]' : ''}</div>
        </div>
      </div>
    `).join('');
    
    this.requestsList.querySelectorAll('.request-row').forEach(row => {
      row.onclick = () => {
        const details = document.getElementById(`details-${row.dataset.idx}`);
        const wasExpanded = details.classList.contains('expanded');
        document.querySelectorAll('.request-details.expanded').forEach(d => d.classList.remove('expanded'));
        document.querySelectorAll('.request-row.expanded').forEach(r => r.classList.remove('expanded'));
        if (!wasExpanded) {
          details.classList.add('expanded');
          row.classList.add('expanded');
        }
      };
    });
  }
  
  formatBody(body) {
    if (!body) return '';
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch (e) {
      return body;
    }
  }
  
  updateUI() {
    const hasSession = !!this.activeSession;
    const canRecord = hasSession && !this.isRecording;
    const canPause = this.isRecording && !this.isPaused;
    const canStop = this.isRecording || this.isPaused;
    const canExport = hasSession && this.currentCalls.length > 0;
    
    this.startBtn.disabled = !canRecord;
    this.pauseBtn.disabled = !canPause;
    this.stopBtn.disabled = !canStop;
    this.exportBtn.disabled = !canExport;
    
    if (this.isRecording) {
      this.statusBadge.textContent = 'Recording';
      this.statusBadge.className = 'status-badge recording';
    } else if (this.isPaused) {
      this.statusBadge.textContent = 'Paused';
      this.statusBadge.className = 'status-badge paused';
    } else {
      this.statusBadge.textContent = 'Idle';
      this.statusBadge.className = 'status-badge idle';
    }
    
    this.requestCounter.textContent = `${this.currentCalls.length} calls`;
  }
  
  setFilter(text) {
    this.filterText = text.toLowerCase();
    this.renderCalls();
  }
  
  clearCurrentCalls() {
    this.currentCalls = [];
    this.renderCalls();
    this.updateUI();
  }
  
  async clearAllSessions() {
    if (!confirm('Delete all sessions? This cannot be undone.')) return;
    
    await this.stopRecording();
    await clearAllData();
    this.activeSession = null;
    this.currentCalls = [];
    await this.loadSessions();
    this.renderCalls();
    this.updateUI();
  }
  
  async deleteSessionById(sessionId) {
    if (!confirm('Delete this session?')) return;
    
    if (this.activeSession?.id === sessionId && this.isRecording) {
      await this.stopRecording();
    }
    
    await deleteSession(sessionId);
    
    if (this.activeSession?.id === sessionId) {
      this.activeSession = null;
      this.currentCalls = [];
    }
    
    await this.loadSessions();
    this.renderCalls();
    this.updateUI();
  }
  
  async exportCurrentSession() {
    if (!this.activeSession) return;
    await this.exportSessionById(this.activeSession.id);
  }
  
  async exportSessionById(sessionId) {
    try {
      const content = await exportSession(sessionId);
      const session = await getSession(sessionId);
      const filename = `api-trace-${session.name.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.jsonl`;
      downloadFile(content, filename, 'application/jsonl');
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed: ' + error.message);
    }
  }
  
  async getCurrentTabUrl() {
    return new Promise(resolve => {
      if (chrome.devtools?.inspectedWindow?.tabId) {
        chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, tab => {
          resolve(tab?.url || null);
        });
      } else {
        resolve(null);
      }
    });
  }
  
  truncateUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname + u.search;
      return path.length > 80 ? path.substring(0, 77) + '...' : path;
    } catch (e) {
      return url.length > 80 ? url.substring(0, 77) + '...' : url;
    }
  }
  
  getStatusClass(status) {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    return 'error';
  }
  
  formatDate(ts) {
    return new Date(ts).toLocaleString(undefined, { 
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
  }
  
  formatTime(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { 
      hour: '2-digit', minute: '2-digit', second: '2-digit' 
    });
  }
  
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

new APILoggerPanel();

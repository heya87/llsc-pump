// ============================================================
// HISTORY — training session log (CSV-only, no localStorage)
// ============================================================

// In-memory sessions after loading a file
// [{ sessionId, date, exercises: [{id, name, muscleGroup, tools}] }]
let _historyData = [];

// ---- IndexedDB helpers for persisting FileSystemFileHandle across sessions ----
const _HANDLE_DB = 'LLSCHandles';
const _HANDLE_STORE = 'fileHandles';

function _openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_HANDLE_DB, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_HANDLE_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}

async function _storeFileHandle(key, handle) {
  try {
    const db = await _openHandleDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(_HANDLE_STORE, 'readwrite');
      tx.objectStore(_HANDLE_STORE).put(handle, key);
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch { /* ignore */ }
}

async function _loadFileHandle(key) {
  try {
    const db = await _openHandleDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(_HANDLE_STORE, 'readonly');
      const req = tx.objectStore(_HANDLE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = reject;
    });
  } catch { return null; }
}

// Request readwrite permission for a stored handle; returns the handle or null
async function _tryHandle(key, mode = 'readwrite') {
  const handle = await _loadFileHandle(key);
  if (!handle) return null;
  try {
    const perm = await handle.requestPermission({ mode });
    return perm === 'granted' ? handle : null;
  } catch { return null; }
}

// ---- CSV helpers ----
function _csvEscSemi(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _splitSemiCSV(line) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ';' && !inQ) {
      cols.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  cols.push(cur);
  return cols;
}

// ---- CSV serialise / parse ----
function _historyToCSV(rows) {
  const lines = ['session_id;date;exercise_id;exercise_name;muscle_group;tools'];
  for (const r of rows) {
    lines.push([
      _csvEscSemi(r.sessionId),
      _csvEscSemi(r.date),
      r.exerciseId,
      _csvEscSemi(r.exerciseName),
      _csvEscSemi(r.muscleGroup),
      _csvEscSemi(r.tools)
    ].join(';'));
  }
  return lines.join('\n');
}

function _parseHistoryCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = _splitSemiCSV(lines[i]);
    if (cols.length < 6) continue;
    rows.push({
      sessionId:    cols[0].trim(),
      date:         cols[1].trim(),
      exerciseId:   parseInt(cols[2], 10) || 0,
      exerciseName: cols[3].trim(),
      muscleGroup:  cols[4].trim(),
      tools:        cols[5].trim()
    });
  }
  return rows;
}

function _rowsToSessions(rows) {
  const bySession = {};
  for (const r of rows) {
    if (!bySession[r.sessionId]) {
      bySession[r.sessionId] = { sessionId: r.sessionId, date: r.date, exercises: [] };
    }
    if (!bySession[r.sessionId].exercises.find(e => e.id === r.exerciseId)) {
      bySession[r.sessionId].exercises.push({
        id: r.exerciseId, name: r.exerciseName,
        muscleGroup: r.muscleGroup, tools: r.tools
      });
    }
  }
  return Object.values(bySession).sort((a, b) => b.sessionId.localeCompare(a.sessionId));
}

// ---- Collect unique exercises from a completed training's phases ----
function _exercisesFromPhases(phases) {
  const seen = new Set();
  const result = [];
  for (const phase of phases) {
    if (phase.type === 'work' && phase.exercise) {
      const ex = phase.exercise;
      if (!seen.has(ex.id)) {
        seen.add(ex.id);
        result.push({
          id: ex.id, name: ex.name,
          muscleGroup: ex.muscleGroup || '',
          tools: ex.tools || ''
        });
      }
    }
  }
  return result;
}

// ---- File choice dialog (append to existing vs new file) ----
function _promptHistoryFileChoice() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p style="font-weight:700;font-size:16px;margin-bottom:12px">Training speichern</p>
        <div class="confirm-btns" style="flex-direction:column;align-items:stretch">
          <button class="btn btn-success" id="histFileExisting">In bestehende Datei eintragen</button>
          <button class="btn btn-outline" id="histFileNew">Neue Datei erstellen</button>
          <button class="btn btn-outline" id="histFileCancel">Abbrechen</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#histFileExisting').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#histFileNew').onclick      = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#histFileCancel').onclick   = () => { overlay.remove(); resolve(null); };
  });
}

// ---- Save completed training to CSV file ----
async function saveTrainingHistory(phases) {
  if (!phases || !phases.length) return;
  const exList = _exercisesFromPhases(phases);
  if (!exList.length) return;

  const now = new Date();
  const sessionId = now.toISOString();
  const date = sessionId.slice(0, 10);

  const newRows = exList.map(ex => ({
    sessionId, date,
    exerciseId:   ex.id,
    exerciseName: ex.name,
    muscleGroup:  ex.muscleGroup,
    tools:        ex.tools
  }));

  // Try remembered file handle silently — no requestPermission (avoids browser dialogs).
  // createWritable() throws on its own if permission has expired.
  const savedHandle = await _loadFileHandle('historySaveFile');
  if (savedHandle) {
    try {
      const existing = await savedHandle.getFile();
      const existingRows = _parseHistoryCSV(await existing.text());
      const csv = _historyToCSV([...existingRows, ...newRows]);
      const w = await savedHandle.createWritable();
      await w.write(csv);
      await w.close();
      return;
    } catch {
      // Stale or no write permission — discard and fall through to picker
      await _storeFileHandle('historySaveFile', null);
    }
  }

  // No remembered handle.
  // Load the last-used handle to use as startIn (opens pickers in the right folder).
  const hintHandle = await _loadFileHandle('historySaveFile');

  // Step 1: read existing file via open picker.
  let existingRows = [];
  let suggestedName = 'llsc-history.csv';

  if ('showOpenFilePicker' in window) {
    try {
      const opts = { types: [{ description: 'CSV-Datei', accept: { 'text/csv': ['.csv'] } }] };
      if (hintHandle) opts.startIn = hintHandle; // open in same folder as last time
      const [rHandle] = await window.showOpenFilePicker(opts);
      const file = await rHandle.getFile();
      existingRows = _parseHistoryCSV(await file.text());
      suggestedName = file.name;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  } else {
    const picked = await _pickCsvForAppend();
    if (picked === null) return;
    existingRows = picked.rows;
    suggestedName = picked.filename;
  }

  const csv = _historyToCSV([...existingRows, ...newRows]);

  // Step 2: write via save picker — same folder (startIn) + same filename pre-filled.
  if ('showSaveFilePicker' in window) {
    try {
      const opts = {
        suggestedName,
        types: [{ description: 'CSV-Datei', accept: { 'text/csv': ['.csv'] } }]
      };
      if (hintHandle) opts.startIn = hintHandle;
      const handle = await window.showSaveFilePicker(opts);
      const w = await handle.createWritable();
      await w.write(csv);
      await w.close();
      await _storeFileHandle('historySaveFile', handle);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // Fallback: download with original filename
  const blob = new Blob([csv], { type: 'text/csv' });
  Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: suggestedName
  }).click();
}

// Read a CSV via <input type="file"> and return { rows, filename } or null if cancelled
function _pickCsvForAppend() {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file', accept: '.csv'
    });
    input.addEventListener('cancel', () => resolve(null));
    input.onchange = async () => {
      if (!input.files[0]) { resolve(null); return; }
      const file = input.files[0];
      resolve({ rows: _parseHistoryCSV(await file.text()), filename: file.name });
    };
    input.click();
  });
}

// Read a CSV file via <input type="file"> — returns parsed rows or null if cancelled
function _readCsvInput() {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file', accept: '.csv'
    });
    input.addEventListener('cancel', () => resolve(null));
    input.onchange = async () => {
      if (!input.files[0]) { resolve(null); return; }
      resolve(_parseHistoryCSV(await input.files[0].text()));
    };
    input.click();
  });
}

// ---- Load history from one or more CSV files ----
async function loadHistoryFiles() {
  if ('showOpenFilePicker' in window) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'CSV-Datei', accept: { 'text/csv': ['.csv'] } }]
      });
      let allRows = [];
      for (const h of handles) {
        const file = await h.getFile();
        allRows = allRows.concat(_parseHistoryCSV(await file.text()));
      }
      if (!allRows.length) { alert('Keine Trainingseinträge gefunden.'); return; }
      _historyData = _rowsToSessions(allRows);
      // Remember single-file choice for quick reload
      if (handles.length === 1) await _storeFileHandle('historyLoadFile', handles[0]);
      renderHistoryScreen();
    } catch (e) {
      if (e.name !== 'AbortError') _loadHistoryFilesViaInput();
    }
  } else {
    _loadHistoryFilesViaInput();
  }
}

function _loadHistoryFilesViaInput() {
  const input = Object.assign(document.createElement('input'), {
    type: 'file', accept: '.csv', multiple: true
  });
  input.onchange = async () => {
    const files = Array.from(input.files);
    if (!files.length) return;
    let allRows = [];
    for (const file of files) {
      allRows = allRows.concat(_parseHistoryCSV(await file.text()));
    }
    if (!allRows.length) { alert('Keine Trainingseinträge gefunden.'); return; }
    _historyData = _rowsToSessions(allRows);
    renderHistoryScreen();
  };
  input.click();
}

// ---- Reload from the last remembered load handle ----
async function reloadLastHistoryFile() {
  if (!('showOpenFilePicker' in window)) { loadHistoryFiles(); return; }
  const handle = await _tryHandle('historyLoadFile', 'read');
  if (!handle) { loadHistoryFiles(); return; }
  try {
    const file = await handle.getFile();
    const rows = _parseHistoryCSV(await file.text());
    if (!rows.length) { alert('Keine Trainingseinträge gefunden.'); return; }
    _historyData = _rowsToSessions(rows);
    renderHistoryScreen();
  } catch { loadHistoryFiles(); }
}

// ---- Returns exercise IDs done in the last n sessions (for planner) ----
function getRecentlyDoneExerciseIds(n) {
  const ids = new Set();
  _historyData.slice(0, n).forEach(s => s.exercises.forEach(e => ids.add(e.id)));
  return ids;
}

// ---- Render statistics screen ----
function renderHistoryScreen() {
  const container = document.getElementById('historyContent');
  if (!container) return;

  if (!_historyData.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 0">
        <p style="color:var(--text-light);margin-bottom:16px">Noch keine Trainingsdaten geladen.</p>
        <button class="btn btn-primary" style="width:auto;padding:10px 24px" onclick="loadHistoryFiles()">CSV öffnen</button>
        <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="reloadLastHistoryFile()">Zuletzt geöffnete Datei laden</button>
      </div>
    `;
    return;
  }

  // Exercise frequency
  const exFreq = {};
  const muscleFreq = {};
  for (const session of _historyData) {
    for (const ex of session.exercises) {
      if (!exFreq[ex.id]) exFreq[ex.id] = { name: ex.name, muscleGroup: ex.muscleGroup, count: 0, lastDate: '' };
      exFreq[ex.id].count++;
      if (!exFreq[ex.id].lastDate || session.date > exFreq[ex.id].lastDate) exFreq[ex.id].lastDate = session.date;

      if (ex.muscleGroup) {
        muscleFreq[ex.muscleGroup] = (muscleFreq[ex.muscleGroup] || 0) + 1;
      }
    }
  }
  const exList = Object.values(exFreq).sort((a, b) => b.count - a.count);
  const maxExCount = exList[0]?.count || 1;

  const muscleList = Object.entries(muscleFreq).sort((a, b) => b[1] - a[1]);
  const maxMuscleCount = muscleList[0]?.[1] || 1;

  // Session list HTML
  const sessionHTML = _historyData.map((s, idx) => `
    <div class="hist-session" onclick="toggleHistorySession(${idx})">
      <div class="hist-session-header">
        <span class="hist-date">${_fmtDate(s.date)}</span>
        <span class="hist-count-badge">${s.exercises.length} Übungen</span>
        <span class="hist-toggle" id="histToggle${idx}">▼</span>
      </div>
      <div class="hist-exercises" id="histEx${idx}" style="display:none">
        ${s.exercises.map(ex => `
          <div class="hist-ex-row">
            <span class="hist-ex-name">${esc(ex.name)}</span>
            ${_muscleTag(ex.muscleGroup)}
            ${_toolTag(ex.tools)}
          </div>`).join('')}
      </div>
    </div>
  `).join('');

  // Exercise frequency table with bars
  const exFreqHTML = exList.map(ex => `
    <div class="hist-freq-row">
      <div class="hist-freq-label">
        <span class="hist-freq-name">${esc(ex.name)}</span>
        ${_muscleTag(ex.muscleGroup)}
      </div>
      <div class="hist-freq-bar-wrap">
        <div class="hist-freq-bar" style="width:${Math.round(ex.count / maxExCount * 100)}%"></div>
      </div>
      <span class="hist-freq-num">${ex.count}×</span>
      <span class="hist-freq-last">${_fmtDate(ex.lastDate)}</span>
    </div>
  `).join('');

  // Muscle group frequency with bars
  const muscleFreqHTML = muscleList.map(([muscle, count]) => `
    <div class="hist-freq-row">
      <div class="hist-freq-label">
        ${_muscleTag(muscle)}
      </div>
      <div class="hist-freq-bar-wrap">
        <div class="hist-freq-bar" style="width:${Math.round(count / maxMuscleCount * 100)}%;background:${getMuscleColor(muscle)}"></div>
      </div>
      <span class="hist-freq-num">${count}×</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="reloadLastHistoryFile()">Aktualisieren</button>
      <button class="btn btn-outline btn-sm" onclick="loadHistoryFiles()">Andere Datei öffnen</button>
    </div>
    <div class="hist-layout">
      <div class="hist-col">
        <h3 class="hist-col-title">Trainings (${_historyData.length})</h3>
        <div class="hist-session-list">${sessionHTML}</div>
      </div>
      <div class="hist-col">
        <h3 class="hist-col-title">Übungen</h3>
        <div class="hist-freq-list">${exFreqHTML}</div>
        <h3 class="hist-col-title" style="margin-top:20px">Muskelgruppen</h3>
        <div class="hist-freq-list">${muscleFreqHTML}</div>
      </div>
    </div>
  `;
}

function toggleHistorySession(idx) {
  const el = document.getElementById(`histEx${idx}`);
  const toggle = document.getElementById(`histToggle${idx}`);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (toggle) toggle.textContent = open ? '▼' : '▲';
}

function _fmtDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}.${m}.${y}`;
}

function _muscleTag(muscle) {
  if (!muscle) return '';
  const color = getMuscleColor(muscle);
  return `<span class="hist-tag" style="background:${color};color:#fff;border-radius:100px">${esc(muscle)}</span>`;
}

function _toolTag(tool) {
  if (!tool) return '';
  const color = getToolColor(tool);
  return `<span class="hist-tag" style="background:${color};color:#fff;border-radius:4px">${esc(tool)}</span>`;
}

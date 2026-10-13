// ============================================================
// HISTORY — training session log (server: api/history; CSV in backup.js)
// ============================================================

// Flat rows as stored on the server (same shape as the CSV rows)
// [{ sessionId, date, exerciseId, exerciseName, muscleGroup, tools }]
let _historyRows = [];

// Grouped sessions for rendering, newest first
// [{ sessionId, date, exercises: [{id, name, muscleGroup, tools}] }]
let _historyData = [];

function _setHistoryRows(rows) {
  _historyRows = rows;
  _historyData = _rowsToSessions(rows);
}

async function loadHistory() {
  _setHistoryRows(await Api.get('history'));
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

// ---- Save completed training ----
async function saveTrainingHistory(phases, btn) {
  if (!phases || !phases.length) return;
  const exList = _exercisesFromPhases(phases);
  if (!exList.length) return;

  const sessionId = new Date().toISOString();
  const date = sessionId.slice(0, 10);
  const newRows = exList.map(ex => ({
    sessionId, date,
    exerciseId:   ex.id,
    exerciseName: ex.name,
    muscleGroup:  ex.muscleGroup,
    tools:        ex.tools
  }));

  if (btn) btn.disabled = true;
  try {
    await apiSave(Api.post('history/append', newRows));
  } catch {
    if (btn) btn.disabled = false;
    return;
  }
  _setHistoryRows([..._historyRows, ...newRows]);
  if (btn) btn.textContent = 'Gespeichert ✓';
}

// ---- Returns exercise IDs done in the last n sessions (for planner) ----
function getRecentlyDoneExerciseIds(n) {
  const ids = new Set();
  _historyData.slice(0, n).forEach(s => s.exercises.forEach(e => ids.add(e.id)));
  return ids;
}

async function deleteWeightHistory(exerciseId) {
  await WeightStore.deleteByExercise(exerciseId);
  renderHistoryScreen();
}

function _buildWeightSectionHTML(weightByEx, titleStyle) {
  const weightExIds = Object.keys(weightByEx).map(Number);
  if (weightExIds.length === 0) return '';
  const cards = weightExIds.map(exId => {
    const exName = exercises.find(e => e.id === exId)?.name || `#${exId}`;
    const entries = weightByEx[exId].slice().sort((a, b) => a.date.localeCompare(b.date));
    const maxKg = Math.max(...entries.map(e => e.weightKg));
    const rows = entries.map(e => `
      <div class="weight-hist-row">
        <span class="weight-hist-date">${_fmtDate(e.date.slice(0, 10))}</span>
        <div class="weight-hist-bar-wrap">
          <div class="weight-hist-bar" style="width:${Math.round(e.weightKg / maxKg * 100)}%"></div>
        </div>
        <span class="weight-hist-val">${e.weightKg} kg</span>
      </div>
    `).join('');
    return `
      <div class="weight-hist-card">
        <div class="weight-hist-name">
          <span>${esc(exName)}</span>
          <button class="weight-hist-delete" onclick="deleteWeightHistory(${exId})" title="Verlauf löschen"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3v1H4v2h1l1 14h12l1-14h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z"/></svg></button>
        </div>
        ${rows}
      </div>
    `;
  }).join('');
  return `
    <h3 class="hist-col-title" style="${titleStyle}">Gewichtsentwicklung</h3>
    <div class="weight-hist-list">${cards}</div>
  `;
}

// ---- Render statistics screen ----
async function renderHistoryScreen() {
  const container = document.getElementById('historyContent');
  if (!container) return;

  if (!_historyData.length) {
    const allWeightEntries = await WeightStore.getAll();
    const weightByEx = {};
    for (const entry of allWeightEntries) {
      if (!weightByEx[entry.exerciseId]) weightByEx[entry.exerciseId] = [];
      weightByEx[entry.exerciseId].push(entry);
    }
    const weightSectionHTML = _buildWeightSectionHTML(weightByEx, 'margin-bottom:12px');
    container.innerHTML = `
      <div style="text-align:center;padding:40px 0 20px">
        <p style="color:var(--text-light);margin-bottom:16px">Noch keine Trainings gespeichert.</p>
      </div>
      ${weightSectionHTML}
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

  // Weight progression section
  const allWeightEntries = await WeightStore.getAll();
  const weightByEx = {};
  for (const entry of allWeightEntries) {
    if (!weightByEx[entry.exerciseId]) weightByEx[entry.exerciseId] = [];
    weightByEx[entry.exerciseId].push(entry);
  }
  const weightSectionHTML = _buildWeightSectionHTML(weightByEx, 'margin-top:20px');

  container.innerHTML = `
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
        ${weightSectionHTML}
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

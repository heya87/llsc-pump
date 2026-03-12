// ============================================================
// FAVOURITES — saved workout plans (CSV-only, no localStorage)
// ============================================================

// Temp storage for the currently-displayed load modal
let _loadedFavs = [];

// ---- CSV serialise ----
function _favouritesToCSV(favs) {
  const rows = ['name,station,slot,exercise_id,exercise_name'];
  for (const fav of favs) {
    for (const e of fav.plan) {
      rows.push([
        _csvEscape(fav.name),
        e.stop + 1,
        e.slot + 1,
        e.exerciseId,
        _csvEscape(e.exerciseName)
      ].join(','));
    }
  }
  return rows.join('\n');
}

// ---- CSV parse ----
function _parseFavouritesCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const byName = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = CSVProvider._parseLine(lines[i]);
    if (cols.length < 5) continue;
    const name = cols[0].trim();
    if (!name) continue;
    const stop = parseInt(cols[1], 10) - 1;
    const slot = parseInt(cols[2], 10) - 1;
    const exerciseId = parseInt(cols[3], 10);
    const exerciseName = cols[4].trim();
    if (isNaN(stop) || isNaN(slot) || isNaN(exerciseId)) continue;
    if (!byName[name]) byName[name] = { name, plan: [] };
    byName[name].plan.push({ stop, slot, exerciseId, exerciseName });
  }
  return Object.values(byName);
}

// ---- Build plan entries for current plan ----
function _currentPlanEntries() {
  return plan.map(p => {
    const ex = exercises.find(e => e.id === p.exerciseId);
    return { stop: p.stop, slot: p.slot, exerciseId: p.exerciseId, exerciseName: ex?.name || '' };
  });
}

// ---- Save current plan to CSV file ----
async function saveFavouriteToFile() {
  readSettings();
  if (plan.length === 0) { alert('Kein Workout geplant.'); return; }

  const name = await _promptFavouriteName();
  if (!name) return;

  const planEntries = _currentPlanEntries();

  if ('showOpenFilePicker' in window) {
    const useExisting = await _promptFileChoice();
    if (useExisting === null) return; // cancelled
    try {
      let handle;
      if (useExisting) {
        [handle] = await window.showOpenFilePicker({
          types: [{ description: 'CSV-Datei', accept: { 'text/csv': ['.csv'] } }]
        });
        // Upgrade to readwrite
        await handle.requestPermission({ mode: 'readwrite' });
      } else {
        handle = await window.showSaveFilePicker({
          suggestedName: 'llsc-favourites.csv',
          types: [{ description: 'CSV-Datei', accept: { 'text/csv': ['.csv'] } }]
        });
      }
      const file = await handle.getFile();
      const existingText = await file.text();
      const favs = _parseFavouritesCSV(existingText);

      const idx = favs.findIndex(f => f.name === name);
      if (idx >= 0) favs[idx].plan = planEntries;
      else favs.push({ name, plan: planEntries });

      const w = await handle.createWritable();
      await w.write(_favouritesToCSV(favs));
      await w.close();
    } catch(e) {
      if (e.name !== 'AbortError') alert('Speichern fehlgeschlagen.');
    }
  } else {
    // Fallback: download a new CSV with just this entry
    const csv = _favouritesToCSV([{ name, plan: planEntries }]);
    const blob = new Blob([csv], { type: 'text/csv' });
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'llsc-favourites.csv'
    }).click();
  }
}

// ---- File choice dialog (existing vs new) ----
// Returns true = existing, false = new, null = cancelled
function _promptFileChoice() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p style="font-weight:700;font-size:16px;margin-bottom:12px">In welche Datei speichern?</p>
        <div class="confirm-btns" style="flex-direction:column;align-items:stretch">
          <button class="btn btn-success" id="favFileExisting">Bestehende Datei erweitern</button>
          <button class="btn btn-outline" id="favFileNew">Neue Datei erstellen</button>
          <button class="btn btn-outline" id="favFileCancel">Abbrechen</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#favFileExisting').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#favFileNew').onclick     = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#favFileCancel').onclick  = () => { overlay.remove(); resolve(null); };
  });
}

// ---- Name prompt dialog ----
function _promptFavouriteName() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p style="font-weight:700;font-size:16px;margin-bottom:12px">Workout speichern</p>
        <input type="text" id="favNameInput" placeholder="Name des Workouts"
          style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px;font-family:inherit;margin-bottom:12px;box-sizing:border-box"
          onkeydown="if(event.key==='Enter')document.getElementById('favNameConfirm').click()">
        <div class="confirm-btns">
          <button class="btn btn-success" id="favNameConfirm">Weiter</button>
          <button class="btn btn-outline" id="favNameCancel">Abbrechen</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('favNameInput')?.focus(), 50);

    overlay.querySelector('#favNameConfirm').onclick = () => {
      const val = document.getElementById('favNameInput').value.trim();
      if (!val) { document.getElementById('favNameInput').style.borderColor = 'var(--danger)'; return; }
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector('#favNameCancel').onclick = () => { overlay.remove(); resolve(null); };
  });
}

// ---- Load favourites from CSV file ----
function loadFavouriteFromFile() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const text = await file.text();
    const favs = _parseFavouritesCSV(text);
    if (!favs.length) { alert('Keine Workouts in der Datei gefunden.'); return; }
    _showLoadModal(favs);
  };
  input.click();
}

// ---- Load modal ----
function _showLoadModal(favs) {
  _loadedFavs = favs;
  document.getElementById('favLoadModal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.id = 'favLoadModal';
  overlay.innerHTML = `
    <div class="confirm-box fav-modal-box">
      <div class="fav-modal-header">
        <span style="font-weight:700;font-size:16px">Favorit laden</span>
        <button class="form-close-btn" onclick="document.getElementById('favLoadModal').remove()">&times;</button>
      </div>
      <div class="fav-modal-list">
        ${favs.map((f, i) => `
          <div class="fav-item">
            <span class="fav-name">${esc(f.name)}</span>
            <button class="btn btn-outline btn-sm" onclick="showFavouritePreview(${i})">Ansehen</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

// ---- Preview ----
function _favSlotHtml(entry) {
  if (!entry) return `<div class="fav-preview-slot">—</div>`;
  const ex = exercises.find(x => x.id === entry.exerciseId) || { name: entry.exerciseName, muscleGroup: '', tools: '' };
  return `<div class="fav-preview-slot filled">
    <div class="fav-preview-slot-content">
      ${muscleBadgeHtml(ex)}${toolBadgeHtml(ex)}
      <span class="fav-preview-slot-name">${esc(ex.name)}</span>
    </div>
  </div>`;
}

function showFavouritePreview(idx) {
  const fav = _loadedFavs[idx];
  if (!fav) return;

  const maxStop = fav.plan.reduce((max, e) => Math.max(max, e.stop), -1);
  const stationsHtml = [];
  for (let s = 0; s <= maxStop; s++) {
    const slot0 = fav.plan.find(e => e.stop === s && e.slot === 0);
    const slot1 = fav.plan.find(e => e.stop === s && e.slot === 1);
    if (!slot0 && !slot1) continue;
    stationsHtml.push(`
      <div class="fav-preview-station">
        <div class="fav-preview-label">Station ${s + 1}</div>
        <div class="fav-preview-slots">
          ${_favSlotHtml(slot0)}
          ${_favSlotHtml(slot1)}
        </div>
      </div>`);
  }

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box fav-preview-box">
      <p style="font-weight:700;font-size:16px;margin-bottom:12px">${esc(fav.name)}</p>
      <div class="fav-preview-grid">${stationsHtml.join('') || '<p class="fav-empty">Keine Stationen</p>'}</div>
      <div class="confirm-btns" style="margin-top:14px">
        <button class="btn btn-success" id="favPreviewLoadBtn">Laden</button>
        <button class="btn btn-outline" onclick="this.closest('.confirm-overlay').remove()">Zurück</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#favPreviewLoadBtn').onclick = () => {
    overlay.remove();
    document.getElementById('favLoadModal')?.remove();
    _doLoadFavourite(fav);
  };
}

// ---- Apply a favourite to the current plan ----
function _doLoadFavourite(fav) {
  const doLoad = () => {
    const unmatched = [];
    plan = [];
    for (const entry of fav.plan) {
      let ex = exercises.find(e => e.id === entry.exerciseId);
      if (!ex) ex = exercises.find(e => e.name === entry.exerciseName);
      if (ex) {
        plan.push({ stop: entry.stop, slot: entry.slot, exerciseId: ex.id });
      } else {
        unmatched.push(entry.exerciseName);
      }
    }
    savePlan();
    renderPool();
    renderStops();
    if (unmatched.length > 0) {
      alert(`Nicht gefunden: ${unmatched.join(', ')}`);
    }
  };
  if (plan.length > 0) {
    showConfirm(`Aktuelles Workout mit "${fav.name}" ersetzen?`, doLoad, () => {});
  } else {
    doLoad();
  }
}

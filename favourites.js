// ============================================================
// FAVOURITES — saved workout plans (server: api/favourites; CSV in backup.js)
// ============================================================

// All favourites of the user: [{ name, plan: [{ stop, slot, exerciseId, exerciseName }] }]
let _favourites = [];
// Favourites shown in the currently-displayed load modal
let _loadedFavs = [];

// ---- Build plan entries for current plan ----
function _currentPlanEntries() {
  return plan.map(p => {
    const ex = exercises.find(e => e.id === p.exerciseId);
    return { stop: p.stop, slot: p.slot, exerciseId: p.exerciseId, exerciseName: ex?.name || '' };
  });
}

// ---- Load all favourites from the server ----
async function loadFavourites() {
  _favourites = await Api.get('favourites');
}

function _saveFavourites() {
  return queuedPut('favourites', _favourites);
}

// ---- Save current plan as favourite (same name replaces) ----
async function saveFavourite() {
  readSettings();
  if (plan.length === 0) { alert('Kein Workout geplant.'); return; }

  const name = await _promptFavouriteName();
  if (!name) return;

  const planEntries = _currentPlanEntries();
  const idx = _favourites.findIndex(f => f.name === name);
  const doSave = () => {
    if (idx >= 0) _favourites[idx].plan = planEntries;
    else _favourites.push({ name, plan: planEntries });
    _saveFavourites();
  };
  if (idx >= 0) showConfirm(`Favorit "${name}" überschreiben?`, doSave, () => {}, 'Überschreiben');
  else doSave();
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

// ---- Favourites modal ----
function openFavourites() {
  _showLoadModal(_favourites);
}

function deleteFavourite(idx) {
  const fav = _favourites[idx];
  if (!fav) return;
  showConfirm(`Favorit "${fav.name}" löschen?`, () => {
    _favourites.splice(idx, 1);
    _saveFavourites();
    openFavourites();
  }, () => {});
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
        <span style="font-weight:700;font-size:16px">Favoriten</span>
        <button class="form-close-btn" onclick="document.getElementById('favLoadModal').remove()">&times;</button>
      </div>
      <div class="fav-modal-list">
        ${favs.map((f, i) => `
          <div class="fav-item">
            <span class="fav-name">${esc(f.name)}</span>
            <button class="btn btn-outline btn-sm" onclick="showFavouritePreview(${i})">Ansehen</button>
            <button class="ex-remove" onclick="deleteFavourite(${i})" title="Löschen">&times;</button>
          </div>
        `).join('') || '<p class="fav-empty">Noch keine Favoriten gespeichert.</p>'}
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

// ============================================================
// PLANNER SCREEN
// ============================================================
function renderPlanner() {
  readSettings();
  renderLegends();
  renderPool();
  renderStops();
}

function renderLegends() {
  const muscles = [...new Set(exercises.flatMap(e => getMuscleGroups(e)))].sort();
  const tools   = [...new Set(exercises.map(e => e.tools).filter(Boolean))].sort();
  renderFilterPanel('legends', muscles, tools, activeMuscleFilters, activeToolFilters, 'toggleMuscleFilter', 'toggleToolFilter', 'resetPlannerFilters');
}

function readSettings() {
  settings.workTime = Math.max(5, parseInt(document.getElementById('settingWork').value, 10) || 45);
  settings.shortBreak = Math.max(5, parseInt(document.getElementById('settingShortBreak').value, 10) || 15);
  settings.longBreak = Math.max(5, parseInt(document.getElementById('settingLongBreak').value, 10) || 60);
  settings.stops = Math.max(1, parseInt(document.getElementById('settingStops').value, 10) || 11);
}

function handleSettingChange() {
  readSettings();
  savePlan();
  updatePlannerTimeEstimate();
}

function updatePlannerTimeEstimate() {
  const el = document.getElementById('plannerTimeEstimate');
  if (!el) return;
  const { totalSec, stationCount } = calculateTotalTrainingSec();
  el.textContent = stationCount > 0
    ? `${stationCount} Stationen · ca. ${Math.ceil(totalSec / 60)} Min.`
    : '';
}

function handleStopsChange(input) {
  const newCount = Math.max(1, parseInt(input.value, 10) || 1);
  const oldCount = settings.stops;

  if (newCount < oldCount) {
    const affectedSlots = plan.filter(p => p.stop >= newCount);
    if (affectedSlots.length > 0) {
      showConfirm(
        `${affectedSlots.length} Übung(en) in Station ${newCount + 1}–${oldCount} werden entfernt. Fortfahren?`,
        () => {
          plan = plan.filter(p => p.stop < newCount);
          settings.stops = newCount;
          savePlan();
          renderPool();
          renderStops();
        },
        () => {
          input.value = oldCount;
        }
      );
      return;
    }
  }

  settings.stops = newCount;
  savePlan();
  renderStops();
}

function renderPool() {
  const pool = document.getElementById('exercisePool');
  const usedIds = new Set(plan.map(p => p.exerciseId));

  const filtered = exercises.filter(ex => {
    if (usedIds.has(ex.id)) return false;
    if (activeMuscleFilters.size > 0 && !getMuscleGroups(ex).some(g => activeMuscleFilters.has(g))) return false;
    if (activeToolFilters.size > 0 && !activeToolFilters.has(ex.tools)) return false;
    return true;
  });

  pool.innerHTML = filtered.map(ex => {
    const isSelected = selectedExerciseId === ex.id;
    const dualBadge = ex.mode === 'switch_per_station' ? '<span class="dual-slot-badge">×2</span>' : '';
    return `<span class="pool-item${isSelected ? ' selected' : ''}" draggable="true" ondragstart="dragFromPool(event,${ex.id})" onclick="handlePoolTap(${ex.id})"${ex.description ? ` title="${esc(ex.description)}"` : ''}>${muscleBadgeHtml(ex)}${toolBadgeHtml(ex)}<span class="pool-item-name">${ex.id}. ${esc(ex.name)}</span>${dualBadge}</span>`;
  }).join('');

  updateSelectionBar();
}

function updateSelectionBar() {
  const bar = document.getElementById('selectionBar');
  const nameEl = document.getElementById('selectionBarName');
  const screen = document.getElementById('screen-planner');
  if (!bar) return;
  if (selectedExerciseId !== null) {
    const ex = exercises.find(e => e.id === selectedExerciseId);
    nameEl.textContent = ex ? (ex.mode === 'switch_per_station' ? `${ex.name} (belegt 2 Slots)` : ex.name) : '';
    bar.classList.add('visible');
    screen.classList.add('bar-visible');
  } else {
    bar.classList.remove('visible');
    screen.classList.remove('bar-visible');
  }
}

function handlePoolTap(id) {
  selectedExerciseId = selectedExerciseId === id ? null : id;
  renderPool();
}

// Check if placing exerciseId at (stop, slot) is blocked by a per-station exercise
function canPlaceAt(stop, slot, exerciseId) {
  const ex = exercises.find(e => e.id === exerciseId);
  const otherSlot = slot === 0 ? 1 : 0;
  const otherEntry = plan.find(p => p.stop === stop && p.slot === otherSlot);
  const otherEx = otherEntry ? exercises.find(e => e.id === otherEntry.exerciseId) : null;

  // Placing a per_station exercise: other slot must be free (unless it's the same exercise already there)
  if (ex && ex.mode === 'switch_per_station' && otherEntry && otherEntry.exerciseId !== exerciseId) return false;
  // Placing into a station that has a per_station exercise in the other slot (different exercise)
  if (otherEx && otherEx.mode === 'switch_per_station' && otherEntry.exerciseId !== exerciseId) return false;

  return true;
}

function placeExercise(stop, slot, exerciseId) {
  const ex = exercises.find(e => e.id === exerciseId);
  if (!canPlaceAt(stop, slot, exerciseId)) {
    alert('Diese Station ist bereits mit einer Doppel\u00fcbung (Seitenwechsel pro Station) belegt.');
    return false;
  }
  plan = plan.filter(p => !(p.stop === stop && p.slot === slot));
  plan.push({ stop, slot, exerciseId });
  // Auto-fill both slots for per_station
  if (ex && ex.mode === 'switch_per_station') {
    const otherSlot = slot === 0 ? 1 : 0;
    plan = plan.filter(p => !(p.stop === stop && p.slot === otherSlot));
    plan.push({ stop, slot: otherSlot, exerciseId });
  }
  return true;
}

function addToNextFreeSlot(id) {
  const ex = exercises.find(e => e.id === id);
  const needsBoth = ex && ex.mode === 'switch_per_station';
  for (let s = 0; s < settings.stops; s++) {
    if (needsBoth) {
      const slot0 = plan.find(p => p.stop === s && p.slot === 0);
      const slot1 = plan.find(p => p.stop === s && p.slot === 1);
      if (!slot0 && !slot1) {
        placeExercise(s, 0, id);
        selectedExerciseId = null;
        savePlan();
        renderPool();
        renderStops();
        return;
      }
    } else {
      for (let sl = 0; sl < 2; sl++) {
        if (!plan.find(p => p.stop === s && p.slot === sl) && canPlaceAt(s, sl, id)) {
          plan.push({ stop: s, slot: sl, exerciseId: id });
          selectedExerciseId = null;
          savePlan();
          renderPool();
          renderStops();
          return;
        }
      }
    }
  }
}

function slotHtml(ex, stop, slot) {
  const dropAttrs = `ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="dropOnSlot(event,${stop},${slot})"`;
  if (!ex) return `<div class="slot" onclick="slotClick(${stop},${slot})" ${dropAttrs}>Slot ${slot + 1}</div>`;
  const sideLabel = ex.mode === 'switch_per_station' ? `<span class="slot-side-label">Seite ${slot + 1}</span>` : '';
  return `<div class="slot filled" draggable="true" ondragstart="dragFromSlot(event,${stop},${slot})" onclick="slotClick(${stop},${slot})"${ex.description ? ` title="${esc(ex.description)}"` : ''} ${dropAttrs}>
    <div class="slot-content">
      ${muscleBadgeHtml(ex)}${toolBadgeHtml(ex)}
      <span class="slot-name">${esc(ex.name)}</span>${sideLabel}
    </div>
    <button class="remove-btn" onclick="event.stopPropagation();removeSlot(${stop},${slot})">&times;</button>
  </div>`;
}

function renderStops() {
  const grid = document.getElementById('stopsGrid');
  grid.innerHTML = '';
  for (let s = 0; s < settings.stops; s++) {
    const row = document.createElement('div');
    row.className = 'stop-row';
    const ex1 = getPlannedExercise(s, 0);
    const ex2 = getPlannedExercise(s, 1);
    const conflict = stationHasMuscleConflict(s);
    row.innerHTML = `
      <div class="stop-label">Station ${s + 1}${conflict ? ' <span class="muscle-warn" title="Gleiche Muskelgruppe wie Nachbarstation">⚠</span>' : ''}</div>
      <div class="stop-slots">
        ${slotHtml(ex1, s, 0)}
        ${slotHtml(ex2, s, 1)}
      </div>
    `;
    grid.appendChild(row);
  }
  updatePlannerTimeEstimate();
}

function isMobile() {
  return window.matchMedia('(max-width: 899px)').matches;
}

function slotClick(stop, slot) {
  if (isMobile()) {
    openMobilePicker(stop, slot);
    return;
  }
  if (selectedExerciseId === null) return;
  if (!placeExercise(stop, slot, selectedExerciseId)) return;
  selectedExerciseId = null;
  savePlan();
  renderPool();
  renderStops();
}

// ============================================================
// MOBILE EXERCISE PICKER
// ============================================================
let pickerStop = null;
let pickerSlot = null;
let pickerSearchText = '';
let pickerMuscleFilters = new Set();
let pickerToolFilters = new Set();

function openMobilePicker(stop, slot) {
  pickerStop = stop;
  pickerSlot = slot;
  pickerSearchText = '';
  document.getElementById('mobilePickerSearch').value = '';
  document.getElementById('mobilePickerTitle').textContent =
    `Station ${stop + 1} · Slot ${slot + 1}`;
  renderPickerFilters();
  renderPickerExercises();
  document.getElementById('mobilePicker').classList.add('visible');
}

function closeMobilePicker() {
  document.getElementById('mobilePicker').classList.remove('visible');
  pickerStop = null;
  pickerSlot = null;
}

function renderPickerFilters() {
  const muscles = [...new Set(exercises.flatMap(e => getMuscleGroups(e)))].sort();
  const tools   = [...new Set(exercises.map(e => e.tools).filter(Boolean))].sort();
  renderFilterPanel('mobilePickerFilters', muscles, tools,
    pickerMuscleFilters, pickerToolFilters,
    'togglePickerMuscleFilter', 'togglePickerToolFilter', 'resetPickerFilters');
}

function renderPickerExercises() {
  const usedIds = new Set(plan.map(p => p.exerciseId));
  // Allow re-picking the exercise already in this slot
  const current = plan.find(p => p.stop === pickerStop && p.slot === pickerSlot);
  if (current) usedIds.delete(current.exerciseId);

  const filtered = exercises.filter(ex => {
    if (usedIds.has(ex.id)) return false;
    if (pickerSearchText && !ex.name.toLowerCase().includes(pickerSearchText)) return false;
    if (pickerMuscleFilters.size > 0 && !getMuscleGroups(ex).some(g => pickerMuscleFilters.has(g))) return false;
    if (pickerToolFilters.size > 0 && !pickerToolFilters.has(ex.tools)) return false;
    return true;
  });

  const meta = ex => [modeLabel(ex.mode), ex.muscleGroup, ex.tools].filter(Boolean).join(' · ');

  document.getElementById('mobilePickerList').innerHTML = filtered.map(ex => `
    <div class="picker-ex-item" onclick="assignFromPicker(${ex.id})">
      ${muscleBadgeHtml(ex)}${toolBadgeHtml(ex)}
      <div>
        <div class="picker-ex-name">${esc(ex.name)}</div>
        ${meta(ex) ? `<div class="picker-ex-meta">${meta(ex)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function assignFromPicker(exerciseId) {
  if (!placeExercise(pickerStop, pickerSlot, exerciseId)) return;
  savePlan();
  renderPool();
  renderStops();
  closeMobilePicker();
}

function togglePickerMuscleFilter(muscle) {
  if (pickerMuscleFilters.has(muscle)) pickerMuscleFilters.delete(muscle);
  else pickerMuscleFilters.add(muscle);
  renderPickerFilters();
  renderPickerExercises();
}

function togglePickerToolFilter(tool) {
  if (pickerToolFilters.has(tool)) pickerToolFilters.delete(tool);
  else pickerToolFilters.add(tool);
  renderPickerFilters();
  renderPickerExercises();
}

function resetPickerFilters() {
  pickerMuscleFilters.clear();
  pickerToolFilters.clear();
  renderPickerFilters();
  renderPickerExercises();
}

function onPickerSearch(val) {
  pickerSearchText = val.trim().toLowerCase();
  renderPickerExercises();
}


function removeSlot(stop, slot) {
  // If this is a per_station exercise, remove both slots
  const entry = plan.find(p => p.stop === stop && p.slot === slot);
  if (entry) {
    const ex = exercises.find(e => e.id === entry.exerciseId);
    if (ex && ex.mode === 'switch_per_station') {
      plan = plan.filter(p => !(p.stop === stop));
    } else {
      plan = plan.filter(p => !(p.stop === stop && p.slot === slot));
    }
  } else {
    plan = plan.filter(p => !(p.stop === stop && p.slot === slot));
  }
  savePlan();
  renderPool();
  renderStops();
}

function clearPlan() {
  plan = [];
  selectedExerciseId = null;
  savePlan();
  renderPool();
  renderStops();
}

function addAllExercises() {
  const usedIds = new Set(plan.map(p => p.exerciseId));
  const available = exercises.filter(e => !usedIds.has(e.id)).sort((a, b) => a.id - b.id);
  for (const ex of available) {
    let placed = false;
    const needsBoth = ex.mode === 'switch_per_station';
    for (let s = 0; s < settings.stops && !placed; s++) {
      if (needsBoth) {
        const slot0 = plan.find(p => p.stop === s && p.slot === 0);
        const slot1 = plan.find(p => p.stop === s && p.slot === 1);
        if (!slot0 && !slot1) {
          plan.push({ stop: s, slot: 0, exerciseId: ex.id });
          plan.push({ stop: s, slot: 1, exerciseId: ex.id });
          placed = true;
        }
      } else {
        for (let sl = 0; sl < 2 && !placed; sl++) {
          if (!plan.find(p => p.stop === s && p.slot === sl) && canPlaceAt(s, sl, ex.id)) {
            plan.push({ stop: s, slot: sl, exerciseId: ex.id });
            placed = true;
          }
        }
      }
    }
    if (!placed) break;
  }
  selectedExerciseId = null;
  savePlan();
  renderPool();
  renderStops();
}

function getPlannedExercise(stop, slot) {
  const entry = plan.find(p => p.stop === stop && p.slot === slot);
  if (!entry) return null;
  return exercises.find(e => e.id === entry.exerciseId) || null;
}

function calculateTotalTrainingSec() {
  const filledStops = [];
  for (let s = 0; s < settings.stops; s++) {
    const ex1 = getPlannedExercise(s, 0);
    const ex2 = getPlannedExercise(s, 1);
    if (ex1 || ex2) filledStops.push({ ex1, ex2 });
  }
  let totalSec = 0;
  for (let i = 0; i < filledStops.length; i++) {
    const st = filledStops[i];
    const exCount = (st.ex1 ? 1 : 0) + (st.ex2 ? 1 : 0);
    totalSec += exCount * settings.workTime;
    if (exCount === 2) totalSec += settings.shortBreak;
    if (i < filledStops.length - 1) totalSec += settings.longBreak;
  }
  return { totalSec, stationCount: filledStops.length };
}

function stationHasMuscleConflict(s) {
  const muscleAt = (stop) => {
    const ex1 = getPlannedExercise(stop, 0);
    const ex2 = getPlannedExercise(stop, 1);
    return [ex1, ex2].flatMap(ex => getMuscleGroups(ex));
  };
  const cur = muscleAt(s);
  if (cur.length === 0) return false;
  const check = (neighbor) => {
    if (neighbor < 0 || neighbor >= settings.stops) return false;
    const nb = muscleAt(neighbor);
    return cur.some(m => nb.includes(m));
  };
  return check(s - 1) || check(s + 1);
}

function savePlan() {
  DataSource.saveWorkout({ plan, settings });
}

// ============================================================
// DRAG & DROP
// ============================================================
function dragFromPool(event, id) {
  event.dataTransfer.setData('text/plain', JSON.stringify({ source: 'pool', exerciseId: id }));
  event.dataTransfer.effectAllowed = 'move';
}

function dragFromSlot(event, stop, slot) {
  event.dataTransfer.setData('text/plain', JSON.stringify({ source: 'slot', stop, slot }));
  event.dataTransfer.effectAllowed = 'move';
  event.stopPropagation();
}

function dropOnSlot(event, targetStop, targetSlot) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  let data;
  try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch(e) { return; }

  if (data.source === 'pool') {
    if (!placeExercise(targetStop, targetSlot, data.exerciseId)) return;
  } else if (data.source === 'slot') {
    if (data.stop === targetStop && data.slot === targetSlot) return;
    const srcEntry = plan.find(p => p.stop === data.stop && p.slot === data.slot);
    const srcEx = srcEntry ? exercises.find(e => e.id === srcEntry.exerciseId) : null;
    const tgtEntry = plan.find(p => p.stop === targetStop && p.slot === targetSlot);
    const tgtEx = tgtEntry ? exercises.find(e => e.id === tgtEntry.exerciseId) : null;
    // Block drag of/onto per_station exercises (too complex to swap)
    if ((srcEx && srcEx.mode === 'switch_per_station') || (tgtEx && tgtEx.mode === 'switch_per_station')) {
      alert('Doppel\u00fcbungen (Seitenwechsel pro Station) k\u00f6nnen nicht per Drag verschoben werden. Bitte entfernen und neu zuweisen.');
      return;
    }
    plan = plan.filter(p =>
      !(p.stop === data.stop && p.slot === data.slot) &&
      !(p.stop === targetStop && p.slot === targetSlot)
    );
    if (srcEntry) plan.push({ stop: targetStop, slot: targetSlot, exerciseId: srcEntry.exerciseId });
    if (tgtEntry) plan.push({ stop: data.stop, slot: data.slot, exerciseId: tgtEntry.exerciseId });
  }

  selectedExerciseId = null;
  savePlan();
  renderPool();
  renderStops();
}

// ============================================================
// PRINT EXPORT
// ============================================================
async function exportStationSheets() {
  readSettings();
  const stations = [];
  for (let s = 0; s < settings.stops; s++) {
    const ex1 = getPlannedExercise(s, 0);
    const ex2 = getPlannedExercise(s, 1);
    if (ex1 || ex2) stations.push({ num: s + 1, ex1, ex2 });
  }
  if (stations.length === 0) { alert('Keine Stationen belegt.'); return; }

  const w = window.open('', '_blank');
  if (!w) { alert('Popup wurde blockiert. Bitte Popups für diese Seite erlauben.'); return; }

  const printImages = {};
  const allEx = stations.flatMap(st => [st.ex1, st.ex2]).filter(Boolean);
  await Promise.all(allEx.map(async ex => {
    printImages[ex.id] = await getExerciseImageUrl(ex.id);
  }));

  function exBlock(ex, label) {
    if (!ex) return `<div class="ex-half empty"><div class="empty-label">${label}: nicht belegt</div></div>`;
    const mGroups = getMuscleGroups(ex);
    const tc = getToolColor(ex.tools);
    const ta = getToolAbbrev(ex.tools);
    const imgUrl = printImages[ex.id];
    return `
      <div class="ex-half">
        <div class="ex-header">
          <div class="ex-title">
            ${mGroups.map(g => `<span class="print-muscle-badge" style="background:${getMuscleColor(g)}">${getToolAbbrev(g)}</span>`).join('')}
            ${ex.tools ? `<span class="print-tool-badge" style="background:${tc}">${ta}</span>` : ''}
            ${esc(ex.name)}
          </div>
          <div class="ex-tags">
            ${mGroups.map(g => `<span class="tag" style="background:${getMuscleColor(g)}20;border-color:${getMuscleColor(g)};color:${getMuscleColor(g)}">${esc(g)}</span>`).join('')}
            ${ex.tools ? `<span class="tag">${esc(ex.tools)}</span>` : ''}
            ${modeLabel(ex.mode) ? `<span class="tag">${modeLabel(ex.mode)}</span>` : ''}
          </div>
        </div>
        ${ex.description ? `<div class="ex-description">${esc(ex.description)}</div>` : ''}
        ${imgUrl
          ? `<div class="ex-image"><img src="${imgUrl}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px"></div>`
          : `<div class="ex-image" style="background:#cbd5e1;"><span class="img-placeholder">Kein Bild</span></div>`}
      </div>
    `;
  }

  const pages = stations.map(st => {
    const isPerStation = st.ex1 && st.ex2 && st.ex1.id === st.ex2.id && st.ex1.mode === 'switch_per_station';
    const label1 = isPerStation ? 'Seite 1' : 'Übung 1';
    const label2 = isPerStation ? 'Seite 2' : 'Übung 2';
    const timingText = isPerStation
      ? `${settings.workTime}s Seite 1 &middot; ${settings.shortBreak}s Seitenwechsel &middot; ${settings.workTime}s Seite 2 &middot; ${settings.longBreak}s Wechsel`
      : `${settings.workTime}s Training &middot; ${settings.shortBreak}s Pause &middot; ${settings.workTime}s Training &middot; ${settings.longBreak}s Wechsel`;
    return `
    <div class="page">
      <div class="station-header">Station ${st.num}</div>
      <div class="station-timing">${timingText}</div>
      <div class="exercises">
        ${exBlock(st.ex1, label1)}
        <div class="divider"></div>
        ${exBlock(st.ex2, label2)}
      </div>
    </div>
  `;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Stationen – Druckansicht</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; }

  .page {
    width: 100%;
    height: 277mm;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }

  .station-header {
    font-size: 28px;
    font-weight: 800;
    text-align: center;
    padding: 8px 0 2px;
  }
  .station-timing {
    text-align: center;
    font-size: 12px;
    color: #64748b;
    padding-bottom: 8px;
    border-bottom: 2px solid #e2e8f0;
  }

  .exercises {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .divider {
    height: 2px;
    background: #e2e8f0;
    flex-shrink: 0;
  }

  .ex-half {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 10px 0;
    min-height: 0;
  }
  .ex-half.empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-label {
    color: #94a3b8;
    font-size: 16px;
    font-style: italic;
  }

  .ex-header {
    flex-shrink: 0;
  }
  .ex-title {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .print-muscle-badge {
    width: 30px; height: 30px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }
  .print-tool-badge {
    width: 30px; height: 30px;
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }
  .ex-tags {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .tag {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 2px 10px;
    font-size: 11px;
    color: #64748b;
  }
  .ex-description {
    font-size: 14px;
    color: #475569;
    line-height: 1.4;
    margin-bottom: 8px;
    flex-shrink: 0;
  }
  .ex-image {
    flex: 1;
    min-height: 60px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .img-placeholder {
    color: #94a3b8;
    font-size: 18px;
    font-weight: 600;
  }

  @media screen {
    body { background: #e2e8f0; padding: 20px; }
    .page {
      background: white;
      width: 210mm;
      margin: 0 auto 20px;
      padding: 12mm;
      box-shadow: 0 2px 12px rgba(0,0,0,.15);
      border-radius: 4px;
    }
    .print-hint {
      text-align: center;
      padding: 12px;
      font-size: 14px;
      color: #64748b;
      margin-bottom: 16px;
    }
    .print-hint button {
      background: #2563eb; color: white; border: none;
      padding: 10px 24px; border-radius: 8px; font-size: 15px;
      font-weight: 600; cursor: pointer; margin-left: 8px;
    }
  }
  @media print {
    .print-hint { display: none; }
  }
</style>
</head>
<body>
  <div class="print-hint">
    Vorschau der Stationsblätter
    <button onclick="window.print()">Drucken / PDF</button>
  </div>
  ${pages}
</body>
</html>`;

  w.document.write(html);
  w.document.close();
}

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
  const muscles = [...new Set(exercises.map(e => e.muscleGroup).filter(Boolean))].sort();
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
    if (activeMuscleFilters.size > 0 && !activeMuscleFilters.has(ex.muscleGroup)) return false;
    if (activeToolFilters.size > 0 && !activeToolFilters.has(ex.tools)) return false;
    return true;
  });

  pool.innerHTML = filtered.map(ex => {
    const isSelected = selectedExerciseId === ex.id;
    return `<span class="pool-item${isSelected ? ' selected' : ''}" onclick="handlePoolTap(${ex.id})">${muscleBadgeHtml(ex)}${toolBadgeHtml(ex)}<span class="pool-item-name">${ex.id}. ${esc(ex.name)}</span></span>`;
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
    nameEl.textContent = ex ? ex.name : '';
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

function addToNextFreeSlot(id) {
  for (let s = 0; s < settings.stops; s++) {
    for (let sl = 0; sl < 2; sl++) {
      if (!plan.find(p => p.stop === s && p.slot === sl)) {
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

function slotHtml(ex, stop, slot) {
  if (!ex) return `<div class="slot" onclick="slotClick(${stop},${slot})">Slot ${slot + 1}</div>`;
  return `<div class="slot filled" onclick="slotClick(${stop},${slot})">
    <div class="slot-content">
      ${muscleBadgeHtml(ex)}${toolBadgeHtml(ex)}
      <span class="slot-name">${esc(ex.name)}</span>
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
    row.innerHTML = `
      <div class="stop-label">Station ${s + 1}</div>
      <div class="stop-slots">
        ${slotHtml(ex1, s, 0)}
        ${slotHtml(ex2, s, 1)}
      </div>
    `;
    grid.appendChild(row);
  }
}

function slotClick(stop, slot) {
  if (selectedExerciseId === null) return;
  plan = plan.filter(p => !(p.stop === stop && p.slot === slot));
  plan.push({ stop, slot, exerciseId: selectedExerciseId });
  selectedExerciseId = null;
  savePlan();
  renderPool();
  renderStops();
}

function removeSlot(stop, slot) {
  plan = plan.filter(p => !(p.stop === stop && p.slot === slot));
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
    for (let s = 0; s < settings.stops && !placed; s++) {
      for (let sl = 0; sl < 2 && !placed; sl++) {
        if (!plan.find(p => p.stop === s && p.slot === sl)) {
          plan.push({ stop: s, slot: sl, exerciseId: ex.id });
          placed = true;
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

function savePlan() {
  DataSource.saveWorkout({ plan, settings });
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

  const printImages = {};
  const allEx = stations.flatMap(st => [st.ex1, st.ex2]).filter(Boolean);
  await Promise.all(allEx.map(async ex => {
    printImages[ex.id] = await getExerciseImageUrl(ex.id);
  }));

  function exBlock(ex, label) {
    if (!ex) return `<div class="ex-half empty"><div class="empty-label">${label}: nicht belegt</div></div>`;
    const mc = getMuscleColor(ex.muscleGroup);
    const tc = getToolColor(ex.tools);
    const ta = getToolAbbrev(ex.tools);
    const ma = getToolAbbrev(ex.muscleGroup);
    const imgUrl = printImages[ex.id];
    return `
      <div class="ex-half">
        <div class="ex-header">
          <div class="ex-title">
            ${ex.muscleGroup ? `<span class="print-muscle-badge" style="background:${mc}">${ma}</span>` : ''}
            ${ex.tools ? `<span class="print-tool-badge" style="background:${tc}">${ta}</span>` : ''}
            ${esc(ex.name)}
          </div>
          <div class="ex-tags">
            ${ex.muscleGroup ? `<span class="tag" style="background:${mc}20;border-color:${mc};color:${mc}">${esc(ex.muscleGroup)}</span>` : ''}
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

  const pages = stations.map(st => `
    <div class="page">
      <div class="station-header">Station ${st.num}</div>
      <div class="station-timing">${settings.workTime}s Training &middot; ${settings.shortBreak}s Pause &middot; ${settings.workTime}s Training &middot; ${settings.longBreak}s Wechsel</div>
      <div class="exercises">
        ${exBlock(st.ex1, 'Übung 1')}
        <div class="divider"></div>
        ${exBlock(st.ex2, 'Übung 2')}
      </div>
    </div>
  `).join('');

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

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

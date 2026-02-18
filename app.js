// ============================================================
// APP STATE
// ============================================================
let exercises = [];
let selectedExerciseId = null;
let plan = []; // array of { stop: number, slot: 0|1, exerciseId: number }
let settings = {
  workTime: 45,
  shortBreak: 15,
  longBreak: 60,
  stops: 11
};

// Training state
let trainingRunning = false;
let trainingPaused = false;
let trainingTimer = null;
let wakeLock = null;

// Form image state
let pendingImageData = null;
let pendingImageRemove = false;

// Planner filter state
let activeMuscleFilters = new Set();
let activeToolFilters = new Set();

// Import filter state
let importSearchText = '';
let importMuscleFilters = new Set();
let importToolFilters = new Set();

function toggleMuscleFilter(muscle) {
  if (activeMuscleFilters.has(muscle)) activeMuscleFilters.delete(muscle);
  else activeMuscleFilters.add(muscle);
  renderLegends();
  renderPool();
}

function toggleToolFilter(tool) {
  if (activeToolFilters.has(tool)) activeToolFilters.delete(tool);
  else activeToolFilters.add(tool);
  renderLegends();
  renderPool();
}

function resetPlannerFilters() {
  activeMuscleFilters.clear();
  activeToolFilters.clear();
  renderLegends();
  renderPool();
}

function onImportSearch(val) {
  importSearchText = val.trim().toLowerCase();
  renderImportedExercises();
}

function toggleImportMuscleFilter(muscle) {
  if (importMuscleFilters.has(muscle)) importMuscleFilters.delete(muscle);
  else importMuscleFilters.add(muscle);
  renderImportedExercises();
}

function toggleImportToolFilter(tool) {
  if (importToolFilters.has(tool)) importToolFilters.delete(tool);
  else importToolFilters.add(tool);
  renderImportedExercises();
}

function renderImportFilters() {
  const section = document.getElementById('importFilterSection');
  if (!section) return;
  if (exercises.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  const muscles = [...new Set(exercises.map(e => e.muscleGroup).filter(Boolean))].sort();
  const tools   = [...new Set(exercises.map(e => e.tools).filter(Boolean))].sort();
  renderFilterPanel('importFilterChips', muscles, tools, importMuscleFilters, importToolFilters, 'toggleImportMuscleFilter', 'toggleImportToolFilter', 'resetImportFilters');
}

function resetImportFilters() {
  importMuscleFilters.clear();
  importToolFilters.clear();
  renderImportedExercises();
}

// ============================================================
// NAVIGATION
// ============================================================
function showScreen(name) {
  if (trainingRunning && name !== 'training') {
    showConfirm(
      'Das Training läuft gerade. Beim Wechseln geht der Fortschritt verloren.',
      () => { stopTraining(); _doShowScreen(name); },
      () => {},
      'Training abbrechen',
      'Weiter trainieren'
    );
    return;
  }
  _doShowScreen(name);
}

function _doShowScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.getElementById('nav' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');

  if (name === 'planner') renderPlanner();
  if (name === 'training') renderTrainingSetup();
}

function enableNav() {
  document.getElementById('navPlanner').disabled = exercises.length === 0;
  document.getElementById('navTraining').disabled = exercises.length === 0;
}

// ============================================================
// IMPORT SCREEN
// ============================================================
const csvFileInput = document.getElementById('csvFileInput');

csvFileInput.addEventListener('change', e => {
  handleImportFiles(e.target.files);
  e.target.value = '';
});
document.getElementById('folderInput').addEventListener('change', e => {
  handleImportFiles(e.target.files);
  e.target.value = '';
});

// Save settings when timing inputs change
document.getElementById('settingWork').addEventListener('change', handleSettingChange);
document.getElementById('settingShortBreak').addEventListener('change', handleSettingChange);
document.getElementById('settingLongBreak').addEventListener('change', handleSettingChange);

async function handleImportFiles(fileList) {
  const files = Array.from(fileList);
  const csvFile = files.find(f => f.name.toLowerCase().endsWith('.csv'));
  const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.name));

  if (csvFile) {
    const text = await readFileAsText(csvFile);
    exercises = CSVProvider.loadFromText(text);
  }

  let imgCount = 0;
  for (const imgFile of imageFiles) {
    const baseName = imgFile.name.replace(/\.[^.]+$/, '');
    const id = parseInt(baseName, 10);
    if (!id || isNaN(id)) continue;
    const dataUrl = await resizeImage(imgFile, 800);
    await ImageStore.save(id, dataUrl);
    imgCount++;
  }

  if (imgCount > 0 || csvFile) {
    renderImportedExercises();
    enableNav();
  }
}

function readFileAsText(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsText(file);
  });
}

// ============================================================
// EXERCISE LIST RENDERING
// ============================================================
async function renderImportedExercises() {
  document.getElementById('actionRow').style.display = exercises.length > 0 ? 'flex' : 'none';

  const imgMap = await ImageStore.getAll();

  renderImportFilters();

  const filtered = exercises.filter(ex => {
    if (importSearchText && !ex.name.toLowerCase().includes(importSearchText)) return false;
    if (importMuscleFilters.size > 0 && !importMuscleFilters.has(ex.muscleGroup)) return false;
    if (importToolFilters.size > 0 && !importToolFilters.has(ex.tools)) return false;
    return true;
  });

  const list = document.getElementById('importedList');
  const countLabel = filtered.length < exercises.length
    ? `${filtered.length} / ${exercises.length}`
    : `${exercises.length}`;
  const countRow = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:11px;color:var(--text-light)">${countLabel}</span>
      <button class="btn btn-danger btn-sm" onclick="removeAllExercises()">Alle entfernen</button>
    </div>`;
  list.innerHTML = countRow + filtered.map(ex => {
    const hasImg = !!imgMap[ex.id];
    return `
    <div class="exercise-item">
      <div class="ex-num">${ex.id}</div>
      ${hasImg
        ? `<img class="ex-img-thumb" src="${imgMap[ex.id]}" alt="${esc(ex.name)}">`
        : `<div class="ex-no-img" id="filethumb-${ex.id}">—</div>`}
      <div class="ex-info">
        <div class="ex-name">${esc(ex.name)}</div>
        ${ex.description ? `<div class="ex-desc">${esc(ex.description)}</div>` : ''}
        <div class="ex-meta">
          ${ex.mode ? ex.mode : ''}
          ${ex.tools ? ' | ' + ex.tools : ''}
          ${ex.muscleGroup ? ' | ' + ex.muscleGroup : ''}
        </div>
      </div>
      <div class="ex-actions">
        <button class="ex-edit" onclick="editExercise(${ex.id})" title="Bearbeiten">&#9998;</button>
        <button class="ex-remove" onclick="removeExercise(${ex.id})" title="Entfernen">&times;</button>
      </div>
    </div>`;
  }).join('');

  filtered.filter(ex => !imgMap[ex.id]).forEach(ex => {
    const el = document.getElementById('filethumb-' + ex.id);
    if (!el) return;
    tryLoadFileImage(ex.id, url => {
      el.outerHTML = `<img class="ex-img-thumb" src="${url}" alt="${esc(ex.name)}">`;
    });
  });
}

// ============================================================
// EXERCISE FORM (ADD / EDIT)
// ============================================================
function getNextId() {
  if (exercises.length === 0) return 1;
  return Math.max(...exercises.map(e => e.id)) + 1;
}

function openExerciseForm() {
  resetForm();
  document.getElementById('formOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('addName').focus(), 50);
}

function closeExerciseForm() {
  document.getElementById('formOverlay').style.display = 'none';
  resetForm();
}

function handleFormOverlayClick(e) {
  if (e.target === document.getElementById('formOverlay')) closeExerciseForm();
}

function resetForm() {
  document.getElementById('editId').value = '';
  document.getElementById('addName').value = '';
  document.getElementById('addDesc').value = '';
  document.getElementById('addMode').selectedIndex = 0;
  document.getElementById('addTools').value = '';
  document.getElementById('addMuscle').value = '';
  document.getElementById('formTitle').textContent = 'Übung hinzufügen';
  document.getElementById('formSubmitBtn').textContent = 'Hinzufügen';
  resetFormImage();
}

async function submitExerciseForm() {
  const name = document.getElementById('addName').value.trim();
  if (!name) { document.getElementById('addName').focus(); return; }


  const editId = parseInt(document.getElementById('editId').value, 10);
  let targetId;

  if (editId) {
    const ex = exercises.find(e => e.id === editId);
    if (ex) {
      ex.name = name;
      ex.description = document.getElementById('addDesc').value.trim();
      ex.mode = document.getElementById('addMode').value;
      ex.tools = document.getElementById('addTools').value.trim();
      ex.muscleGroup = document.getElementById('addMuscle').value.trim();
    }
    targetId = editId;
  } else {
    targetId = getNextId();
    exercises.push({
      id: targetId,
      name: name,
      description: document.getElementById('addDesc').value.trim(),
      mode: document.getElementById('addMode').value,
      tools: document.getElementById('addTools').value.trim(),
      muscleGroup: document.getElementById('addMuscle').value.trim(),
      image: null
    });
  }

  if (pendingImageData) {
    await ImageStore.save(targetId, pendingImageData);
  } else if (pendingImageRemove) {
    await ImageStore.remove(targetId);
  }

  saveExercises();
  renderImportedExercises();
  enableNav();
  closeExerciseForm();
}

async function editExercise(id) {
  const ex = exercises.find(e => e.id === id);
  if (!ex) return;
  document.getElementById('editId').value = ex.id;
  document.getElementById('addName').value = ex.name;
  document.getElementById('addDesc').value = ex.description;
  document.getElementById('addMode').value = ex.mode || 'kein wechsel';
  document.getElementById('addTools').value = ex.tools;
  document.getElementById('addMuscle').value = ex.muscleGroup;
  document.getElementById('formTitle').textContent = 'Übung bearbeiten (#' + ex.id + ')';
  document.getElementById('formSubmitBtn').textContent = 'Speichern';

  resetFormImage();
  const imgUrl = await getExerciseImageUrl(ex.id);
  if (imgUrl) {
    document.getElementById('imagePreviewImg').src = imgUrl;
    document.getElementById('imagePreview').style.display = '';
    document.getElementById('imageUploadBtns').style.display = 'none';
  }

  document.getElementById('formOverlay').style.display = 'flex';
}

function cancelEdit() {
  closeExerciseForm();
}

function removeExercise(id) {
  ImageStore.remove(id);
  plan = plan.filter(p => p.exerciseId !== id);
  exercises = exercises.filter(e => e.id !== id);
  saveExercises();
  savePlan();
  renderImportedExercises();
  enableNav();
}

function removeAllExercises() {
  showConfirm('Alle Übungen, Bilder und den aktuellen Plan entfernen?', async () => {
    for (const ex of exercises) await ImageStore.remove(ex.id);
    exercises = [];
    plan = [];
    saveExercises();
    savePlan();
    renderImportedExercises();
    enableNav();
  }, () => {});
}

function saveExercises() {
  localStorage.setItem('csv_exercises', JSON.stringify(exercises));
  CSVProvider._exercises = exercises;
}

// ============================================================
// IMPORT / EXPORT DIALOGS
// ============================================================
function showImportDialog() {
  showChoiceDialog('Importieren', [
    { label: 'Dateien auswählen (CSV + Bilder)', action: () => document.getElementById('csvFileInput').click() },
    { label: 'Ordner wählen', action: () => document.getElementById('folderInput').click() },
  ]);
}

function showExportDialog() {
  showChoiceDialog('Exportieren als', [
    { label: 'CSV exportieren', action: exportCSV },
    { label: 'ZIP exportieren (mit Bildern)', action: exportZIP },
  ]);
}

// ============================================================
// CSV / ZIP EXPORT
// ============================================================
function exportCSV() {
  const csv = buildCSVString();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'exercises.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function exportZIP() {
  const files = [];

  const csvStr = buildCSVString();
  files.push({ name: 'exercises.csv', data: new TextEncoder().encode(csvStr) });

  const imgMap = await ImageStore.getAll();
  for (const [id, dataUrl] of Object.entries(imgMap)) {
    if (!dataUrl) continue;
    const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
    files.push({ name: id + '.' + ext, data: dataUrlToUint8Array(dataUrl) });
  }

  const zipData = createZip(files);
  const blob = new Blob([zipData], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'training.zip';
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// FORM IMAGE HANDLING
// ============================================================
function handleImageSelect(input) {
  const file = input.files[0];
  if (!file) return;
  resizeImage(file, 800).then(dataUrl => {
    pendingImageData = dataUrl;
    pendingImageRemove = false;
    document.getElementById('imagePreviewImg').src = dataUrl;
    document.getElementById('imagePreview').style.display = '';
    document.getElementById('imageUploadBtns').style.display = 'none';
  });
  input.value = '';
}

function removeFormImage() {
  pendingImageData = null;
  pendingImageRemove = true;
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('imagePreviewImg').src = '';
  document.getElementById('imageUploadBtns').style.display = '';
}

function resetFormImage() {
  pendingImageData = null;
  pendingImageRemove = false;
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('imagePreviewImg').src = '';
  document.getElementById('imageUploadBtns').style.display = '';
}

// ============================================================
// INIT — restore from localStorage
// ============================================================
(async function init() {
  await ImageStore.open();

  exercises = CSVProvider.getExercises();
  if (exercises.length > 0) {
    renderImportedExercises();
    enableNav();
  }

  const saved = CSVProvider.loadWorkout();
  if (saved) {
    plan = saved.plan || [];
    if (saved.settings) {
      settings = { ...settings, ...saved.settings };
      document.getElementById('settingWork').value = settings.workTime;
      document.getElementById('settingShortBreak').value = settings.shortBreak;
      document.getElementById('settingLongBreak').value = settings.longBreak;
      document.getElementById('settingStops').value = settings.stops;
    }
  }
})();

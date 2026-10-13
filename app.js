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

  const muscles = [...new Set(exercises.flatMap(e => getMuscleGroups(e)))].sort();
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
  if (name === 'stats') renderHistoryScreen();
  if (name !== 'planner') {
    document.getElementById('selectionBar').classList.remove('visible');
    document.getElementById('screen-planner').classList.remove('bar-visible');
  }
}

function enableNav() {
  document.getElementById('navPlanner').disabled = exercises.length === 0;
  document.getElementById('navTraining').disabled = exercises.length === 0;
}

// ============================================================
// IMPORT SCREEN
// ============================================================
// ============================================================
// EXERCISE LIST RENDERING
// ============================================================
async function renderImportedExercises() {
  const imgMap = await ImageStore.getAll();

  renderImportFilters();

  const filtered = exercises.filter(ex => {
    if (importSearchText && !ex.name.toLowerCase().includes(importSearchText)) return false;
    if (importMuscleFilters.size > 0 && !getMuscleGroups(ex).some(g => importMuscleFilters.has(g))) return false;
    if (importToolFilters.size > 0 && !importToolFilters.has(ex.tools)) return false;
    return true;
  });

  const list = document.getElementById('importedList');
  const countLabel = filtered.length < exercises.length
    ? `${filtered.length} / ${exercises.length}`
    : `${exercises.length}`;
  const countRow = exercises.length > 0 ? `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:11px;color:var(--text-light)">${countLabel}</span>
      <button class="btn btn-danger btn-sm" onclick="removeAllExercises()">Alle entfernen</button>
    </div>` : '';
  list.innerHTML = countRow + filtered.map(ex => {
    const hasImg = !!imgMap[ex.id];
    return `
    <div class="exercise-item">
      <div class="ex-num">${ex.id}</div>
      ${hasImg
        ? `<img class="ex-img-thumb" src="${imgMap[ex.id]}" alt="${esc(ex.name)}">`
        : `<div class="ex-no-img">—</div>`}
      <div class="ex-info">
        <div class="ex-name">${esc(ex.name)}</div>
        ${ex.description ? `<div class="ex-desc">${esc(ex.description)}</div>` : ''}
        <div class="ex-meta">
          ${modeLabel(ex.mode)}
          ${ex.tools ? ' | ' + ex.tools : ''}
          ${ex.muscleGroup ? ' | ' + ex.muscleGroup : ''}
          ${ex.hasWeight ? ' | ⚖️ Gewicht' : ''}
        </div>
      </div>
      <div class="ex-actions">
        <button class="ex-edit" onclick="editExercise(${ex.id})" title="Bearbeiten">&#9998;</button>
        <button class="ex-remove" onclick="removeExercise(${ex.id})" title="Entfernen">&times;</button>
      </div>
    </div>`;
  }).join('');
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
  document.getElementById('addHasWeight').checked = false;
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
      ex.hasWeight = document.getElementById('addHasWeight').checked;
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
      hasWeight: document.getElementById('addHasWeight').checked,
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
  document.getElementById('addMode').value = ex.mode || 'no_switch';
  document.getElementById('addTools').value = ex.tools;
  document.getElementById('addMuscle').value = ex.muscleGroup;
  document.getElementById('addHasWeight').checked = !!ex.hasWeight;
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
  ExerciseStore.saveExercises(exercises);
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
// INIT — load the user's data from the server
// ============================================================
(async function init() {
  let saved;
  try {
    [exercises, saved] = await Promise.all([
      ExerciseStore.load(),
      ExerciseStore.loadWorkout(),
      ImageStore.load(),
      WeightStore.load(),
      loadHistory(),
      loadFavourites()
    ]);
  } catch (e) {
    console.error(e);
    alert('Daten konnten nicht vom Server geladen werden. Bitte Seite neu laden.');
    return;
  }

  // Migrate old German mode values to English identifiers
  let migrated = false;
  exercises = exercises.map(ex => {
    const newMode = normalizeMode(ex.mode);
    if (newMode !== ex.mode) migrated = true;
    return { ...ex, mode: newMode };
  });
  if (migrated) saveExercises();

  if (exercises.length > 0) {
    renderImportedExercises();
    enableNav();
  }

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

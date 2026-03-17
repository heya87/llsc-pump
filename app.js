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

// ============================================================
// NAVIGATION
// ============================================================
function showScreen(name) {
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
const importZone = document.getElementById('importZone');
const csvFileInput = document.getElementById('csvFileInput');

importZone.addEventListener('click', () => csvFileInput.click());
importZone.addEventListener('dragover', e => { e.preventDefault(); importZone.classList.add('dragover'); });
importZone.addEventListener('dragleave', () => importZone.classList.remove('dragover'));
importZone.addEventListener('drop', e => {
  e.preventDefault();
  importZone.classList.remove('dragover');
  handleImportFiles(e.dataTransfer.files);
});
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
    const parts = [];
    if (csvFile) parts.push(exercises.length + ' Übungen');
    if (imgCount > 0) parts.push(imgCount + ' Bilder');
    const badge = document.getElementById('exerciseCountBadge');
    badge.style.display = 'block';
    badge.textContent = parts.join(' + ') + ' geladen';
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
  const badge = document.getElementById('exerciseCountBadge');
  badge.style.display = exercises.length > 0 ? 'block' : 'none';
  badge.textContent = exercises.length + ' Übungen geladen';

  document.getElementById('actionRow').style.display = exercises.length > 0 ? 'flex' : 'none';

  const imgMap = await ImageStore.getAll();

  const list = document.getElementById('importedList');
  list.innerHTML = exercises.map(ex => {
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

  exercises.filter(ex => !imgMap[ex.id]).forEach(ex => {
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

function resetForm() {
  document.getElementById('editId').value = '';
  document.getElementById('addName').value = '';
  document.getElementById('addDesc').value = '';
  document.getElementById('addMode').selectedIndex = 0;
  document.getElementById('addTools').value = '';
  document.getElementById('addMuscle').value = '';
  document.getElementById('formTitle').textContent = 'Übung hinzufügen';
  document.getElementById('formSubmitBtn').textContent = 'Hinzufügen';
  document.getElementById('formCancelBtn').style.display = 'none';
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
  resetForm();
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
  document.getElementById('formCancelBtn').style.display = '';

  resetFormImage();
  const imgUrl = await getExerciseImageUrl(ex.id);
  if (imgUrl) {
    document.getElementById('imagePreviewImg').src = imgUrl;
    document.getElementById('imagePreview').style.display = '';
    document.getElementById('imageUploadBtns').style.display = 'none';
  }

  document.getElementById('addForm').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  resetForm();
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

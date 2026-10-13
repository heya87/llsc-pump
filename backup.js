// ============================================================
// BACKUP — file import/export (CSV, ZIP), "Daten" screen
// Day-to-day data lives on the server; this is only for backups
// and moving data in/out (e.g. from the old browser-only version).
// ============================================================

// ---- Generic CSV helpers ----
function csvEscape(val, delimiter = ';') {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Split CSV text into logical rows, respecting quoted fields that span multiple lines
function csvSplitRows(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++; // skip \r in \r\n
      const row = current.trim();
      if (row) rows.push(row);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) rows.push(current.trim());
  return rows;
}

function csvParseLine(line, delimiter = ';') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function downloadFile(data, filename, type) {
  const blob = new Blob([data], { type });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function readFileAsText(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsText(file);
  });
}

// ============================================================
// EXERCISES (CSV + images, ZIP)
// ============================================================
function parseExercisesCSV(text) {
  const lines = csvSplitRows(text);
  if (lines.length < 2) return [];

  const exercises = [];
  const seenIds = new Set();
  const duplicateIds = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = csvParseLine(lines[i]);
    const num = parseInt(cols[0], 10);
    const name = (cols[1] || '').trim();
    if (!name) continue;

    const id = num || i;
    if (seenIds.has(id)) {
      duplicateIds.push(id);
      continue;
    }
    seenIds.add(id);

    exercises.push({
      id,
      name: name,
      description: (cols[2] || '').trim(),
      mode: normalizeMode((cols[3] || '').trim()),
      tools: (cols[4] || '').trim(),
      muscleGroup: (cols[5] || '').trim(),
      hasWeight: (cols[6] || '').trim() === '1',
      image: null
    });
  }
  if (duplicateIds.length > 0) {
    alert('Doppelte IDs in CSV übersprungen: ' + duplicateIds.join(', '));
  }
  return exercises;
}

function buildExercisesCSV() {
  const header = 'id;name;description;mode;tools;muscleGroup;hasWeight';
  const rows = exercises.map(ex =>
    [ex.id, csvEscape(ex.name), csvEscape(ex.description), csvEscape(ex.mode), csvEscape(ex.tools), csvEscape(ex.muscleGroup), ex.hasWeight ? '1' : '0'].join(';')
  );
  return [header, ...rows].join('\n');
}

document.getElementById('csvFileInput').addEventListener('change', e => {
  importExerciseFiles(e.target.files);
  e.target.value = '';
});
document.getElementById('folderInput').addEventListener('change', e => {
  importExerciseFiles(e.target.files);
  e.target.value = '';
});

// CSV replaces all exercises; images (named {id}.jpg etc.) are added/replaced
async function importExerciseFiles(fileList) {
  const files = Array.from(fileList);
  const csvFile = files.find(f => f.name.toLowerCase().endsWith('.csv'));
  const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.name));
  if (!csvFile && !imageFiles.length) { alert('Keine CSV-Datei oder Bilder gefunden.'); return; }

  const doImport = async () => {
    let exCount = 0;
    if (csvFile) {
      exercises = parseExercisesCSV(await readFileAsText(csvFile));
      ExerciseStore.saveExercises(exercises);
      exCount = exercises.length;
    }

    let imgCount = 0;
    for (const imgFile of imageFiles) {
      const id = parseInt(imgFile.name.replace(/\.[^.]+$/, ''), 10);
      if (!id || isNaN(id)) continue;
      await ImageStore.save(id, await resizeImage(imgFile, 800));
      imgCount++;
    }

    renderImportedExercises();
    enableNav();
    alert(`Importiert: ${exCount} Übungen, ${imgCount} Bilder.`);
  };

  if (csvFile && exercises.length > 0) {
    showConfirm(`Alle ${exercises.length} bestehenden Übungen durch die CSV ersetzen?`, doImport, () => {}, 'Ersetzen');
  } else {
    doImport();
  }
}

function exportExercisesCSV() {
  downloadFile(buildExercisesCSV(), 'exercises.csv', 'text/csv;charset=utf-8;');
}

async function exportExercisesZIP() {
  const files = [{ name: 'exercises.csv', data: new TextEncoder().encode(buildExercisesCSV()) }];
  const imgMap = await ImageStore.getAll();
  for (const id of Object.keys(imgMap)) {
    const data = await ImageStore.getBytes(id);
    if (data) files.push({ name: id + '.jpg', data });
  }
  downloadFile(createZip(files), 'training.zip', 'application/zip');
}

function showImportHelp() {
  const csvExample = `id;name;description;mode;tools;muscleGroup;hasWeight
1;Liegestütze;Arme schulterbreit;no_switch;;Brust;0
2;Ausfallschritt;Links/rechts wechseln;switch_per_exercise;;Beine;0
3;Einbeiniges Kreuzheben;;switch_per_station;Kettlebell;Beine;1
4;Schulterdrücken;;no_switch;Kettlebell;Schulter;1`;

  const td = 'padding:4px 8px;border:1px solid var(--border)';
  const th = td + ';font-weight:600;background:var(--bg)';

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box" style="max-width:480px;max-height:80vh;overflow-y:auto">
      <p style="font-weight:600;margin-bottom:12px;font-size:16px">CSV-Import Format</p>
      <p style="font-size:13px;margin-bottom:8px">Erste Zeile = Header, danach eine Zeile pro Übung:</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">
        <tr><th style="${th}">Spalte</th><th style="${th}">Typ</th><th style="${th}">Beschreibung</th></tr>
        <tr><td style="${td}">id</td><td style="${td}">Zahl</td><td style="${td}">Eindeutige Nummer</td></tr>
        <tr><td style="${td}">name</td><td style="${td}">Text</td><td style="${td}">Name der Übung *</td></tr>
        <tr><td style="${td}">description</td><td style="${td}">Text</td><td style="${td}">Beschreibung (optional)</td></tr>
        <tr><td style="${td}">mode</td><td style="${td}"><code style="font-size:11px">no_switch</code><br><code style="font-size:11px">switch_per_exercise</code><br><code style="font-size:11px">switch_per_station</code></td><td style="${td}">Kein Wechsel / Seitenwechsel pro Übung (halbe Zeit) / Seitenwechsel pro Station (belegt beide Slots)</td></tr>
        <tr><td style="${td}">tools</td><td style="${td}">Text</td><td style="${td}">Gerät (z.B. Kettlebell)</td></tr>
        <tr><td style="${td}">muscleGroup</td><td style="${td}">Text</td><td style="${td}">Muskelgruppe (z.B. Schulter)</td></tr>
        <tr><td style="${td}">hasWeight</td><td style="${td}"><code style="font-size:11px">0</code> / <code style="font-size:11px">1</code></td><td style="${td}">Gewicht tracken (1 = ja, 0 = nein, optional)</td></tr>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <p style="font-size:13px;font-weight:600">Beispiel:</p>
        <button class="btn btn-outline btn-sm" id="copyBtn">Kopieren</button>
      </div>
      <pre style="font-size:11px;background:var(--bg);padding:8px;margin-bottom:12px;border-radius:6px;overflow-x:auto;border:1px solid var(--border);white-space:pre-wrap">${csvExample}</pre>
      <p style="font-size:13px;margin-bottom:12px;padding:8px 10px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">💡 Die CSV-Datei lässt sich einfach in <strong>Excel</strong> oder <strong>Google Sheets</strong> bearbeiten — einfach öffnen, Zeilen hinzufügen ((Daten → Text in Spalten → Delimiter: Komma), bearbeiten, und wieder als CSV speichern/exportieren.</p>
      <p style="font-size:13px;margin-top:12px;margin-bottom:4px;font-weight:600">Bilder:</p>
      <p style="font-size:13px;margin-bottom:12px">Bilddateien nach ID benennen: <code style="background:var(--bg);padding:2px 5px;border-radius:3px;font-size:12px">1.jpg</code>, <code style="background:var(--bg);padding:2px 5px;border-radius:3px;font-size:12px">2.png</code> usw. Beim Import Ordner wählen, um CSV und Bilder in einem Schritt zu laden.</p>
      <button class="btn btn-primary btn-sm" id="helpClose" style="width:100%">Schließen</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#helpClose').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#copyBtn').onclick = () => {
    navigator.clipboard.writeText(csvExample).then(() => {
      const btn = overlay.querySelector('#copyBtn');
      btn.textContent = 'Kopiert!';
      setTimeout(() => { btn.textContent = 'Kopieren'; }, 2000);
    });
  };
}

// ============================================================
// FAVOURITES (CSV, comma-delimited; semicolon also accepted on import)
// ============================================================
function _favouritesToCSV(favs) {
  const rows = ['name,station,slot,exercise_id,exercise_name'];
  for (const fav of favs) {
    for (const e of fav.plan) {
      rows.push([
        csvEscape(fav.name, ','),
        e.stop + 1,
        e.slot + 1,
        e.exerciseId,
        csvEscape(e.exerciseName, ',')
      ].join(','));
    }
  }
  return rows.join('\n');
}

function _parseFavouritesCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
  const byName = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = csvParseLine(lines[i], delimiter);
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

// Same name replaces
function importFavouritesCSV() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv', multiple: true });
  input.onchange = async () => {
    let count = 0;
    for (const file of input.files) {
      for (const fav of _parseFavouritesCSV(await file.text())) {
        const idx = _favourites.findIndex(f => f.name === fav.name);
        if (idx >= 0) _favourites[idx] = fav;
        else _favourites.push(fav);
        count++;
      }
    }
    if (!count) { alert('Keine Workouts in der Datei gefunden.'); return; }
    _saveFavourites();
    alert(`Importiert: ${count} Favoriten.`);
  };
  input.click();
}

function exportFavouritesCSV() {
  downloadFile(_favouritesToCSV(_favourites), 'llsc-favourites.csv', 'text/csv;charset=utf-8;');
}

// ============================================================
// HISTORY (CSV, semicolon-delimited)
// ============================================================
function _historyToCSV(rows) {
  const lines = ['session_id;date;exercise_id;exercise_name;muscle_group;tools'];
  for (const r of rows) {
    lines.push([
      csvEscape(r.sessionId),
      csvEscape(r.date),
      r.exerciseId,
      csvEscape(r.exerciseName),
      csvEscape(r.muscleGroup),
      csvEscape(r.tools)
    ].join(';'));
  }
  return lines.join('\n');
}

function _parseHistoryCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = csvParseLine(lines[i]);
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

// Merge, skipping rows already present (same session + exercise)
function importHistoryCSV() {
  const input = Object.assign(document.createElement('input'), {
    type: 'file', accept: '.csv', multiple: true
  });
  input.onchange = async () => {
    const files = Array.from(input.files);
    if (!files.length) return;
    const key = r => r.sessionId + '|' + r.exerciseId;
    const seen = new Set(_historyRows.map(key));
    const added = [];
    for (const file of files) {
      for (const r of _parseHistoryCSV(await file.text())) {
        if (!seen.has(key(r))) { seen.add(key(r)); added.push(r); }
      }
    }
    if (!added.length) { alert('Keine neuen Trainingseinträge gefunden.'); return; }
    try { await apiSave(Api.post('history/append', added)); } catch { return; }
    _setHistoryRows([..._historyRows, ...added]);
    alert(`Importiert: ${added.length} Einträge.`);
  };
  input.click();
}

function exportHistoryCSV() {
  downloadFile(_historyToCSV(_historyRows), 'llsc-history.csv', 'text/csv;charset=utf-8;');
}

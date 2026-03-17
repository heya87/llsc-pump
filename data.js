// ============================================================
// DATA SOURCE ABSTRACTION
// ============================================================
const DataSource = {
  _provider: null,

  setProvider(provider) {
    this._provider = provider;
  },

  async getExercises() {
    if (!this._provider) throw new Error('No data provider set');
    return this._provider.getExercises();
  },

  async saveWorkout(workout) {
    if (!this._provider) throw new Error('No data provider set');
    return this._provider.saveWorkout(workout);
  },

  async loadWorkout() {
    if (!this._provider) throw new Error('No data provider set');
    return this._provider.loadWorkout();
  }
};

// ============================================================
// CSV PROVIDER
// ============================================================
const CSVProvider = {
  _exercises: [],

  parseCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = this._parseLine(lines[0]).map(h => h.trim().toLowerCase());

    const exercises = [];
    const seenIds = new Set();
    const duplicateIds = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this._parseLine(lines[i]);
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
        image: null
      });
    }
    if (duplicateIds.length > 0) {
      alert('Doppelte IDs in CSV übersprungen: ' + duplicateIds.join(', '));
    }
    return exercises;
  },

  _parseLine(line) {
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
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  },

  loadFromText(text) {
    this._exercises = this.parseCSV(text);
    localStorage.setItem('csv_exercises', JSON.stringify(this._exercises));
    return this._exercises;
  },

  getExercises() {
    if (this._exercises.length === 0) {
      const stored = localStorage.getItem('csv_exercises');
      if (stored) this._exercises = JSON.parse(stored);
    }
    return this._exercises;
  },

  saveWorkout(workout) {
    localStorage.setItem('workout_plan', JSON.stringify(workout));
  },

  loadWorkout() {
    const stored = localStorage.getItem('workout_plan');
    return stored ? JSON.parse(stored) : null;
  }
};

DataSource.setProvider(CSVProvider);

// ============================================================
// CSV EXPORT — proper escaping for all fields
// ============================================================
function _csvEscape(val) {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function buildCSVString() {
  const header = 'id,name,description,mode,tools,muscleGroup';
  const rows = exercises.map(ex =>
    [ex.id, _csvEscape(ex.name), _csvEscape(ex.description), _csvEscape(ex.mode), _csvEscape(ex.tools), _csvEscape(ex.muscleGroup)].join(',')
  );
  return [header, ...rows].join('\n');
}

// ============================================================
// IMAGE STORE (IndexedDB)
// ============================================================
const ImageStore = {
  _db: null,
  _cache: {},

  open() {
    return new Promise((resolve, reject) => {
      if (this._db) { resolve(this._db); return; }
      const req = indexedDB.open('TrainingImages', 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore('images', { keyPath: 'id' }); };
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = e => reject(e);
    });
  },

  async save(id, dataUrl) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').put({ id, dataUrl });
      tx.oncomplete = () => { this._cache[id] = dataUrl; resolve(); };
      tx.onerror = e => reject(e);
    });
  },

  async get(id) {
    if (this._cache[id] !== undefined) return this._cache[id];
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readonly');
      const req = tx.objectStore('images').get(id);
      req.onsuccess = () => {
        const val = req.result ? req.result.dataUrl : null;
        this._cache[id] = val;
        resolve(val);
      };
      req.onerror = e => reject(e);
    });
  },

  async remove(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').delete(id);
      tx.oncomplete = () => { delete this._cache[id]; resolve(); };
      tx.onerror = e => reject(e);
    });
  },

  async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readonly');
      const req = tx.objectStore('images').getAll();
      req.onsuccess = () => {
        const map = {};
        for (const r of req.result) { map[r.id] = r.dataUrl; this._cache[r.id] = r.dataUrl; }
        resolve(map);
      };
      req.onerror = e => reject(e);
    });
  }
};

// ============================================================
// META STORE (IndexedDB) — for File System Access handles etc.
// ============================================================
const MetaStore = {
  _db: null,
  _open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('llsc_meta', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('meta');
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async get(key) {
    const db = await this._open();
    return new Promise(resolve => {
      const req = db.transaction('meta').objectStore('meta').get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  },
  async set(key, value) {
    const db = await this._open();
    return new Promise(resolve => {
      const tx = db.transaction('meta', 'readwrite');
      value === null ? tx.objectStore('meta').delete(key) : tx.objectStore('meta').put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => resolve();
    });
  }
};

// Image helpers
async function getExerciseImageUrl(id) {
  const stored = await ImageStore.get(id);
  if (stored) return stored;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const url = id + '.' + ext;
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      if (resp.ok) return url;
    } catch (e) { /* ignore */ }
  }
  return null;
}

function tryLoadFileImage(id, onSuccess) {
  const exts = ['jpg', 'jpeg', 'png', 'webp'];
  let i = 0;
  function tryNext() {
    if (i >= exts.length) return;
    const img = new Image();
    img.onload = () => onSuccess(img.src);
    img.onerror = () => { i++; tryNext(); };
    img.src = id + '.' + exts[i];
  }
  tryNext();
}

function resizeImage(file, maxSize) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

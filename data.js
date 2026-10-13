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
// EXERCISE STORE (server: api/exercises, api/workout)
// ============================================================
const ExerciseStore = {
  _exercises: [],

  async load() {
    this._exercises = await Api.get('exercises');
    return this._exercises;
  },

  getExercises() {
    return this._exercises;
  },

  saveExercises(list) {
    this._exercises = list;
    queuedPut('exercises', list);
  },

  saveWorkout(workout) {
    queuedPut('workout', workout);
  },

  loadWorkout() {
    return Api.get('workout');
  }
};

// Coalesce rapid saves of the same document and send them in order,
// so a slow older request can't overwrite a newer one.
const _putQueue = {};
function queuedPut(name, value) {
  const q = _putQueue[name] || (_putQueue[name] = { pending: undefined, running: null });
  q.pending = value;
  if (q.running) return q.running;
  q.running = (async () => {
    while (q.pending !== undefined) {
      const v = q.pending;
      q.pending = undefined;
      await apiSave(Api.put(name, v)).catch(() => {});
    }
    q.running = null;
  })();
  return q.running;
}

DataSource.setProvider(ExerciseStore);

// ============================================================
// IMAGE STORE (server: api/images/{id}, JPEG files)
// ============================================================
const ImageStore = {
  _versions: {}, // { id: version } for ids that have an image

  async load() {
    this._versions = await Api.get('images');
  },

  // Absolute URL so it also works in the print window (about:blank)
  _url(id) {
    return new URL(`api/images/${id}?v=${this._versions[id]}`, location.href).href;
  },

  async save(id, dataUrl) {
    const blob = new Blob([dataUrlToUint8Array(dataUrl)], { type: 'image/jpeg' });
    await apiSave(Api.putBlob('images/' + id, blob));
    this._versions[id] = Date.now();
  },

  async get(id) {
    return this._versions[id] ? this._url(id) : null;
  },

  async remove(id) {
    if (!this._versions[id]) return;
    delete this._versions[id];
    await apiSave(Api.del('images/' + id));
  },

  async getAll() {
    const map = {};
    for (const id of Object.keys(this._versions)) map[id] = this._url(id);
    return map;
  },

  async getBytes(id) {
    const resp = await fetch(this._url(id));
    return resp.ok ? new Uint8Array(await resp.arrayBuffer()) : null;
  }
};

// ============================================================
// WEIGHT LOG STORE (server: api/weights, kept in memory)
// ============================================================
const WeightStore = {
  _log: [], // [{ exerciseId, weightKg, date }] in chronological order

  async load() {
    this._log = await Api.get('weights');
  },

  async save(exerciseId, weightKg) {
    const entry = { exerciseId, weightKg, date: new Date().toISOString() };
    this._log.push(entry);
    await apiSave(Api.post('weights/append', [entry]));
  },

  async getLatest(exerciseId) {
    const history = await this.getHistory(exerciseId);
    return history.length > 0 ? history[history.length - 1] : null;
  },

  async getLatestMap(exerciseIds) {
    const result = {};
    for (const e of this._log) if (exerciseIds.includes(e.exerciseId)) result[e.exerciseId] = e;
    return result;
  },

  async getHistory(exerciseId) {
    return this._log.filter(e => e.exerciseId === exerciseId);
  },

  async getAll() {
    return this._log.slice();
  },

  async deleteByExercise(exerciseId) {
    this._log = this._log.filter(e => e.exerciseId !== exerciseId);
    await apiSave(Api.put('weights', this._log));
  }
};

// Image helpers
async function getExerciseImageUrl(id) {
  return ImageStore.get(id);
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

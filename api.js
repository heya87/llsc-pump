// ============================================================
// API — server storage (per logged-in user)
// ============================================================
const Api = {
  async _req(method, url, body, type = 'application/json') {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = type;
      opts.body = type === 'application/json' ? JSON.stringify(body) : body;
    }
    const resp = await fetch('api/' + url, opts);
    if (!resp.ok) throw new Error(`${method} ${url}: ${resp.status}`);
    return resp.json();
  },
  get(url)         { return this._req('GET', url); },
  put(url, body)   { return this._req('PUT', url, body); },
  post(url, body)  { return this._req('POST', url, body); },
  del(url)         { return this._req('DELETE', url); },
  putBlob(url, blob) { return this._req('PUT', url, blob, blob.type || 'application/octet-stream'); }
};

// Fire-and-forget save with a visible error, for sync call sites
function apiSave(promise) {
  promise.catch(e => {
    console.error(e);
    alert('Speichern auf dem Server fehlgeschlagen. Bitte Verbindung prüfen.');
  });
  return promise;
}

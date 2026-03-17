// ============================================================
// UTILITIES
// ============================================================

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// COLOR UTILITIES — deterministic hash-based assignment
// ============================================================

// Wong's colorblind-safe palette (muscle groups)
const MUSCLE_COLORS = [
  '#0072B2', '#E69F00', '#009E73', '#D55E00',
  '#CC79A7', '#56B4E9', '#F0E442', '#332288',
];
// Tol's qualitative palette (tools)
const TOOL_COLORS = [
  '#4477AA', '#EE6677', '#228833', '#CCBB44',
  '#66CCEE', '#AA3377', '#BBBBBB', '#EE8866',
];

// Simple string hash for deterministic color assignment
function _hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getMuscleColor(name) {
  if (!name) return '#cbd5e1';
  return MUSCLE_COLORS[_hashStr(name) % MUSCLE_COLORS.length];
}

function getToolColor(name) {
  if (!name) return '#94a3b8';
  return TOOL_COLORS[_hashStr(name) % TOOL_COLORS.length];
}

function getToolAbbrev(name) {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function toolBadgeHtml(ex) {
  if (!ex || !ex.tools) return '';
  return `<span class="tool-badge" style="background:${getToolColor(ex.tools)}" title="${esc(ex.tools)}">${getToolAbbrev(ex.tools)}</span>`;
}

function muscleBadgeHtml(ex) {
  if (!ex || !ex.muscleGroup) return '';
  const mc = getMuscleColor(ex.muscleGroup);
  const abbrev = getToolAbbrev(ex.muscleGroup);
  return `<span class="muscle-badge" style="background:${mc}" title="${esc(ex.muscleGroup)}">${abbrev}</span>`;
}

// ============================================================
// CONFIRM DIALOG
// ============================================================
function showConfirm(message, onYes, onNo) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <p>${esc(message)}</p>
      <div class="confirm-btns">
        <button class="btn btn-danger btn-sm" id="confirmYes">Ja, entfernen</button>
        <button class="btn btn-outline btn-sm" id="confirmNo">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirmYes').onclick = () => { overlay.remove(); onYes(); };
  overlay.querySelector('#confirmNo').onclick = () => { overlay.remove(); onNo(); };
}

// ============================================================
// MINIMAL ZIP CREATOR
// ============================================================
function createZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new Uint8Array(30 + nameBytes.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(file.data, 30 + nameBytes.length);
    localHeaders.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  centralHeaders.forEach(c => centralSize += c.length);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + 22;
  const zip = new Uint8Array(totalSize);
  let pos = 0;
  for (const lh of localHeaders) { zip.set(lh, pos); pos += lh.length; }
  for (const ch of centralHeaders) { zip.set(ch, pos); pos += ch.length; }
  zip.set(end, pos);
  return zip;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

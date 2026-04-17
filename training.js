// ============================================================
// TRAINING SCREEN
// ============================================================
let _pauseAccumulatedMs = 0;
let _pauseStartTime = null;
let _skipPhase = null;
let _jumpToStation = null;
let _prevStation = null;
let _nextStation = null;
let _render = null;
let _lastTrainingPhases = null; // kept after training ends for history saving
let _contentClickHandler = null; // event delegation handler

function renderTrainingSetup() {
  readSettings();
  stopTraining();

  const filledStops = [];
  for (let s = 0; s < settings.stops; s++) {
    const ex1 = getPlannedExercise(s, 0);
    const ex2 = getPlannedExercise(s, 1);
    if (ex1 || ex2) filledStops.push({ stop: s, ex1, ex2 });
  }

  if (filledStops.length === 0) {
    document.getElementById('trainingContent').innerHTML = `
      <div class="training-finished">
        <h2>Kein Workout geplant</h2>
        <p style="color:var(--text-light)">Bitte zuerst im Planner Übungen zuweisen.</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="showScreen('planner')">Zum Planner</button>
      </div>
    `;
    return;
  }

  // Accurate time estimate: count actual exercises per stop
  let totalSec = 0;
  for (let i = 0; i < filledStops.length; i++) {
    const st = filledStops[i];
    const exCount = (st.ex1 ? 1 : 0) + (st.ex2 ? 1 : 0);
    totalSec += exCount * settings.workTime;
    // Short break between the two exercises at the same stop
    if (exCount === 2) totalSec += settings.shortBreak;
    // Between stops: long break
    if (i < filledStops.length - 1) totalSec += settings.longBreak;
  }
  const totalMin = Math.ceil(totalSec / 60);

  document.getElementById('trainingContent').innerHTML = `
    <div class="training-finished">
      <h2>Workout bereit</h2>
      <p style="color:var(--text-light);margin-bottom:4px">${filledStops.length} Stationen &middot; ca. ${totalMin} Min.</p>
      <p style="color:var(--text-light);margin-bottom:20px">
        ${settings.workTime}s Training / ${settings.shortBreak}s Pause / ${settings.longBreak}s Wechsel
      </p>
      <button class="btn btn-success" onclick="startTraining()">Training starten</button>
    </div>
  `;
}

function buildPhases() {
  const phases = [];
  for (let s = 0; s < settings.stops; s++) {
    const ex1 = getPlannedExercise(s, 0);
    const ex2 = getPlannedExercise(s, 1);
    if (!ex1 && !ex2) continue;

    const isPerStation = ex1 && ex2 && ex1.id === ex2.id && ex1.mode === 'switch_per_station';
    const stopExercises = [ex1, ex2].filter(Boolean);
    stopExercises.forEach((ex, exIdx) => {
      const sideLabel = isPerStation ? (exIdx === 0 ? 'Seite 1' : 'Seite 2') : null;
      phases.push({ type: 'work', exercise: ex, stop: s, slotIdx: exIdx, duration: settings.workTime, sideLabel });

      const isLastExInStop = exIdx === stopExercises.length - 1;
      if (isLastExInStop) {
        let moreStops = false;
        for (let ns = s + 1; ns < settings.stops; ns++) {
          if (getPlannedExercise(ns, 0) || getPlannedExercise(ns, 1)) { moreStops = true; break; }
        }
        if (moreStops) {
          phases.push({ type: 'transition', exercise: null, stop: s, duration: settings.longBreak, label: 'Stationswechsel' });
        }
      } else {
        const breakLabel = isPerStation ? 'Seitenwechsel' : 'Nächste Übung';
        phases.push({ type: 'break', exercise: null, stop: s, duration: settings.shortBreak, label: breakLabel });
      }
    });
  }
  return phases;
}

function _buildStationChipsHTML(phases, currentPhase) {
  const phase = phases[currentPhase];
  const stationStops = [...new Set(phases.filter(p => p.type === 'work').map(p => p.stop))];
  const stopSlotCount = {};
  for (const p of phases) {
    if (p.type === 'work') stopSlotCount[p.stop] = (stopSlotCount[p.stop] || 0) + 1;
  }

  const currentStopIdx = stationStops.indexOf(phase.stop);

  return stationStops.map((s, idx) => {
    const slotCount = stopSlotCount[s] || 1;
    const isCurrentStop = s === phase.stop;
    const slot1Active = isCurrentStop && phase.type === 'work' && phase.slotIdx === 0;
    const breakActive  = isCurrentStop && phase.type === 'break';
    const slot2Active  = isCurrentStop && phase.type === 'work' && phase.slotIdx === 1;
    const transActive  = isCurrentStop && phase.type === 'transition';
    const anyActive    = slot1Active || breakActive || slot2Active;

    let chipHTML;
    if (slotCount === 1) {
      chipHTML = `<div class="station-sub-chip${slot1Active ? ' active' : ''}" data-action="jump" data-stop="${s}">${s + 1}</div>`;
    } else {
      // 3-part pill: left wing | number | right wing
      chipHTML = `
        <div class="station-pill${anyActive ? ' current-station' : ''}" data-action="jump" data-stop="${s}">
          <div class="station-pill-left${slot1Active ? ' active' : ''}"></div>
          <div class="station-pill-center${breakActive ? ' active' : ''}">${s + 1}</div>
          <div class="station-pill-right${slot2Active ? ' active' : ''}"></div>
        </div>`;
    }

    const rel = idx - currentStopIdx;
    const relClass = rel === 0 ? ' chip-group-current' : rel === -1 ? ' chip-group-prev' : rel === 1 ? ' chip-group-next' : '';
    // Dot class encodes which gap it sits in (used for mobile grid placement)
    const dotClass = rel === -1 ? ' dot-before-current' : rel === 0 ? ' dot-after-current' : '';
    const transitionDot = idx < stationStops.length - 1
      ? `<div class="station-transition-dot${dotClass}${transActive ? ' active' : ''}"></div>`
      : '';
    // Dot is a sibling of the chip group (not a child) so it can be placed independently in the mobile grid
    return `<span class="station-chip-group${relClass}">${chipHTML}</span>${transitionDot}`;
  }).join('') + `<span class="station-chip-group chip-group-finish"><div class="station-sub-chip station-finish-chip">🎉</div></span>`;
}

async function startTraining() {
  const phases = buildPhases();
  if (phases.length === 0) return;
  _lastTrainingPhases = phases;

  const trainingImages = {};
  const exIds = [...new Set(phases.filter(p => p.exercise).map(p => p.exercise.id))];
  await Promise.all(exIds.map(async id => {
    trainingImages[id] = await getExerciseImageUrl(id);
  }));

  requestWakeLock();

  let currentPhase = 0;
  let remaining = phases[currentPhase].duration;
  trainingRunning = true;
  trainingPaused = false;
  _pauseAccumulatedMs = 0;
  _pauseStartTime = null;

  // Drift-corrected timer: track when the phase started
  let phaseStartTime = Date.now();
  let phaseStartRemaining = remaining;
  let halftimeBeepFired = false;
  let endBeepFired = false;
  let lastRenderedPhase = -1;

  // Event delegation: one stable listener on trainingContent handles all button clicks
  const contentEl = document.getElementById('trainingContent');
  _contentClickHandler = function(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'pause') togglePause();
    else if (action === 'stop') { stopTraining(); renderTrainingSetup(); }
    else if (action === 'prev') prevStation();
    else if (action === 'next') nextStation();
    else if (action === 'jump') jumpToStation(+btn.dataset.stop);
  };
  contentEl.addEventListener('click', _contentClickHandler);

  function doFullRender(phase) {
    const ex = phase.exercise;
    const stationStops = [...new Set(phases.filter(p => p.type === 'work').map(p => p.stop))];
    const stationIdx = stationStops.indexOf(phase.stop);

    const phaseClass = phase.type === 'work' ? 'phase-work' : phase.type === 'break' ? 'phase-break' : 'phase-transition';
    const phaseLabel = phase.type === 'work'
      ? (phase.sideLabel ? `Training – ${phase.sideLabel}` : 'Training')
      : (phase.label || 'Pause');
    const phaseIcon = phase.type === 'work' ? '🏋🏾' : phase.type === 'break' ? '🧘🏾' : '🚶🏾';

    // Look ahead for next exercise to show during breaks
    let nextEx = null, nextExImg = null;
    if (!ex) {
      for (let i = currentPhase + 1; i < phases.length; i++) {
        if (phases[i].type === 'work' && phases[i].exercise) {
          nextEx = phases[i].exercise;
          nextExImg = trainingImages[nextEx.id];
          break;
        }
      }
    }

    const exImgUrl = ex ? trainingImages[ex.id] : null;

    contentEl.innerHTML = `
      <div class="training-display">
        <div class="station-progress-row">
          <button class="station-nav-btn" data-action="prev" ${stationIdx <= 0 ? 'disabled' : ''}>&#8592;</button>
          <div class="station-chips${stationIdx >= stationStops.length - 1 ? ' is-last-station' : ''}" id="t-station-chips">
            ${_buildStationChipsHTML(phases, currentPhase)}
          </div>
          <button class="station-nav-btn" data-action="next" ${stationIdx >= stationStops.length - 1 ? 'disabled' : ''}>&#8594;</button>
        </div>
        <div class="training-phase-icon ${phaseClass}">${phaseIcon}</div>
        <div class="training-phase ${phaseClass}">${esc(phaseLabel)}</div>
        <div class="training-stop-info">Station ${phase.stop + 1} von ${settings.stops}</div>
        <div class="training-timer ${phaseClass}" id="t-timer">${remaining}</div>
        ${ex ? `
          <div class="training-exercise-name">${esc(ex.name)}</div>
          ${exImgUrl ? `<img class="training-image" src="${exImgUrl}" alt="${esc(ex.name)}">` : ''}
          ${ex.description ? `<div class="training-description">${esc(ex.description)}</div>` : ''}
          <div class="training-meta">
            ${modeLabel(ex.mode) ? `<span class="training-tag">${modeLabel(ex.mode)}</span>` : ''}
            ${ex.tools ? `<span class="training-tag">${esc(ex.tools)}</span>` : ''}
          </div>
          <div id="t-switch-hint" class="switch-hint"></div>
        ` : `
          ${nextEx ? `
            <div class="training-next-section">
              <div class="training-next-label">Nächste Übung</div>
              <div class="training-exercise-name training-next-name">${esc(nextEx.name)}</div>
              ${nextExImg ? `<img class="training-image" src="${nextExImg}" alt="${esc(nextEx.name)}" style="max-height:25vh">` : ''}
              ${nextEx.description ? `<div class="training-description">${esc(nextEx.description)}</div>` : ''}
              <div class="training-meta">
                ${modeLabel(nextEx.mode) ? `<span class="training-tag">${modeLabel(nextEx.mode)}</span>` : ''}
                ${nextEx.tools ? `<span class="training-tag">${esc(nextEx.tools)}</span>` : ''}
              </div>
            </div>
          ` : `<div class="training-exercise-name">${esc(phaseLabel)}</div>`}
        `}
        <div class="training-controls">
          <button class="btn ${trainingPaused ? 'btn-success' : 'btn-warning'}" id="t-pause-btn" data-action="pause">
            ${trainingPaused ? 'Fortsetzen' : 'Pause'}
          </button>
          <button class="btn btn-danger" data-action="stop">Stop</button>
        </div>
        <div class="wakelock-note">Display bleibt aktiv</div>
      </div>
    `;

    // Scroll active chip into view
    const activeChip = contentEl.querySelector('.station-sub-chip.active');
    if (activeChip) activeChip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  function render() {
    const phase = phases[currentPhase];

    // Full re-render only on phase change
    if (currentPhase !== lastRenderedPhase) {
      lastRenderedPhase = currentPhase;
      doFullRender(phase);
      return;
    }

    // Tick-only updates
    const timerEl = document.getElementById('t-timer');
    if (timerEl) timerEl.textContent = remaining;

    const pauseBtn = document.getElementById('t-pause-btn');
    if (pauseBtn) {
      pauseBtn.textContent = trainingPaused ? 'Fortsetzen' : 'Pause';
      pauseBtn.className = `btn ${trainingPaused ? 'btn-success' : 'btn-warning'}`;
    }

    // Switch hint mid-phase
    const hintEl = document.getElementById('t-switch-hint');
    if (hintEl && phase.type === 'work' && phase.exercise && phase.exercise.mode === 'switch_per_exercise') {
      const half = Math.ceil(phase.duration / 2);
      hintEl.textContent = (remaining <= half && remaining > half - 3) ? 'Seitenwechsel!' : '';
    }
  }

  function tick() {
    if (!trainingRunning) return;
    if (trainingPaused) {
      trainingTimer = setTimeout(tick, 200);
      return;
    }

    // Drift-corrected: calculate remaining from elapsed wall-clock time (minus pause)
    const elapsed = Math.floor((Date.now() - phaseStartTime - _pauseAccumulatedMs) / 1000);
    remaining = Math.max(0, phaseStartRemaining - elapsed);

    // Beep sequence 2 seconds before phase ends
    if (!endBeepFired && remaining <= 5 && remaining > 0) {
      endBeepFired = true;
      beepSequence();
    }

    if (remaining <= 0) {
      currentPhase++;
      if (currentPhase >= phases.length) {
        trainingRunning = false;
        releaseWakeLock();
        document.getElementById('trainingContent').innerHTML = `
          <div class="training-finished">
            <h2>Geschafft!</h2>
            <p style="color:var(--text-light);margin-bottom:20px">Training abgeschlossen.</p>
            <button class="btn btn-success" style="margin-bottom:8px" onclick="saveTrainingHistory(_lastTrainingPhases)">Training speichern</button>
            <button class="btn btn-primary" onclick="renderTrainingSetup()">Zurück</button>
          </div>
        `;
        return;
      }
      remaining = phases[currentPhase].duration;
      phaseStartTime = Date.now();
      phaseStartRemaining = remaining;
      _pauseAccumulatedMs = 0;
      _pauseStartTime = null;
      halftimeBeepFired = false;
      endBeepFired = false;
    }

    // Single beep at halftime for seitenwechsel exercises (flag prevents re-firing)
    const curPhase = phases[currentPhase];
    if (!halftimeBeepFired && curPhase.type === 'work' && curPhase.exercise &&
        curPhase.exercise.mode === 'switch_per_exercise') {
      const half = Math.ceil(curPhase.duration / 2);
      if (remaining <= half) {
        halftimeBeepFired = true;
        beep(600, 600);
      }
    }

    render();
    trainingTimer = setTimeout(tick, 250); // Check more frequently for drift correction
  }

  _render = render;

  function goToStation(targetStop) {
    const targetIdx = phases.findIndex(p => p.type === 'work' && p.stop === targetStop);
    if (targetIdx === -1) return;
    currentPhase = targetIdx;
    remaining = phases[currentPhase].duration;
    phaseStartTime = Date.now();
    phaseStartRemaining = remaining;
    _pauseAccumulatedMs = 0;
    _pauseStartTime = null;
    halftimeBeepFired = false;
    endBeepFired = false;
    render();
  }

  _prevStation = function() {
    const stops = [...new Set(phases.filter(p => p.type === 'work').map(p => p.stop))];
    const curIdx = stops.indexOf(phases[currentPhase].stop);
    if (curIdx <= 0) return;
    goToStation(stops[curIdx - 1]);
  };

  _nextStation = function() {
    const stops = [...new Set(phases.filter(p => p.type === 'work').map(p => p.stop))];
    const curIdx = stops.indexOf(phases[currentPhase].stop);
    if (curIdx === -1 || curIdx >= stops.length - 1) return;
    goToStation(stops[curIdx + 1]);
  };

  _skipPhase = function() {
    currentPhase++;
    if (currentPhase >= phases.length) {
      trainingRunning = false;
      releaseWakeLock();
      _skipPhase = null;
      _jumpToStation = null;
      document.getElementById('trainingContent').innerHTML = `
        <div class="training-finished">
          <h2>Geschafft!</h2>
          <p style="color:var(--text-light);margin-bottom:20px">Training abgeschlossen.</p>
          <button class="btn btn-primary" onclick="renderTrainingSetup()">Zurück</button>
        </div>
      `;
      return;
    }
    remaining = phases[currentPhase].duration;
    phaseStartTime = Date.now();
    phaseStartRemaining = remaining;
    _pauseAccumulatedMs = 0;
    _pauseStartTime = null;
    halftimeBeepFired = false;
    endBeepFired = false;
    render();
  };

  _jumpToStation = function(targetStop) {
    goToStation(targetStop);
  };

  render();
  trainingTimer = setTimeout(tick, 250);
}

function togglePause() {
  trainingPaused = !trainingPaused;
  if (trainingPaused) {
    _pauseStartTime = Date.now();
  } else {
    if (_pauseStartTime !== null) {
      _pauseAccumulatedMs += Date.now() - _pauseStartTime;
      _pauseStartTime = null;
    }
  }
  if (_render) _render();
}

function skipPhase() {
  if (_skipPhase) _skipPhase();
}

function jumpToStation(targetStop) {
  if (_jumpToStation) _jumpToStation(targetStop);
}

function prevStation() {
  if (_prevStation) _prevStation();
}

function nextStation() {
  if (_nextStation) _nextStation();
}

function stopTraining() {
  trainingRunning = false;
  trainingPaused = false;
  if (trainingTimer) { clearTimeout(trainingTimer); trainingTimer = null; }
  releaseWakeLock();
  _skipPhase = null;
  _jumpToStation = null;
  _prevStation = null;
  _nextStation = null;
  _render = null;
  _pauseAccumulatedMs = 0;
  _pauseStartTime = null;
  if (_contentClickHandler) {
    const el = document.getElementById('trainingContent');
    if (el) el.removeEventListener('click', _contentClickHandler);
    _contentClickHandler = null;
  }
}

// ============================================================
// AUDIO — single shared AudioContext
// ============================================================
let _audioCtx = null;

function beepSequence() {
  const beeps = [
    { delay: 1250, freq: 400, dur: 600 },
    { delay: 2500, freq: 400, dur: 600 },
    { delay: 3750, freq: 400, dur: 600 },
    { delay: 5000, freq: 600, dur: 600 },
  ];
  beeps.forEach(b => setTimeout(() => beep(b.freq, b.dur), b.delay));
}

function beep(freq, duration) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Resume if suspended (browser autoplay policy)
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.frequency.value = freq;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(_audioCtx.currentTime + duration / 1000);
  } catch (e) { /* audio not available */ }
}

// ============================================================
// WAKE LOCK
// ============================================================
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* not supported or denied */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// ============================================================
// TRAINING SCREEN
// ============================================================
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

    const stopExercises = [ex1, ex2].filter(Boolean);
    stopExercises.forEach((ex, exIdx) => {
      phases.push({ type: 'work', exercise: ex, stop: s, duration: settings.workTime });

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
        phases.push({ type: 'break', exercise: null, stop: s, duration: settings.shortBreak, label: 'Nächste Übung' });
      }
    });
  }
  return phases;
}

async function startTraining() {
  const phases = buildPhases();
  if (phases.length === 0) return;

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

  // Drift-corrected timer: track when the phase started
  let phaseStartTime = Date.now();
  let phaseStartRemaining = remaining;
  let halftimeBeepFired = false;
  let endBeepFired = false;

  function render() {
    const phase = phases[currentPhase];
    const total = phases.length;
    const progress = ((currentPhase / total) * 100).toFixed(1);
    const ex = phase.exercise;

    const phaseClass = phase.type === 'work' ? 'phase-work' : phase.type === 'break' ? 'phase-break' : 'phase-transition';
    const phaseLabel = phase.type === 'work'
      ? 'Training'
      : (phase.label || 'Pause');

    let switchHint = '';
    if (phase.type === 'work' && ex && ex.mode === 'halftime_switch') {
      const half = Math.ceil(phase.duration / 2);
      if (remaining <= half && remaining > half - 3) {
        switchHint = '<div class="switch-hint">Seitenwechsel!</div>';
      }
    }

    // Look ahead for next exercise to show during breaks
    let nextEx = null;
    let nextExImg = null;
    if (phase.type !== 'work') {
      for (let i = currentPhase + 1; i < phases.length; i++) {
        if (phases[i].type === 'work' && phases[i].exercise) {
          nextEx = phases[i].exercise;
          nextExImg = trainingImages[nextEx.id];
          break;
        }
      }
    }

    const exImgUrl = ex ? trainingImages[ex.id] : null;

    document.getElementById('trainingContent').innerHTML = `
      <div class="training-display">
        <div class="training-progress"><div class="training-progress-bar" style="width:${progress}%"></div></div>
        <div class="training-phase ${phaseClass}">${esc(phaseLabel)}</div>
        <div class="training-stop-info">Station ${phase.stop + 1} von ${settings.stops}</div>
        <div class="training-timer ${phaseClass}">${remaining}</div>
        ${ex ? `
          <div class="training-exercise-name">${esc(ex.name)}</div>
          ${exImgUrl ? `<img class="training-image" src="${exImgUrl}" alt="${esc(ex.name)}">` : ''}
          ${ex.description ? `<div class="training-description">${esc(ex.description)}</div>` : ''}
          <div class="training-meta">
            ${modeLabel(ex.mode) ? `<span class="training-tag">${modeLabel(ex.mode)}</span>` : ''}
            ${ex.tools ? `<span class="training-tag">${esc(ex.tools)}</span>` : ''}
          </div>
          ${switchHint}
        ` : `
          ${nextEx ? `
            <div style="opacity:.45;margin-top:8px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-light);margin-bottom:8px">Nächste Übung</div>
              <div class="training-exercise-name" style="font-size:20px">${esc(nextEx.name)}</div>
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
          <button class="btn ${trainingPaused ? 'btn-success' : 'btn-warning'}" onclick="togglePause()">
            ${trainingPaused ? 'Weiter' : 'Pause'}
          </button>
          <button class="btn btn-danger" onclick="stopTraining();renderTrainingSetup();">Stop</button>
        </div>
        <div class="wakelock-note">Display bleibt aktiv</div>
      </div>
    `;
  }

  function tick() {
    if (!trainingRunning) return;
    if (trainingPaused) {
      trainingTimer = setTimeout(tick, 200);
      return;
    }

    // Drift-corrected: calculate remaining from elapsed wall-clock time
    const elapsed = Math.floor((Date.now() - phaseStartTime) / 1000);
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
            <button class="btn btn-primary" onclick="renderTrainingSetup()">Zurück</button>
          </div>
        `;
        return;
      }
      remaining = phases[currentPhase].duration;
      phaseStartTime = Date.now();
      phaseStartRemaining = remaining;
      halftimeBeepFired = false;
      endBeepFired = false;
    }

    // Single beep at halftime for seitenwechsel exercises (flag prevents re-firing)
    const curPhase = phases[currentPhase];
    if (!halftimeBeepFired && curPhase.type === 'work' && curPhase.exercise &&
        curPhase.exercise.mode === 'halftime_switch') {
      const half = Math.ceil(curPhase.duration / 2);
      if (remaining <= half) {
        halftimeBeepFired = true;
        beep(600, 600);
      }
    }

    render();
    trainingTimer = setTimeout(tick, 250); // Check more frequently for drift correction
  }

  render();
  trainingTimer = setTimeout(tick, 250);
}

function togglePause() {
  trainingPaused = !trainingPaused;
}

function stopTraining() {
  trainingRunning = false;
  trainingPaused = false;
  if (trainingTimer) { clearTimeout(trainingTimer); trainingTimer = null; }
  releaseWakeLock();
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

// UniTalk — alur utama aplikasi (UI + integrasi).
//   bicara -> ASR lokal (parsial + final) -> terjemahan -> tampil di sisi lawan bicara + dibacakan
// TUGAS 3 (UI/UX & Integrasi) memegang file ini + index.html + css/style.css + i18n.js.

import { LANGUAGES, getLanguage } from './languages.js';
import { LocalWhisper, StreamingSession, SAMPLE_RATE } from './asr/streaming-asr.js';
import { MicInput, decodeAudioFile, streamSamples } from './asr/audio-input.js';
import { translate } from './translate.js';
import { ttsSupported, speak, stopSpeaking, hasVoiceFor, voicesLoaded, onVoicesChanged } from './tts.js';
import * as metrics from './metrics.js';
import { t, phrase, UI_LANG } from './i18n.js';

const SIDES = ['a', 'b'];
const other = (side) => (side === 'a' ? 'b' : 'a');
const $ = (selector, root = document) => root.querySelector(selector);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MODEL_IDS = {
  fast: 'onnx-community/whisper-tiny',
  balanced: 'onnx-community/whisper-base',
  accurate: 'onnx-community/whisper-small',
};

const ICON_SPEAKER =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>';

// ------------------------------------------------------------------ pengaturan
const STORAGE_KEY = 'unitalk:v2';
const settings = loadSettings();

function loadSettings() {
  const defaults = { langs: { a: 'en', b: 'id' }, autoSpeak: true, quality: 'fast', evalMode: false, faceToFace: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...defaults, ...saved, langs: { ...defaults.langs, ...saved.langs } };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage bisa diblokir (mode private) — abaikan
  }
}

// ------------------------------------------------------------------ elemen
const halves = Object.fromEntries(
  SIDES.map((side) => {
    const root = $(`.half[data-side="${side}"]`);
    return [
      side,
      {
        root,
        select: $('select', root),
        greet: $('.greet', root),
        feed: $('.feed', root),
        mic: $('.mic', root),
        hint: $('.hint', root),
        live: null, // baris teks parsial (sisi yang bicara)
        typing: null, // indikator "…" (sisi yang mendengar)
      },
    ];
  }),
);

const els = {
  loader: $('#loader'),
  loaderText: $('#loaderText'),
  loaderBar: $('#loaderBar'),
  loaderSub: $('#loaderSub'),
  retry: $('#retry'),
  swap: $('#swap'),
  openSettings: $('#openSettings'),
  settings: $('#settings'),
  autoSpeak: $('#autoSpeak'),
  voiceNote: $('#voiceNote'),
  faceToFace: $('#faceToFace'),
  evalMode: $('#evalMode'),
  evalTools: $('#evalTools'),
  stats: $('#stats'),
  exportLog: $('#exportLog'),
  testFile: $('#testFile'),
  testSide: $('#testSide'),
  runTest: $('#runTest'),
  typeInput: $('#typeInput'),
  typeSide: $('#typeSide'),
  typeSend: $('#typeSend'),
};

const langOf = (side) => getLanguage(halves[side].select.value);

function setHint(side, text, isError = false) {
  const { hint } = halves[side];
  hint.textContent = text;
  hint.classList.toggle('is-error', isError);
}

const idleHint = (side) => setHint(side, phrase(langOf(side).code, 'idle'));

function applyLanguage(side) {
  const h = halves[side];
  const lang = langOf(side);
  h.root.lang = lang.speech;
  h.root.dir = lang.dir ?? 'ltr';
  h.greet.textContent = phrase(lang.code, 'greet');
  h.mic.setAttribute('aria-label', phrase(lang.code, 'idle'));
  if (active?.side !== side) idleHint(side);
  renderSideOptions();
}

// ------------------------------------------------------------------ model ASR
const progressFiles = new Map();

function onProgress(p) {
  if (p.status !== 'progress' || !p.file || !p.total) return;
  progressFiles.set(p.file, p);
  let loaded = 0;
  let total = 0;
  for (const f of progressFiles.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  els.loaderBar.style.width = `${Math.round((loaded / total) * 100)}%`;
  els.loaderSub.textContent = t('downloading', Math.round(loaded / 1e6), Math.round(total / 1e6));
}

const asr = new LocalWhisper({ onProgress });
let modelReady = false;

function showLoader(state) {
  els.loader.classList.toggle('is-done', state === 'done');
  els.loader.classList.toggle('is-error', state === 'error');
  els.loaderText.textContent = state === 'error' ? t('loadFailed') : t('preparing');
  els.retry.hidden = state !== 'error';
}

function setMicsEnabled(enabled) {
  for (const side of SIDES) halves[side].mic.disabled = !enabled;
}

async function loadModel() {
  await stopListening();
  modelReady = false;
  setMicsEnabled(false);
  progressFiles.clear();
  els.loaderBar.style.width = '0%';
  els.loaderSub.textContent = t('firstTime');
  showLoader('loading');
  try {
    await asr.load(MODEL_IDS[settings.quality] ?? MODEL_IDS.fast);
    modelReady = true;
    setMicsEnabled(true);
    showLoader('done');
  } catch (err) {
    console.error(err);
    showLoader('error');
  }
}

// ------------------------------------------------------------------ mendengar (mic / file)
let active = null; // { side, session, input }

function micErrorMessage(err) {
  if (err?.name === 'NotAllowedError') return t('micBlocked');
  if (err?.name === 'NotFoundError') return t('noMic');
  return t('micError');
}

function resetMic(side) {
  const { mic } = halves[side];
  mic.classList.remove('is-listening');
  mic.setAttribute('aria-pressed', 'false');
  mic.style.setProperty('--level', '0');
}

async function startListening(side, source = 'mic', samples = null) {
  if (!modelReady) return;
  stopSpeaking();
  const h = halves[side];
  const lang = langOf(side);

  const session = new StreamingSession(asr, {
    language: lang.whisper,
    onPartial: (text) => showLive(side, text),
    onFinal: (text, asrMetrics) => {
      clearLive(side);
      handleUtterance(side, text, { ...asrMetrics, input: source });
    },
    onLevel: (level) => h.mic.style.setProperty('--level', Math.min(1, level * 8).toFixed(3)),
    onError: (err) => {
      console.error(err);
      setHint(side, t('asrError'), true);
    },
  });

  const entry = { side, session, input: null };
  active = entry;
  h.mic.classList.add('is-listening');
  h.mic.setAttribute('aria-pressed', 'true');
  setHint(side, phrase(lang.code, 'listening'));

  try {
    if (source === 'mic') {
      entry.input = new MicInput();
      await entry.input.start((chunk) => session.pushAudio(chunk));
      if (active !== entry) await entry.input.stop(); // sudah di-stop saat izin mic muncul
    } else {
      entry.input = streamSamples(samples, (chunk) => session.pushAudio(chunk));
      entry.input.done.then(() => {
        if (active === entry) stopListening();
      });
    }
  } catch (err) {
    if (active === entry) active = null;
    resetMic(side);
    setHint(side, micErrorMessage(err), true);
  }
}

async function stopListening() {
  const entry = active;
  if (!entry) return;
  active = null;
  resetMic(entry.side);
  setHint(entry.side, phrase(langOf(entry.side).code, 'processing'));
  await entry.input?.stop();
  await entry.session.stop();
  clearLive(entry.side);
  if (active?.side !== entry.side) idleHint(entry.side);
}

async function toggleMic(side) {
  if (active?.side === side) {
    await stopListening();
    return;
  }
  await stopListening();
  await startListening(side, 'mic');
}

// ------------------------------------------------------------------ percakapan
function makeLine(kind, text = '') {
  const el = document.createElement('div');
  el.className = `line line--${kind}`;
  const p = document.createElement('p');
  p.className = 'line__text';
  p.textContent = text;
  el.append(p);
  return { el, text: p };
}

function makeDots() {
  const el = document.createElement('div');
  el.className = 'line line--them';
  el.innerHTML = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  return el;
}

function scrollFeed(side) {
  const { feed } = halves[side];
  feed.scrollTop = feed.scrollHeight;
}

function appendLine(side, el) {
  const h = halves[side];
  h.greet.hidden = true;
  h.feed.append(el);
  scrollFeed(side);
}

function markLatest(side, el) {
  halves[side].feed.querySelectorAll('.line--them.is-latest').forEach((x) => x.classList.remove('is-latest'));
  el.classList.add('is-latest');
}

function showLive(side, text) {
  const speaker = halves[side];
  if (!speaker.live) {
    speaker.live = makeLine('me');
    speaker.live.el.classList.add('line--live');
    appendLine(side, speaker.live.el);
  }
  speaker.live.text.textContent = text;
  scrollFeed(side);

  const listener = halves[other(side)];
  if (!listener.typing) {
    listener.typing = makeDots();
    appendLine(other(side), listener.typing);
  }
}

function clearLive(side) {
  const speaker = halves[side];
  speaker.live?.el.remove();
  speaker.live = null;
  const listener = halves[other(side)];
  listener.typing?.remove();
  listener.typing = null;
}

function formatMetrics(m) {
  const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const parts = [];
  if (typeof m.latencyMs === 'number') parts.push(sec(m.latencyMs));
  if (typeof m.asrMs === 'number') parts.push(`ASR ${sec(m.asrMs)}`);
  if (typeof m.rtf === 'number') parts.push(`RTF ${m.rtf}`);
  if (typeof m.translateMs === 'number') parts.push(`MT ${sec(m.translateMs)}`);
  return parts.join(' · ');
}

async function handleUtterance(side, text, asrMetrics = null) {
  const from = langOf(side);
  const to = langOf(other(side));

  // Sisi pembicara: apa yang dia ucapkan (kecil). Sisi pendengar: terjemahannya (besar).
  const mine = makeLine('me', text);
  const meta = document.createElement('span');
  meta.className = 'line__meta';
  if (asrMetrics) meta.textContent = formatMetrics(asrMetrics);
  mine.el.append(meta);
  appendLine(side, mine.el);

  const theirs = makeLine('them');
  theirs.text.innerHTML = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  markLatest(other(side), theirs.el);
  appendLine(other(side), theirs.el);

  const t0 = performance.now();
  try {
    const { text: translated, provider } = await translate(text, from.code, to.code);
    const translateMs = Math.round(performance.now() - t0);

    theirs.text.textContent = translated;
    theirs.text.lang = to.speech;
    if (ttsSupported) {
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'line__play';
      play.innerHTML = ICON_SPEAKER;
      play.setAttribute('aria-label', t('replay'));
      play.addEventListener('click', () => speakTranslation(translated, to));
      theirs.el.append(play);
    }
    meta.textContent = formatMetrics({ ...asrMetrics, translateMs });
    scrollFeed(other(side));

    metrics.record({
      side,
      from: from.code,
      to: to.code,
      source: asrMetrics ? 'speech' : 'typed',
      model: asr.info?.model,
      device: asr.info?.device,
      transcript: text,
      translation: translated,
      provider,
      translateMs,
      ...asrMetrics,
    });
    renderStats();

    if (settings.autoSpeak) speakTranslation(translated, to);
  } catch (err) {
    console.error(err);
    theirs.el.classList.add('is-error');
    theirs.text.textContent = t('translateFailed');
  }
}

// TTS diantre satu per satu dan menunggu pembicara selesai kalimatnya.
// Selama TTS bicara, mic dijeda supaya suara terjemahan tidak ikut ditranskripsi.
let ttsQueue = Promise.resolve();

function speakTranslation(text, lang) {
  ttsQueue = ttsQueue
    .then(async () => {
      const waitStart = performance.now();
      while (active?.session?.inSpeech && performance.now() - waitStart < 10000) await sleep(100);
      const session = active?.session;
      session?.pause();
      try {
        await speak(text, lang.speech);
      } finally {
        session?.resume();
      }
    })
    .catch((err) => console.warn('[tts]', err));
  return ttsQueue;
}

// ------------------------------------------------------------------ pengaturan & evaluasi
function renderStats() {
  const s = metrics.summary();
  const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(2)} s`);
  els.stats.textContent = s.utterances
    ? t('stats', {
        utterances: s.utterances,
        latency: sec(s.avgLatencyMs),
        firstPartial: sec(s.avgFirstPartialMs),
        rtf: s.avgRtf?.toFixed(2) ?? '–',
        translate: sec(s.avgTranslateMs),
      })
    : t('noStats');
}

function renderVoiceNote() {
  const missing =
    ttsSupported && voicesLoaded()
      ? [...new Set(SIDES.map(langOf))].filter((lang) => !hasVoiceFor(lang.speech)).map((lang) => lang.label)
      : [];
  els.voiceNote.hidden = !missing.length;
  els.voiceNote.textContent = missing.length ? t('noVoice', missing.join(', ')) : '';
}

function renderSideOptions() {
  for (const select of [els.testSide, els.typeSide]) {
    const value = select.value || 'a';
    select.replaceChildren(...SIDES.map((side) => new Option(`${side.toUpperCase()} · ${langOf(side).label}`, side)));
    select.value = value;
  }
}

/** Putar sampel audio (Float32Array 16 kHz) lewat pipeline yang sama seperti mic. */
async function runSamples(side, samples) {
  await stopListening();
  // 1,5 s hening di akhir supaya kalimat terakhir ditutup secara alami.
  const padded = new Float32Array(samples.length + SAMPLE_RATE * 1.5);
  padded.set(samples);
  await startListening(side, 'file', padded);
}

function sendTyped() {
  const text = els.typeInput.value.trim();
  if (!text) return;
  els.typeInput.value = '';
  els.settings.close();
  handleUtterance(els.typeSide.value, text);
}

// ------------------------------------------------------------------ setup
function setup() {
  document.documentElement.lang = UI_LANG;
  document.querySelectorAll('[data-t]').forEach((el) => {
    el.textContent = t(el.dataset.t);
  });
  document.querySelectorAll('[data-t-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.tLabel));
    if (el.tagName === 'BUTTON') el.title = t(el.dataset.tLabel);
  });

  for (const side of SIDES) {
    const h = halves[side];
    for (const lang of LANGUAGES) h.select.add(new Option(lang.label, lang.code));
    h.select.value = settings.langs[side];
    h.select.addEventListener('change', () => {
      settings.langs[side] = h.select.value;
      saveSettings();
      if (active?.side === side) stopListening(); // bahasa ganti -> sesi baru
      applyLanguage(side);
    });
    h.mic.addEventListener('click', () => toggleMic(side));
    applyLanguage(side);
  }

  els.swap.addEventListener('click', async () => {
    await stopListening();
    [halves.a.select.value, halves.b.select.value] = [halves.b.select.value, halves.a.select.value];
    settings.langs = { a: halves.a.select.value, b: halves.b.select.value };
    saveSettings();
    SIDES.forEach(applyLanguage);
  });

  // Pengaturan
  els.openSettings.addEventListener('click', () => {
    renderStats();
    renderVoiceNote();
    els.settings.showModal();
  });
  els.settings.addEventListener('click', (event) => {
    if (event.target === els.settings) els.settings.close(); // klik di luar panel
  });

  els.autoSpeak.checked = settings.autoSpeak;
  els.autoSpeak.addEventListener('change', () => {
    settings.autoSpeak = els.autoSpeak.checked;
    saveSettings();
    if (!settings.autoSpeak) stopSpeaking();
  });

  for (const input of document.querySelectorAll('input[name="quality"]')) {
    input.checked = input.value === settings.quality;
    input.addEventListener('change', () => {
      settings.quality = input.value;
      saveSettings();
      els.settings.close();
      loadModel();
    });
  }

  const applyFace = () => document.body.classList.toggle('face', settings.faceToFace);
  els.faceToFace.checked = settings.faceToFace;
  els.faceToFace.addEventListener('change', () => {
    settings.faceToFace = els.faceToFace.checked;
    saveSettings();
    applyFace();
  });
  applyFace();

  const applyEval = () => {
    document.body.classList.toggle('eval', settings.evalMode);
    els.evalTools.hidden = !settings.evalMode;
  };
  els.evalMode.checked = settings.evalMode;
  els.evalMode.addEventListener('change', () => {
    settings.evalMode = els.evalMode.checked;
    saveSettings();
    applyEval();
  });
  applyEval();

  els.exportLog.addEventListener('click', () => metrics.downloadJson());
  els.runTest.addEventListener('click', async () => {
    const file = els.testFile.files?.[0];
    if (!file) return;
    els.settings.close();
    await runSamples(els.testSide.value, await decodeAudioFile(file));
  });
  els.typeSend.addEventListener('click', sendTyped);
  els.typeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault(); // jangan sampai form dialog tertutup
      sendTyped();
    }
  });

  els.retry.addEventListener('click', loadModel);
  onVoicesChanged(renderVoiceNote);
  renderSideOptions();

  loadModel().then(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      for (const side of SIDES) setHint(side, t('needLocalhost'), true);
    }
  });
}

// Hook kecil untuk debugging / eksperimen dari DevTools console.
window.unitalk = { asr, metrics, runSamples, stopListening };

setup();

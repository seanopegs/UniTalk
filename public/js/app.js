// UniTalk — alur utama aplikasi (UI + integrasi).
//   bicara -> ASR lokal (parsial + final) -> terjemahan -> tampil + dibacakan (TTS)
// TUGAS 3 (UI/UX & Integrasi) memegang file ini + index.html + css/style.css.

import { LANGUAGES, getLanguage } from './languages.js';
import { LocalWhisper, StreamingSession, MODELS, SAMPLE_RATE } from './asr/streaming-asr.js';
import { MicInput, decodeAudioFile, streamSamples } from './asr/audio-input.js';
import { translate } from './translate.js';
import { ttsSupported, speak, stopSpeaking, hasVoiceFor, voicesLoaded, onVoicesChanged } from './tts.js';
import * as metrics from './metrics.js';

const SIDES = ['a', 'b'];
const other = (side) => (side === 'a' ? 'b' : 'a');
const IDLE_STATUS = 'Tekan mic, lalu bicara';
const $ = (selector, root = document) => root.querySelector(selector);

const SPEAKER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

// ------------------------------------------------------------------ settings
const STORAGE_KEY = 'unitalk:settings';
const settings = loadSettings();

function loadSettings() {
  const defaults = { langs: { a: 'en', b: 'id' }, autoSpeak: true, model: 'onnx-community/whisper-tiny' };
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

// ------------------------------------------------------------------ elements
const people = Object.fromEntries(
  SIDES.map((side) => {
    const root = $(`.panel[data-side="${side}"]`);
    return [
      side,
      {
        side,
        label: side === 'a' ? 'Orang A' : 'Orang B',
        select: $('.lang-select', root),
        mic: $('.mic', root),
        meter: $('.meter span', root),
        status: $('.status', root),
        live: $('.live', root),
        form: $('.typer', root),
        input: $('.typer input', root),
        voiceHint: $('.voice-hint', root),
      },
    ];
  }),
);

const els = {
  model: $('#modelSelect'),
  modelStatus: $('#modelStatus'),
  progressWrap: $('#progressWrap'),
  progress: $('#modelProgress'),
  progressText: $('#progressText'),
  autoSpeak: $('#autoSpeak'),
  banner: $('#banner'),
  swap: $('#swap'),
  clear: $('#clear'),
  messages: $('#messages'),
  stats: $('#stats'),
  exportLog: $('#exportLog'),
  testFile: $('#testFile'),
  testSide: $('#testSide'),
  runTest: $('#runTest'),
};

const langOf = (side) => getLanguage(people[side].select.value);

function setStatus(side, text, isError = false) {
  const { status } = people[side];
  status.textContent = text;
  status.classList.toggle('is-error', isError);
}

function showBanner(text) {
  els.banner.textContent = text;
  els.banner.hidden = false;
}

// ------------------------------------------------------------------ model ASR
const progressFiles = new Map();

function renderProgress(p) {
  if (p.status !== 'progress' || !p.file || !p.total) return;
  progressFiles.set(p.file, { loaded: p.loaded, total: p.total });
  let loaded = 0;
  let total = 0;
  for (const f of progressFiles.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  els.progress.value = total ? loaded / total : 0;
  els.progressText.textContent = `Mengunduh model ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB (sekali saja, lalu tersimpan di cache)`;
}

const asr = new LocalWhisper({ onProgress: renderProgress });
let modelReady = false;

function setModelStatus(text, kind = '') {
  els.modelStatus.textContent = text;
  els.modelStatus.className = `chip ${kind ? `is-${kind}` : ''}`;
}

function setMicsEnabled(enabled) {
  for (const side of SIDES) people[side].mic.disabled = !enabled;
}

async function loadModel() {
  await stopListening();
  modelReady = false;
  setMicsEnabled(false);
  progressFiles.clear();
  els.progress.value = 0;
  els.progressText.textContent = 'Menyiapkan model…';
  els.progressWrap.hidden = false;
  setModelStatus('Memuat model…');
  for (const side of SIDES) setStatus(side, 'Menunggu model…');

  try {
    const info = await asr.load(settings.model);
    modelReady = true;
    setMicsEnabled(true);
    const device = info.device === 'webgpu' ? 'WebGPU (GPU)' : 'WASM (CPU)';
    setModelStatus(`Siap · ${device} · lokal`, 'ok');
    for (const side of SIDES) setStatus(side, IDLE_STATUS);
  } catch (err) {
    console.error(err);
    setModelStatus('Gagal memuat model', 'error');
    showBanner(`Model ASR gagal dimuat: ${err.message}. Cek koneksi internet (untuk unduhan pertama) lalu refresh.`);
  } finally {
    els.progressWrap.hidden = true;
  }
}

// ------------------------------------------------------------------ mendengar (mic / file)
let active = null; // { side, session, input }

function micErrorMessage(err) {
  if (err?.name === 'NotAllowedError') return 'Akses mikrofon ditolak. Izinkan mic lewat ikon gembok di address bar.';
  if (err?.name === 'NotFoundError') return 'Mikrofon tidak ditemukan.';
  return `Mic error: ${err?.message || err}`;
}

function resetMicButton(side) {
  const p = people[side];
  p.mic.classList.remove('is-listening');
  p.mic.setAttribute('aria-pressed', 'false');
  p.meter.style.width = '0%';
}

async function startListening(side, source = 'mic', samples = null) {
  if (!modelReady) {
    setStatus(side, 'Model belum siap, tunggu sebentar…', true);
    return;
  }
  stopSpeaking();
  const p = people[side];
  const lang = langOf(side);

  const session = new StreamingSession(asr, {
    language: lang.whisper,
    onSpeechStart: () => setStatus(side, 'Mendengar suara…'),
    onPartial: (text) => {
      p.live.textContent = text;
    },
    onFinal: (text, asrMetrics) => {
      p.live.textContent = '';
      if (active?.side === side) setStatus(side, `Mendengarkan (${lang.label})… tekan lagi untuk berhenti`);
      handleUtterance(side, text, { ...asrMetrics, input: source });
    },
    onLevel: (level) => {
      p.meter.style.width = `${Math.min(100, level * 600)}%`;
    },
    onError: (err) => setStatus(side, `ASR error: ${err.message}`, true),
  });

  const entry = { side, session, input: null };
  active = entry;
  p.live.textContent = '';
  p.mic.classList.add('is-listening');
  p.mic.setAttribute('aria-pressed', 'true');
  setStatus(side, source === 'mic' ? `Mendengarkan (${lang.label})… tekan lagi untuk berhenti` : 'Memutar file audio uji…');

  try {
    if (source === 'mic') {
      entry.input = new MicInput();
      await entry.input.start((chunk) => session.pushAudio(chunk));
      if (active !== entry) await entry.input.stop(); // user sudah menekan stop saat izin mic muncul
    } else {
      entry.input = streamSamples(samples, (chunk) => session.pushAudio(chunk));
      entry.input.done.then(() => {
        if (active === entry) stopListening();
      });
    }
  } catch (err) {
    if (active === entry) active = null;
    resetMicButton(side);
    setStatus(side, micErrorMessage(err), true);
  }
}

async function stopListening() {
  const entry = active;
  if (!entry) return;
  active = null;
  resetMicButton(entry.side);
  await entry.input?.stop();
  setStatus(entry.side, 'Memproses kalimat terakhir…');
  await entry.session.stop();
  people[entry.side].live.textContent = '';
  if (active?.side !== entry.side) setStatus(entry.side, modelReady ? IDLE_STATUS : 'Menunggu model…');
}

async function toggleMic(side) {
  if (active?.side === side) {
    await stopListening();
    return;
  }
  await stopListening();
  await startListening(side, 'mic');
}

// ------------------------------------------------------------------ terjemahan + TTS
async function handleUtterance(side, text, asrMetrics = null) {
  const from = langOf(side);
  const to = langOf(other(side));
  const msg = renderMessage({ side, text, from, to });

  const t0 = performance.now();
  try {
    const { text: translated, provider } = await translate(text, from.code, to.code);
    const translateMs = Math.round(performance.now() - t0);
    msg.setTranslation(translated, { ...asrMetrics, translateMs });

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

    if (els.autoSpeak.checked) speakTranslation(translated, to);
  } catch (err) {
    msg.setError(err.message);
  }
}

// TTS diantre (satu per satu) dan menunggu pembicara selesai kalimatnya dulu.
// Selama TTS bicara, mic dijeda supaya suara terjemahan tidak ikut ditranskripsi.
let ttsQueue = Promise.resolve();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function formatMetrics(m) {
  const parts = [];
  if (typeof m.latencyMs === 'number') parts.push(`latency ${(m.latencyMs / 1000).toFixed(2)} s`);
  if (typeof m.asrMs === 'number') parts.push(`ASR ${m.asrMs} ms`);
  if (typeof m.rtf === 'number') parts.push(`RTF ${m.rtf}`);
  if (typeof m.translateMs === 'number') parts.push(`translate ${m.translateMs} ms`);
  return parts.join(' · ');
}

function renderMessage({ side, text, from, to }) {
  els.messages.querySelector('.empty')?.remove();

  const el = document.createElement('article');
  el.className = `msg msg--${side}`;

  const meta = document.createElement('div');
  meta.className = 'msg__meta';
  meta.textContent = `${people[side].label} · ${from.label} → ${to.label}`;

  const original = document.createElement('p');
  original.className = 'msg__original';
  original.lang = from.speech;
  original.textContent = text;

  const row = document.createElement('div');
  row.className = 'msg__row';
  const translation = document.createElement('p');
  translation.className = 'msg__translation';
  translation.lang = to.speech;
  translation.textContent = 'Menerjemahkan…';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'msg__play';
  play.title = 'Putar suara';
  play.setAttribute('aria-label', 'Putar suara terjemahan');
  play.innerHTML = SPEAKER_ICON;
  play.hidden = true;
  row.append(translation, play);

  const metricsLine = document.createElement('div');
  metricsLine.className = 'msg__metrics';

  el.append(meta, original, row, metricsLine);
  els.messages.append(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return {
    setTranslation(value, m) {
      translation.textContent = value;
      metricsLine.textContent = formatMetrics(m);
      play.hidden = !ttsSupported;
      play.onclick = () => speakTranslation(value, to);
    },
    setError(message) {
      el.classList.add('is-error');
      translation.textContent = `⚠ ${message}`;
    },
  };
}

function renderStats() {
  const s = metrics.summary();
  const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(2)} s`);
  els.stats.textContent = s.utterances
    ? `Kalimat (suara): ${s.utterances} · latency terakhir ${sec(s.lastLatencyMs)} · rata-rata ${sec(s.avgLatencyMs)} · ` +
      `parsial pertama ${sec(s.avgFirstPartialMs)} · ASR ${sec(s.avgAsrMs)} · RTF ${s.avgRtf?.toFixed(3) ?? '–'} · ` +
      `translate ${sec(s.avgTranslateMs)}`
    : 'Belum ada data suara.';
}

// ------------------------------------------------------------------ voice hints
function renderVoiceHints() {
  for (const side of SIDES) {
    const hint = people[side].voiceHint;
    const lang = langOf(side);
    const missing = ttsSupported && voicesLoaded() && !hasVoiceFor(lang.speech);
    hint.hidden = !missing;
    hint.textContent = missing ? `Suara TTS ${lang.label} tidak ada di browser ini — terjemahan tetap tampil sebagai teks.` : '';
  }
}

// ------------------------------------------------------------------ setup
function setup() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showBanner('Mikrofon hanya bisa dipakai lewat http://localhost atau HTTPS. Jalankan "npm start" lalu buka http://localhost:3000.');
  } else if (!window.AudioWorkletNode) {
    showBanner('Browser ini belum mendukung AudioWorklet. Pakai Google Chrome atau Microsoft Edge versi terbaru.');
  }

  for (const model of MODELS) els.model.add(new Option(model.label, model.id));
  els.model.value = settings.model;
  els.model.addEventListener('change', () => {
    settings.model = els.model.value;
    saveSettings();
    loadModel();
  });

  els.autoSpeak.checked = settings.autoSpeak;
  els.autoSpeak.addEventListener('change', () => {
    settings.autoSpeak = els.autoSpeak.checked;
    saveSettings();
    if (!settings.autoSpeak) stopSpeaking();
  });

  for (const side of SIDES) {
    const p = people[side];
    for (const lang of LANGUAGES) p.select.add(new Option(lang.label, lang.code));
    p.select.value = settings.langs[side];
    p.select.addEventListener('change', () => {
      settings.langs[side] = p.select.value;
      saveSettings();
      renderVoiceHints();
      if (active?.side === side) stopListening(); // bahasa ganti -> mulai sesi baru
    });
    p.mic.addEventListener('click', () => toggleMic(side));
    p.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = p.input.value.trim();
      if (!text) return;
      p.input.value = '';
      handleUtterance(side, text);
    });
  }

  els.swap.addEventListener('click', async () => {
    await stopListening();
    [people.a.select.value, people.b.select.value] = [people.b.select.value, people.a.select.value];
    settings.langs = { a: people.a.select.value, b: people.b.select.value };
    saveSettings();
    renderVoiceHints();
  });

  els.clear.addEventListener('click', () => {
    els.messages.innerHTML = '<p class="empty">Belum ada percakapan. Pilih bahasa, tekan mic, lalu bicara.</p>';
  });

  els.exportLog.addEventListener('click', () => metrics.downloadJson());

  els.runTest.addEventListener('click', async () => {
    const file = els.testFile.files?.[0];
    const side = els.testSide.value;
    if (!file) {
      setStatus(side, 'Pilih file audio dulu di panel Evaluasi.', true);
      return;
    }
    await runSamples(side, await decodeAudioFile(file));
  });

  onVoicesChanged(renderVoiceHints);
  renderVoiceHints();
  loadModel();
}

/** Putar sampel audio (Float32Array 16 kHz) lewat pipeline yang sama seperti mic. */
async function runSamples(side, samples) {
  await stopListening();
  // Tambah 1,5 s hening di akhir supaya endpoint kalimat terakhir terdeteksi secara alami.
  const padded = new Float32Array(samples.length + SAMPLE_RATE * 1.5);
  padded.set(samples);
  await startListening(side, 'file', padded);
}

// Hook kecil untuk debugging / eksperimen dari DevTools console.
window.unitalk = { asr, metrics, runSamples, stopListening };

setup();

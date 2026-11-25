// Real-time (streaming) speech recognition — 100% LOKAL.
//
// Alur:
//   mic -> AudioWorklet (chunk 100 ms, 16 kHz)
//       -> VAD berbasis energi (deteksi ada suara / hening)
//       -> selama orang masih bicara: transkripsi PARSIAL tiap ~0,7 s (teks ter-update)
//       -> begitu ada jeda hening (endpoint): transkripsi FINAL -> onFinal(text, metrics)
//
// Whisper bukan model streaming asli (input-nya potongan audio), jadi "streaming"
// di sini = transkripsi ulang buffer kalimat yang terus bertambah. Ini cara umum
// untuk membuat Whisper terasa real-time (lihat juga whisper_streaming / whisper.cpp stream).
//
// TUGAS 1 (ASR Engine) memegang file ini + asr-worker.js + audio-input.js.

export const SAMPLE_RATE = 16000;

export const MODELS = [
  { id: 'onnx-community/whisper-tiny', label: 'Whisper tiny · paling cepat' },
  { id: 'onnx-community/whisper-base', label: 'Whisper base · lebih akurat (ID)' },
  { id: 'onnx-community/whisper-small', label: 'Whisper small · paling akurat (berat)' },
];

export const DEFAULT_CONFIG = {
  partialIntervalMs: 700, // seberapa sering transkripsi parsial di-update
  silenceMs: 800, // lama hening untuk menutup kalimat (endpoint)
  maxSegmentMs: 15000, // kalimat terlalu panjang -> paksa ditutup
  minSpeechMs: 250, // bunyi lebih pendek dari ini dianggap noise (klik, batuk)
  preRollMs: 300, // audio sebelum suara terdeteksi ikut disimpan supaya awal kata tidak terpotong
  minRms: 0.01, // ambang energi minimum untuk dianggap suara
  noiseFactor: 2.5, // ambang = max(minRms, noiseFloor * noiseFactor)
};

// ---------------------------------------------------------------- utils

function rms(chunk) {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  return Math.sqrt(sum / (chunk.length || 1));
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

const msToSamples = (ms) => Math.round((ms / 1000) * SAMPLE_RATE);
const samplesToMs = (n) => Math.round((n / SAMPLE_RATE) * 1000);

// Whisper kadang "berhalusinasi" di audio hening: [BLANK_AUDIO], (music), *laughs*.
export function cleanTranscript(text) {
  const cleaned = String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : '';
}

// ---------------------------------------------------------------- model (Web Worker)

export class LocalWhisper {
  constructor({ onProgress } = {}) {
    this.onProgress = onProgress;
    this.worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
    this.requests = new Map();
    this.nextId = 1;
    this.ready = Promise.reject(new Error('Model belum dimuat'));
    this.ready.catch(() => {});
    this.info = null;

    this.worker.onmessage = (event) => this.#onMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Worker ASR crash');
      for (const req of this.requests.values()) req.reject(error);
      this.requests.clear();
    };
  }

  #onMessage(msg) {
    if (msg.type === 'progress') {
      this.onProgress?.(msg);
      return;
    }
    const req = this.requests.get(msg.id);
    if (!req) return;
    this.requests.delete(msg.id);
    if (msg.type === 'error') req.reject(new Error(msg.message));
    else req.resolve(msg);
  }

  #call(payload, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.worker.postMessage({ ...payload, id }, transfer);
    });
  }

  /** Muat model. device: 'auto' | 'webgpu' | 'wasm' */
  load(model, device = 'auto') {
    this.info = null;
    this.ready = this.#call({ type: 'load', model, device }).then((msg) => {
      this.info = { model, device: msg.device, loadMs: msg.loadMs };
      return this.info;
    });
    return this.ready;
  }

  /** audio: Float32Array mono 16 kHz. language: nama bahasa Whisper, mis. 'english'. */
  async transcribe(audio, language) {
    await this.ready;
    const msg = await this.#call({ type: 'transcribe', audio, language }, [audio.buffer]);
    return { text: cleanTranscript(msg.text), ms: msg.ms };
  }
}

// ---------------------------------------------------------------- sesi streaming

export class StreamingSession {
  /**
   * @param {LocalWhisper} asr
   * @param {object} opts
   * @param {string} opts.language            nama bahasa Whisper ('english', 'indonesian', ...)
   * @param {object} [opts.config]            override DEFAULT_CONFIG
   * @param {(text:string)=>void} [opts.onPartial]
   * @param {(text:string, metrics:object)=>void} [opts.onFinal]
   * @param {()=>void} [opts.onSpeechStart]
   * @param {(rms:number)=>void} [opts.onLevel]
   * @param {(err:Error)=>void} [opts.onError]
   */
  constructor(asr, { language, config = {}, onPartial, onFinal, onSpeechStart, onLevel, onError }) {
    this.asr = asr;
    this.language = language;
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    Object.assign(this, { onPartial, onFinal, onSpeechStart, onLevel, onError });

    this.noiseFloor = 0.003;
    this.preRoll = [];
    this.preRollMs = 0;
    this.segment = null;
    this.segmentSeq = 0;
    this.partialBusy = false;
    this.inferMs = 0; // rata-rata (EMA) waktu inference, untuk interval parsial adaptif
    this.paused = false;
    this.closed = false;
    this.pendingFinals = new Set();
  }

  /** true selama ada kalimat yang sedang diucapkan (belum ditutup). */
  get inSpeech() {
    return Boolean(this.segment);
  }

  #trackInference(ms) {
    this.inferMs = this.inferMs ? this.inferMs * 0.7 + ms * 0.3 : ms;
  }

  /** Masukkan potongan audio baru (Float32Array mono 16 kHz). */
  pushAudio(chunk) {
    if (this.closed) return;
    const now = performance.now();
    const chunkMs = samplesToMs(chunk.length);
    const level = rms(chunk);
    this.onLevel?.(level);
    if (this.paused) return;

    // Noise floor adaptif: cepat turun, lambat naik (melacak level hening ruangan).
    this.noiseFloor =
      level < this.noiseFloor ? this.noiseFloor * 0.9 + level * 0.1 : this.noiseFloor * 0.995 + level * 0.005;
    const isSpeech = level > Math.max(this.cfg.minRms, this.noiseFloor * this.cfg.noiseFactor);

    if (!this.segment) {
      this.preRoll.push(chunk);
      this.preRollMs += chunkMs;
      while (this.preRollMs > this.cfg.preRollMs && this.preRoll.length > 1) {
        this.preRollMs -= samplesToMs(this.preRoll.shift().length);
      }
      if (!isSpeech) return;

      // Mulai kalimat baru.
      this.segment = {
        id: ++this.segmentSeq,
        chunks: this.preRoll,
        ms: this.preRollMs,
        speechMs: 0,
        silenceMs: 0,
        startedAt: now,
        lastSpeechAt: now,
        lastPartialAt: now,
        firstPartialAt: null,
        partials: 0,
        partialMsTotal: 0,
      };
      this.preRoll = [];
      this.preRollMs = 0;
      this.onSpeechStart?.();
    } else {
      this.segment.chunks.push(chunk);
      this.segment.ms += chunkMs;
    }

    const seg = this.segment;
    if (isSpeech) {
      seg.speechMs += chunkMs;
      seg.silenceMs = 0;
      seg.lastSpeechAt = now;
    } else {
      seg.silenceMs += chunkMs;
    }

    if (seg.silenceMs >= this.cfg.silenceMs || seg.ms >= this.cfg.maxSegmentMs) {
      this.#finalize(seg.silenceMs >= this.cfg.silenceMs ? 'silence' : 'max-length');
      return;
    }

    // Parsial hanya saat orang masih bicara: kalau sudah mulai hening, kalimat akan segera
    // ditutup dan parsial baru cuma akan memperlambat transkripsi final (antre di worker).
    // Interval adaptif: minimal selama 1x waktu inference, supaya worker tidak penuh terus.
    if (
      isSpeech &&
      !this.partialBusy &&
      seg.speechMs >= this.cfg.minSpeechMs &&
      now - seg.lastPartialAt >= Math.max(this.cfg.partialIntervalMs, this.inferMs)
    ) {
      this.#runPartial(seg);
    }
  }

  async #runPartial(seg) {
    this.partialBusy = true;
    seg.lastPartialAt = performance.now();
    try {
      const { text, ms } = await this.asr.transcribe(concat(seg.chunks), this.language);
      this.#trackInference(ms);
      // Kalimat sudah ditutup (final) selama kita menunggu -> hasil parsial ini basi.
      if (this.segment !== seg || this.closed) return;
      seg.partials += 1;
      seg.partialMsTotal += ms;
      if (text) {
        seg.firstPartialAt ??= performance.now();
        this.onPartial?.(text);
      }
    } catch (err) {
      this.onError?.(err);
    } finally {
      this.partialBusy = false;
    }
  }

  #finalize(reason) {
    const seg = this.segment;
    this.segment = null;
    if (!seg || seg.speechMs < this.cfg.minSpeechMs) return Promise.resolve();

    // Buang hening di ekor kalimat (sisakan ~200 ms).
    let audio = concat(seg.chunks);
    const trim = msToSamples(Math.max(0, seg.silenceMs - 200));
    if (trim > 0 && trim < audio.length) audio = audio.slice(0, audio.length - trim);
    const audioMs = samplesToMs(audio.length);

    const job = this.asr
      .transcribe(audio, this.language)
      .then(({ text, ms }) => {
        this.#trackInference(ms);
        if (!text) return;
        const doneAt = performance.now();
        this.onFinal?.(text, {
          reason,
          audioMs,
          asrMs: ms,
          // Latency yang dirasakan user: dari akhir bicara sampai teks final muncul
          // (termasuk waktu tunggu hening untuk endpoint).
          latencyMs: Math.round(doneAt - seg.lastSpeechAt),
          // Responsiveness: dari mulai bicara sampai teks parsial pertama muncul.
          firstPartialMs: seg.firstPartialAt ? Math.round(seg.firstPartialAt - seg.startedAt) : null,
          partials: seg.partials,
          avgPartialMs: seg.partials ? Math.round(seg.partialMsTotal / seg.partials) : null,
          // Real-time factor: waktu proses / durasi audio (< 1 berarti lebih cepat dari real-time).
          rtf: Number((ms / Math.max(audioMs, 1)).toFixed(3)),
        });
      })
      .catch((err) => this.onError?.(err));

    this.pendingFinals.add(job);
    job.finally(() => this.pendingFinals.delete(job));
    return job;
  }

  /** Tutup kalimat yang sedang berjalan lalu berhenti mendengar sementara (mis. saat TTS bicara). */
  pause() {
    this.#finalize('pause');
    this.paused = true;
    this.preRoll = [];
    this.preRollMs = 0;
  }

  resume() {
    this.paused = false;
  }

  /** Selesaikan sesi: kalimat terakhir tetap ditranskripsi. */
  async stop() {
    if (this.closed) return;
    this.#finalize('stop');
    this.closed = true;
    await Promise.allSettled([...this.pendingFinals]);
  }
}

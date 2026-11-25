// Web Worker: menjalankan model Whisper SECARA LOKAL di browser
// (transformers.js + ONNX Runtime Web, pakai WebGPU kalau ada, kalau tidak WASM/CPU).
//
// Audio TIDAK dikirim ke server mana pun. Yang diunduh dari internet hanya file
// bobot model (sekali saja, lalu di-cache oleh browser).
//
// Protokol pesan:
//   main -> worker  { id, type: 'load', model, device }        => { id, type: 'ready', device, loadMs }
//   main -> worker  { id, type: 'transcribe', audio, language } => { id, type: 'result', text, ms }
//   worker -> main  { type: 'progress', status, file, loaded, total }   (saat download model)
//   worker -> main  { id, type: 'error', message }

import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

let transcriber = null;
let loadedKey = null;

async function detectDevice() {
  try {
    if (self.navigator?.gpu && (await self.navigator.gpu.requestAdapter())) return 'webgpu';
  } catch {
    // abaikan, pakai WASM
  }
  return 'wasm';
}

async function createPipeline(model, device) {
  // WebGPU: encoder fp32 + decoder 4-bit (cepat & akurat). WASM: semua 8-bit (ringan untuk CPU).
  const dtype = device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8';
  return pipeline('automatic-speech-recognition', model, {
    device,
    dtype,
    progress_callback: (p) =>
      self.postMessage({
        type: 'progress',
        status: p.status,
        file: p.file,
        loaded: p.loaded,
        total: p.total,
      }),
  });
}

async function load({ model, device: wanted }) {
  const t0 = performance.now();
  let device = !wanted || wanted === 'auto' ? await detectDevice() : wanted;
  const key = `${model}@${device}`;
  if (transcriber && loadedKey === key) return { device, loadMs: 0 };

  if (transcriber) {
    await transcriber.dispose?.();
    transcriber = null;
    loadedKey = null;
  }

  try {
    transcriber = await createPipeline(model, device);
  } catch (err) {
    if (device !== 'webgpu') throw err;
    console.warn('[asr] WebGPU gagal, pindah ke WASM:', err);
    device = 'wasm';
    transcriber = await createPipeline(model, device);
  }

  // Warm-up: inference pertama selalu lambat (inisialisasi kernel/shader),
  // jadi jalankan sekali pakai 1 detik hening supaya latency awal tidak menipu.
  await transcriber(new Float32Array(16000), { language: 'english', task: 'transcribe' });

  loadedKey = `${model}@${device}`;
  return { device, loadMs: Math.round(performance.now() - t0) };
}

async function transcribe({ audio, language }) {
  if (!transcriber) throw new Error('Model belum dimuat');
  const t0 = performance.now();
  const out = await transcriber(audio, { language, task: 'transcribe' });
  return { text: (out?.text ?? '').trim(), ms: Math.round(performance.now() - t0) };
}

// Proses pesan satu per satu (model tidak boleh dipakai paralel).
let queue = Promise.resolve();
self.onmessage = (event) => {
  const msg = event.data;
  queue = queue.then(() => handle(msg));
};

async function handle(msg) {
  try {
    if (msg.type === 'load') {
      self.postMessage({ id: msg.id, type: 'ready', ...(await load(msg)) });
    } else if (msg.type === 'transcribe') {
      self.postMessage({ id: msg.id, type: 'result', ...(await transcribe(msg)) });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', message: String(err?.message || err) });
  }
}

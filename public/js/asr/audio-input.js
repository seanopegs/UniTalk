// Sumber audio untuk StreamingSession:
//   - MicInput        : mikrofon, real-time
//   - streamSamples() : file audio yang "diputar" dengan kecepatan real-time
//                       (untuk eksperimen yang bisa diulang: noise, aksen, kecepatan bicara, dll.)

import { SAMPLE_RATE } from './streaming-asr.js';

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = pos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

export class MicInput {
  async start(onChunk) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    // Minta AudioContext 16 kHz (browser yang resample). Kalau tidak didukung, resample manual.
    try {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.source = this.ctx.createMediaStreamSource(this.stream);
    } catch {
      await this.ctx?.close();
      this.ctx = new AudioContext();
      this.source = this.ctx.createMediaStreamSource(this.stream);
    }

    await this.ctx.audioWorklet.addModule(new URL('./audio-processor.js', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'capture-processor');
    const rate = this.ctx.sampleRate;
    this.node.port.onmessage = (event) => onChunk(resampleLinear(event.data, rate, SAMPLE_RATE));

    // Worklet harus tersambung ke output supaya process() dipanggil; gain 0 supaya tidak terdengar.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.source.connect(this.node).connect(this.mute).connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async stop() {
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.mute?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close();
  }
}

/** Decode file audio (wav/mp3/ogg/...) menjadi Float32Array mono 16 kHz. */
export async function decodeAudioFile(file) {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const out = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) out[i] += data[i] / buffer.numberOfChannels;
    }
    return out;
  } finally {
    await ctx.close();
  }
}

/** Kirim sampel ke onChunk per 100 ms dengan kecepatan real-time. */
export function streamSamples(samples, onChunk, { chunkMs = 100 } = {}) {
  const size = Math.round((SAMPLE_RATE * chunkMs) / 1000);
  let offset = 0;
  let timer;
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  timer = setInterval(() => {
    if (offset >= samples.length) {
      clearInterval(timer);
      finish();
      return;
    }
    onChunk(samples.slice(offset, offset + size));
    offset += size;
  }, chunkMs);

  return {
    done,
    stop() {
      clearInterval(timer);
      finish();
    },
  };
}

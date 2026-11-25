// AudioWorklet: mengambil audio mikrofon blok demi blok (128 sampel per blok)
// lalu mengirimnya ke main thread setiap ~100 ms (1600 sampel @ 16 kHz).
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1600);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      let i = 0;
      while (i < channel.length) {
        const n = Math.min(channel.length - i, this.buffer.length - this.offset);
        this.buffer.set(channel.subarray(i, i + n), this.offset);
        this.offset += n;
        i += n;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);

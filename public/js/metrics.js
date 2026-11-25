// Log latency & hasil transkripsi per kalimat -> bahan Technical Evaluation (TUGAS 4).
// Bisa diunduh sebagai JSON dari panel "Evaluasi & latency".
const log = [];

export function record(entry) {
  log.push({ time: new Date().toISOString(), ...entry });
}

export function entries() {
  return [...log];
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summary() {
  const speech = log.filter((e) => e.source !== 'typed' && typeof e.latencyMs === 'number');
  return {
    utterances: speech.length,
    lastLatencyMs: speech.at(-1)?.latencyMs ?? null,
    avgLatencyMs: avg(speech.map((e) => e.latencyMs)),
    avgAsrMs: avg(speech.map((e) => e.asrMs)),
    avgFirstPartialMs: avg(speech.map((e) => e.firstPartialMs).filter((x) => typeof x === 'number')),
    avgRtf: avg(speech.map((e) => e.rtf)),
    avgTranslateMs: avg(log.map((e) => e.translateMs).filter((x) => typeof x === 'number')),
  };
}

export function clear() {
  log.length = 0;
}

export function downloadJson() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries: log }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unitalk-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

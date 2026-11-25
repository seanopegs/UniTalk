// Text-to-Speech pakai suara bawaan browser / OS (Web Speech Synthesis).
// Catatan: larangan di guide hanya untuk *Speech Recognition* eksternal; TTS boleh.
// TUGAS 2 (Translation & TTS). Kontrak:
//   speak(text, speechLang) -> Promise<void>   (selesai saat suara berhenti)
//   stopSpeaking()
//   hasVoiceFor(speechLang) -> boolean
export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

let voices = [];
let current = null; // simpan referensi supaya utterance tidak di-garbage-collect (bug Chrome)

function loadVoices() {
  voices = window.speechSynthesis.getVoices();
}

if (ttsSupported) {
  loadVoices();
  window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

export function onVoicesChanged(callback) {
  if (ttsSupported) window.speechSynthesis.addEventListener('voiceschanged', callback);
}

export function voicesLoaded() {
  return voices.length > 0;
}

const norm = (lang) => String(lang).replace('_', '-').toLowerCase();

export function pickVoice(speechLang) {
  const wanted = norm(speechLang);
  const prefix = wanted.split('-')[0];
  const exact = voices.filter((v) => norm(v.lang) === wanted);
  const pool = exact.length ? exact : voices.filter((v) => norm(v.lang).startsWith(prefix));
  if (!pool.length) return null;
  // Utamakan suara neural/online (lebih natural), lalu suara Google.
  const score = (v) => (/natural|online|neural/i.test(v.name) ? 2 : 0) + (/google/i.test(v.name) ? 1 : 0);
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

export function hasVoiceFor(speechLang) {
  return Boolean(pickVoice(speechLang));
}

export function speak(text, speechLang, { rate = 1 } = {}) {
  return new Promise((resolve) => {
    if (!ttsSupported || !text) return resolve();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    utterance.rate = rate;
    const voice = pickVoice(speechLang);
    if (voice) utterance.voice = voice;

    // Pengaman: beberapa browser kadang tidak memanggil onend.
    const safety = setTimeout(done, 3000 + text.length * 150);
    function done() {
      clearTimeout(safety);
      if (current === utterance) current = null;
      resolve();
    }
    utterance.onend = done;
    utterance.onerror = done;
    current = utterance;
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking() {
  if (ttsSupported) window.speechSynthesis.cancel();
}

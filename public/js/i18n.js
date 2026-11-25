// Teks antarmuka.
//   PHRASES : kalimat pendek di sisi tiap orang, mengikuti bahasa yang dia pilih.
//   UI      : teks pengaturan & pesan sistem, mengikuti bahasa browser (Indonesia / English).

const PHRASES = {
  en: { greet: 'Hello', idle: 'Tap to speak', listening: 'Listening… tap to finish', processing: 'One moment…' },
  id: { greet: 'Halo', idle: 'Ketuk untuk bicara', listening: 'Mendengarkan… ketuk untuk selesai', processing: 'Sebentar…' },
  ms: { greet: 'Helo', idle: 'Sentuh untuk bercakap', listening: 'Mendengar… sentuh untuk selesai', processing: 'Sebentar…' },
  ja: { greet: 'こんにちは', idle: 'タップして話す', listening: '聞いています… タップで終了', processing: '少々お待ちください…' },
  ko: { greet: '안녕하세요', idle: '탭하여 말하기', listening: '듣는 중… 탭하여 종료', processing: '잠시만요…' },
  'zh-CN': { greet: '你好', idle: '点按说话', listening: '正在聆听… 点按结束', processing: '请稍候…' },
  ar: { greet: 'مرحبا', idle: 'انقر للتحدث', listening: 'جارٍ الاستماع… انقر للإنهاء', processing: 'لحظة…' },
  es: { greet: 'Hola', idle: 'Toca para hablar', listening: 'Escuchando… toca para terminar', processing: 'Un momento…' },
  fr: { greet: 'Bonjour', idle: 'Touchez pour parler', listening: 'J’écoute… touchez pour terminer', processing: 'Un instant…' },
  de: { greet: 'Hallo', idle: 'Tippen zum Sprechen', listening: 'Ich höre zu… zum Beenden tippen', processing: 'Einen Moment…' },
};

export function phrase(langCode, key) {
  return (PHRASES[langCode] ?? PHRASES.en)[key];
}

const UI = {
  id: {
    settings: 'Pengaturan',
    close: 'Tutup',
    swap: 'Tukar bahasa',
    language: 'Bahasa',
    readAloud: 'Bacakan terjemahan',
    recognition: 'Pengenalan suara',
    fast: 'Cepat',
    balanced: 'Seimbang',
    accurate: 'Akurat',
    privacy: 'Suara diproses di perangkat ini. Hanya teks yang dikirim untuk diterjemahkan.',
    faceToFace: 'Tampilan berhadapan',
    evalMode: 'Mode evaluasi',
    exportLog: 'Unduh log',
    testAudio: 'Uji file audio',
    typeTest: 'Ketik kalimat uji',
    run: 'Jalankan',
    send: 'Kirim',
    preparing: 'Menyiapkan pengenalan suara',
    firstTime: 'Hanya saat pertama kali dibuka',
    downloading: (done, total) => `${done} / ${total} MB`,
    loadFailed: 'Gagal memuat. Periksa koneksi internet.',
    retry: 'Coba lagi',
    replay: 'Putar ulang',
    translateFailed: 'Gagal menerjemahkan. Coba lagi.',
    asrError: 'Suara tidak terbaca. Coba lagi.',
    micBlocked: 'Izinkan akses mikrofon di browser.',
    noMic: 'Mikrofon tidak ditemukan.',
    micError: 'Mikrofon tidak bisa dipakai.',
    needLocalhost: 'Buka lewat localhost atau HTTPS agar mikrofon bisa dipakai.',
    noVoice: (names) => `Suara untuk ${names} tidak tersedia di browser ini.`,
    noStats: 'Belum ada data.',
    stats: (s) =>
      `${s.utterances} kalimat · latency rata-rata ${s.latency} · parsial pertama ${s.firstPartial} · RTF ${s.rtf} · terjemahan ${s.translate}`,
  },
  en: {
    settings: 'Settings',
    close: 'Close',
    swap: 'Swap languages',
    language: 'Language',
    readAloud: 'Read translations aloud',
    recognition: 'Speech recognition',
    fast: 'Fast',
    balanced: 'Balanced',
    accurate: 'Accurate',
    privacy: 'Speech is processed on this device. Only text is sent for translation.',
    faceToFace: 'Face-to-face view',
    evalMode: 'Evaluation mode',
    exportLog: 'Download log',
    testAudio: 'Test an audio file',
    typeTest: 'Type a test sentence',
    run: 'Run',
    send: 'Send',
    preparing: 'Preparing speech recognition',
    firstTime: 'Only the first time',
    downloading: (done, total) => `${done} / ${total} MB`,
    loadFailed: 'Could not load. Check your internet connection.',
    retry: 'Try again',
    replay: 'Play again',
    translateFailed: 'Translation failed. Try again.',
    asrError: 'Could not recognise that. Try again.',
    micBlocked: 'Allow microphone access in your browser.',
    noMic: 'No microphone found.',
    micError: 'The microphone cannot be used.',
    needLocalhost: 'Open via localhost or HTTPS to use the microphone.',
    noVoice: (names) => `No ${names} voice is available in this browser.`,
    noStats: 'No data yet.',
    stats: (s) =>
      `${s.utterances} sentences · avg latency ${s.latency} · first partial ${s.firstPartial} · RTF ${s.rtf} · translation ${s.translate}`,
  },
};

export const UI_LANG = String(navigator.language || 'en').toLowerCase().startsWith('id') ? 'id' : 'en';

export function t(key, ...args) {
  const value = UI[UI_LANG][key] ?? UI.en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

// Daftar bahasa yang didukung.
//   code    = kode untuk API terjemahan (ISO 639-1)
//   speech  = kode BCP-47 untuk suara TTS di browser
//   whisper = nama bahasa untuk model Whisper (ASR lokal)
//   label   = nama bahasa dalam bahasanya sendiri (yang dilihat user)
export const LANGUAGES = [
  { code: 'en', speech: 'en-US', whisper: 'english', label: 'English' },
  { code: 'id', speech: 'id-ID', whisper: 'indonesian', label: 'Bahasa Indonesia' },
  { code: 'ms', speech: 'ms-MY', whisper: 'malay', label: 'Bahasa Melayu' },
  { code: 'ja', speech: 'ja-JP', whisper: 'japanese', label: '日本語' },
  { code: 'ko', speech: 'ko-KR', whisper: 'korean', label: '한국어' },
  { code: 'zh-CN', speech: 'zh-CN', whisper: 'chinese', label: '中文' },
  { code: 'ar', speech: 'ar-SA', whisper: 'arabic', label: 'العربية', dir: 'rtl' },
  { code: 'es', speech: 'es-ES', whisper: 'spanish', label: 'Español' },
  { code: 'fr', speech: 'fr-FR', whisper: 'french', label: 'Français' },
  { code: 'de', speech: 'de-DE', whisper: 'german', label: 'Deutsch' },
];

export function getLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

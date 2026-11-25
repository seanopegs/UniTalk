// Mesin terjemahan untuk prototype.
//
// Dipakai provider GRATIS tanpa API key supaya prototype langsung bisa jalan:
//   MyMemory (API publik resmi, kuota gratis ~5.000 karakter/hari per IP,
//             ~50.000 kalau isi MYMEMORY_EMAIL di .env)
//
// TUGAS 2 (Translation & TTS): ganti / tambah provider berkualitas di sini
// (model lokal opus-mt / NLLB, LLM, DeepL, Google Cloud Translation).
// API key disimpan di .env, jangan di kode.
// Kontrak yang harus tetap sama:
//   translateText(text, from, to) -> Promise<{ translation: string, provider: string }>

const TIMEOUT_MS = 8000;

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function myMemory(text, from, to) {
  if (Buffer.byteLength(text, 'utf8') > 500) throw new Error('teks > 500 byte');

  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `${from}|${to}`);
  if (process.env.MYMEMORY_EMAIL) url.searchParams.set('de', process.env.MYMEMORY_EMAIL);

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const main = data?.responseData?.translatedText;
  if (
    Number(data?.responseStatus) !== 200 ||
    !main ||
    /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR|NO QUERY SPECIFIED/i.test(main)
  ) {
    throw new Error(String(data?.responseDetails || main || 'respons kosong'));
  }

  // MyMemory kadang memilih "translation memory" crowd-source yang ngawur
  // (contoh nyata: "Where is the nearest train station?" -> "Ada tiga ayam di rumah saya.").
  // Hasil mesin (created-by "MT!") jauh lebih konsisten, jadi diutamakan.
  const machine = (data.matches ?? []).find((m) => m?.['created-by'] === 'MT!' && m.translation);
  return decodeEntities(machine?.translation ?? main);
}

// Urutan dicoba dari atas; kalau gagal pindah ke berikutnya.
// (Endpoint Google tidak resmi sempat dicoba tapi diblokir, jadi tidak dipakai.)
const PROVIDERS = [['mymemory', myMemory]];

export async function translateText(text, from, to) {
  if (from === to) return { translation: text, provider: 'none' };

  const errors = [];
  for (const [name, fn] of PROVIDERS) {
    try {
      return { translation: await fn(text, from, to), provider: name };
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

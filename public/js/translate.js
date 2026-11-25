// Terjemahan lewat server kita sendiri (/api/translate), supaya API key nanti aman di server.
// TUGAS 2 (Translation & TTS). Kontrak:
//   translate(text, fromCode, toCode) -> Promise<{ text: string, provider: string }>
export async function translate(text, from, to) {
  if (from === to) return { text, provider: 'none' };

  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, from, to }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Gagal menerjemahkan (HTTP ${res.status})`);
  return { text: data.translation, provider: data.provider };
}

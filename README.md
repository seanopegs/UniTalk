# UniTalk — Live Speech Translator

Final Project **COMP6822001 Speech Recognition** (BINUS).

Dua orang dengan bahasa berbeda bisa ngobrol langsung:
**bicara → speech recognition lokal real-time (teks parsial muncul saat masih bicara) → terjemahan → tampil di layar + dibacakan** dalam bahasa lawan bicara.
Prototype ini mulai dari **English ↔ Bahasa Indonesia** (bahasa lain sudah ada di dropdown).

> ⚠️ Sesuai guide (§11), **speech recognition wajib jalan lokal**. Di UniTalk, ASR memakai model **Whisper (ONNX)** yang berjalan **di browser pengguna** lewat transformers.js (WebGPU / WASM). Audio **tidak dikirim** ke API speech recognition mana pun.

---

## Cara menjalankan

Prasyarat:
- **Node.js ≥ 22.9** (tidak perlu `npm install`, tanpa dependency)
- **Google Chrome / Microsoft Edge** versi terbaru (WebGPU + AudioWorklet)
- Internet (untuk unduh model pertama kali + API terjemahan)

```powershell
npm start
```

Buka **http://localhost:3000** → tunggu model selesai dimuat (pertama kali mengunduh ±120 MB untuk whisper-tiny / ±210 MB untuk base, setelah itu tersimpan di cache browser) → izinkan mikrofon.

Model default **whisper-tiny** (paling cepat, cukup untuk bahasa Inggris). Untuk Bahasa Indonesia coba **base/small** lewat dropdown di atas (lebih akurat, tapi lebih lambat).

Cara pakai:
1. Pilih bahasa **Orang A** dan **Orang B**.
2. Tekan mic orang yang mau bicara → bicara. Teks parsial muncul saat masih bicara.
3. Begitu ada jeda ±0,8 detik, kalimat ditutup → diterjemahkan → dibacakan untuk lawan bicara.
4. Tekan mic lagi untuk berhenti. Bisa juga **mengetik** di kolom bawah mic (untuk tes tanpa mic).

Mode pengembangan (auto-restart server saat file server berubah): `npm run dev`.

### Tes tanpa mic (untuk eksperimen)
Buka panel **Evaluasi & latency** di bawah → pilih file audio (`.wav`/`.mp3`) → **Jalankan**.
File diputar dengan kecepatan real-time lewat pipeline yang **sama persis** dengan mic, jadi hasilnya bisa diulang (cocok untuk eksperimen noise, aksen, kecepatan bicara, dll).
Tombol **Unduh log (JSON)** menyimpan transkrip + latency tiap kalimat → bahan evaluasi (lihat `eval/`).

---

## Arsitektur

```
 [Mic] ─► AudioWorklet (16 kHz, chunk 100 ms) ─► VAD energi ─► buffer kalimat
                                                  │ tiap ~0,7 s          │ hening ≥ 0,8 s (endpoint)
                                                  ▼                      ▼
                                 Whisper di Web Worker (LOKAL: WebGPU / WASM)
                                     teks PARSIAL (update)        teks FINAL + metrics
                                                                         │
                                               server Node: POST /api/translate (MyMemory)
                                                                         │
                                     tampil di layar + TTS browser (speechSynthesis) ─► [Orang B]
```

Metrik yang dicatat per kalimat (lihat `public/js/metrics.js`):

| Metrik | Arti |
|---|---|
| `latencyMs` | akhir bicara → teks final muncul (termasuk tunggu hening 0,8 s) |
| `firstPartialMs` | mulai bicara → teks parsial pertama muncul (responsiveness) |
| `asrMs` | waktu inference Whisper untuk kalimat final |
| `rtf` | real-time factor = waktu proses / durasi audio (< 1 = lebih cepat dari real-time) |
| `translateMs` | waktu terjemahan |

### Struktur folder

```
public/
  index.html, css/style.css, js/app.js   UI + alur aplikasi                 (Tugas 3)
  js/asr/streaming-asr.js                streaming: VAD, parsial, final      (Tugas 1)
  js/asr/asr-worker.js                   Whisper lokal (transformers.js)     (Tugas 1)
  js/asr/audio-input.js, audio-processor.js   mic & file audio                (Tugas 1)
  js/translate.js, js/tts.js             terjemahan & suara                  (Tugas 2)
  js/metrics.js                          log latency + export JSON           (Tugas 4)
  js/languages.js                        daftar bahasa
server/
  index.js                               server statis + API                 (Tugas 3)
  translate.js                           provider terjemahan                 (Tugas 2)
eval/
  wer.js                                 hitung WER/CER + error analysis      (Tugas 4)
```

---

## Kesesuaian dengan guide final project

| Syarat di guide | Status |
|---|---|
| Real-time: audio continuous, transkripsi parsial/ter-update saat bicara (§3) | ✅ prototype (perlu dipercepat) |
| ASR lokal, tanpa API speech recognition eksternal (§11) | ✅ Whisper di browser |
| Latency/responsiveness dijelaskan & diukur (§3, §13) | ✅ tercatat per kalimat, bisa diekspor |
| Real problem + target user nyata & spesifik (§4–5) | ⬜ Tugas 5 |
| Technical evaluation: baseline + ≥ 1 kondisi, WER (§12–14) | ⬜ Tugas 4 (`eval/wer.js` sudah siap) |
| User testing ≥ 5 target user nyata + feedback (§6–9) | ⬜ Tugas 5 |
| Technical report sesuai struktur (§15) + bukti (§16) | ⬜ semua |

Catatan: guide hanya melarang **speech recognition** eksternal. Terjemahan (MyMemory) dan TTS (suara browser) bukan speech recognition, tapi **sebaiknya dikonfirmasi ke dosen**. Opsi paling aman: terjemahan juga lokal (lihat Tugas 2).

---

## Hasil uji awal prototype (25 Nov 2026)

Diuji di browser Chromium (WebGPU) memakai **audio sintetis** (suara TTS Windows, bukan suara manusia).
Angka ini **hanya untuk mengecek prototype jalan**, **bukan** data untuk laporan. Eksperimen asli harus diulang dengan rekaman suara manusia.

| Model | Device | Waktu per inference |
|---|---|---|
| whisper-tiny | WebGPU | 0,57–0,74 s |
| whisper-tiny | WASM | 0,9–1,9 s |
| whisper-base | WebGPU | 1,2–2,1 s |
| whisper-base | WASM | 1,6–1,9 s |

Semua menghasilkan transkrip yang sama untuk kalimat uji bahasa Inggris. Bahasa Indonesia **belum diuji** dengan suara asli.

Uji end-to-end (whisper-tiny, WebGPU, file audio diputar real-time):
- Teks parsial ter-update saat "bicara": `Good morning, every` → `… Today` → `… how speech` → `… can help people from` → final + terjemahan.
- Latency akhir bicara → teks final: 2,3–4,3 s (termasuk tunggu hening 0,8 s). Terjemahan ±1,2–1,4 s.
- Contoh terjemahan: "Where is the nearest train station?" → "Di mana stasiun kereta api terdekat?"; "Stasiunnya lurus aja, nanti belok kiri di lampu merah." → "The station is straight ahead, then turn left at the traffic light."

### Masalah yang sudah diketahui
- **Latency masih tinggi** (tiny ±2–4 s, base ±3–6 s dari akhir bicara sampai teks final). Target perbaikan Tugas 1.
- Mic sungguhan **belum** dites (yang dites baru file audio lewat pipeline yang sama). Tes pertama dengan mic perlu dilakukan tim.
- Whisper bukan model streaming asli: parsial = transkripsi ulang buffer yang bertambah, jadi teks parsial bisa "berubah-ubah".
- VAD masih berbasis energi, jadi gampang salah di tempat bising.
- MyMemory: kuota gratis ±5.000 karakter/hari, kualitas naik-turun (sudah dipaksa pakai hasil mesin, bukan translation memory).
- Suara TTS Bahasa Indonesia tergantung browser/OS (Edge: "Microsoft Gadis Online", Chrome: "Google Bahasa Indonesia").

---

## Rencana (sederhana)

1. **Fase 0: Prototype** ✅ (sekarang). End-to-end jalan: ASR lokal streaming → terjemahan → TTS.
2. **Fase 1: Problem & target user.** Tentukan masalah nyata + siapa user-nya, karena ini menentukan bahasa, skenario, dan kondisi eksperimen. *Harus diputuskan paling awal.*
3. **Fase 2: Perbaikan inti.** Turunkan latency, uji akurasi Bahasa Indonesia, terjemahan yang lebih bagus/lokal, UI sesuai skenario user.
4. **Fase 3: Evaluasi teknis.** Dataset rekaman, baseline + kondisi (noise/aksen/kecepatan), WER/CER, latency, error analysis.
5. **Fase 4: User testing.** ≥ 5 target user nyata → feedback → perbaikan → analisis gabungan.
6. **Fase 5: Laporan & demo.** Technical report (§15) dan bukti (§16).

Pembagian kerja 5 orang ada di **[TASKS.md](TASKS.md)**.

## Aturan kerja tim
- Satu branch per tugas (`tugas-1-asr`, `tugas-2-translate`, …), merge ke `main` setelah dicek teman.
- Jangan commit `.env` (API key). Salin dari `.env.example`.
- Semua anggota harus paham cara kerja sistem secara keseluruhan, karena saat demo bisa ditanya.

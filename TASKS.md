# Pembagian Tugas UniTalk (5 orang)

Masing-masing ambil **1 tugas**. Tugas dibagi berdasarkan bagian rubrik penilaian di guide, jadi setiap bagian nilai ada penanggung jawabnya.
Tiap tugas punya **file sendiri**, jadi bisa dikerjakan paralel tanpa saling tabrakan.

| # | Tugas | Bobot rubrik terkait | File utama | Bisa mulai sekarang? |
|---|---|---|---|---|
| 1 | ASR Engine (real-time & lokal) | Real-Time App 30% · Fundamentals 15% | `public/js/asr/*` | ✅ |
| 2 | Translation & Text-to-Speech | Real-Time App 30% | `server/translate.js`, `public/js/translate.js`, `public/js/tts.js` | ✅ |
| 3 | Aplikasi, UI/UX & Integrasi | Real-Time App 30% · usability | `public/index.html`, `public/css/`, `public/js/app.js`, `server/index.js` | ✅ |
| 4 | Technical Evaluation (WER, latency, eksperimen) | Experimental Workflow & Technical Eval 20% | `eval/`, `public/js/metrics.js` | ✅ mulai susun & rekam dataset |
| 5 | Problem, Target User, User Testing & Laporan | Real-World Problem 5% · System Analysis & User Eval 20% | `docs/` | ✅ **paling mendesak** |

> **Keputusan pertama (semua orang):** tentukan **real problem + target user** bareng-bareng (dipimpin Tugas 5). Ini menentukan bahasa, skenario UI, dan kondisi eksperimen.

---

## Tugas 1 — ASR Engine (Real-time & Lokal)

**Tujuan:** speech recognition lokal yang cepat, akurat, dan terasa real-time.

Yang dikerjakan:
- [ ] Pahami & tulis cara kerja Whisper (log-Mel spectrogram, encoder–decoder Transformer, jendela 30 detik, tokenizer) → bahan bab *Speech Recognition Fundamentals* di laporan.
- [ ] **Turunkan latency** (sekarang ±2–4 s dengan tiny, ±3–6 s dengan base):
  - bandingkan whisper tiny / base / small × WebGPU / WASM (dropdown model sudah ada),
  - tuning `silenceMs`, `partialIntervalMs` di `DEFAULT_CONFIG`,
  - cegah transkripsi parsial menghambat transkripsi final.
- [ ] **Stabilkan teks parsial** supaya tidak "berubah-ubah", misalnya dengan *LocalAgreement*: hanya tampilkan kata yang sama di 2 parsial berturut-turut.
- [ ] Ganti VAD energi dengan **Silero VAD (ONNX)** supaya lebih tahan noise.
- [ ] Uji **Bahasa Indonesia** dengan suara asli. Kalau WER jelek, cari model Whisper yang di-fine-tune untuk Indonesia (Hugging Face, format ONNX).
- [ ] (Opsional) Kalau browser terlalu lambat di laptop tim, siapkan alternatif backend Python (`faster-whisper` + WebSocket). Tetap lokal.

**Selesai kalau:** teks parsial muncul ≤ 1 s setelah mulai bicara, latency akhir bicara → teks final ≤ ±1,5 s di laptop tim, dan tidak ada API STT eksternal.
**Kontrak (jangan diubah tanpa ngobrol dengan Tugas 3):** `StreamingSession` → `onPartial(text)`, `onFinal(text, metrics)`.

---

## Tugas 2 — Translation & Text-to-Speech

**Tujuan:** terjemahan yang benar & cepat, dan suara yang jelas di kedua bahasa.

Yang dikerjakan:
- [ ] Ganti/lengkapi MyMemory (kuota ±5.000 karakter/hari, kualitas tidak stabil). Opsi:
  - **lokal**: `opus-mt-en-id` / `opus-mt-id-en` atau NLLB via transformers.js (semua offline, paling aman untuk syarat "lokal"),
  - **API resmi**: DeepL / Google Cloud Translation / LLM. Simpan key di `.env`, panggil dari `server/translate.js`.
- [ ] Bandingkan kualitas & kecepatan beberapa opsi pakai kalimat sehari-hari + bahasa gaul (contoh: "gak", "udah", "mantap") → hasilnya jadi bahan laporan.
- [ ] (Kalau pakai LLM) kirim 2–3 kalimat terakhir sebagai konteks percakapan.
- [ ] TTS: pastikan suara Indonesia ada di Chrome & Edge; tambah pilihan suara/kecepatan; pecah kalimat panjang.
- [ ] **Tanya dosen**: boleh tidak terjemahan/TTS pakai API eksternal (yang dilarang di guide hanya speech recognition).

**Selesai kalau:** ≥ 90% kalimat uji EN↔ID diterjemahkan benar, terjemahan < 1 s, dan TTS Indonesia jalan di Chrome & Edge.
**Kontrak:** `translate(text, from, to) → { text, provider }`, `speak(text, lang) → Promise`.

---

## Tugas 3 — Aplikasi, UI/UX & Integrasi

**Tujuan:** aplikasi yang enak dipakai target user dalam situasi nyata.

Yang dikerjakan:
- [ ] Sesuaikan UI dengan skenario target user. Contoh: **mode tatap muka** (HP di tengah meja, panel Orang B diputar 180°), teks besar, satu tombol.
- [ ] Indikator jelas: Recording/Listening, latency, status (lihat contoh UI di guide §10).
- [ ] Responsive di HP; (opsional) PWA supaya bisa di-install. Catatan: mic di HP butuh HTTPS, jadi perlu deploy atau tunnel.
- [ ] Error handling: mic ditolak, model gagal dimuat, internet putus, kuota terjemahan habis.
- [ ] Riwayat percakapan, tombol salin, ukuran font.
- [ ] Integrasi hasil Tugas 1 & 2 dan pastikan `main` selalu bisa jalan.
- [ ] Ambil **screenshot** untuk laporan (Required Evidence §16).

**Selesai kalau:** user baru bisa pakai tanpa dijelaskan lebih dari 1 menit, dan setiap state punya feedback visual.

---

## Tugas 4 — Technical Evaluation (Eksperimen, WER, Latency)

**Tujuan:** menjawab *"How accurate is the system?"* dan *"How responsive is the system?"* dengan data asli.

Yang dikerjakan:
- [ ] Susun **dataset uji**: ±20–30 kalimat EN & ID sesuai skenario target user, beserta teks referensinya.
- [ ] Rekam oleh beberapa pembicara (minta izin). Simpan file audio + `reference`.
- [ ] **Baseline** (suara bersih, mic laptop) + **minimal 1 kondisi** yang relevan dengan target user: noise (kantin/jalan), aksen, kecepatan bicara, mic HP, dll.
- [ ] Jalankan lewat panel **Evaluasi → Uji pakai file audio** → **Unduh log** → tambahkan `reference` → `node eval/wer.js log.json`.
- [ ] Ukur & bandingkan: WER/CER, latency, first partial, RTF; antar model (tiny/base/small) & device (WebGPU/WASM).
- [ ] **Error analysis**: tabel *Reference / Output / Error type* (otomatis dari `wer.js`) + pola error (nama orang, istilah teknis, aksen, noise).
- [ ] Buat tabel & grafik untuk laporan.

**Selesai kalau:** ada tabel baseline vs kondisi + analisis, dan angkanya bisa direproduksi orang lain.
⚠️ Semua angka harus dari eksperimen yang benar-benar dilakukan. Data palsu = pelanggaran serius.

---

## Tugas 5 — Problem, Target User, User Testing & Laporan

**Tujuan:** membuktikan aplikasi benar-benar menyelesaikan masalah nyata untuk user nyata.

Yang dikerjakan:
- [ ] Pimpin keputusan **real problem + target user** yang konkret dan bisa ditemui. Contoh ide (pilih/ubah bersama tim):
  - mahasiswa internasional/exchange ↔ staf atau mahasiswa lokal (kantin, administrasi, kos),
  - pedagang / staf hotel / guide di area wisata ↔ turis asing.
- [ ] Tulis **Target User, User Problem, Proposed Solution, Usage Scenario** (§4).
- [ ] Susun protokol user testing (§7): task realistis, observasi, kuesioner skala 1–5 (*ease of use, responsiveness, transcription quality, translation quality, overall satisfaction*) + wawancara singkat.
- [ ] Rekrut & uji **≥ 5 target user nyata** (minta izin/consent). Data & feedback **harus dari user asli**.
- [ ] Analisis feedback & hubungkan dengan hasil Tugas 4 → strengths, weaknesses, improvements (§9).
- [ ] Koordinasi **Technical Report** (struktur §15).

**Selesai kalau:** ada data ≥ 5 user nyata beserta analisisnya, dan laporan lengkap sesuai struktur guide.

---

### Catatan untuk semua
- Kerjakan di branch masing-masing, lalu minta 1 teman review sebelum merge ke `main`.
- Semua anggota harus bisa menjelaskan: cara kerja Whisper, cara audio streaming, cara latency & WER dihitung.

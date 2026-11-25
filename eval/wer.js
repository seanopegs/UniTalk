#!/usr/bin/env node
// Hitung WER (Word Error Rate) & CER (Character Error Rate) — TUGAS 4.
//
//   WER = (S + D + I) / N      S = substitusi, D = deletion, I = insertion, N = jumlah kata referensi
//
// Pemakaian:
//   node eval/wer.js eval/samples.example.json
//
// Format input (salah satu):
//   1) [{ "id": "u1", "reference": "teks yang benar", "hypothesis": "hasil ASR" }, ...]
//   2) Log dari aplikasi (tombol "Unduh log (JSON)") yang tiap entrinya SUDAH ditambah
//      field "reference" secara manual. Field "transcript" dipakai sebagai hypothesis.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Huruf kecil, buang tanda baca, rapikan spasi (normalisasi standar sebelum hitung WER). */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein alignment + backtrace -> jumlah S/D/I dan daftar operasi untuk error analysis. */
export function align(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const d = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }

  let i = n;
  let j = m;
  let S = 0;
  let D = 0;
  let I = 0;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] === hyp[j - 1]) ops.push({ type: 'C', ref: ref[i - 1], hyp: hyp[j - 1] });
      else {
        S++;
        ops.push({ type: 'S', ref: ref[i - 1], hyp: hyp[j - 1] });
      }
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      D++;
      ops.push({ type: 'D', ref: ref[i - 1] });
      i--;
    } else {
      I++;
      ops.push({ type: 'I', hyp: hyp[j - 1] });
      j--;
    }
  }
  return { S, D, I, N: n, ops: ops.reverse() };
}

const words = (text) => normalize(text).split(' ').filter(Boolean);
const chars = (text) => [...normalize(text)];

export function wer(reference, hypothesis) {
  return align(words(reference), words(hypothesis));
}

export function cer(reference, hypothesis) {
  return align(chars(reference), chars(hypothesis));
}

const rate = ({ S, D, I, N }) => (N ? (S + D + I) / N : 0);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

async function main(file) {
  if (!file) {
    console.error('Pemakaian: node eval/wer.js <file.json>');
    process.exit(1);
  }
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const items = (Array.isArray(raw) ? raw : raw.entries ?? [])
    .map((e, idx) => ({
      id: e.id ?? `#${idx + 1}`,
      reference: e.reference,
      hypothesis: e.hypothesis ?? e.transcript,
    }))
    .filter((e) => typeof e.reference === 'string' && typeof e.hypothesis === 'string');

  if (!items.length) {
    console.error('Tidak ada entri yang punya "reference" dan "hypothesis"/"transcript".');
    process.exit(1);
  }

  const totalW = { S: 0, D: 0, I: 0, N: 0 };
  const totalC = { S: 0, D: 0, I: 0, N: 0 };
  const rows = [];
  const errors = [];

  for (const item of items) {
    const w = wer(item.reference, item.hypothesis);
    const c = cer(item.reference, item.hypothesis);
    for (const k of ['S', 'D', 'I', 'N']) {
      totalW[k] += w[k];
      totalC[k] += c[k];
    }
    rows.push({ id: item.id, N: w.N, S: w.S, D: w.D, I: w.I, WER: pct(rate(w)), CER: pct(rate(c)) });
    for (const op of w.ops) {
      if (op.type === 'S') errors.push({ id: item.id, type: 'Substitution', reference: op.ref, output: op.hyp });
      if (op.type === 'D') errors.push({ id: item.id, type: 'Deletion', reference: op.ref, output: '' });
      if (op.type === 'I') errors.push({ id: item.id, type: 'Insertion', reference: '', output: op.hyp });
    }
  }

  console.log('\nPer kalimat:');
  console.table(rows);
  console.log(`Total (corpus-level): WER = ${pct(rate(totalW))}  (S=${totalW.S}, D=${totalW.D}, I=${totalW.I}, N=${totalW.N})`);
  console.log(`                      CER = ${pct(rate(totalC))}`);
  if (errors.length) {
    console.log('\nContoh kesalahan (bahan Error Analysis):');
    console.table(errors.slice(0, 30));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]);
}

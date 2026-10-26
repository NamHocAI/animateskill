#!/usr/bin/env node
// After a piece is delivered: free the disk, keep what the next episode needs
//   keeps:   renders/*.mp4, the sources (src/, piece.json, brief.md, LOG.md, voice/ takes, assets/, audio/), index.html,
//            the look / storyboard PNGs, and stills/ — a few frames pulled from final.mp4 (first, evenly spaced, last)
//            so a follow-up episode can match the look and pick up where this one ended
//   removes: frames*/ (the PNG sequence, the bulk: GBs), review*/ (contact sheets), renders/*.wav (export remakes them)
// Re-export (tools/export.mjs) to get the frames back; review.mjs needs them.
//
// usage: node tools/clean.mjs pieces/<name> [--stills 6] [--dry]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (!argv[0] || argv[0].startsWith('--')) { console.error('usage: node tools/clean.mjs pieces/<name> [--stills 6] [--dry]'); process.exit(2); }
const ROOT = path.resolve(argv[0]);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const DRY = argv.includes('--dry');
const N = Math.max(0, parseInt(opt('stills', '6'), 10));
const RENDERS = path.join(ROOT, 'renders'), FINAL = path.join(RENDERS, 'final.mp4');
if (!fs.existsSync(FINAL)) { console.error('no renders/final.mp4: export first (clean only runs on a delivered piece)'); process.exit(1); }

const size = (p) => { const s = fs.statSync(p); return s.isDirectory() ? fs.readdirSync(p).reduce((a, n) => a + size(path.join(p, n)), 0) : s.size; };

// the stills: first frame, N-2 evenly spaced, the last frame (the next episode starts from it)
if (N > 0) {
  const dur = parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', FINAL]).stdout.toString());
  const STILLS = path.join(ROOT, 'stills');
  if (!DRY) fs.mkdirSync(STILLS, { recursive: true });
  const last = Math.max(0, dur - 0.1);
  const times = N === 1 ? [last] : Array.from({ length: N }, (_, k) => Math.min(last, (k / (N - 1)) * dur));
  for (const [k, t] of times.entries()) {
    const out = path.join(STILLS, `s${String(k + 1).padStart(2, '0')}-${t.toFixed(1)}s${k === times.length - 1 ? '-end' : ''}.jpg`);
    if (DRY) { console.log('would write', path.relative(ROOT, out)); continue; }
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', FINAL, '-frames:v', '1', '-q:v', '2', out], { stdio: 'inherit' });
    if (r.status !== 0) { console.error('still failed at', t); process.exit(1); }
  }
  if (!DRY) console.log(`stills/: ${times.length} frames from final.mp4`);
}

const doomed = [
  ...fs.readdirSync(ROOT).filter((n) => /^(frames|review)(-\d+x\d+)?$/.test(n)).map((n) => path.join(ROOT, n)),
  ...(fs.existsSync(RENDERS) ? fs.readdirSync(RENDERS).filter((n) => n.endsWith('.wav')).map((n) => path.join(RENDERS, n)) : []),
];
let freed = 0;
for (const p of doomed) {
  const s = size(p); freed += s;
  console.log(`${DRY ? 'would remove' : 'removed'} ${path.relative(ROOT, p)} (${(s / 1e6).toFixed(0)} MB)`);
  if (!DRY) fs.rmSync(p, { recursive: true, force: true });
}
console.log(`${DRY ? 'would free' : 'freed'} ${(freed / 1e9).toFixed(2)} GB; kept renders/*.mp4, the sources and stills/`);

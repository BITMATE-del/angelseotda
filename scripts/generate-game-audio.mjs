#!/usr/bin/env node
/**
 * ANGEL SUTDA 자체 효과음 · 보이스 생성 스크립트.
 *
 * - 보이스: espeak-ng 한국어 음성 합성 → 자체 생성 음원 (외부 게임 음원 복사 없음)
 * - 효과음: 이 스크립트 안에서 파형을 직접 합성 (샘플 라이브러리 미사용)
 *
 * 사용법: node scripts/generate-game-audio.mjs [--force]
 * 결과물: public/audio/game/*.mp3
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/audio/game";
const TMP = "/tmp/angel-audio";
const force = process.argv.includes("--force");
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const SR = 44100;

/* ─────────── 파형 합성 유틸 ─────────── */
function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  return buf;
}

const env = (t, dur, attack = 0.005, release = 0.25) => {
  const a = Math.min(attack, dur * 0.4);
  if (t < a) return t / a;
  const r = Math.min(release, dur);
  const start = dur - r;
  return t > start ? Math.max(0, 1 - (t - start) / r) : 1;
};

function synth(dur, fn) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, dur);
  return out;
}

const tone = (f, t) => Math.sin(2 * Math.PI * f * t);
const noise = () => Math.random() * 2 - 1;

/* ─────────── 효과음 정의 ─────────── */
const SFX = {
  /** 카드 1장 놓는 소리 */
  "card-deal": () =>
    synth(0.2, (t, d) => {
      const swish = noise() * Math.exp(-t * 34) * 0.5;
      const tap = tone(180 - t * 200, t) * Math.exp(-t * 42) * 0.35;
      return (swish + tap) * env(t, d, 0.002, 0.06);
    }),
  /** 라운드 시작 딜링 (연속 카드) */
  "round-start": () =>
    synth(0.95, (t, d) => {
      let v = 0;
      for (let k = 0; k < 5; k++) {
        const s = t - k * 0.15;
        if (s > 0) v += (noise() * Math.exp(-s * 40) * 0.35 + tone(200, s) * Math.exp(-s * 50) * 0.2);
      }
      v += tone(392, t) * 0.08 * env(t, d, 0.4, 0.4);
      return v * env(t, d, 0.005, 0.15);
    }),
  /** 쪼기 시작 — 긴장감 */
  "peel-start": () =>
    synth(1.1, (t, d) => {
      const rise = tone(120 + t * 130, t) * 0.22;
      const trem = 1 + 0.35 * Math.sin(2 * Math.PI * 6 * t);
      const hiss = noise() * 0.06 * (t / d);
      return (rise * trem + hiss) * env(t, d, 0.25, 0.35);
    }),
  /** 사이드팟 생성 */
  "side-pot": () =>
    synth(0.4, (t, d) => {
      const bell = tone(880, t) * 0.25 + tone(1320, t) * 0.12;
      return bell * Math.exp(-t * 7) * env(t, d, 0.004, 0.2);
    }),
  /** 쿼터 베팅 */
  "bet-quarter": () =>
    synth(0.34, (t, d) => {
      const thud = tone(150, t) * Math.exp(-t * 16) * 0.4;
      const clink = (tone(1180, t) + tone(1560, t) * 0.6) * Math.exp(-t * 18) * 0.16;
      return (thud + clink) * env(t, d, 0.003, 0.14);
    }),
  /** 승부패 확정 */
  "hand-submit": () =>
    synth(0.36, (t, d) => {
      const stamp = (noise() * 0.4 + tone(90, t) * 0.6) * Math.exp(-t * 26);
      const ring = tone(660, t) * Math.exp(-t * 9) * 0.15;
      return (stamp + ring) * env(t, d, 0.002, 0.16);
    }),
  /** 턴 알림 */
  "turn-start": () =>
    synth(0.3, (t, d) => (tone(784, t) * 0.2 + tone(1046, t) * 0.14) * Math.exp(-t * 8) * env(t, d, 0.004, 0.16)),
};

/* ─────────── 보이스 정의 (한국어 합성) ─────────── */
const VOICE = {
  "voice-check": "체크",
  "voice-bbing": "삥",
  "voice-call": "콜",
  "voice-ddadang": "따당",
  "voice-quarter": "쿼터",
  "voice-half": "하프",
  "voice-allin": "올인",
  "voice-die": "다이",
  "voice-jjol": "쫄",
  "voice-gwang38": "삼팔 광땡",
  "voice-gwang18": "일팔 광땡",
  "voice-gwang13": "일삼 광땡",
  "voice-ddaeng10": "장땡",
  "voice-ddaeng9": "구땡",
  "voice-ddaeng8": "팔땡",
  "voice-ddaeng7": "칠땡",
  "voice-ddaeng6": "육땡",
  "voice-ddaeng5": "오땡",
  "voice-ddaeng4": "사땡",
  "voice-ddaeng3": "삼땡",
  "voice-ddaeng2": "이땡",
  "voice-ddaeng1": "삥땡",
  "voice-ali": "알리",
  "voice-doksa": "독사",
  "voice-gubing": "구삥",
  "voice-jangbing": "장삥",
  "voice-jangsa": "장사",
  "voice-seryuk": "세륙",
  "voice-gapo": "갑오",
  "voice-mangtong": "망통",
  "voice-amhaeng": "암행어사",
  "voice-ddaengjabi": "땡잡이",
  "voice-gusa": "구사",
  "voice-meongtong-gusa": "멍텅구리 구사",
  "voice-rematch": "재경기",
  "voice-winner": "승리",
  "voice-showdown": "승부",
  /** 내 턴 알림 (UX) */
  "voice-your-turn": "본인의 턴입니다",
  "voice-select-open-card": "공개할 패를 선택하세요",
  "voice-select-make": "패를 선택하세요",
};

function espeak(text, wavPath) {
  execFileSync("nix", [
    "run",
    "nixpkgs#espeak-ng",
    "--",
    "-v",
    "ko",
    "-s",
    "155",
    "-p",
    "35",
    "-a",
    "170",
    "-w",
    wavPath,
    text,
  ]);
}

function toMp3(wavPath, name, filters) {
  const out = join(OUT, `${name}.mp3`);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    wavPath,
    "-af",
    filters,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-b:a",
    "96k",
    out,
  ]);
  return out;
}

let made = 0;
for (const [name, gen] of Object.entries(SFX)) {
  const out = join(OUT, `${name}.mp3`);
  if (existsSync(out) && !force) continue;
  const w = join(TMP, `${name}.wav`);
  writeFileSync(w, wav(gen()));
  toMp3(w, name, "loudnorm=I=-16:TP=-1.5:LRA=11");
  made++;
  console.log("sfx  ", name);
}

for (const [name, text] of Object.entries(VOICE)) {
  const out = join(OUT, `${name}.mp3`);
  if (existsSync(out) && !force) continue;
  const w = join(TMP, `${name}.wav`);
  espeak(text, w);
  // ANGEL SUTDA 보이스 톤: 살짝 낮은 피치 + 짧은 룸 리버브 + 라우드니스 정규화
  toMp3(
    w,
    name,
    "asetrate=44100*0.94,aresample=44100,atempo=1.04,aecho=0.8:0.75:38:0.18,loudnorm=I=-15:TP=-1.5:LRA=11",
  );
  made++;
  console.log("voice", name, text);
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n생성 완료: ${made}개 (public/audio/game)`);

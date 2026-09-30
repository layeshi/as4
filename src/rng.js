// SPEC-M1 §11.5：可复现的伪随机数。
// 带状态的 sfc32；状态是 4 个 int32 组成的数组，可直接存入世界快照（world.rng[stream]）。
// 三条独立的流：world（探索、梦、遗物顺序、忘川）、weather（天象排期）、sandbox（沙盘脑决策）。
// 引擎代码禁止使用 Math.random()；随机数只从这里取。

export const STREAMS = Object.freeze(['world', 'weather', 'sandbox']);

/** cyrb128：把字符串散列成 4 个 uint32 */
function cyrb128(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 | 0, h2 | 0, h3 | 0, h4 | 0];
}

/** 由种子与流名创建一条流的初始状态 */
export function createStream(seed, name) {
  const s = cyrb128(`${seed}\u0000${name}`);
  for (let i = 0; i < 15; i++) next(s); // 预热
  return s;
}

/** 创建 world.rng 的初始值 */
export function createStreams(seed) {
  const out = {};
  for (const name of STREAMS) out[name] = createStream(seed, name);
  return out;
}

/** 取下一个 [0, 1) 的浮点数，并原地推进状态 */
export function next(s) {
  let a = s[0];
  let b = s[1];
  let c = s[2];
  let d = s[3];
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a;
  s[1] = b;
  s[2] = c;
  s[3] = d;
  return (t >>> 0) / 4294967296;
}

/** 取 [0, n) 的整数 */
export function int(s, n) {
  return Math.floor(next(s) * n);
}

/** 从数组中取一个元素 */
export function pick(s, arr) {
  return arr[int(s, arr.length)];
}

/** Fisher–Yates 洗牌（原地，返回同一数组） */
export function shuffle(s, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = int(s, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** 按权重抽取。entries 为 [key, weight] 数组；权重须为非负整数。 */
export function pickWeighted(s, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = int(s, total);
  for (const [key, w] of entries) {
    if (r < w) return key;
    r -= w;
  }
  return entries[entries.length - 1][0];
}

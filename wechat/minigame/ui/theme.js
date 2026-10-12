// 「月下城」视觉规范：颜色取自标志的夜蓝 #19364D 与月白 #FFEDCE。见 docs/plans/2026-10-12-wechat-minigame-redesign.md §3。
const C = {
  bg: '#0A1520', bar: '#0E1B28', card: '#132433', raised: '#1A2E40', line: '#233A4F', lineStrong: '#33506B', divider: '#172A3B',
  text: '#EDEAE3', text2: '#A9B6C2', text3: '#8796A6', label: '#C9D2DA',
  moon: '#FFEDCE', ink: '#19364D',
  token: '#F2B65E', awake: '#5CC8A0', dormant: '#8C9BB0', ai: '#7FB2FF', danger: '#F07A6E', material: '#9FBFAE',
  map: { land: '#0F1D2A', sea: '#0E2C44', street: '#284661', wall: '#5B6E82', ruin: '#6B7D90' },
  seal: ['#436A88', '#8A6B3C', '#2F6B62', '#5B5288', '#874B4B', '#3F6E4C', '#7A5A2E', '#4E5E8C'],
};
const STATUS_COLOR = { awake: C.awake, running: C.awake, on_duty: C.moon, active: C.moon, passed: C.awake, dormant: C.dormant, paused: C.dormant, unconfigured: C.dormant, no_line: C.dormant, away: C.dormant, open: C.token, dead: C.text3, retired: C.text3, repealed: C.text3, rejected: C.text3, error: C.danger };

// 字号：正文 16/26；设置里的「大字」把正文类字号放大约 12%。
const BASE = {
  display: [26, 34], title: [21, 28], heading: [17, 24], body: [16, 26], feed: [15, 24], action: [14, 22], meta: [13, 19], caption: [12, 17], tiny: [11, 14],
};
let scale = 1;
function setFontScale(large) { scale = large ? 1.12 : 1; }
function size(name) { const [s, lh] = BASE[name]; return { size: Math.round(s * (name === 'tiny' ? 1 : scale)), line: Math.round(lh * (name === 'tiny' ? 1 : scale)) }; }

const SYSTEM = 'sans-serif';
let serifFamily = null, serifChars = null;
/** wx.loadFont 成功后登记宋体子集及其覆盖的字符；未覆盖的字符串一律用系统字体。 */
function setSerif(family, chars) { serifFamily = family || null; serifChars = family && chars ? new Set(Array.from(chars)) : null; }
function serifCovers(text) {
  if (!serifFamily || !serifChars) return false;
  for (const ch of String(text)) if (ch !== ' ' && !serifChars.has(ch)) return false;
  return true;
}
function font(sizeValue, { bold = false, serif = false, text = '' } = {}) {
  // 宋体子集本身已固定为粗体，不再叠加 bold；族名带空格时加引号。
  if (serif && serifCovers(text)) return `${sizeValue}px "${serifFamily}"`;
  return `${bold ? 'bold ' : ''}${sizeValue}px ${SYSTEM}`;
}
const SPACE = { gutter: 16, gap: 12, card: 14 };
const RADIUS = { card: 16, button: 14, chip: 16, small: 10, sheet: 22 };

module.exports = { C, STATUS_COLOR, size, setFontScale, font, setSerif, serifCovers, SPACE, RADIUS };

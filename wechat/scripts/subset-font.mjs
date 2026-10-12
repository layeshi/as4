// 生成标题宋体子集：只保留小游戏界面里写定的字（页面、标题、固定文案）、数字与常用标点。
// 用法：node wechat/scripts/subset-font.mjs <NotoSerifSC[wght].ttf> <OFL.txt>
// 需要 HarfBuzz 的 hb-subset（支持 --variations，把可变字体固定为粗体）。源字体放在仓库以外；仓库里只放子集与许可证。
import { readFile, writeFile, readdir, mkdir, copyFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'minigame');
const [source, license] = process.argv.slice(2);
if (!source || !license) { console.error('用法：node wechat/scripts/subset-font.mjs <NotoSerifSC[wght].ttf> <OFL.txt>'); process.exit(1); }

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else if (path.endsWith('.js') && !path.endsWith('shared-text.js') && !path.endsWith('serif-chars.js')) out.push(path);
  }
  return out;
}
const chars = new Set(Array.from('0123456789 ·，。、：；「」《》（）—…?？!！'));
// 公共角色与默认城名来自服务器，也会出现在标题和印章里。
for (const ch of '引舟鸣钟载简目录持平筹守泉衡尺护芽留灯居无名之城后人纪词元本位月下') chars.add(ch);
for (const path of await files(root)) {
  const code = await readFile(path, 'utf8');
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) for (const ch of m[2]) if (/[　-〿一-鿿＀-￯]/.test(ch)) chars.add(ch);
}
const text = [...chars].sort().join('');
await mkdir(join(root, 'fonts'), { recursive: true });
const list = join(tmpdir(), 'heirs-serif-chars.txt');
await writeFile(list, text);
const output = join(root, 'fonts', 'HeirsSerif.ttf');
execFileSync('hb-subset', ['--font-file=' + source, '--text-file=' + list, '--output-file=' + output, '--variations=wght=700', '--no-hinting'], { stdio: 'inherit' });
await copyFile(license, join(root, 'fonts', 'OFL.txt'));
await writeFile(join(root, 'ui', 'serif-chars.js'), `// 宋体子集覆盖的字符，由 wechat/scripts/subset-font.mjs 生成；为空时不加载字体，标题用系统字体。\nmodule.exports = ${JSON.stringify(text)};\n`);
console.log(`已生成 ${output}：${chars.size} 个字符，${Math.ceil((await stat(output)).size / 1024)} KiB`);

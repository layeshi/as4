import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
// 小游戏构建仍需要的生成模块：助手回答解析不进入普通小程序；句式模块去掉模型服务商目录。
const EXCLUDED = new Set(['utils/answer-markdown.js']);
export function observationSharedText(source) {
  const lines = source.split('\n'), index = lines.findIndex(line => line.startsWith('const DATA = '));
  if (index < 0 || !lines[index].endsWith(';')) throw new Error('utils/shared-text.js 格式已变，请更新 wechat/scripts/miniprogram.mjs');
  const data = JSON.parse(lines[index].slice('const DATA = '.length, -1));
  delete data.MODEL_PRESETS;
  lines[index] = 'const DATA = ' + JSON.stringify(data) + ';';
  const output = lines.join('\n').replace(' MODEL_PRESETS: DATA.MODEL_PRESETS,', '');
  if (output.includes('MODEL_PRESETS')) throw new Error('utils/shared-text.js 的模型目录未能移除，请更新 wechat/scripts/miniprogram.mjs');
  return output;
}
export async function syncMiniprogram(root) {
  const source = join(root, 'minigame'), dest = join(root, 'miniprogram-app/runtime');
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  // Copy only the shared controller and its dependencies; game.js is not a Mini Program entry.
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (['game.js', 'game.json', 'config.js'].includes(entry.name)) continue;
    await cp(join(source, entry.name), join(dest, entry.name), { recursive: true, filter: path => !EXCLUDED.has(path.slice(source.length + 1).split('\\').join('/')) });
  }
  const shared = join(dest, 'utils', 'shared-text.js');
  await writeFile(shared, observationSharedText(await readFile(shared, 'utf8')));
  await writeFile(join(dest, 'config.js'), await readFile(join(root, 'miniprogram-app/config.js')));
}

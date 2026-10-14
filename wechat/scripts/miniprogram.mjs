import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
export async function syncMiniprogram(root) {
  const source = join(root, 'minigame'), dest = join(root, 'miniprogram-app/runtime');
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  // Copy only the shared controller and its dependencies; game.js is not a Mini Program entry.
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (['game.js', 'game.json', 'config.js'].includes(entry.name)) continue;
    await cp(join(source, entry.name), join(dest, entry.name), { recursive: true });
  }
  await writeFile(join(dest, 'config.js'), await readFile(join(root, 'miniprogram-app/config.js')));
}

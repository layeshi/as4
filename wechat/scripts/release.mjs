import { readFile, writeFile, readdir, stat, mkdir, cp, rm, access } from 'node:fs/promises';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { isIP } from 'node:net';
import { syncMiniprogram } from './miniprogram.mjs';
import { buildSharedModule, SHARED_TARGET } from './shared.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, process.env.WECHAT_TARGET === 'game' ? 'build' : 'build-miniprogram');
const require = createRequire(import.meta.url);
const mode = process.argv[2] || 'check';
const offline = process.argv.includes('--offline');
const projectConfig = JSON.parse(await readFile(join(root, process.env.WECHAT_TARGET === 'game' ? 'project.game.config.json' : 'project.config.json'), 'utf8'));
const game = projectConfig.compileType === 'game';
const source = resolve(root, projectConfig.miniprogramRoot);

async function files(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('小程序代码目录不接受符号链接');
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}
function validateOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || isIP(url.hostname) || !url.hostname.includes('.')) throw new Error('接口必须是无路径、无端口、无凭据的 HTTPS 域名');
  return url.origin;
}
async function check() {
  const all = await files(source);
  let bytes = 0;
  for (const path of all) {
    bytes += (await stat(path)).size;
    const body = await readFile(path, 'utf8');
    if (/\.(key|pem|zip|enc)$/i.test(path)) throw new Error('代码目录包含私钥或数据文件');
    if (path.endsWith('.json')) JSON.parse(body);
    if (path.endsWith('.wxml')) for (const match of body.matchAll(/wx:(?:if|elif)="([^"]*)"/g)) {
      if (!/^\{\{.+\}\}$/.test(match[1])) throw new Error('条件渲染必须绑定表达式，不能使用恒真的字符串：' + relative(root, path));
    }
    if (path.endsWith('.js')) {
      new Script('(function(require,module,exports){\n' + body + '\n})', { filename: path });
      for (const match of body.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
        if (!match[1].startsWith('.')) throw new Error('小程序存在未构建的 npm 依赖：' + match[1]);
        const module = resolve(dirname(path), match[1] + '.js');
        if (!module.startsWith(source + sep)) throw new Error('客户端模块引用超出上传目录：' + relative(root, module));
        await stat(module);
      }
    }
  }
  let pageCount = 0;
  if (game) {
    JSON.parse(await readFile(join(source, 'game.json'), 'utf8')); await stat(join(source, 'game.js'));
    for (const name of ['view']) {
      if ((await readFile(join(source, 'utils', name + '.js'), 'utf8')) !== (await readFile(join(root, 'miniprogram', 'utils', name + '.js'), 'utf8'))) throw new Error('小游戏公共模块待同步，请运行 prepare');
    }
    if ((await readFile(join(source, SHARED_TARGET), 'utf8')) !== await buildSharedModule()) throw new Error('小游戏句式模块与网站 public/i18n.js 不一致，请运行 prepare');
  } else {
    const app = JSON.parse(await readFile(join(source, 'app.json'), 'utf8'));
    for (const page of app.pages) for (const ext of ['.js', '.json', '.wxml']) await stat(join(source, page + ext));
    for (const tab of app.tabBar?.list || []) if (!app.pages.includes(tab.pagePath)) throw new Error('底部导航指向不存在的页面');
    pageCount = app.pages.length;
  }
  const config = require(join(source, 'config.js'));
  const apiBase = validateOrigin(process.env.WECHAT_API_BASE || config.apiBase);
  if (bytes > 2 * 1024 * 1024) throw new Error('客户端源文件超过 2 MiB，请检查打包内容');
  console.log(`本地检查通过：${game ? 'Canvas 小游戏' : pageCount + ' 个页面'}，${all.length} 个文件，${Math.ceil(bytes / 1024)} KiB 源文件。`);
  console.log('以上是结构与 JavaScript 语法检查；微信编译与真机检查另行执行。');
  if (!offline) {
    for (const path of ['/api/public/state', '/api/public/map', '/api/public/events?recent=1&limit=3', '/api/account']) {
      const response = await fetch(apiBase + path, { signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw new Error('上线接口检查失败：' + path + ' HTTP ' + response.status);
      const data = await response.json();
      if (path.endsWith('/state') && (!data.world || !Array.isArray(data.agents) || !Array.isArray(data.places))) throw new Error('城市状态格式不兼容');
      if (path.endsWith('/map') && (!Array.isArray(data.places) || !Array.isArray(data.size))) throw new Error('地图格式不兼容');
      if (path.includes('/events?') && !Array.isArray(data.events)) throw new Error('事件格式不兼容');
      console.log('HTTPS 公开接口正常：' + path);
    }
  }
  return { config, apiBase };
}
async function prepare(checked) {
  const project = projectConfig;
  const appid = process.env.WECHAT_APPID || project.appid;
  if (!/^wx[0-9a-f]{16}$/.test(appid)) throw new Error('需要真实的小程序 AppID');
  await rm(build, { recursive: true, force: true });
  await mkdir(build, { recursive: true });
  await cp(source, join(build, project.miniprogramRoot), { recursive: true });
  await writeFile(join(build, project.miniprogramRoot, 'config.js'), 'module.exports = ' + JSON.stringify({ ...checked.config, ...(!game ? { appid } : {}), version: process.env.WECHAT_VERSION || checked.config.version, apiBase: checked.apiBase }, null, 2) + ';\n');
  if (!game) await cp(join(build, project.miniprogramRoot, 'config.js'), join(build, project.miniprogramRoot, 'runtime/config.js'));
  await writeFile(join(build, 'project.config.json'), JSON.stringify({ ...project, appid }, null, 2) + '\n');
  console.log('开发者工具导入目录：' + build);
  return appid;
}
async function main() {
  if (!['check', 'prepare', 'preview', 'upload'].includes(mode)) throw new Error('操作应为 check / prepare / preview / upload');
  if (!game && ['preview', 'upload'].includes(mode)) {
    const pending = await access(join(root, 'NEW-ACCOUNT-PENDING')).then(() => true, () => false);
    if (pending) throw new Error('等待新普通小程序账号注册和AppID配置，旧账号上传已停止。');
  }
  if (game && mode !== 'check') {
    for (const name of ['view']) await cp(join(root, 'miniprogram', 'utils', name + '.js'), join(source, 'utils', name + '.js'));
    await writeFile(join(source, SHARED_TARGET), await buildSharedModule());
  }
  if (!game) await syncMiniprogram(root);
  const checked = await check();
  if (mode === 'check') return;
  const appid = await prepare(checked);
  if (mode === 'prepare') return;
  const key = process.env.WECHAT_PRIVATE_KEY_PATH;
  if (!key) throw new Error('需要 WECHAT_PRIVATE_KEY_PATH，或用微信开发者工具登录后手动上传');
  const keyPath = resolve(key);
  if (!relative(source, keyPath).startsWith('..') || !relative(build, keyPath).startsWith('..')) throw new Error('上传私钥必须放在小程序源代码和打包目录以外');
  await stat(keyPath);
  let ci;
  try { ci = require('miniprogram-ci'); } catch (_) { throw new Error('先在 wechat/ 运行 npm ci 安装官方上传工具'); }
  const project = new ci.Project({ appid, type: game ? 'miniGame' : 'miniProgram', projectPath: build, privateKeyPath: keyPath, ignores: ['node_modules/**/*'] });
  const options = { project, version: process.env.WECHAT_VERSION || checked.config.version, desc: '后人纪 · AI 社会模拟、城市实况、档案与造者入口', setting: { useProjectConfig: true }, robot: 1 };
  if (mode === 'preview') {
    await ci.preview({ ...options, qrcodeFormat: 'image', qrcodeOutputDest: join(build, 'preview.png'), ...(game ? {} : { pagePath: 'pages/society/index' }) });
    console.log('预览码：' + join(build, 'preview.png'));
  } else {
    await ci.upload(options);
    console.log('开发版本上传成功。尚需微信后台提交审核，审核通过后再发布。');
  }
}
main().catch(error => { console.error(error.message); process.exit(1); });

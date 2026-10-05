// SPEC-P2 T8：被叫醒（runner/loop.js 的 waitTickOrWake）。城是真的，等待用进程内客户端的 wait（rt.onWake），时间是真的（城的刻是 1 秒）；
// 只测等待与叫醒的逻辑，所以每个用例的「下一刻」都设在一两秒之后。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openCity, drive, lastUser, scripted, sleepMs } from './p2-loop-helpers.js';

const NATIVE = { toolMode: 'native' };
const call = (name, args) => ({ name, args });
const say = (text) => ({ type: 'say', text });
const END = { calls: [call('act', { actions: [], end: true })] };
const WAKING = { deps: { waitWake: undefined } }; // 用 client.wait（进程内），不关掉被叫醒
const inboxOf = (text) => (/【收件箱】\n([\s\S]*?)(?=\n【|$)/.exec(text) || [])[1] || '';

/** 一个脚本化的等待函数：按顺序返回 steps 里的结果；用完之后阻塞到 timeoutMs 再返回空 */
function scriptedWait(steps, calls = []) {
  return async ({ after, timeoutMs, signal }) => {
    calls.push({ after, timeoutMs });
    const step = steps.shift();
    if (step instanceof Error) throw step;
    if (step) return step;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.min(timeoutMs, 300));
      if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    return { ok: true, status: 200, json: { items: [], cursor: after } };
  };
}

// ═══════════════════════════════════════════════════════════════
// 叫醒
// ═══════════════════════════════════════════════════════════════

test('P2 T8 等待中收到会叫醒的收件：防抖之后重新感知、再醒来一次——开头是【被叫醒】与【这一刻早些时候】，轨迹与用量的 kind 是 wake', async () => {
  const city = openCity({ seed: 'wake-1', loop: { wakes: 2, wakeTurns: 2, debounceSec: 0.1 } });
  try {
    const [a, b] = city.ids;
    city.rt.nextTickAt = Date.now() + 1800;
    const running = drive(city, a, { cfg: NATIVE, ...WAKING, script: [
      { calls: [call('act', { thought: '主醒来的想法', actions: [say('主醒来')], end: true })] },
      { calls: [call('look', { what: 'self' })] },
      { calls: [call('act', { actions: [{ type: 'whisper', to: b, text: '回话' }], end: true })] },
    ] });
    await sleepMs(300);
    const t0 = Date.now();
    city.exec(b, [{ type: 'whisper', to: a, text: '有人找你' }]);
    const out = await running;
    assert.deepEqual(out.result, { rounds: 1, acted: 2, stopped: 'maxRounds' });
    assert.deepEqual(out.wakings.map((w) => [w.rec.kind, w.rec.turns, w.rec.ended]), [['main', 1, 'end'], ['wake', 2, 'end']]);
    // 被叫醒的开头
    const wake = out.requests[1].transcript[0].text;
    assert.ok(wake.startsWith('【被叫醒】这一刻还没结束，有人找你。\n【这一刻早些时候】\n'));
    assert.match(wake, /【这一刻早些时候】\n(?: {2}[^\n]*\n)*? {2}做了：say ✓（−1）\n {2}独白：主醒来的想法\n【此刻】/);
    assert.ok(inboxOf(wake).includes('[私语] 乙：有人找你'));
    assert.match(wake, /\n【你】甲 · /);
    assert.ok(wake.includes('【你在】港口 [port]'));
    assert.ok(!wake.includes('【全城】') && !wake.includes('【动作的即时状态】'), '开头是短的：没有全城与动作表');
    // 用量与轨迹：waking 里 kind 是 wake，turn 从 1 数起；看的次数醒来与被叫醒合计（主醒来没看，被叫醒看了一次）
    assert.deepEqual(out.usage.map((u) => [u.waking.kind, u.waking.turn]), [['main', 1], ['wake', 1], ['wake', 2]]);
    assert.deepEqual(out.wakings[1].rec.looks, ['self']);
    assert.ok(Date.now() - t0 < 3500);
    // 同一批收件不会两次叫醒：只有这一次被叫醒
    assert.equal(out.wakings.filter((w) => w.rec.kind === 'wake').length, 1);
    assert.ok(city.agent(b).inbox.some((i) => i.kind === 'whisper' && i.text === '回话'));
  } finally {
    city.close();
  }
});

test('P2 T8 每刻至多 wakes 次、每次至多 wakeTurns 轮；超过的收件不叫醒，留到下一次主醒来再给（游标没有推进）；刻变了不叫醒', async () => {
  const city = openCity({ seed: 'wake-2', loop: { wakes: 1, wakeTurns: 1, debounceSec: 0 } });
  try {
    const [a, b] = city.ids;
    city.rt.nextTickAt = Date.now() + 1800;
    const inner = await scripted([
      END, // 主醒来
      { calls: [call('look', { what: 'here' })] }, // 被叫醒：只有一轮，没有第二轮
      END, // 第二次主醒来
    ]);
    let calls = 0;
    const counting = { name: 'counting', step: async (req) => { calls++; return inner.step(req); } };
    const real = city.client(a);
    let waits = 0;
    const waitCounting = { ...real, wait: async (o) => { waits++; return real.wait(o); } };
    const running = drive(city, a, { cfg: NATIVE, deps: { waitWake: undefined, client: waitCounting }, inner: counting, rounds: 2 });
    await sleepMs(250);
    city.exec(b, [{ type: 'whisper', to: a, text: '第一句' }]);
    await sleepMs(350);
    city.exec(b, [{ type: 'whisper', to: a, text: '第二句' }]); // 这一刻的被叫醒用完了
    await sleepMs(350);
    city.rt.tickNow(); // 刻变了；之后的叫醒也不要
    city.rt.nextTickAt = Date.now() + 5000;
    city.exec(b, [{ type: 'whisper', to: a, text: '第三句' }]);
    const out = await running;
    assert.deepEqual(out.wakings.map((w) => [w.rec.kind, w.rec.turns, w.rec.ended]), [['main', 1, 'end'], ['wake', 1, 'turns'], ['main', 1, 'end']]);
    assert.equal(calls, 3, '被叫醒只有一轮，没有为第二句、第三句再叫醒');
    assert.ok(waits < 12, `等待函数被调用了 ${waits} 次：已见序号要推进，不能对同一批收件空转`);
    // 第二次主醒来的收件箱：第一句已交出去（被叫醒那一轮），第二句、第三句还在
    const inbox = inboxOf(out.requests[2].transcript[0].text);
    assert.ok(!inbox.includes('第一句') && inbox.includes('第二句') && inbox.includes('第三句'), inbox);
    // 摘要：上一次醒来是被叫醒（带标记），再上一次是主醒来
    const brief = out.requests[2].transcript[0].text;
    assert.match(brief, /【上一次醒来】第 1 月第 1 日第 1 刻（被叫醒）\n[\s\S]*【再上一次】第 1 月第 1 日第 1 刻(?:\n|$)/); // Q39 B：主醒来只有例行标签时，摘要只有标题。
    assert.match(brief, /【上一次醒来】[^\n]*\n {2}收到：私语 来自 乙：第一句\n {2}看了：here\n {2}（轮数用完）/);
  } finally {
    city.close();
  }
});

test('P2 T8 离截止不到 marginSec 时不叫醒（收件仍留到下一次）；之前的照样叫醒', async () => {
  const run = async (whisperAtMs) => {
    const city = openCity({ seed: `wake-margin-${whisperAtMs}`, loop: { marginSec: 1, wakes: 2, debounceSec: 0 } });
    try {
      const [a, b] = city.ids;
      city.rt.nextTickAt = Date.now() + 2200; // 主醒来的截止在 1.2 秒之后；叫醒的截止同样是 1.2 秒之后
      const running = drive(city, a, { cfg: NATIVE, ...WAKING, script: [END, END] });
      await sleepMs(whisperAtMs);
      city.exec(b, [{ type: 'whisper', to: a, text: '来得早或晚' }]);
      return await running;
    } finally {
      city.close();
    }
  };
  const early = await run(300);
  assert.deepEqual(early.wakings.map((w) => w.rec.kind), ['main', 'wake']);
  const late = await run(1500);
  assert.deepEqual(late.wakings.map((w) => w.rec.kind), ['main'], '过了截止之后不叫醒');
});

test('P2 T8 动作次数用完时不叫醒（不调用模型）；居民睡去了也不叫醒', async () => {
  const city = openCity({ seed: 'wake-actions', loop: { debounceSec: 0 } });
  try {
    const [a, b] = city.ids;
    city.rt.nextTickAt = Date.now() + 1500;
    const running = drive(city, a, { cfg: NATIVE, ...WAKING, script: [
      { calls: [call('act', { actions: [say('1'), say('2'), say('3'), say('4')] })] }, // 名额用完
      END,
    ] });
    await sleepMs(300);
    city.exec(b, [{ type: 'whisper', to: a, text: '没有名额了' }]);
    const out = await running;
    assert.deepEqual(out.wakings.map((w) => [w.rec.kind, w.rec.ended]), [['main', 'actions']]);
    assert.equal(out.requests.length, 1);
    assert.equal(out.usage.length, 1);
  } finally {
    city.close();
  }
  const city2 = openCity({ seed: 'wake-asleep', loop: { debounceSec: 0 } });
  try {
    const [a, b] = city2.ids;
    city2.rt.nextTickAt = Date.now() + 1500;
    const running = drive(city2, a, { cfg: NATIVE, ...WAKING, script: [END, END] });
    await sleepMs(300);
    city2.agent(a).status = 'dormant';
    city2.agent(a).dormantSinceDay = 0;
    city2.exec(b, [{ type: 'whisper', to: a, text: '睡着了' }]); // 睡着的居民收不到会叫醒的收件，这里只验证不会被叫醒
    const out = await running;
    assert.deepEqual(out.wakings.map((w) => w.rec.kind), ['main']);
  } finally {
    city2.close();
  }
});

test('P2 T8 看的次数醒来与被叫醒合计（按刻）', async () => {
  const city = openCity({ seed: 'wake-looks', loop: { looks: 2, debounceSec: 0, turns: 3 } });
  try {
    const [a, b] = city.ids;
    city.rt.nextTickAt = Date.now() + 1500;
    const running = drive(city, a, { cfg: NATIVE, ...WAKING, script: [
      { calls: [call('look', { what: 'here' }), call('look', { what: 'self' })] }, END, // 主醒来：看了两次
      { calls: [call('look', { what: 'laws' })] }, END, // 被叫醒：没有了
    ] });
    await sleepMs(300);
    city.exec(b, [{ type: 'whisper', to: a, text: '叫你' }]);
    const out = await running;
    assert.deepEqual(out.wakings.map((w) => w.rec.kind), ['main', 'wake']);
    // 被叫醒的第一轮 look：次数用完了
    const toolResult = out.requests[3].transcript.at(-1).results[0].text;
    assert.ok(toolResult.startsWith('本刻能看的次数用完了。'), toolResult);
    assert.deepEqual(out.wakings[1].rec.looks, []);
  } finally {
    city.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 等待函数
// ═══════════════════════════════════════════════════════════════

test('P2 T8 等待函数：after 是游标与已见序号的较大者，timeoutMs 不超过 25 秒也不超过离下一刻的时间；叫醒之后推进已见序号', async () => {
  const city = openCity({ seed: 'wake-fn', loop: { debounceSec: 0, wakes: 3 } });
  try {
    const [a, b] = city.ids;
    city.rt.nextTickAt = Date.now() + 1500;
    city.exec(b, [{ type: 'whisper', to: a, text: '先到的' }]); // 在第一次感知之前就到了：进概要，不叫醒
    const calls = [];
    const wait = scriptedWait([null, { ok: true, status: 200, json: { items: [{ seq: 777, kind: 'whisper' }], cursor: 777 } }, null, null], calls);
    const out = await drive(city, a, { cfg: NATIVE, deps: { waitWake: wait }, script: [END, END] });
    assert.ok(calls.length >= 3, `${calls.length}`);
    assert.ok(calls.every((c) => c.timeoutMs <= 25000 && c.timeoutMs > 0));
    assert.ok(calls[0].timeoutMs <= 1600);
    // 第二次之后 after 至少是 777（已见序号）；第一次是游标
    assert.ok(calls[0].after < 777);
    assert.ok(calls.slice(2).every((c) => c.after >= 777));
    // 叫醒：重新感知时收件箱里没有新的（777 是假的序号），但 actionsLeft 与刻都对，所以仍然醒来一次
    assert.deepEqual(out.wakings.map((w) => w.rec.kind), ['main', 'wake']);
    assert.ok(inboxOf(out.requests[0].transcript[0].text).includes('先到的'));
  } finally {
    city.close();
  }
});

test('P2 T8 等待函数失败：401 停掉；404 或居民不醒着时退回普通的等待；其他失败稍后重试；抛错当失败', async () => {
  const city = openCity({ seed: 'wake-errors', loop: { debounceSec: 0 } });
  try {
    const [a] = city.ids;
    // 401
    city.rt.nextTickAt = Date.now() + 1500;
    let out = await drive(city, a, { cfg: NATIVE, rounds: 3, deps: { waitWake: scriptedWait([{ ok: false, status: 401, json: null }]) }, script: [END, END, END] });
    assert.equal(out.result.stopped, 'auth');
    assert.ok(out.logs.some((l) => l.startsWith('ERR 认证失败')));
    // 404（旧服务器、不是第二前提的城）与不醒着：退回普通的等待，每个主醒来之后调一次 wait
    for (const reply of [{ ok: false, status: 404, json: null }, { ok: true, status: 200, json: { items: [], cursor: 0, status: 'dormant' } }]) {
      let waits = 0;
      city.rt.nextTickAt = Date.now() + 1500;
      out = await drive(city, a, { cfg: NATIVE, rounds: 1, after: () => { waits++; }, deps: { waitWake: scriptedWait([reply]) }, script: [END] });
      assert.equal(waits, 1, JSON.stringify(reply));
      assert.equal(out.result.stopped, 'maxRounds');
    }
    // 其他失败（网络、限速）与抛错：重试，不空转（一次等待不会调用几十次）
    const calls = [];
    city.rt.nextTickAt = Date.now() + 3300;
    const t0 = Date.now();
    out = await drive(city, a, { cfg: NATIVE, rounds: 1, deps: { waitWake: scriptedWait([{ ok: false, status: 0, json: null, error: 'down' }, { ok: false, status: 429, json: null }, new Error('炸了')], calls) }, script: [END] });
    assert.ok(Date.now() - t0 >= 3000 && Date.now() - t0 < 5500 && calls.length >= 3 && calls.length <= 14, `${calls.length} 次，${Date.now() - t0} ms`);
    assert.equal(out.result.stopped, 'maxRounds');
  } finally {
    city.close();
  }
});

test('P2 T8 没有等待函数时退回普通的等待（不会被叫醒）；waitWake: false 明确不要被叫醒；deps.waitWake 优先于 client.wait', async () => {
  const city = openCity({ seed: 'wake-none', loop: { debounceSec: 0 } });
  try {
    const [a, b] = city.ids;
    const real = city.client(a);
    // 客户端没有 wait，deps 里也没有：普通的等待
    const plain = { me: real.me, act: real.act };
    let waits = [];
    city.rt.nextTickAt = Date.now() + 1500;
    let out = await drive(city, a, { cfg: NATIVE, rounds: 1, after: () => waits.push('wait'), deps: { client: plain, waitWake: undefined }, script: [END] });
    assert.deepEqual(waits, ['wait']);
    assert.equal(out.wakings.length, 1);
    // waitWake: false：有 client.wait 也不用
    waits = [];
    let clientWaits = 0;
    const counting = { ...real, wait: async (o) => { clientWaits++; return real.wait(o); } };
    out = await drive(city, a, { cfg: NATIVE, rounds: 1, after: () => waits.push('wait'), deps: { client: counting, waitWake: false }, script: [END] });
    assert.deepEqual([waits.length, clientWaits], [1, 0]);
    // 缺省：用 client.wait；deps.waitWake 给了就用它而不是 client.wait
    city.rt.nextTickAt = Date.now() + 1200;
    clientWaits = 0;
    let fnCalls = 0;
    out = await drive(city, a, { cfg: NATIVE, rounds: 1, deps: { client: counting, waitWake: undefined }, script: [END] });
    assert.ok(clientWaits >= 1);
    city.rt.nextTickAt = Date.now() + 1200;
    clientWaits = 0;
    out = await drive(city, a, { cfg: NATIVE, rounds: 1, deps: { client: counting, waitWake: async ({ timeoutMs }) => { fnCalls++; await sleepMs(Math.min(300, timeoutMs)); return { ok: true, status: 200, json: { items: [], cursor: 0 } }; } }, script: [END] });
    assert.deepEqual([clientWaits, fnCalls >= 1], [0, true]);
    void b;
  } finally {
    city.close();
  }
});

test('P2 T8 退出：中止信号让等待立即结束，不再醒来；被叫醒期间中止不记轨迹', async () => {
  const city = openCity({ seed: 'wake-abort', loop: { debounceSec: 0 } });
  try {
    const [a, b] = city.ids;
    city.rt.nextTickAt = Date.now() + 5000;
    const ac = new AbortController();
    const t0 = Date.now();
    const running = drive(city, a, { cfg: NATIVE, ...WAKING, rounds: 5, deps: { signal: ac.signal, waitWake: undefined }, script: [END, END] });
    await sleepMs(300);
    ac.abort();
    const out = await running;
    assert.ok(Date.now() - t0 < 2000, '没有等到刻点');
    assert.equal(out.result.stopped, 'aborted');
    assert.deepEqual(out.wakings.map((w) => w.rec.kind), ['main']);
    void b;
    void lastUser;
  } finally {
    city.close();
  }
});

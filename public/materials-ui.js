import { renderProjectHistory } from './project-ui.js';
import { h, clear, ai } from './dom.js';
import { api, errorText } from './api.js';
import { section, table, placeLink } from './render.js';
export { renderMaterialsMarket } from './market-ui.js';
export function renderMaterialEnvironment(ctx, root) {
  const s = ctx.S.state;
  if ((s.world.premise !== 5 && s.world.premise !== 6)) return;
  root.append(
    section(
      '物料',
      table(
        ['地带', '现存 / 上限', '本日已采'],
        Object.entries(s.materials.zones).map(([id, z]) => [
          placeLink(ctx, id),
          `${z.stock} / ${z.capacity}`,
          String(z.harvestedThisDay),
        ])
      )
    ),
    section(
      '研究所 · 服务覆盖全城',
      table(
        ['地点', '完好度', '授权', '每次收费', '名义支持'],
        s.research.map((r) => [
          placeLink(ctx, r.id),
          `${r.condition / 100}%`,
          r.policy.access,
          String(r.policy.fee),
          '施工至多 15 / 维修至多 750bp',
        ])
      )
    )
  );
  renderProjectHistory(ctx, root);
  const records = h('div'),
    more = h('button', { class: 'btn small' }, '下一页');
  let after;
  const load = async () => {
    const r = await api(
      `/api/public/observations?limit=20${after ? `&after=${encodeURIComponent(after)}` : ''}`
    );
    if (!r.ok) {
      records.textContent = errorText(r, '读取失败');
      return;
    }
    clear(records);
    records.append(
      table(
        ['记录', '时间', '地点 / 工程', '实际结果'],
        r.json.map((o) => [
          o.id,
          o.tick !== undefined
            ? `tick ${o.tick}`
            : `第 ${o.dayClosed + 1} 日结束`,
          o.zone ?? o.project,
          o.kind === 'regrowth'
            ? `采集 ${o.harvested}，补充 ${o.added}，库存 ${o.stockAfterRefill}`
            : `居民 ${o.actor}，工作 +${o.workAdded}，${o.researchUsed ?? '无研究所'}，工程支出 ${o.energySpent} 词元 / ${o.materialsSpent} 物料`,
        ])
      )
    );
    more.disabled = r.json.length < 20;
    if (r.json.length) after = r.json.at(-1).id;
  };
  more.addEventListener('click', load);
  root.append(
    section(
      '环境记录',
      h('p', { class: 'muted' }, '只展示已经发生的变化。'),
      records,
      more
    )
  );
  void load();
}

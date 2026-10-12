import { renderProjectHistory } from './project-ui.js';
import { h, clear, ai } from './dom.js';
import { api, errorText } from './api.js';
import { section, table, placeLink } from './render.js';
// In-memory only: preserve the active resident across live world redraws.
const marketSession = { token: '', wake: null, view: '0' };
const kindLabels = {
  material_delivery: '物料交付',
  construction: '施工',
  repair: '维修',
  document: '作品交付',
  announcement: '公告发布',
  proposal: '提案提交',
};
const statusLabels = {
  active: '履约中',
  open: '待承接',
  offered: '待接受',
  completed: '已结算',
  cancelled: '已取消',
  expired: '已到期',
  failed: '已终止',
};
export function criterionText(c) {
  return `${kindLabels[c.kind] ?? c.kind} · ${c.to ?? c.project ?? c.target ?? c.publishPlace ?? c.place ?? c.audience ?? c.class ?? '不限地点'}${c.quantity ? ` · ${c.quantity} 物料` : c.work ? ` · ${c.work} 工作量` : c.bp ? ` · ${c.bp} 基点` : ''}`;
}
const obligation =
  '固定价报酬全额托管。成本由承接者自付；全部达标才一次付款，部分完成不付款；超时全额退款，已完成工作不逆转。接单不会授予额外产权权限。作品只验交付，不验质量或真伪。';
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
export function renderMaterialsMarket(ctx, root) {
  const state = ctx.S.state;
  if ((state.world.premise !== 5 && state.world.premise !== 6)) return;
  const content = h('div'),
    message = h('p', { role: 'status' }),
    token = h('input', {
      type: 'password',
      value: marketSession.token,
      autocomplete: 'off',
      placeholder: '居民访问令牌，仅用于本页操作',
      'aria-label': '居民访问令牌',
    }),
    view = h(
      'select',
      { 'aria-label': '交易所视图' },
      ...['服务', '需求', '我的订单'].map((name, i) =>
        h('option', { value: String(i) }, name)
      )
    );
  let actor = null,
    wake = marketSession.wake,
    after = null,
    rows = [];
  const status = async () => {
    const r = await api('/api/me', { key: token.value });
    if (!r.ok) throw Error(errorText(r, '身份读取失败'));
    actor = r.json;
    return actor;
  };
  const execute = async (action) => {
    message.textContent = '正在提交…';
    try {
      await status();
      if (!wake || wake.tick !== actor.now.tick) {
        const r = await api('/api/me/wake', {
          method: 'POST',
          key: token.value,
          body: { kind: 'main', toolMode: 'json', lang: 'zh' },
        });
        if (!r.ok) throw Error(errorText(r, '无法醒来'));
        wake = { id: r.json.wakeId, tick: actor.now.tick };
        marketSession.wake = wake;
      }
      const r = await api('/api/me/act', {
        method: 'POST',
        key: token.value,
        body: {
          wakeId: wake.id,
          requestId: crypto.randomUUID(),
          experimentGeneration: actor.now.experimentGeneration ?? 0,
          actions: [action],
        },
      });
      if (!r.ok) throw Error(errorText(r, '提交失败'));
      const result = r.json.results[0];
      if (!result.ok) throw Error(result.error.hint?.zh ?? result.error.code);
      message.textContent = `已完成：${JSON.stringify(result.data)}`;
      after = null;
      await load();
    } catch (e) {
      message.textContent = e.message;
    }
  };
  const button = (label, action) => {
    const b = h('button', { class: 'btn small', type: 'button' }, label);
    b.addEventListener('click', () => execute(action));
    return b;
  };
  const details = (o, isService) => {
    const c = isService ? o.criterionTemplate : o.terms.criterion;
    const d = h(
      'details',
      null,
      h('summary', null, ai(o.title)),
      h('p', null, ai(o.description)),
      h('p', null, criterionText(c)),
      h(
        'p',
        null,
        `固定报酬 ${isService ? o.price : o.terms.price} 词元 · ${isService ? `等待 ${o.waitTicks} tick / 履约 ${o.durationTicks} tick` : `${statusLabels[o.status]} · 进度 ${o.progress} · 截止 tick ${o.dueTick ?? o.acceptBy}（世界日 ${Math.floor((o.dueTick ?? o.acceptBy) / state.world.ticksPerDay) + 1}）`}`
      ),
      h('p', { class: 'muted' }, obligation)
    );
    if (isService) {
      d.append(
        h(
          'p',
          null,
          '这是当前告示。下单会保存成交条款，之后编辑告示不会改变订单。'
        )
      );
      const targets = {};
      for (const key of {
        material_delivery: ['to', 'place'],
        construction: ['project'],
        repair: ['target'],
        announcement: c.audience === 'place' ? ['place'] : [],
      }[c.kind] ?? [])
        if (c[key] === undefined) {
          targets[key] = h('input', {
            placeholder: {
              to: '接收居民或工程 ID',
              place: '交付地点 ID',
              project: '工程 ID',
              target: '维修目标 ID',
            }[key],
            'aria-label': key,
          });
          d.append(targets[key]);
        }
      const order = h('button', { class: 'btn small' }, '确认条款并下单');
      order.addEventListener('click', () =>
        execute({
          type: 'service_order',
          service: o.id,
          targetArgs: Object.fromEntries(
            Object.entries(targets).map(([k, v]) => [k, v.value])
          ),
        })
      );
      d.append(order);
      if (actor?.you.id === o.provider) {
        d.append(
          button('撤下告示', { type: 'service_withdraw', service: o.id })
        );
        const title = h('input', {
            value: o.title,
            'aria-label': '修改服务标题',
          }),
          description = h(
            'textarea',
            { 'aria-label': '修改服务说明' },
            o.description
          ),
          price = h('input', {
            type: 'number',
            min: 1,
            value: o.price,
            'aria-label': '修改服务价格',
          }),
          edit = h(
            'button',
            { class: 'btn small' },
            '保存告示修改（只影响未来订单）'
          );
        edit.addEventListener('click', () =>
          execute({
            type: 'service_edit',
            service: o.id,
            title: title.value,
            description: description.value,
            price: Number(price.value),
          })
        );
        d.append(title, description, price, edit);
      }
    } else {
      d.append(
        h(
          'p',
          null,
          `付款方 ${o.requester} · 承接者 ${o.provider ?? '待定'} · ${o.reason ?? ''}`
        )
      );
      if (['open', 'offered'].includes(o.status))
        d.append(
          button('确认条款并承接', { type: 'order_accept', order: o.id })
        );
      if (['open', 'offered', 'active'].includes(o.status))
        d.append(
          button(o.status === 'active' ? '请求 / 同意双方解除' : '撤回订单', {
            type: 'order_cancel',
            order: o.id,
          })
        );
      if (
        o.status === 'active' &&
        ['document', 'announcement', 'proposal'].includes(c.kind)
      ) {
        const ref = h('input', {
            placeholder: '成果或公告回执 ID',
            'aria-label': '成果 ID',
          }),
          submit = h('button', { class: 'btn small' }, '提交成果');
        submit.addEventListener('click', () =>
          execute({ type: 'order_submit', order: o.id, ref: ref.value })
        );
        d.append(ref, submit);
      }
    }
    return d;
  };
  const more = h('button', { class: 'btn small' }, '下一页');
  const load = async () => {
    const endpoint = ['services', 'demands', 'orders'][Number(view.value)];
    if (token.value)
      try {
        await status();
      } catch (e) {
        message.textContent = e.message;
        return;
      }
    const r = await api(
      `/api/public/${endpoint}?limit=20${endpoint === 'orders' && actor ? `&agent=${encodeURIComponent(actor.you.id)}` : ''}${after ? `&after=${encodeURIComponent(after)}` : ''}`
    );
    if (!r.ok) {
      message.textContent = errorText(r, '读取失败');
      return;
    }
    rows = r.json;
    clear(content);
    const visible = endpoint === 'orders' && !actor ? [] : rows;
    content.append(...visible.map((o) => details(o, endpoint === 'services')));
    if (!visible.length)
      content.append(h('p', { class: 'muted' }, '本页暂无条目。'));
    more.disabled = rows.length < 20;
    if (rows.length) after = rows.at(-1).id;
  };
  view.value = marketSession.view;
  token.addEventListener('input', () => {
    marketSession.token = token.value;
    marketSession.wake = null;
    wake = null;
    actor = null;
  });
  token.addEventListener('change', () => {
    after = null;
    void load();
  });
  view.addEventListener('change', () => {
    marketSession.view = view.value;
    after = null;
    void load();
  });
  more.addEventListener('click', load);
  root.append(
    section(
      '交易所',
      h(
        'p',
        { class: 'muted' },
        '发布地点不受限制。查看、发布与撤回不调用模型；行动和醒来按世界词元规则计价。'
      ),
      token,
      view,
      message,
      content,
      more
    )
  );
  const title = h('input', {
      required: true,
      maxLength: 80,
      'aria-label': '标题',
      placeholder: '标题',
    }),
    description = h('textarea', {
      required: true,
      maxLength: 600,
      'aria-label': '说明',
      placeholder: '说明',
    }),
    price = h('input', {
      type: 'number',
      min: 1,
      step: 1,
      required: true,
      'aria-label': '报酬',
      placeholder: '报酬词元',
    }),
    kind = h(
      'select',
      { 'aria-label': '验收类型' },
      ...Object.entries(kindLabels).map(([v, n]) =>
        h('option', { value: v }, n)
      )
    ),
    target = h('input', {
      'aria-label': '目标',
      placeholder: '目标居民 / 工程 / 设施 ID（作品可选发布地点）',
    }),
    place = h('input', {
      'aria-label': '地点',
      placeholder: '交付 / 公告地点 ID',
    }),
    quantity = h('input', {
      type: 'number',
      min: 1,
      value: 1,
      'aria-label': '数量',
    }),
    mode = h(
      'select',
      { 'aria-label': '发布类型' },
      h('option', { value: 'service' }, '提供服务'),
      h('option', { value: 'demand' }, '发布需求')
    );
  const form = h(
    'form',
    { class: 'form' },
    h('h3', null, '发布'),
    mode,
    title,
    description,
    price,
    kind,
    target,
    place,
    quantity,
    h(
      'p',
      { class: 'muted' },
      '服务可留空目标，由客户下单时补充；数量固定。公告填写地点则面向该地，留空面向全城。等待接单 12 tick，承接后 36 tick 内完成。'
    ),
    h('p', null, obligation),
    h('button', { type: 'submit', class: 'btn' }, '确认发布')
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let criterion = { kind: kind.value };
    const n = Number(quantity.value),
      to = target.value.trim(),
      at = place.value.trim();
    if (kind.value === 'material_delivery')
      criterion = {
        ...criterion,
        quantity: n,
        ...(to ? { to } : {}),
        ...(at ? { place: at } : {}),
      };
    if (kind.value === 'construction')
      criterion = { ...criterion, work: n, ...(to ? { project: to } : {}) };
    if (kind.value === 'repair')
      criterion = { ...criterion, bp: n, ...(to ? { target: to } : {}) };
    if (kind.value === 'document' && to) criterion.publishPlace = to;
    if (kind.value === 'announcement')
      criterion = {
        ...criterion,
        audience: at ? 'place' : 'all',
        ...(at ? { place: at } : {}),
      };
    void execute({
      type: mode.value === 'service' ? 'service_publish' : 'demand_publish',
      title: title.value,
      description: description.value,
      price: Number(price.value),
      [mode.value === 'service' ? 'criterionTemplate' : 'criterion']: criterion,
    });
  });
  root.append(section('居民服务与需求', form));
  void load();
}

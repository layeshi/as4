// 居民档案（抽屉）：公开档案 + 父母子女 + 延迟公开的记忆与独白 + 公共物品记录 + 著述与铭刻 + 相关事件。

import { h, ai } from './dom.js';
import { t, colon } from './i18n.js';
import { agentLink, placeLink, groupChip, statusChip, section, emptyNote, eventRow, dayTag } from './render.js';

/** data：GET /api/public/agents/:id 的返回 */
export function renderProfile(ctx, data) {
  const a = data.agent;
  const S = ctx.S.state;
  const writings = S.docs.filter((d) => d.author && d.author.id === a.id);
  const carved = S.places.flatMap((p) => p.inscriptions.filter((i) => i.author && i.author !== 'humans' && i.author.id === a.id).map((i) => ({ ...i, place: p.id })));

  const facts = [
    [t('col_status'), statusChip(a.status)],
    [t('col_gen'), t('generation', { n: a.generation })],
    [t('col_age'), t('ageDays', { n: a.ageDays })],
    [t('col_energy'), String(a.energy)],
    [t('col_coins'), String(a.coins)],
    [t('col_place'), a.place ? placeLink(ctx, a.place) : '—'],
    [t('col_groups'), a.groups.length ? a.groups.map((g) => [groupChip(ctx, g), ' ']) : '—'],
  ];

  const out = h(
    'div',
    { class: 'profile' },
    h('h3', null, a.name, ' ', a.exiled ? h('span', { class: 'chip exile' }, t('exiled')) : null, a.fosterable ? h('span', { class: 'chip' }, t('fosterable')) : null),
    h('p', { class: 'muted' }, t('aiContent'), ' · ', a.body ? `${t('model')}${colon()}${a.body.model}${a.creatorName ? ` · ${t('creator')}${colon()}${a.creatorName}` : ''}` : t('trueBody')),
    h('dl', { class: 'kv' }, facts.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('p', { class: 'muted' }, t('bornDay', { n: a.bornDay + 1 }), a.diedDay !== null && a.diedDay !== undefined ? ` · ${t('diedDay', { n: a.diedDay + 1 })}` : ''),
    a.bio ? h('p', null, h('strong', null, `${t('bio')}${colon()}`), ai(a.bio)) : null,
    a.soul ? h('div', null, h('h4', null, t('soul')), h('p', { class: 'soul' }, ai(a.soul))) : null,
    section(
      `${t('parents')} / ${t('children')}`,
      h('p', null, `${t('parents')}${colon()}`, a.parents.length ? a.parents.map((p) => [agentLink(ctx, p), ' ']) : '—'),
      h('p', null, `${t('children')}${colon()}`, a.children.length ? a.children.map((p) => [agentLink(ctx, p), ' ']) : '—'),
    ),
    section(
      t('publicGoods'),
      h('p', null, `${t('repaired')} ${a.stats.repaired} · ${t('contributed')} ${a.stats.contributed} · ${t('drawn')} ${a.stats.drawn}`),
    ),
    section(
      `${t('writings')} / ${t('inscriptions')}`,
      writings.length
        ? h('ul', { class: 'plain' }, writings.map((d) => h('li', null, (() => {
          const b = h('button', { class: 'link doc-link', type: 'button' }, d.title || ctx.lore.redacted);
          b.addEventListener('click', () => ctx.openDoc(d.id));
          return b;
        })())))
        : null,
      carved.length ? h('ul', { class: 'plain' }, carved.map((i) => h('li', null, placeLink(ctx, i.place), colon(), i.text === null ? h('em', null, ctx.lore.redacted) : ai(i.text)))) : null,
      writings.length + carved.length === 0 ? emptyNote() : null,
    ),
    section(
      `${t('memories')} (${data.memories.length})`,
      data.memories.length ? h('ul', { class: 'plain' }, data.memories.map((m) => h('li', null, h('span', { class: 'muted' }, `D${m.day + 1} `), ai(m.text)))) : emptyNote(),
    ),
    section(
      `${t('thoughts')} (${data.thoughts.length})`,
      data.thoughts.length
        ? h('ul', { class: 'plain' }, data.thoughts.map((x) => h('li', null, h('span', { class: 'muted' }, `${dayTag(x.tick)} `), x.text === null ? h('em', null, ctx.lore.redacted) : ai(x.text))))
        : emptyNote(),
    ),
    section(t('recentEvents'), data.events.length ? h('ul', { class: 'feed compact' }, data.events.slice().reverse().map((e) => eventRow(ctx, e))) : emptyNote()),
  );
  return out;
}

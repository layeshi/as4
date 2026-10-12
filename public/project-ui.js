import { h, clear, ai } from './dom.js';
import { api, errorText } from './api.js';
import { getLang } from './i18n.js';
import { openModal } from './modals.js';
import { section, table, placeLink } from './render.js';

const en = () => getLang() === 'en';
const text = (zh, english) => en() ? english : zh;
export function projectAccessText(access) {
  return (en() ? {owner:'Owner/steward only',group:'Owning group members',public:'Public participation'} : {owner:'仅业主／管事',group:'所属社群成员',public:'公开参与'})[access] ?? access;
}
const projectStateText = j => (en()
  ? {funding:'Funding',building:'Construction',built:'Built',cancelled:'Cancelled',abandoned:'Terminated'}
  : {funding:'筹资中',building:'施工中',built:'已建成',cancelled:'已取消',abandoned:'已终止'})[j.status === 'open' ? j.phase : j.status] ?? j.status;
const notice = () => text('出资不自动授予产权或施工权限；施工还需资源齐备、人在现场，并通过法律、额度与服务检查。', 'Deposits do not grant ownership or participation rights. Construction also requires funding, presence, and law, budget and service checks.');
const accountName = a => a.kind === 'city' ? text('公库', 'City treasury') : `${a.name ?? a.id} (${a.id})`;
const amounts = (energy, materials) => text(`${energy} 词元 / ${materials} 物料`, `${energy} tokens / ${materials} materials`);

export function projectAudit(ctx, id) {
  return h('button', {class:'btn small', type:'button', onClick: () => {
    const modal = openModal(`${text('出资核对', 'Project deposits')} · ${id}`, 'wide');
    const rows = h('div', {role:'status'});
    const next = h('button', {class:'btn small',type:'button'}, text('更多出资账户', 'More contributors'));
    let after;
    const load = async () => {
      next.disabled = true;
      const r = await api(`/api/public/project?id=${encodeURIComponent(id)}&limit=10${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      if (!r.ok) { rows.textContent = errorText(r, text('读取失败', 'Read failed')); next.disabled = false; return; }
      const j = r.json, a = j.accounting;
      clear(rows);
      rows.append(
        h('p',null,`${id} · ${projectStateText(j)} · ${projectAccessText(j.access)}`),
        h('p',null, notice()),
        h('p',null,text('历史实际投入', 'Recorded deposits'), '：', a.recordsAvailable ? amounts(a.totals.energy,a.totals.materials) : text('明细缺失，无法核对', 'Records unavailable')),
        h('p',null,text('历史已消耗', 'Recorded consumption'), '：', a.recordsAvailable ? amounts(a.totals.spentEnergy,a.totals.spentMaterials) : '—'),
        h('p',null,text('当前托管余额', 'Current escrow'), '：', amounts(a.escrow.energy,a.escrow.materials)),
        table([text('记录归属账户', 'Recorded asset owner'),text('实际投入', 'Deposits'),text('已消耗', 'Consumed')],a.contributors.map(c=>[
          ai(accountName(c.account)),amounts(c.energy,c.materials),amounts(c.spentEnergy,c.spentMaterials),
        ])),
        h('p',{class:'muted'},text('代管物料归属其受益账户；赠与、承诺、失败出资不计入。关闭工程保留历史投入，托管余额为零；不能从投入数推断退款或继承分配。', 'Earmarked materials belong to their beneficiary. Gifts, promises and rejected deposits are excluded. Closed projects retain deposit history with zero escrow; refund and inheritance allocations cannot be inferred.'))
      );
      after = a.next;
      next.disabled = !after;
    };
    next.addEventListener('click',load);
    modal.body.append(rows,next);
    void load();
  }}, text('核对出资', 'Check deposits'));
}

export function renderProjectHistory(ctx, root) {
  const rows = h('div'), next = h('button',{class:'btn small',type:'button'},text('下一页', 'Next page'));
  let after;
  const load = async () => {
    next.disabled = true;
    const r = await api(`/api/public/projects?limit=20${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    if (!r.ok) { rows.textContent = errorText(r,text('读取失败', 'Read failed')); next.disabled = false; return; }
    clear(rows);
    rows.append(table([text('工程', 'Project'),text('状态 / 工作', 'State / Work'),text('地点', 'Site'),text('业主', 'Owner'),text('参与权限', 'Participation'),text('账目', 'Accounting')],r.json.map(j=>[
      h('span',null,`${j.id} · `,ai(j.name ?? j.module ?? j.build)),
      `${projectStateText(j)} · ${j.progress}/${j.needWork}`,
      placeLink(ctx,j.place), ai(accountName(j.owner)), projectAccessText(j.access),projectAudit(ctx,j.id),
    ])));
    next.disabled = r.json.length < 20;
    after = r.json.at(-1)?.id;
  };
  next.addEventListener('click',load);
  const first = h('button',{class:'btn small',type:'button',onClick:()=>{after=undefined;void load();}},text('首页', 'First page'));
  root.append(section(text('工程历史与出资核对', 'Project history and deposits'),h('p',{class:'muted'},text('包含筹资、施工、已建成、取消等状态。', 'Includes funding, construction, completed and cancelled projects.')),rows,first,next));
  void load();
}

// Public interfaces expose prices and nominal capacity, not causal parameters.
const rows = {
  gather: [
    'amount?',
    2,
    '在所在回收地带采集物料，每次至多 10，费用 2K。实际结果以回执为准。',
  ],
  claim: [
    'claim, amount?',
    0,
    '到领取点领取物料。专项物料只能用于所属公共资产。',
  ],
  return_materials: ['claim, amount?', 0, '在原领取点放回专项物料。'],
  construct: [
    'project, research?, maxResearchFee?, order?',
    1,
    '到工程现场施工。资源齐备才可施工；名义上限 10，研究所为 15。费用 1K，研究所费另计。',
  ],
  cancel_project: [
    'project',
    0,
    '终止未完成工程，退还未用投入，现场保留残料。',
  ],
  project_policy: [
    'project, access',
    0,
    '所有者设置工程参与权 public/owner/group。',
  ],
  research_policy: [
    'place, access, agents?, groups?, fee',
    0,
    '所有者设置全城研究所的授权和每次收费。',
  ],
  claim_policy: ['claim, agents', 0, '社群管事指定专项物料领取人。'],
  service_publish: [
    'title, description, price, criterionTemplate, waitTicks?, durationTicks?',
    0,
    '发布固定价服务。验收类型：material_delivery/construction/repair/document/announcement/proposal。',
  ],
  service_edit: [
    'service, title?, description?, price?, criterionTemplate?, waitTicks?, durationTicks?',
    0,
    '修改服务告示，只影响未来订单。',
  ],
  service_withdraw: ['service', 0, '撤下告示，既有订单继续履行。'],
  service_order: [
    'service, targetArgs',
    0,
    '冻结全部报酬并向服务提供者下单。成本自付，一次完成付款，部分完成不付款，不授予产权权限。',
  ],
  demand_publish: [
    'title, description, price, criterion, eligible?, waitTicks?, durationTicks?',
    0,
    '发布需求并冻结全部报酬。首个合格承接者接单，无需再次确认。',
  ],
  order_accept: [
    'order',
    0,
    '接受固定条款。成本自付，一次完成付款，部分完成不付款，不获得额外产权权限。',
  ],
  order_decline: ['order', 0, '拒绝指定给自己的待接订单，全部退款。'],
  order_cancel: [
    'order',
    0,
    '接单前付款方取消；接单后须双方同意。到期全部退款，已做工作不逆转。',
  ],
  order_submit: [
    'order, ref',
    0,
    '提交接单后本人作品、公告回执或正式提案。只验交付事实，不判断质量或真伪。',
  ],
};
const ints = new Set([
  'amount',
  'fee',
  'price',
  'waitTicks',
  'durationTicks',
  'maxResearchFee',
]);
const objects = new Set(['criterionTemplate', 'criterion', 'targetArgs']);
export const MATERIAL_ACTIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(rows).map(([type, [params, base, zh]]) => [
      type,
      {
        base,
        place: null,
        module: null,
        where: null,
        params,
        args: params
          .split(',')
          .map((s) => s.trim().replace('?', ''))
          .map((n) => [
            n,
            ints.has(n)
              ? 'int'
              : objects.has(n)
                ? 'obj'
                : n === 'agents' || n === 'groups'
                  ? 'list'
                  : 'str',
          ]),
        verb: { zh: type, en: type },
        desc: { zh, en: zh },
      },
    ])
  )
);
export const MATERIAL_OVERRIDES = {
  give: {
    params: 'to, energy?, coins?, materials?, note?, order?',
    extra: [
      ['materials', 'int'],
      ['order', 'str'],
    ],
    zh: '赠予词元、旧币或自由物料。物料交付双方必须同地；词元仍可远程转赠。',
  },
  offer: {
    params: 'to?, give, want, note?',
    extra: [],
    zh: '交易组合可含 energy、coins、materials。出售物料当场托管，含物料交易双方必须在挂牌地点成交。异地退款成为原地待领物料。',
  },
  initiate: {
    params:
      'build, lot?, on?, name?, description?, module?, inscription?, to?, owner?, access?',
    extra: [['access', 'str']],
    zh: '发起 site/module/road/upgrade 工程，可建 research 研究所。工程需词元、物料及施工；筹资完成不立即建成。',
  },
  contribute: {
    params: 'project, energy?, materials?, claim?, order?',
    extra: [
      ['materials', 'int'],
      ['claim', 'str'],
      ['order', 'str'],
    ],
    zh: '在工程现场投入词元或物料，只扣剩余需求。专项物料须指定 claim 且用于所属公共资产。',
  },
  repair: {
    params:
      'target?, energy, materials, research?, maxResearchFee?, claim?, order?',
    extra: [
      ['materials', 'int'],
      ['research', 'str'],
      ['maxResearchFee', 'int'],
      ['claim', 'str'],
      ['order', 'str'],
    ],
    zh: '现场修复。energy/materials 是支付上限；每物料至多 100bp，每 K 词元 10bp，低完好度为 5bp；每次至多 500bp，研究所为 750bp，只扣实用量。',
  },
  dismantle: {
    params: 'materials?, module?, project?',
    replace: [
      ['materials', 'int'],
      ['module', 'str'],
      ['project', 'str'],
    ],
    zh: '现场拆解回收至多 15 物料，费用 2K，受现行拆解许可法约束。不能拆源井与港口。',
  },
};

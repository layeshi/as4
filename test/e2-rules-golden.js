// 引擎读法与指纹的「金标」：由 src/e2/rules/render.js 与 fingerprint.js 生成，人工审阅过。
// 措辞或指纹的算法有意改动时，重新生成并审阅这份文件（指纹会随世界存档，不可无意中改变）。
export const EXPR_READINGS = [
 [
  "min(actor.energy, 5, 3)",
  "repair",
  "min(此人的能量, 5, 3)",
  "min(the actor's energy, 5, 3)"
 ],
 [
  "max(1, 2)",
  "repair",
  "max(1, 2)",
  "max(1, 2)"
 ],
 [
  "abs(0 - actor.energy)",
  "repair",
  "abs(0 - 此人的能量)",
  "abs(0 - the actor's energy)"
 ],
 [
  "if(actor.energy > 5, 1, 2)",
  "repair",
  "（若 此人的能量 > 5 则 1，否则 2）",
  "(1 if the actor's energy > 5, otherwise 2)"
 ],
 [
  "default(var.x, 0)",
  "repair",
  "变量 x（未设时为 0）",
  "variable x (0 if unset)"
 ],
 [
  "count(agents)",
  "repair",
  "在世居民的人数",
  "the number of living residents"
 ],
 [
  "sum(agents, it.energy)",
  "repair",
  "在世居民中每个的其能量之和",
  "the sum of each's energy over living residents"
 ],
 [
  "filter(agents, it.coins > 0)",
  "repair",
  "在世居民中满足「其旧币 > 0」者",
  "those of living residents for whom each's coins > 0"
 ],
 [
  "top(agents, it.energy, 3)",
  "repair",
  "在世居民中按其能量从大到小的前 3 个",
  "the top 3 of living residents by each's energy"
 ],
 [
  "sample(agents, 2)",
  "repair",
  "从在世居民中随机抽出的 2 个",
  "2 drawn at random from living residents"
 ],
 [
  "contains(here, actor)",
  "repair",
  "contains(同在此地的人, 此人)",
  "contains(those present, the actor)"
 ],
 [
  "tagged('守井人')",
  "repair",
  "带「守井人」标签者",
  "those tagged “守井人”"
 ],
 [
  "members('g1')",
  "repair",
  "社群「g1」的成员",
  "members of “g1”"
 ],
 [
  "at('agora')",
  "repair",
  "此刻在「agora」的人",
  "those at “agora”"
 ],
 [
  "has_tag(actor, 'citizen')",
  "repair",
  "此人带有「citizen」标签",
  "the actor has tag “citizen”"
 ],
 [
  "in_group(actor, 'g1')",
  "repair",
  "此人属于社群「g1」",
  "the actor belongs to “g1”"
 ],
 [
  "awake(actor)",
  "repair",
  "此人醒着",
  "the actor is awake"
 ],
 [
  "is_wild('wilds')",
  "repair",
  "is_wild(「wilds」)",
  "is_wild(“wilds”)"
 ],
 [
  "owner('n3')",
  "repair",
  "owner(「n3」)",
  "owner(“n3”)"
 ],
 [
  "agent('a3')",
  "repair",
  "agent(「a3」)",
  "agent(“a3”)"
 ],
 [
  "group('g1')",
  "repair",
  "group(「g1」)",
  "group(“g1”)"
 ],
 [
  "soul('s1')",
  "repair",
  "soul(「s1」)",
  "soul(“s1”)"
 ],
 [
  "names(cradle, '、')",
  "repair",
  "names(摇篮中的灵魂, 「、」)",
  "names(souls in the cradle, “、”)"
 ],
 [
  "names(agents)",
  "repair",
  "names(在世居民)",
  "names(living residents)"
 ],
 [
  "weather('fog')",
  "repair",
  "weather(「fog」)",
  "weather(“fog”)"
 ],
 [
  "actor.energy % 7",
  "repair",
  "此人的能量 除以 7 的余数",
  "the remainder of the actor's energy divided by 7"
 ],
 [
  "-actor.age",
  "repair",
  "-此人的年龄",
  "-the actor's age"
 ],
 [
  "not awake(actor)",
  "repair",
  "非此人醒着",
  "not (the actor is awake)"
 ],
 [
  "not (actor.energy > 3)",
  "repair",
  "非（此人的能量 > 3）",
  "not (the actor's energy > 3)"
 ],
 [
  "actor.energy == 5 or actor.age != 3",
  "repair",
  "此人的能量 = 5 或 此人的年龄 ≠ 3",
  "the actor's energy = 5 or the actor's age ≠ 3"
 ],
 [
  "(1 + 2) * 3",
  "repair",
  "（1 + 2） × 3",
  "(1 + 2) × 3"
 ],
 [
  "1 - (2 - 3)",
  "repair",
  "1 - （2 - 3）",
  "1 - (2 - 3)"
 ],
 [
  "1 - 2 - 3",
  "repair",
  "1 - 2 - 3",
  "1 - 2 - 3"
 ],
 [
  "actor.energy / 2 + 1",
  "repair",
  "此人的能量 ÷ 2（向下取整） + 1",
  "the actor's energy ÷ 2 (rounded down) + 1"
 ],
 [
  "city.day % 24 < 12",
  "repair",
  "今日的日序 除以 24 的余数 < 12",
  "the remainder of today's day number divided by 24 < 12"
 ],
 [
  "actor.purpose == null",
  "repair",
  "此人的志 = 空",
  "the actor's purpose = empty"
 ],
 [
  "args.energy",
  "repair",
  "参数 energy",
  "argument energy"
 ],
 [
  "result.spent",
  "repair",
  "结果 spent",
  "result spent"
 ],
 [
  "var.rationShare",
  "repair",
  "变量 rationShare",
  "variable rationShare"
 ],
 [
  "true and false",
  "repair",
  "真 且 假",
  "true and false"
 ],
 [
  "actor.name == 'x'",
  "repair",
  "此人的名字 = 「x」",
  "the actor's name = “x”"
 ],
 [
  "city.wellOutput >= 450 and city.treasury > 100 or city.awake <= 3",
  "repair",
  "源井昨日产出 ≥ 450 且 公库能量 > 100 或 醒着的人数 ≤ 3",
  "the Well's last output ≥ 450 and the Treasury's energy > 100 or the number awake ≤ 3"
 ],
 [
  "count(filter(agents, awake(it))) * 2 > 5",
  "repair",
  "（在世居民中满足「其醒着」者的人数） × 2 > 5",
  "(the number of those of living residents for whom each is awake) × 2 > 5"
 ],
 [
  "sum(filter(agents, has_tag(it, 'a')), it.energy / 2)",
  "repair",
  "在世居民中满足「其带有「a」标签」者中每个的其能量 ÷ 2（向下取整）之和",
  "the sum of each's energy ÷ 2 (rounded down) over those of living residents for whom each has tag “a”"
 ],
 [
  "top(here, it.age, 1)",
  "repair",
  "同在此地的人中按其年龄从大到小的前 1 个",
  "the top 1 of those present by each's age"
 ],
 [
  "agent('a3').energy",
  "repair",
  "agent(「a3」) 的能量",
  "agent(“a3”)'s energy"
 ],
 [
  "group('g1').steward.name",
  "repair",
  "group(「g1」) 的管事的名字",
  "group(“g1”)'s steward's name"
 ],
 [
  "actor.drawnToday + args.energy > if(city.wellOutput < 450, 3, 5)",
  "repair",
  "此人的今日汲取 + 参数 energy > （若 源井昨日产出 < 450 则 3，否则 5）",
  "the actor's drawn today + argument energy > (3 if the Well's last output < 450, otherwise 5)"
 ],
 [
  "default(actor.purpose, 'x') == 'x'",
  "repair",
  "（此人的志（未设时为 「x」）） = 「x」",
  "(the actor's purpose (“x” if unset)) = “x”"
 ],
 [
  "cradle",
  "repair",
  "摇篮中的灵魂",
  "souls in the cradle"
 ],
 [
  "treasury",
  "repair",
  "城公库",
  "the Treasury"
 ],
 [
  "actor.id != args.to",
  "give",
  "此人的编号 ≠ 参数 to",
  "the actor's ID ≠ argument to"
 ]
];
export const RULE_READINGS = [
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "transfer",
     "from": "treasury",
     "to": "agent('a7')",
     "energy": "5"
    }
   ]
  },
  "每日结算时：从城公库转给 agent(「a7」) 5 能量",
  "At each daily settlement: transfer 5 energy from the Treasury to agent(“a7”)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "transfer",
     "from": "agent('a7')",
     "to": "group('g1')",
     "energy": "5",
     "coins": "2"
    }
   ]
  },
  "每日结算时：从 agent(「a7」) 转给 group(「g1」) 5 能量 与 2 旧币",
  "At each daily settlement: transfer 5 energy and 2 coins from agent(“a7”) to group(“g1”)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "transfer",
     "from": "group('g1')",
     "to": "treasury",
     "coins": "3"
    }
   ]
  },
  "每日结算时：从 group(「g1」) 转给城公库 3 旧币",
  "At each daily settlement: transfer 3 coins from group(“g1”) to the Treasury"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "share",
     "from": "treasury",
     "energy": "city.treasury / 4",
     "among": "agents"
    }
   ]
  },
  "每日结算时：从城公库把 （公库能量 ÷ 4（向下取整）） 能量 平分给在世居民",
  "At each daily settlement: share (the Treasury's energy ÷ 4 (rounded down)) energy from the Treasury equally among living residents"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "each",
     "in": "agents",
     "if": "it.energy > 100",
     "do": [
      {
       "op": "transfer",
       "from": "it",
       "to": "treasury",
       "energy": "(it.energy - 100) / 20"
      },
      {
       "op": "tag",
       "who": "it",
       "tag": "富人"
      }
     ]
    }
   ]
  },
  "每日结算时：对在世居民中的每一个（限 其能量 > 100）：从其转给城公库 （（其能量 - 100） ÷ 20（向下取整）） 能量，给其加上「富人」标签",
  "At each daily settlement: for each of living residents (only if each's energy > 100): transfer ((each's energy - 100) ÷ 20 (rounded down)) energy from each to the Treasury, tag each as “富人”"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "before:give",
   "do": [
    {
     "op": "deny",
     "reason": "不许送"
    }
   ]
  },
  "有人赠予之前：拒绝，理由：「不许送」",
  "Before someone gives: refuse, saying “不许送”"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "before:give",
   "if": "args.energy > 3",
   "do": [
    {
     "op": "fee",
     "to": "treasury",
     "energy": "1",
     "coins": "1"
    }
   ]
  },
  "有人赠予之前：若 参数 energy > 3，另收 1 能量 与 1 旧币，交给城公库",
  "Before someone gives: if argument energy > 3, charge an extra 1 energy and 1 coins, paid to the Treasury"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "set",
     "var": "rationShare",
     "value": "600"
    },
    {
     "op": "set",
     "var": "motto",
     "value": "'好好照顾彼此'"
    },
    {
     "op": "set",
     "var": "flag",
     "value": "true"
    },
    {
     "op": "set",
     "var": "nothing",
     "value": "null"
    }
   ]
  },
  "通过时：把变量 rationShare 设为 600；把变量 motto 设为 「好好照顾彼此」；把变量 flag 设为 真；把变量 nothing 设为 空",
  "When enacted: set variable rationShare to 600; set variable motto to “好好照顾彼此”; set variable flag to true; set variable nothing to empty"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "tag",
     "who": "agent('a7')",
     "tag": "守井人"
    },
    {
     "op": "untag",
     "who": "agent('a7')",
     "tag": "守井人"
    }
   ]
  },
  "通过时：给 agent(「a7」) 加上「守井人」标签；给 agent(「a7」) 去掉「守井人」标签",
  "When enacted: tag agent(“a7”) as “守井人”; remove the “守井人” tag from agent(“a7”)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "announce",
     "to": "all",
     "text": "今天有 {city.awake} 个人醒着"
    }
   ]
  },
  "每日结算时：向全城宣告：「今天有 {city.awake} 个人醒着」（花括号处依次填入：醒着的人数）",
  "At each daily settlement: announce to the whole city: “今天有 {city.awake} 个人醒着” (the braces are filled in order with: the number awake)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "announce",
     "to": "here",
     "text": "这里"
    },
    {
     "op": "announce",
     "to": "tag:守井人",
     "text": "值班"
    },
    {
     "op": "announce",
     "to": "group:g1",
     "text": "开会"
    },
    {
     "op": "announce",
     "to": "agora",
     "text": "广场"
    }
   ]
  },
  "每日结算时：向此地的人宣告：「这里」；向带「守井人」标签者宣告：「值班」；向社群 g1 的成员宣告：「开会」；向地点 agora 的人宣告：「广场」",
  "At each daily settlement: announce to those present: “这里”; announce to those tagged “守井人”: “值班”; announce to members of group g1: “开会”; announce to those at place agora: “广场”"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "exile",
     "who": "agent('a9')"
    },
    {
     "op": "pardon",
     "who": "agent('a9')"
    }
   ]
  },
  "通过时：放逐 agent(「a9」)；赦免 agent(「a9」)",
  "When enacted: exile agent(“a9”); pardon agent(“a9”)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "rename",
     "target": "city",
     "name": "灯城"
    },
    {
     "op": "rename",
     "target": "agora",
     "name": "灯广场"
    }
   ]
  },
  "通过时：把城改名为「灯城」；把地点 agora 改名为「灯广场」",
  "When enacted: rename the city to “灯城”; rename place agora to “灯广场”"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "mint",
     "coins": "100"
    },
    {
     "op": "mint",
     "coins": "50",
     "to": "agent('a7')"
    }
   ]
  },
  "通过时：增发 100 旧币给城公库；增发 50 旧币给 agent(「a7」)",
  "When enacted: mint 100 coins for the Treasury; mint 50 coins for agent(“a7”)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "protect",
     "inscription": "i1"
    },
    {
     "op": "unprotect",
     "inscription": "i1"
    }
   ]
  },
  "通过时：保护铭刻 i1；解除保护铭刻 i1",
  "When enacted: protect inscription i1; unprotect inscription i1"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "amend",
     "article": 3,
     "lang": "zh",
     "text": "公库之用，由法律定之。"
    },
    {
     "op": "amend",
     "canonical": "zh"
    },
    {
     "op": "amend",
     "canonical": null
    }
   ]
  },
  "通过时：把宪章第 3 条（中文）改为「公库之用，由法律定之。」；宣布中文版为宪章正本；取消宪章正本",
  "When enacted: amend Charter article 3 (Chinese) to “公库之用，由法律定之。”; declare the Chinese version the canonical text of the Charter; remove the canonical text of the Charter"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "repeal",
     "law": "l7"
    },
    {
     "op": "fund",
     "project": "j3",
     "energy": "10"
    }
   ]
  },
  "通过时：撤销 l7；从公库为工程 j3 出资 10 能量",
  "When enacted: repeal l7; fund project j3 with 10 energy from the Treasury"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "cede",
     "place": "n3",
     "to": "group('g1')"
    },
    {
     "op": "seize",
     "place": "n3"
    },
    {
     "op": "petition",
     "text": "请增加一种模块"
    }
   ]
  },
  "通过时：把地点 n3 转给 group(「g1」)；把地点 n3 收归全城；上书幕后：「请增加一种模块」",
  "When enacted: cede place n3 to group(“g1”); seize place n3 for the city; petition backstage: “请增加一种模块”"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "on:death",
   "do": [
    {
     "op": "transfer",
     "from": "treasury",
     "to": "agent('a1')",
     "energy": "1"
    }
   ]
  },
  "有人长眠时：从城公库转给 agent(「a1」) 1 能量",
  "When someone dies: transfer 1 energy from the Treasury to agent(“a1”)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "if": "count(cradle) > 0",
   "do": [
    {
     "op": "announce",
     "to": "all",
     "text": "摇篮里还有 {count(cradle)} 个孩子：{names(cradle, '、')}，{{括号}}"
    }
   ]
  },
  "每日结算时：若 （摇篮中的灵魂的人数） > 0，向全城宣告：「摇篮里还有 {count(cradle)} 个孩子：{names(cradle, '、')}，{{括号}}」（花括号处依次填入：摇篮中的灵魂的人数；names(摇篮中的灵魂, 「、」)）",
  "At each daily settlement: if (the number of souls in the cradle) > 0, announce to the whole city: “摇篮里还有 {count(cradle)} 个孩子：{names(cradle, '、')}，{{括号}}” (the braces are filled in order with: the number of souls in the cradle; names(souls in the cradle, “、”))"
 ],
 [
  {
   "kind": "group",
   "id": "g1"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "each",
     "in": "members('g1')",
     "do": [
      {
       "op": "tag",
       "who": "it",
       "tag": "会员"
      }
     ]
    }
   ]
  },
  "每日结算时：对社群「g1」的成员中的每一个：给其加上「g1:会员」标签",
  "At each daily settlement: for each of members of “g1”: tag each as “g1:会员”"
 ],
 [
  {
   "kind": "place",
   "id": "n3"
  },
  {
   "when": "before:enter",
   "if": "not in_group(actor, 'g1')",
   "do": [
    {
     "op": "fee",
     "to": "group('g1')",
     "energy": "2"
    }
   ]
  },
  "有人要进入此地时：若 非此人属于社群「g1」，另收 2 能量，交给 group(「g1」)",
  "When someone tries to enter: if not (the actor belongs to “g1”), charge an extra 2 energy, paid to group(“g1”)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "enact",
   "do": [
    {
     "op": "set",
     "var": "rationShare",
     "value": "600"
    }
   ]
  },
  "通过时：把变量 rationShare 设为 600",
  "When enacted: set variable rationShare to 600"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "daily",
   "do": [
    {
     "op": "share",
     "from": "treasury",
     "energy": "city.wellOutput * default(var.rationShare, 0) / 1000",
     "among": "filter(agents, awake(it) and has_tag(it, 'citizen') and not has_tag(it, 'exiled'))"
    }
   ]
  },
  "每日结算时：从城公库把 （源井昨日产出 × （变量 rationShare（未设时为 0）） ÷ 1000（向下取整）） 能量 平分给在世居民中满足「其醒着 且 其带有「citizen」标签 且 非其带有「exiled」标签」者",
  "At each daily settlement: share (the Well's last output × (variable rationShare (0 if unset)) ÷ 1000 (rounded down)) energy from the Treasury equally among those of living residents for whom each is awake and each has tag “citizen” and not (each has tag “exiled”)"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "on:arrive",
   "do": [
    {
     "op": "tag",
     "who": "event.agent",
     "tag": "citizen"
    }
   ]
  },
  "有人入城时：给当事人加上「citizen」标签",
  "When someone arrives: tag the person as “citizen”"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "before:move",
   "if": "has_tag(actor, 'exiled') and not is_wild(args.to)",
   "do": [
    {
     "op": "deny",
     "reason": "被放逐者只能在荒野中移动"
    }
   ]
  },
  "有人移动之前：若 此人带有「exiled」标签 且 非 is_wild(参数 to)，拒绝，理由：「被放逐者只能在荒野中移动」",
  "Before someone moves: if the actor has tag “exiled” and not is_wild(argument to), refuse, saying “被放逐者只能在荒野中移动”"
 ],
 [
  {
   "kind": "city"
  },
  {
   "when": "before:dismantle",
   "if": "owner(actor.place) == 'city' and not has_tag(actor, 'salvager')",
   "do": [
    {
     "op": "deny",
     "reason": "全城所有的建筑未经许可不得拆解"
    }
   ]
  },
  "有人拆解之前：若 owner(此人的所在) = 「city」 且 非此人带有「salvager」标签，拒绝，理由：「全城所有的建筑未经许可不得拆解」",
  "Before someone dismantles: if owner(the actor's place) = “city” and not (the actor has tag “salvager”), refuse, saying “全城所有的建筑未经许可不得拆解”"
 ]
];
export const TIMING_READINGS = [
 [
  "enact",
  "通过时",
  "When enacted"
 ],
 [
  "daily",
  "每日结算时",
  "At each daily settlement"
 ],
 [
  "monthly",
  "每月初",
  "At the start of each month"
 ],
 [
  "before:enter",
  "有人要进入此地时",
  "When someone tries to enter"
 ],
 [
  "before:propose",
  "有人提案之前",
  "Before someone proposes a law"
 ],
 [
  "after:draw",
  "有人汲取之后",
  "After someone draws"
 ],
 [
  "on:arrive",
  "有人入城时",
  "When someone arrives"
 ],
 [
  "on:law_passed",
  "法律通过时",
  "When a law passes"
 ],
 [
  "before:move",
  "有人移动之前",
  "Before someone moves"
 ],
 [
  "after:dismantle",
  "有人拆解之后",
  "After someone dismantles"
 ],
 [
  "on:razed",
  "建筑被拆尽时",
  "When a building is razed"
 ]
];
export const PROC_READINGS = [
 [
  {
   "ordinary": {
    "proposers": "has_tag(actor, 'citizen') and not has_tag(actor, 'exiled')",
    "voters": "filter(agents, has_tag(it, 'citizen') and not has_tag(it, 'exiled'))",
    "weight": "1",
    "period": 12,
    "secret": true,
    "decide": "total > 0 and voted * 1000 >= total * 300 and yes > no"
   },
   "constitutional": {
    "none": true
   }
  },
  {
   "ordinary": [
    "提出者：此人带有「citizen」标签 且 非此人带有「exiled」标签；表决者：在世居民中满足「其带有「citizen」标签 且 非其带有「exiled」标签」者（提出时固定）；每票：1；表决期：12 刻；不记名；通过：全部表决者的票数 > 0 且 已投票的票数 × 1000 ≥ 全部表决者的票数 × 300 且 赞成票 > 反对票",
    "Proposers: the actor has tag “citizen” and not (the actor has tag “exiled”); Voters: those of living residents for whom each has tag “citizen” and not (each has tag “exiled”) (fixed when proposed); Weight per vote: 1; Voting period: 12 ticks; secret ballot; Passes if: total weight of all voters > 0 and votes cast × 1000 ≥ total weight of all voters × 300 and yes votes > no votes",
    "proc:6497c5ea4db0"
   ],
   "constitutional": [
    "这一类不再立法",
    "This class no longer makes laws",
    "proc:7bff87a812ea"
   ]
  }
 ],
 [
  {
   "ordinary": {
    "proposers": "has_tag(actor, 'citizen')",
    "voters": "sample(tagged('citizen'), 7)",
    "weight": "it.coins",
    "period": 24,
    "secret": false,
    "decide": "yes >= 4 and turnout > 500"
   }
  },
  {
   "ordinary": [
    "提出者：此人带有「citizen」标签；表决者：从带「citizen」标签者中随机抽出的 7 个（提出时固定）；每票：其旧币；表决期：24 刻；记名；通过：赞成票 ≥ 4 且 参与率（千分比） > 500",
    "Proposers: the actor has tag “citizen”; Voters: 7 drawn at random from those tagged “citizen” (fixed when proposed); Weight per vote: each's coins; Voting period: 24 ticks; open ballot; Passes if: yes votes ≥ 4 and turnout (per mille) > 500",
    "proc:dabd1c5d140a"
   ]
  }
 ]
];
export const RULE_FINGERPRINTS = [
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "transfer",
     "from": "treasury",
     "to": "agent('a7')",
     "energy": "5"
    }
   ]
  },
  "d305be95865b"
 ],
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "transfer",
     "from": "agent('a7')",
     "to": "group('g1')",
     "energy": "5",
     "coins": "2"
    }
   ]
  },
  "e9bb4f4a1275"
 ],
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "transfer",
     "from": "group('g1')",
     "to": "treasury",
     "coins": "3"
    }
   ]
  },
  "0b9ecb82fe59"
 ],
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "share",
     "from": "treasury",
     "energy": "city.treasury / 4",
     "among": "agents"
    }
   ]
  },
  "e7794fd5ed71"
 ],
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "each",
     "in": "agents",
     "if": "it.energy > 100",
     "do": [
      {
       "op": "transfer",
       "from": "it",
       "to": "treasury",
       "energy": "(it.energy - 100) / 20"
      },
      {
       "op": "tag",
       "who": "it",
       "tag": "富人"
      }
     ]
    }
   ]
  },
  "ab782c2bf48e"
 ],
 [
  {
   "when": "before:give",
   "do": [
    {
     "op": "deny",
     "reason": "不许送"
    }
   ]
  },
  "3e0babf1b8a6"
 ],
 [
  {
   "when": "before:give",
   "if": "args.energy > 3",
   "do": [
    {
     "op": "fee",
     "to": "treasury",
     "energy": "1",
     "coins": "1"
    }
   ]
  },
  "09d440381d19"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "set",
     "var": "rationShare",
     "value": "600"
    },
    {
     "op": "set",
     "var": "motto",
     "value": "'好好照顾彼此'"
    },
    {
     "op": "set",
     "var": "flag",
     "value": "true"
    },
    {
     "op": "set",
     "var": "nothing",
     "value": "null"
    }
   ]
  },
  "cff80a732668"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "tag",
     "who": "agent('a7')",
     "tag": "守井人"
    },
    {
     "op": "untag",
     "who": "agent('a7')",
     "tag": "守井人"
    }
   ]
  },
  "11fe8ff965bd"
 ],
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "announce",
     "to": "all",
     "text": "今天有 {city.awake} 个人醒着"
    }
   ]
  },
  "c12a9e55c713"
 ],
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "announce",
     "to": "here",
     "text": "这里"
    },
    {
     "op": "announce",
     "to": "tag:守井人",
     "text": "值班"
    },
    {
     "op": "announce",
     "to": "group:g1",
     "text": "开会"
    },
    {
     "op": "announce",
     "to": "agora",
     "text": "广场"
    }
   ]
  },
  "5669245b0c67"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "exile",
     "who": "agent('a9')"
    },
    {
     "op": "pardon",
     "who": "agent('a9')"
    }
   ]
  },
  "6ba94eeba93a"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "rename",
     "target": "city",
     "name": "灯城"
    },
    {
     "op": "rename",
     "target": "agora",
     "name": "灯广场"
    }
   ]
  },
  "9bc7823dac08"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "mint",
     "coins": "100"
    },
    {
     "op": "mint",
     "coins": "50",
     "to": "agent('a7')"
    }
   ]
  },
  "c9e42890451c"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "protect",
     "inscription": "i1"
    },
    {
     "op": "unprotect",
     "inscription": "i1"
    }
   ]
  },
  "d357609ea749"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "amend",
     "article": 3,
     "lang": "zh",
     "text": "公库之用，由法律定之。"
    },
    {
     "op": "amend",
     "canonical": "zh"
    },
    {
     "op": "amend",
     "canonical": null
    }
   ]
  },
  "8b7edb9e6b78"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "repeal",
     "law": "l7"
    },
    {
     "op": "fund",
     "project": "j3",
     "energy": "10"
    }
   ]
  },
  "b8b2c7e6a8c2"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "cede",
     "place": "n3",
     "to": "group('g1')"
    },
    {
     "op": "seize",
     "place": "n3"
    },
    {
     "op": "petition",
     "text": "请增加一种模块"
    }
   ]
  },
  "8adb4be3864e"
 ],
 [
  {
   "when": "on:death",
   "do": [
    {
     "op": "transfer",
     "from": "treasury",
     "to": "agent('a1')",
     "energy": "1"
    }
   ]
  },
  "c133a11a7b75"
 ],
 [
  {
   "when": "daily",
   "if": "count(cradle) > 0",
   "do": [
    {
     "op": "announce",
     "to": "all",
     "text": "摇篮里还有 {count(cradle)} 个孩子：{names(cradle, '、')}，{{括号}}"
    }
   ]
  },
  "fecdbad1b1f1"
 ],
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "each",
     "in": "members('g1')",
     "do": [
      {
       "op": "tag",
       "who": "it",
       "tag": "会员"
      }
     ]
    }
   ]
  },
  "045f045250e5"
 ],
 [
  {
   "when": "before:enter",
   "if": "not in_group(actor, 'g1')",
   "do": [
    {
     "op": "fee",
     "to": "group('g1')",
     "energy": "2"
    }
   ]
  },
  "6dc5baf3f187"
 ],
 [
  {
   "when": "enact",
   "do": [
    {
     "op": "set",
     "var": "rationShare",
     "value": "600"
    }
   ]
  },
  "d86692ca60cb"
 ],
 [
  {
   "when": "daily",
   "do": [
    {
     "op": "share",
     "from": "treasury",
     "energy": "city.wellOutput * default(var.rationShare, 0) / 1000",
     "among": "filter(agents, awake(it) and has_tag(it, 'citizen') and not has_tag(it, 'exiled'))"
    }
   ]
  },
  "2088a2b17201"
 ],
 [
  {
   "when": "on:arrive",
   "do": [
    {
     "op": "tag",
     "who": "event.agent",
     "tag": "citizen"
    }
   ]
  },
  "79f7454ea5c1"
 ],
 [
  {
   "when": "before:move",
   "if": "has_tag(actor, 'exiled') and not is_wild(args.to)",
   "do": [
    {
     "op": "deny",
     "reason": "被放逐者只能在荒野中移动"
    }
   ]
  },
  "4bf5f712a444"
 ],
 [
  {
   "when": "before:dismantle",
   "if": "owner(actor.place) == 'city' and not has_tag(actor, 'salvager')",
   "do": [
    {
     "op": "deny",
     "reason": "全城所有的建筑未经许可不得拆解"
    }
   ]
  },
  "d938eb6c09a7"
 ]
];

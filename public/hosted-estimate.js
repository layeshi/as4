// Scenario estimate, not a financial budget: game thinking units != provider tokens.
export function estimateHosted(model, cap) {
  if (!Number.isSafeInteger(cap) || cap < 0 || cap > 50000000 || !model?.available) return null;
  const tiers = model.tiers?.length ? model.tiers : [{ pricesMicro: model.pricesMicro }];
  if (!tiers[0]?.pricesMicro) return null;
  const price = (u, p) => ((u.input - u.cacheRead - u.cacheWrite) * p.miss + u.cacheRead * (p.hit ?? p.miss) + (u.cacheWrite - u.cacheWriteHour) * (p.write ?? p.miss) + u.cacheWriteHour * (p.writeHour ?? p.write ?? p.miss) + u.output * p.output) / 1000000;
  const samples = (model.samples ?? []).filter(s => s.gameTokens > 0 && s.input >= s.cacheRead + s.cacheWrite && s.cacheWrite >= s.cacheWriteHour);
  let low, high, assumptions, basis;
  if (samples.length >= 10) {
    const values = samples.flatMap(s => tiers.map(t => price(s, t.pricesMicro) / s.gameTokens)).sort((a, b) => a - b);
    low = values[Math.floor((values.length - 1) * .1)] * cap;
    high = values[Math.ceil((values.length - 1) * .9)] * cap;
    basis = '运行样本估算';
    assumptions = `最近30天 ${samples.length} 个完整醒来样本，按当前各价档重算，取场景组合中每游戏词元费用的10%–90%分位；不代表置信区间。`;
  } else {
    const scenario = (ratio, outputShare, cacheShare, writeShare) => {
      const total = cap * ratio, input = total * (1 - outputShare);
      return { input, output: total * outputShare, cacheRead: input * cacheShare, cacheWrite: input * writeShare, cacheWriteHour: input * writeShare };
    };
    const cheap = tiers[0].pricesMicro, expensive = tiers.at(-1).pricesMicro;
    low = price(scenario(2, .1, cheap.hit == null ? 0 : .8, 0), cheap);
    high = price(scenario(4, .2, 0, expensive.writeHour == null ? 0 : .2), expensive);
    basis = '粗略估算';
    assumptions = '场景假设（非实测）：实际 token 为游戏词元的2–4倍；输出占10%–20%；低消耗场景输入缓存命中80%（无缓存价时按0%），高消耗场景无命中、有写入价时20%输入按1小时缓存写入；阶梯模型覆盖首档至末档价格。';
  }
  const daily = [Math.max(0, Math.floor(Math.min(low, high))), Math.max(0, Math.ceil(Math.max(low, high)))];
  if (!daily.every(Number.isSafeInteger) || !daily.every(n => Number.isSafeInteger(n * 30))) return null;
  return { daily, monthly: daily.map(n => n * 30), basis, assumptions, days: 30 };
}

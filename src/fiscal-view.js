// A rebuildable public-event projection, outside the deterministic world.
// It retains daily aggregates even after EventStore's public ring rolls over.
export class FiscalView {
  constructor() { this.days = new Map(); this.errors = new Map(); }
  index(e) {
    if (e.vis !== 'public') return;
    if (e.type === 'rule_error') {
      this.errors.set(`${e.data.scope}:${e.data.owner}:${e.data.rule}`, { tick: e.tick, day: e.day, ...e.data });
      return;
    }
    if (e.type !== 'rule_op') return;
    const d = e.data;
    if (d.scope !== 'city' || d.from !== 'treasury' || !d.ok) return;
    const amount = d.op === 'share' ? (d.each?.energy || 0) * d.among
      : d.op === 'transfer' && /^a\d+$/.test(d.to) ? d.energy : 0;
    if (!amount) return;
    let day = this.days.get(e.day);
    if (!day) this.days.set(e.day, (day = new Map()));
    const key = `${d.owner}:${d.rule}`;
    day.set(key, (day.get(key) || 0) + amount);
  }
  metrics(w, m) {
    let daily = 0, other = 0;
    for (const [key, amount] of this.days.get(m.day) || []) {
      const [owner, index] = key.split(':');
      const when = w.laws[owner]?.rules[index]?.when;
      if (when === 'daily' || when === 'monthly') daily += amount;
      else other += amount;
    }
    const population = m.awake + m.dormant;
    return { ...m, legacyRationPerCapita: m.rationPerCapita,
      // Compatibility field: now ALL actual scheduled law distributions / living residents.
      rationPerCapita: population ? Math.round(daily / population * 1000) / 1000 : 0,
      dailyDistributionEnergy: daily, otherLawPaymentsEnergy: other,
      rationMetricBasis: 'scheduled_law_payments_per_living_resident',
    };
  }
  diagnostics(w) {
    return [...this.errors.values()].filter(e => e.scope === 'city' && w.laws[e.owner]?.status === 'active').slice(-20);
  }
}

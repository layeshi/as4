// 滚动：跟手、惯性、越界阻尼与回弹、下拉刷新。时间单位为毫秒，速度为像素/毫秒。
const PULL = 64;
class Scroller {
  constructor() { this.offset = 0; this.max = 0; this.v = 0; this.dragging = false; this.samples = []; this.lastY = 0; }
  setMax(max) { this.max = Math.max(0, max); if (!this.dragging && this.offset > this.max && this.v === 0) this.offset = this.max; }
  reset() { this.offset = 0; this.v = 0; this.dragging = false; this.samples = []; }
  start(y, t) { this.dragging = true; this.v = 0; this.lastY = y; this.samples = [{ y, t }]; }
  move(y, t) {
    if (!this.dragging) return;
    let dy = this.lastY - y; this.lastY = y;
    if (this.offset < 0 || this.offset > this.max) dy *= 0.45;
    this.offset += dy;
    this.samples.push({ y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  }
  /** 返回 true 表示越过下拉阈值，应当刷新。 */
  end(t) {
    if (!this.dragging) return false;
    this.dragging = false;
    const first = this.samples[0], last = this.samples[this.samples.length - 1];
    const dt = Math.max(1, (t || last.t) - first.t);
    this.v = dt > 140 ? 0 : Math.max(-6, Math.min(6, (first.y - last.y) / dt));
    return this.offset < -PULL;
  }
  get pull() { return this.offset < 0 ? -this.offset : 0; }
  get pullReady() { return this.offset < -PULL; }
  /** 推进一帧；返回 true 表示还在动。 */
  step(dt) {
    if (this.dragging) return false;
    dt = Math.min(dt, 48);
    if (this.offset < 0 || this.offset > this.max) {
      const target = this.offset < 0 ? 0 : this.max;
      this.v = 0;
      this.offset += (target - this.offset) * Math.min(1, dt / 90);
      if (Math.abs(target - this.offset) < 0.5) { this.offset = target; return false; }
      return true;
    }
    if (Math.abs(this.v) < 0.02) { this.v = 0; return false; }
    this.offset += this.v * dt;
    this.v *= Math.exp(-dt / 325);
    if (this.offset < 0 || this.offset > this.max) this.v *= 0.3;
    return true;
  }
  scrollTo(offset) { this.offset = Math.max(0, Math.min(this.max, offset)); this.v = 0; }
}
module.exports = { Scroller, PULL };

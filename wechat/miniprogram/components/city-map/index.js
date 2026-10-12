const view = require('../../utils/view');
Component({
  properties: { state: { type: Object, value: null }, map: { type: Object, value: null } },
  observers: { 'state, map': function () { if (this._ready) this.draw(); } },
  lifetimes: { ready() { this._ready = true; this.draw(); } },
  methods: {
    draw() {
      if (!this.data.state || !this.data.map) return;
      this.createSelectorQuery().select('.city').boundingClientRect(rect => {
        if (!rect || !this._ready) return;
        const state = this.data.state, map = this.data.map;
        const ctx = wx.createCanvasContext('city', this);
        const size = map.size || [1200, 900];
        const places = {}, coords = {};
        const sx = (rect.width - 52) / size[0], sy = (rect.height - 52) / size[1];
        (state.places || []).forEach(p => { places[p.id] = p; });
        (map.places || []).concat(state.places || []).forEach(p => {
          if (p.xy && p.xy.length === 2) coords[p.id] = { x: 26 + p.xy[0] * sx, y: 20 + p.xy[1] * sy };
        });
        ctx.setStrokeStyle('#273c3e'); ctx.setLineWidth(1);
        for (let x = 16; x < rect.width; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke(); }
        for (let y = 16; y < rect.height; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke(); }
        ctx.setStrokeStyle('#49615e');
        (map.streets || []).concat(state.roads || []).forEach(edge => {
          const a = coords[edge.a], b = coords[edge.b];
          if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        });
        this._points = [];
        Object.keys(coords).forEach(id => {
          const p = places[id]; if (!p) return;
          const point = coords[id];
          const count = (state.agents || []).filter(a => a.place === id && a.status === 'awake').length;
          ctx.setFillStyle(p.ruined || p.razed ? '#586366' : count ? '#e5bd79' : '#9ebaae');
          ctx.beginPath(); ctx.arc(point.x, point.y, count ? 5 : 3, 0, Math.PI * 2); ctx.fill();
          ctx.setFontSize(10); ctx.setTextAlign('center');
          const label = view.placeName(p);
          ctx.fillText(label.slice(0, 7) + (count ? ' ' + count : ''), point.x, point.y + 16);
          this._points.push({ id, x: point.x, y: point.y });
        });
        ctx.draw();
      }).exec();
    },
    selectPlace(event) {
      const x = event.detail.x, y = event.detail.y;
      const points = (this._points || []).map(p => Object.assign({}, p, { distance: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.distance - b.distance);
      if (points[0] && points[0].distance < 28) this.triggerEvent('select', { id: points[0].id });
    }
  }
});

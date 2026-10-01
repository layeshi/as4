// 一个极小的假 DOM，只够让观测站的渲染函数（public/*.js 里 (ctx, root) → 往 root 里填内容的那些）在 Node 里跑起来，
// 用来测它们遇到真实数据时不抛错、不出现 undefined / NaN / [object Object]。不是浏览器：没有布局、没有事件冒泡、不解析 HTML。

class FClassList {
  constructor(owner) {
    this.owner = owner;
    this.set = new Set();
  }

  sync() {
    this.owner.attrs.set('class', [...this.set].join(' '));
  }

  add(...cs) {
    for (const c of cs) if (c) this.set.add(c);
    this.sync();
  }

  remove(...cs) {
    for (const c of cs) this.set.delete(c);
    this.sync();
  }

  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c);
    else this.set.delete(c);
    this.sync();
    return on;
  }

  contains(c) {
    return this.set.has(c);
  }

  replace(a, b) {
    if (this.set.delete(a)) this.set.add(b);
    this.sync();
  }

  [Symbol.iterator]() {
    return this.set[Symbol.iterator]();
  }
}

export class FNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }

  append(...cs) {
    for (const c of cs) this.appendChild(c instanceof FNode ? c : new FText(String(c)));
  }

  prepend(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.unshift(c);
  }

  insertBefore(c, ref) {
    if (ref === null || ref === undefined) return this.appendChild(c);
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, c);
    return c;
  }

  replaceChildren(...cs) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...cs);
  }

  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }

  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  get children() {
    return this.childNodes.filter((c) => c instanceof FElement);
  }

  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === FDocument.root;
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) this.appendChild(new FText(String(v)));
  }

  /** 一个复合选择器：tag / * 、.class、[attr]、[attr="值"] 的组合 */
  matchesCompound(part) {
    if (!(this instanceof FElement)) return false;
    const m = part.match(/^([a-zA-Z0-9*]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/);
    if (!m) throw new Error(`假 DOM 不支持的选择器：${part}`);
    if (m[1] && m[1] !== '*' && m[1] !== this.tag) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    for (const a of m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!this.attrs.has(a[1])) return false;
      if (a[2] !== undefined && this.attrs.get(a[1]) !== a[2]) return false;
    }
    return true;
  }

  /** 支持逗号、后代（空格）与子代（>）组合 */
  matches(sel) {
    if (!(this instanceof FElement)) return false;
    return sel.split(',').some((chain) => {
      const toks = chain.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
      const match = (node, i) => {
        if (!node || !node.matchesCompound(toks[i])) return false;
        if (i === 0) return true;
        const direct = toks[i - 1] === '>';
        const prev = direct ? i - 2 : i - 1;
        if (direct) return match(node.parentNode, prev);
        for (let up = node.parentNode; up; up = up.parentNode) if (match(up, prev)) return true;
        return false;
      };
      return match(this, toks.length - 1);
    });
  }

  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

export class FText extends FNode {
  constructor(data) {
    super();
    this.data = data;
  }

  get textContent() {
    return this.data;
  }

  set textContent(v) {
    this.data = String(v);
  }
}

export class FElement extends FNode {
  constructor(tag, ns = null) {
    super();
    this.tag = tag;
    this.ns = ns;
    this.attrs = new Map();
    this.classList = new FClassList(this);
    this.style = { setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this.listeners = {};
  }

  get className() {
    return this.attrs.get('class') || '';
  }

  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
    this.classList.sync();
  }

  setAttribute(k, v) {
    if (k === 'class') this.className = v;
    else this.attrs.set(k, String(v));
  }

  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }

  hasAttribute(k) {
    return this.attrs.has(k);
  }

  removeAttribute(k) {
    this.attrs.delete(k);
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== fn);
  }

  /** 布局不存在：给一个固定的矩形，让依赖尺寸的代码（地图的视口）能算出有限的数 */
  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700 };
  }

  setPointerCapture() {}

  releasePointerCapture() {}

  /** 触发已登记的监听器（测试里模拟点击） */
  fire(type, ev = {}) {
    for (const fn of this.listeners[type] || []) fn({ type, target: this, stopPropagation() {}, preventDefault() {}, ...ev });
  }

  click() {
    this.fire('click');
  }

  scrollIntoView() {}

  focus() {}

  getComputedTextLength() {
    return this.textContent.length * 7;
  }
}

export const FDocument = {
  root: null,
};

/** 安装全局的 document / Node（只在测试里调用），返回 { root, restore } */
export function installFakeDom() {
  const root = new FElement('body');
  FDocument.root = root;
  const saved = { document: globalThis.document, Node: globalThis.Node, SVGElement: globalThis.SVGElement };
  const byId = new Map();
  globalThis.Node = FNode;
  globalThis.document = {
    documentElement: new FElement('html'),
    createElement: (tag) => new FElement(tag),
    createElementNS: (ns, tag) => new FElement(tag, ns),
    createTextNode: (t) => new FText(String(t)),
    getElementById: (id) => byId.get(id) || null,
    addEventListener() {},
    removeEventListener() {},
    body: root,
  };
  return {
    root,
    register: (id, el) => byId.set(id, el),
    restore() {
      globalThis.document = saved.document;
      globalThis.Node = saved.Node;
      FDocument.root = null;
    },
  };
}

/** 一个节点子树的全部文字 */
export const textOf = (node) => node.textContent;

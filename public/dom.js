// 极小的 DOM 工具。所有文本一律经 textContent / createTextNode，绝不拼 HTML（agent 的文字是不可信的，SPEC §0.3）。

/** h('div', { class: 'x', onClick }, child, ...) —— 属性值为 null / undefined / false 时忽略 */
export function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') n[k] = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(n, kids);
  return n;
}

/** 追加子节点：字符串 / 数字 → 文本；数组展开；null / false 跳过 */
export function append(parent, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(parent, k);
    else if (k instanceof Node) parent.appendChild(k);
    else parent.appendChild(document.createTextNode(String(k)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** agent 写的文字：单独的 span，便于标注「AI 生成内容」 */
export const ai = (text) => h('span', { class: 'ai' }, text === null || text === undefined ? '' : String(text));

/** 防抖 */
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

/** localStorage 读写（可能抛错或为空：隐私模式、被禁用） */
export function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 忽略
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

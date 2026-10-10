// Minimal DOM helpers (no framework).
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Append children, skipping null/false (Element.append rejects null). */
export function add(el: HTMLElement, ...children: Child[]): HTMLElement { append(el, children); return el; }

export function clear(el: HTMLElement): HTMLElement { el.replaceChildren(); return el; }

export function svg(markup: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'svg';
  span.innerHTML = markup;
  return span;
}

export const fmtTime = (s: number): string => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
export const ratio = (a: number, b: number): string => (b > 0 ? (a / b).toFixed(2) : a > 0 ? a.toFixed(2) : '0.00');

/**
 * Tiny DOM helpers. The UI is plain TypeScript + DOM (no React) so the
 * bundle stays small and there are no extra dependencies. Panels are
 * constructed with their host element and hold their own state.
 */
type EventHandlers = Record<string, EventListener>;

type ElAttrs = {
  on?: EventHandlers;
  [key: string]: string | EventHandlers | undefined;
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K,
  attrs: ElAttrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'className' && typeof value === 'string') node.className = value;
    else if (key === 'html' && typeof value === 'string') (node as HTMLElement).innerHTML = value;
    else if (key === 'on' && typeof value === 'object') {
      for (const [ev, fn] of Object.entries(value)) {
        node.addEventListener(ev, fn);
      }
    } else if (typeof value === 'string') node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') node.append(document.createTextNode(child));
    else node.append(child);
  }
  return node;
}

export function text(node: Node, value: string): void {
  node.textContent = value;
}

export function show(el: HTMLElement, value: boolean): void {
  el.style.display = value ? '' : 'none';
}

export function setDisabled(el: HTMLButtonElement | HTMLInputElement, value: boolean): void {
  el.disabled = value;
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  return el('button', { className, on: { click: onClick } }, label);
}

export function input<K extends keyof HTMLElementTagNameMap>(attrs: Partial<HTMLInputElement> & { onInput?: (v: string) => void }): HTMLInputElement {
  const node = document.createElement('input');
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'onInput') {
      node.addEventListener('input', () => (value as (v: string) => void)(node.value));
    } else if (key === 'onChange') {
      node.addEventListener('change', () => (value as (v: string) => void)(node.value));
    } else if (key === 'onBlur') {
      node.addEventListener('blur', () => (value as () => void)());
    } else {
      (node as any)[key] = value;
    }
  }
  return node;
}

export function select<T>(options: T[], render: (item: T) => string, onChange: (item: T) => void): HTMLSelectElement {
  const node = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = String(options.indexOf(opt));
    o.textContent = render(opt);
    node.appendChild(o);
  }
  node.addEventListener('change', () => onChange(options[parseInt(node.value, 10)]));
  return node;
}

export function modal(title: string, content: Node | string, onClose: () => void): HTMLElement {
  const backdrop = el('div', { className: 'modal-backdrop', on: { click: onClose } });
  const card = el('div', { className: 'modal', on: { click: (e: Event) => e.stopPropagation() } });
  card.append(el('h3', {}, title), content);
  backdrop.appendChild(card);
  return backdrop;
}
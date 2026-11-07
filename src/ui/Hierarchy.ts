import { el, text } from './UILite';
import { EditorEngine } from '../engine/core/editor-engine';

/**
 * Object hierarchy panel. Lists every object in the scene graph and lets
 * the user select, rename and toggle visibility. Mobile: vertical list
 * with big tap targets.
 */
export class Hierarchy {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private selectedId: string | null = null;

  constructor(private readonly engine: EditorEngine) {
    this.element = el('div', { className: 'panel' });
    this.element.append(el('h3', {}, 'Hierarchy'));
    this.list = el('ul', { className: 'hierarchy' });
    this.element.appendChild(this.list);

    this.engine.graph.onSelectionChange((obj) => {
      this.selectedId = obj ? obj.meta.id : null;
      this.render();
    });
    this.engine.graph.onChange(() => this.render());
    this.render();
  }

  private render(): void {
    this.list.innerHTML = '';
    const objects = this.engine.graph.objects;

    if (objects.length === 0) {
      this.list.append(el('li', { className: 'empty' }, 'No objects yet — add one below.'));
      return;
    }

    for (const obj of objects) {
      const item = el(
        'button',
        {
          className: 'hierarchy-item' + (obj.meta.id === this.selectedId ? ' active' : ''),
          on: { click: () => this.engine.graph.select(obj) },
        },
        el('span', { className: 'dot', style: 'background:' + obj.meta.color }),
        el('span', { className: 'name' }, obj.meta.name),
        el('span', { className: 'badge' }, obj.meta.primitive || 'group')
      );
      this.list.appendChild(el('li', {}, item));
    }
  }
}
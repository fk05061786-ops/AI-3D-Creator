import * as THREE from 'three';
import { el, text } from './UILite';
import { EditorEngine } from '../engine/core/editor-engine';
import type { AnimatedProperty } from '../engine/animation/animation-system';
import type { SceneObject } from '../engine/core/object-model';

const PROPERTIES: AnimatedProperty[] = ['position', 'rotation', 'scale'];

function targetName(target: SceneObject | THREE.Bone): string {
  return target instanceof THREE.Bone ? target.name : target.meta.name;
}

/**
 * Timeline UI: clip management, keyframe recording, transport controls and
 * frame scrubbing. Drives the AnimationSystem owned by the engine.
 */
export class AnimationPanel {
  readonly element: HTMLElement;
  private readonly clipSelect: HTMLSelectElement;
  private readonly targetSelect: HTMLSelectElement;
  private readonly targetLabel: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly durationInput: HTMLInputElement;
  private readonly timeline: HTMLInputElement;
  private readonly frameLabel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly propertyButtons = new Map<AnimatedProperty, HTMLButtonElement>();
  private property: AnimatedProperty = 'position';
  private scrubbing = false;

  constructor(private readonly engine: EditorEngine) {
    this.element = el('div', { className: 'panel anim-panel' });
    this.element.append(el('h3', {}, 'Animation'));

    this.nameInput = el('input', { type: 'text', placeholder: 'Clip name' }) as HTMLInputElement;
    this.durationInput = el('input', {
      type: 'number',
      min: '0.1',
      max: '120',
      step: '0.1',
      value: '2',
    }) as HTMLInputElement;
    this.element.append(
      el('div', { className: 'field' }, el('span', {}, 'Clip'), this.nameInput),
      el('div', { className: 'field' }, el('span', {}, 'Duration s'), this.durationInput)
    );

    const clipActions = el('div', { className: 'actions' });
    clipActions.append(
      this.button('New Clip', () => this.createClip()),
      this.button('Delete', () => this.deleteClip())
    );
    this.element.appendChild(clipActions);

    this.clipSelect = el('select', { className: 'anim-select' }) as HTMLSelectElement;
    this.clipSelect.addEventListener('change', () => {
      this.engine.animation.selectClip(this.clipSelect.value || null);
    });
    this.element.appendChild(el('div', { className: 'field' }, el('span', {}, 'Clip'), this.clipSelect));

    this.targetSelect = el('select', { className: 'anim-select' }) as HTMLSelectElement;
    this.targetSelect.append(
      this.option('object', 'Object'),
      this.option('bone', 'Bone')
    );
    this.targetLabel = el('span', { className: 'anim-target' }, 'none');
    this.element.append(
      el('div', { className: 'field' }, el('span', {}, 'Target'), this.targetSelect),
      el('div', { className: 'field' }, el('span', {}, 'Animating'), this.targetLabel)
    );

    const propertyGroup = el('div', { className: 'anim-properties' });
    for (const property of PROPERTIES) {
      const button = this.button(
        property[0].toUpperCase() + property.slice(1),
        () => this.selectProperty(property),
        'anim-prop'
      );
      this.propertyButtons.set(property, button);
      propertyGroup.appendChild(button);
    }
    this.element.appendChild(propertyGroup);

    const keyActions = el('div', { className: 'actions' });
    keyActions.append(
      this.button('Add Key', () => this.addKeyframe()),
      this.button('Del Key', () => this.removeKeyframe())
    );
    this.element.appendChild(keyActions);

    const transport = el('div', { className: 'actions' });
    transport.append(
      this.button('Play', () => this.engine.animation.play()),
      this.button('Pause', () => this.engine.animation.pause()),
      this.button('Stop', () => this.engine.animation.stop()),
      this.button('Loop', () => this.toggleLoop(), 'anim-loop')
    );
    this.element.appendChild(transport);

    this.timeline = el('input', {
      type: 'range',
      className: 'anim-timeline',
      min: '0',
      max: '1',
      step: '0.01',
      value: '0',
    }) as HTMLInputElement;
    this.timeline.addEventListener('input', () => {
      this.scrubbing = true;
      this.engine.animation.scrub(parseFloat(this.timeline.value));
    });
    this.timeline.addEventListener('change', () => {
      this.scrubbing = false;
    });

    this.frameLabel = el('span', { className: 'anim-frame' }, 'Frame 0 / 0');
    this.element.append(this.timeline, this.frameLabel);

    this.status = el('div', { className: 'anim-status' }, 'No clip selected');
    this.element.appendChild(this.status);

    this.engine.animation.onChange(() => this.refresh());
    this.engine.graph.onSelectionChange(() => this.refreshTarget());
    this.engine.rig.onChange(() => this.refreshTarget());

    this.refresh();
    this.refreshTarget();
    this.tick();
  }

  private button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
    return el('button', { className, on: { click: onClick } }, label) as HTMLButtonElement;
  }

  private option(value: string, label: string): HTMLOptionElement {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  private createClip(): void {
    const duration = parseFloat(this.durationInput.value) || 2;
    const name = this.engine.animation.createClip(this.nameInput.value || undefined, duration);
    this.nameInput.value = '';
    this.setStatus(`Created clip "${name}".`);
  }

  private deleteClip(): void {
    const name = this.engine.animation.currentClip;
    if (!name) {
      this.setStatus('No clip selected.', true);
      return;
    }
    this.engine.animation.removeClip(name);
    this.setStatus(`Deleted clip "${name}".`);
  }

  private selectProperty(property: AnimatedProperty): void {
    this.property = property;
    for (const [key, button] of this.propertyButtons) {
      button.classList.toggle('active', key === property);
    }
  }

  private currentTarget(): SceneObject | THREE.Bone | null {
    if (this.targetSelect.value === 'bone') return this.engine.rig.activeBone;
    return this.engine.graph.selected;
  }

  private addKeyframe(): void {
    const target = this.currentTarget();
    if (!target) {
      this.setStatus('Select an object or bone to key.', true);
      return;
    }
    const ok = this.engine.animation.addKeyframe(
      target,
      this.property,
      this.engine.animation.currentTime
    );
    this.setStatus(ok ? `Key added at ${this.engine.animation.currentTime.toFixed(2)}s.` : 'Add a clip first.', !ok);
  }

  private removeKeyframe(): void {
    const target = this.currentTarget();
    if (!target) {
      this.setStatus('Select an object or bone to key.', true);
      return;
    }
    const ok = this.engine.animation.removeKeyframe(
      target,
      this.property,
      this.engine.animation.currentTime
    );
    this.setStatus(ok ? 'Key removed.' : 'No key at the playhead.', !ok);
  }

  private toggleLoop(): void {
    this.engine.animation.setLoop(!this.engine.animation.loopEnabled);
  }

  private refresh(): void {
    const names = this.engine.animation.clipNames;
    const current = this.engine.animation.currentClip;
    const wanted = current ?? names[0] ?? '';
    if (this.clipSelect.value !== wanted || this.clipSelect.options.length !== names.length) {
      this.clipSelect.innerHTML = '';
      for (const name of names) {
        const option = this.option(name, name);
        this.clipSelect.appendChild(option);
      }
      if (wanted) this.clipSelect.value = wanted;
    }
    const duration = this.engine.animation.duration;
    this.timeline.max = String(Math.max(duration, 0.01));
    this.timeline.step = String(1 / Math.max(1, this.engine.animation.fps));

    for (const button of this.element.querySelectorAll('.anim-loop')) {
      button.classList.toggle('active', this.engine.animation.loopEnabled);
    }
  }

  private refreshTarget(): void {
    const target = this.currentTarget();
    text(this.targetLabel, target ? targetName(target) : 'none');
  }

  private setStatus(message: string, error = false): void {
    text(this.status, message);
    this.status.style.color = error ? '#f87171' : '#60a5fa';
  }

  private tick(): void {
    const update = () => {
      const animation = this.engine.animation;
      if (!this.scrubbing) this.timeline.value = String(animation.currentTime);
      text(
        this.frameLabel,
        `Frame ${animation.currentFrame} / ${animation.totalFrames}  (${animation.currentTime.toFixed(2)}s)`
      );
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }
}

// Full-screen touch layout editor (available from Settings, works with finger or mouse).
// Drag any button, tap it to select, then change its size / hide it; changes save to the profile.
import { DEFAULT_TOUCH, type Settings } from '../../meta/profile';
import { h } from './dom';
import { LABELS } from './touch';

const NAMES: Record<string, string> = {
  fire: 'Огонь (правая)', fireLeft: 'Огонь (левая)', aim: 'Прицел', jump: 'Прыжок', crouch: 'Присед', reload: 'Перезарядка',
  weapon: 'Смена оружия', grenade: 'Гранаты', use: 'Взаимодействие (E)', buy: 'Магазин ($)', scores: 'Таблица', walk: 'Тихий шаг',
};

export function openTouchEditor(root: HTMLElement, settings: Settings, save: () => void): void {
  const t = settings.touch;
  let selected = 'fire';
  const stage = h('div', { class: 'touch', style: 'position:absolute;inset:0;background:linear-gradient(#5b7da8,#c9b48a 55%,#8a7a5a);touch-action:none;pointer-events:auto' });
  // mock HUD so you can see what the buttons would cover
  stage.append(
    h('div', { style: 'position:absolute;top:12px;left:12px;width:130px;height:130px;border-radius:10px;background:rgba(0,0,0,.45);color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center' }, 'мини-карта'),
    h('div', { style: 'position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:6px 16px;border-radius:8px;background:rgba(0,0,0,.5);color:#fff;font-weight:800' }, '0  1:45  0'),
    h('div', { style: 'position:absolute;bottom:14px;left:16px;color:#fff;font-weight:800;font-size:28px;text-shadow:0 1px 2px #000' }, '✚100  ⛑100'),
    h('div', { style: 'position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px;border:2px solid #4dff7a;border-radius:50%' }),
    h('div', { style: 'position:absolute;left:4%;top:55%;width:120px;height:120px;border-radius:50%;border:2px dashed rgba(255,255,255,.5);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;text-align:center' }, 'зона\nджойстика'),
  );
  const btns = new Map<string, HTMLDivElement>();
  const panel = h('div', { class: 'card', style: 'position:absolute;left:50%;transform:translateX(-50%);width:min(560px,94vw);padding:12px;z-index:5' });
  let collapsed = false;
  // keep the panel on the opposite half of the screen from the selected button
  const placePanel = () => {
    const low = t.buttons[selected].y > 0.5;
    panel.style.top = low ? '10px' : 'auto';
    panel.style.bottom = low ? 'auto' : '10px';
  };
  const back = h('div', { style: 'position:absolute;inset:0;z-index:70' }, stage, panel);

  const layout = () => {
    for (const [id, el] of btns) {
      const b = t.buttons[id];
      const px = 64 * b.size;
      el.style.left = `${b.x * 100}%`; el.style.top = `${b.y * 100}%`;
      el.style.width = el.style.height = `${px}px`;
      el.style.margin = `${-px / 2}px 0 0 ${-px / 2}px`;
      el.style.opacity = b.hidden ? '0.25' : String(t.opacity + 0.3);
      el.style.outline = id === selected ? '3px solid var(--accent)' : '2px dashed rgba(255,255,255,.5)';
      el.style.outlineOffset = '3px';
    }
    placePanel();
  };
  const renderPanel = () => {
    const b = t.buttons[selected];
    const sizeOut = h('span', {}, b.size.toFixed(2));
    const toggle = h('button', { class: 'btn ghost', style: 'padding:4px 10px;font-size:14px', onclick: () => { collapsed = !collapsed; renderPanel(); } }, collapsed ? '▴ Настройки' : '▾ Свернуть');
    if (collapsed) {
      panel.replaceChildren(h('div', { class: 'row' }, h('b', {}, NAMES[selected] ?? selected), h('span', { class: 'spacer' }), toggle,
        h('button', { class: 'btn', style: 'padding:4px 12px;font-size:14px', onclick: () => { save(); back.remove(); } }, 'Сохранить')));
      return;
    }
    panel.replaceChildren(
      h('div', { class: 'row', style: 'margin-bottom:8px' }, h('b', {}, `Кнопка: ${NAMES[selected] ?? selected}`), h('span', { class: 'spacer' }), toggle,
        h('label', {}, h('input', { type: 'checkbox', checked: !!b.hidden, onchange: (e: Event) => { b.hidden = (e.target as HTMLInputElement).checked; layout(); } }), ' скрыть')),
      h('div', { class: 'row' }, h('span', { style: 'width:110px' }, 'Размер'), h('input', { type: 'range', min: 0.5, max: 2, step: 0.05, value: b.size, style: 'flex:1', oninput: (e: Event) => { b.size = +(e.target as HTMLInputElement).value; sizeOut.textContent = b.size.toFixed(2); layout(); } }), sizeOut),
      h('div', { class: 'row' }, h('span', { style: 'width:110px' }, 'Прозрачность'), h('input', { type: 'range', min: 0.1, max: 0.8, step: 0.05, value: t.opacity, style: 'flex:1', oninput: (e: Event) => { t.opacity = +(e.target as HTMLInputElement).value; layout(); } })),
      h('p', { class: 'sub', style: 'margin:6px 0' }, 'Перетащите кнопки пальцем или мышью. Нажмите на кнопку, чтобы выбрать её.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { save(); back.remove(); } }, 'Сохранить'),
        h('button', { class: 'btn ghost', onclick: () => { t.buttons = JSON.parse(JSON.stringify(DEFAULT_TOUCH)); for (const id of Object.keys(LABELS)) t.buttons[id] ??= { ...DEFAULT_TOUCH[id] }; layout(); renderPanel(); } }, 'По умолчанию'),
      ),
    );
  };

  for (const id of Object.keys(LABELS)) {
    t.buttons[id] ??= { ...DEFAULT_TOUCH[id] };
    const el = h('div', { class: `tbtn${id.startsWith('fire') ? ' fire' : ''}`, style: 'position:absolute;pointer-events:auto;cursor:grab;touch-action:none' }, LABELS[id]);
    btns.set(id, el);
    stage.append(el);
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      selected = id;
      renderPanel(); layout();
      el.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const r = stage.getBoundingClientRect();
        const b = t.buttons[id];
        b.x = Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width));
        b.y = Math.min(0.98, Math.max(0.02, (ev.clientY - r.top) / r.height));
        layout();
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  layout();
  renderPanel();
  root.append(back);
}

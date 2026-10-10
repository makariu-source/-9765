// Weapon collection: 3D preview + stat bars (same numbers the simulation uses).
import * as THREE from 'three';
import { WEAPONS, fireInterval, type WeaponDef } from '../../sim/weapons';
import { weaponModel } from '../render/weaponmodels';
import { h } from './dom';

const ORDER = ['g9', 'warden', 'p250', 'deagle', 'macx', 'mk5', 'px90', 'galeon', 'famine', 'ak', 'm4', 'hawk', 'awm', 'nova', 'xmauto', 'hailstorm', 'knife', 'he', 'flash', 'smoke', 'molotov', 'decoy', 'c4', 'trainer'];
const CLS: Record<string, string> = { pistol: 'Пистолет', smg: 'Пистолет-пулемёт', rifle: 'Штурмовая винтовка', sniper: 'Снайперская винтовка', shotgun: 'Дробовик', lmg: 'Пулемёт', knife: 'Ближний бой', grenade: 'Граната', bomb: 'Бомба', training: 'Учебное' };

export class CollectionView {
  readonly root: HTMLDivElement;
  private preview: HTMLCanvasElement;
  private info: HTMLDivElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 2, 0.01, 10);
  private model: THREE.Group | null = null;
  private raf = 0;

  constructor() {
    this.preview = h('canvas', { style: 'width:100%;height:260px;border-radius:12px;background:radial-gradient(#2a3140,#10141b)' });
    this.info = h('div', {});
    const list = h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(160px,1fr))' },
      ORDER.map(id => h('div', { class: 'card click', onclick: () => this.select(id) }, h('b', {}, WEAPONS[id].name), h('p', {}, WEAPONS[id].style))));
    this.root = h('div', {}, h('h1', {}, 'Коллекция оружия'), h('p', { class: 'sub' }, 'Характеристики едины для игроков и ботов.'),
      h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { style: 'flex:1;min-width:280px' }, this.preview, this.info), h('div', { style: 'flex:1;min-width:280px' }, list)));
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#445', 2));
    const d = new THREE.DirectionalLight('#fff', 2); d.position.set(1, 2, 1); this.scene.add(d);
    this.camera.position.set(0.9, 0.25, 0.9);
    this.camera.lookAt(0, 0, 0);
    requestAnimationFrame(() => this.init());
  }

  private init(): void {
    if (!this.root.isConnected) return;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.preview, antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch { this.renderer = null; }
    this.select('ak');
    const loop = (t: number) => {
      if (!this.root.isConnected) { this.dispose(); return; }
      this.raf = requestAnimationFrame(loop);
      if (!this.renderer) return;
      const w = this.preview.clientWidth, hh = this.preview.clientHeight;
      if (this.preview.width !== w || this.preview.height !== hh) { this.renderer.setSize(w, hh, false); this.camera.aspect = w / hh; this.camera.updateProjectionMatrix(); }
      if (this.model) this.model.rotation.y = t / 1500;
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private select(id: string): void {
    const def = WEAPONS[id];
    if (this.model) this.scene.remove(this.model);
    this.model = weaponModel(id);
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3()).length() || 0.3;
    const center = box.getCenter(new THREE.Vector3());
    this.model.position.sub(center);
    const holder = new THREE.Group();
    holder.add(this.model);
    holder.scale.setScalar(0.6 / size);
    this.scene.add(holder);
    this.model = holder;
    this.info.replaceChildren(...statBlock(def));
  }

  private dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    this.renderer = null;
  }
}

function statBlock(d: WeaponDef): HTMLElement[] {
  const bar = (label: string, v: number, text: string) => h('div', { style: 'margin:6px 0' }, h('div', { class: 'row' }, h('span', {}, label), h('span', { class: 'spacer' }), h('span', { style: 'color:var(--muted)' }, text)), h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(3, Math.min(100, v * 100))}%` })));
  const out: HTMLElement[] = [h('h2', {}, d.name), h('p', { class: 'sub' }, `${CLS[d.cls]} · ${d.style}${d.team ? ` · только ${d.team === 'T' ? 'атака' : 'защита'}` : ''} · ${d.price ? `$${d.price}` : 'бесплатно'}`)];
  if (d.cls === 'grenade' || d.cls === 'bomb') {
    const txt: Record<string, string> = {
      he: 'Урон до 98 в радиусе ~9 м, уменьшается с расстоянием, блокируется стенами.', flash: 'Ослепляет всех в прямой видимости; сила зависит от угла взгляда и расстояния.',
      smoke: 'Облако на 18 с, полностью перекрывает обзор (в том числе ботам). Гасит огонь.', molotov: 'Огонь на 7 с, 32 урона/с внутри зоны. Боты обходят горящие участки.',
      decoy: 'Имитирует стрельбу вашим оружием 14 с — слышно и людям, и ботам.', c4: 'Установка 3,2 с, таймер 40 с, обезвреживание 10 с (5 с с набором).',
    };
    out.push(h('p', {}, txt[d.id] ?? ''));
    return out;
  }
  if (d.cls === 'knife') { out.push(h('p', {}, `Лёгкий удар ${d.damage}, сильный ${d.heavyDamage}; в спину — 90/180.`)); return out; }
  const pellets = d.pellets ?? 1;
  out.push(
    bar('Урон', (d.damage * pellets) / 180, `${d.damage}${pellets > 1 ? `×${pellets}` : ''} (в голову ×${d.headMult})`),
    bar('Пробитие брони', d.armorPen, `${Math.round(d.armorPen * 100)}%`),
    bar('Скорострельность', d.rpm / 900, `${d.rpm} выстр./мин`),
    bar('Точность (стоя)', 1 - d.spreadStand / 0.08, `${(d.spreadStand * 1000).toFixed(1)} мрад`),
    bar('Точность в движении', 1 - d.spreadMove / 0.25, `+${(d.spreadMove * 1000).toFixed(0)} мрад`),
    bar('Отдача', 1 - d.recoilUp / 0.045, `${(d.recoilUp * 1000).toFixed(1)} мрад/выстр.`),
    bar('Подвижность', d.speed / 6.35, `${d.speed.toFixed(2)} м/с`),
    bar('Дальность', Math.pow(d.rangeMod, 5), `×${d.rangeMod} на 10 м`),
    h('p', { class: 'sub' }, `Магазин ${d.mag} / запас ${d.reserve} · перезарядка ${d.reloadTime} с · пробитие стен ${d.penetration} · награда за убийство $${d.killReward} · интервал ${(fireInterval(d) * 1000).toFixed(0)} мс`),
  );
  return out;
}

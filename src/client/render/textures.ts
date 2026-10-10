// Procedural canvas textures (original, generated at runtime — no external assets).
import * as THREE from 'three';
import type { ThemeId } from '../../sim/maps/mapgrid';
import { Rng } from '../../sim/rng';

export interface ThemePalette {
  wall: string; wall2: string; floor: string; floor2: string; site: string; crate: string; trim: string;
  sky: [string, string]; fog: string; sun: string; ambient: string; sunIntensity: number; pattern: 'brick' | 'plaster' | 'concrete' | 'stone' | 'metal' | 'tiles';
  floorPattern: 'sand' | 'tiles' | 'cobble' | 'concrete' | 'grass' | 'planks' | 'stone';
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  desert: { wall: '#c9a670', wall2: '#b08a55', floor: '#d6bd8a', floor2: '#c4a674', site: '#a88e62', crate: '#8a6a3c', trim: '#7a5a34', sky: ['#7fb2e6', '#f0dcb4'], fog: '#e8d6b0', sun: '#fff1d0', ambient: '#9a8a70', sunIntensity: 2.6, pattern: 'plaster', floorPattern: 'sand' },
  mediterranean: { wall: '#e3d6bf', wall2: '#cdb894', floor: '#cbb593', floor2: '#b39b76', site: '#9c8566', crate: '#7c5f3b', trim: '#3f6e8c', sky: ['#5da5e8', '#f3e5c8'], fog: '#efe2c8', sun: '#fff4dc', ambient: '#8f8a80', sunIntensity: 2.5, pattern: 'plaster', floorPattern: 'tiles' },
  italian: { wall: '#d9b48f', wall2: '#c08e66', floor: '#9b8c7c', floor2: '#857565', site: '#7d6c5a', crate: '#6e4f30', trim: '#8a3f2c', sky: ['#7aa8d8', '#f4d9b8'], fog: '#e6cdb0', sun: '#ffe8c4', ambient: '#8c7c6c', sunIntensity: 2.4, pattern: 'brick', floorPattern: 'cobble' },
  industrial: { wall: '#9aa3a8', wall2: '#7e878d', floor: '#8b8f92', floor2: '#76797b', site: '#6c7a5a', crate: '#556b3a', trim: '#c8a43a', sky: ['#8fb3cf', '#dfe6ea'], fog: '#c9d2d8', sun: '#f4f6ff', ambient: '#7f878f', sunIntensity: 2.2, pattern: 'concrete', floorPattern: 'concrete' },
  jungle: { wall: '#8f8a72', wall2: '#6f6b55', floor: '#6f7a4a', floor2: '#5a6a3a', site: '#7b7458', crate: '#5e4a2e', trim: '#4f6b3a', sky: ['#7fb0c8', '#d8e8d0'], fog: '#b7c9b0', sun: '#fff6dc', ambient: '#6f7a66', sunIntensity: 2.2, pattern: 'stone', floorPattern: 'grass' },
  urban: { wall: '#a39a8f', wall2: '#8a8178', floor: '#7d7f80', floor2: '#6a6c6d', site: '#5f6a74', crate: '#4f5f3a', trim: '#b8473a', sky: ['#88aed6', '#e4e8ee'], fog: '#cfd6de', sun: '#fff8ec', ambient: '#80858c', sunIntensity: 2.3, pattern: 'brick', floorPattern: 'concrete' },
  construction: { wall: '#b6b2a8', wall2: '#9a968c', floor: '#a6a29a', floor2: '#8e8a82', site: '#7f8a96', crate: '#c08a2a', trim: '#e0b020', sky: ['#4d8fd6', '#cfe3f5'], fog: '#c4d8ec', sun: '#ffffff', ambient: '#8a929c', sunIntensity: 2.8, pattern: 'concrete', floorPattern: 'concrete' },
  rail: { wall: '#9c8f80', wall2: '#857869', floor: '#7a7368', floor2: '#665f55', site: '#6f6a60', crate: '#4a5a6a', trim: '#a8402e', sky: ['#90a8c0', '#dcd8d0'], fog: '#c8c4bc', sun: '#fff0dc', ambient: '#7c7870', sunIntensity: 2.1, pattern: 'brick', floorPattern: 'stone' },
  egypt: { wall: '#d8c08a', wall2: '#c2a46a', floor: '#cdb485', floor2: '#b89c6c', site: '#a08458', crate: '#7a5c34', trim: '#2f6f8a', sky: ['#6aa6e0', '#f4e2b8'], fog: '#ecdcb4', sun: '#fff0cc', ambient: '#9a8c70', sunIntensity: 2.7, pattern: 'stone', floorPattern: 'stone' },
  range: { wall: '#8f9aa3', wall2: '#76828c', floor: '#7f8a72', floor2: '#6f7a62', site: '#8a7d5a', crate: '#6a5232', trim: '#d6b23a', sky: ['#7fb0dc', '#e2ecf4'], fog: '#cfdbe6', sun: '#ffffff', ambient: '#86909a', sunIntensity: 2.4, pattern: 'concrete', floorPattern: 'grass' },
};

const cache = new Map<string, THREE.Texture>();

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function noise(ctx: CanvasRenderingContext2D, size: number, rng: Rng, amount: number, dots = 2400): void {
  for (let i = 0; i < dots; i++) {
    const v = rng.range(-amount, amount);
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    const s = rng.range(1, 3);
    ctx.fillRect(rng.range(0, size), rng.range(0, size), s, s);
  }
}

function finish(c: HTMLCanvasElement, key: string, repeat = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

export function wallTexture(theme: ThemeId, variant = 0): THREE.Texture {
  const key = `wall-${theme}-${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pal = THEMES[theme];
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const rng = new Rng(theme.length * 31 + variant);
  const base = variant ? pal.wall2 : pal.wall;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  switch (pal.pattern) {
    case 'brick': {
      const bh = 21, bw = 64;
      for (let y = 0; y < size; y += bh) {
        const off = (y / bh) % 2 ? bw / 2 : 0;
        for (let x = -bw; x < size; x += bw) {
          ctx.fillStyle = shade(base, rng.range(0.82, 1.08));
          ctx.fillRect(x + off + 2, y + 2, bw - 4, bh - 4);
        }
      }
      ctx.fillStyle = shade(base, 0.6);
      for (let y = 0; y < size; y += bh) ctx.fillRect(0, y, size, 2);
      break;
    }
    case 'stone': {
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = shade(base, rng.range(0.8, 1.1));
        const w = rng.range(40, 110), h = rng.range(30, 60);
        ctx.fillRect(rng.range(-20, size), rng.range(-10, size), w, h);
      }
      ctx.strokeStyle = shade(base, 0.62);
      ctx.lineWidth = 2;
      for (let y = 0; y < size; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
      for (let i = 0; i < 18; i++) { const x = rng.range(0, size), y = Math.floor(rng.range(0, 6)) * 48; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 48); ctx.stroke(); }
      break;
    }
    case 'concrete': {
      ctx.strokeStyle = shade(base, 0.75);
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
      for (let i = 0; i < 6; i++) { ctx.fillStyle = shade(base, 0.6); ctx.beginPath(); ctx.arc(rng.range(10, size - 10), rng.range(10, size - 10), 2.5, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'plaster':
    default: {
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(0,0,0,${rng.range(0.02, 0.07)})`;
        ctx.beginPath();
        ctx.ellipse(rng.range(0, size), rng.range(0, size), rng.range(10, 60), rng.range(6, 30), rng.range(0, 3), 0, Math.PI * 2);
        ctx.fill();
      }
      // exposed bricks
      for (let i = 0; i < 3; i++) {
        const x0 = rng.range(0, size - 60), y0 = rng.range(0, size - 40);
        for (let k = 0; k < 4; k++) { ctx.fillStyle = shade(pal.wall2, rng.range(0.7, 0.9)); ctx.fillRect(x0 + (k % 2) * 28, y0 + Math.floor(k / 2) * 14, 26, 12); }
      }
    }
  }
  // dirt gradient at the bottom
  const grd = ctx.createLinearGradient(0, size * 0.75, 0, size);
  grd.addColorStop(0, 'rgba(60,40,20,0)');
  grd.addColorStop(1, 'rgba(60,40,20,0.25)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  noise(ctx, size, rng, 0.06);
  return finish(c, key);
}

export function floorTexture(theme: ThemeId, kind: string): THREE.Texture {
  const key = `floor-${theme}-${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pal = THEMES[theme];
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const rng = new Rng(theme.length * 17 + kind.charCodeAt(0));
  const base = kind === 'S' ? pal.site : kind === 'P' ? shade(pal.floor, 0.95) : kind === '~' ? '#3f6f86' : kind === 'k' ? shade(pal.floor2, 0.85) : pal.floor;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const pattern = kind === '~' ? 'water' : kind === 'k' ? 'sand' : pal.floorPattern;
  switch (pattern) {
    case 'tiles': {
      const t = 64;
      for (let y = 0; y < size; y += t) for (let x = 0; x < size; x += t) { ctx.fillStyle = shade(base, rng.range(0.88, 1.06)); ctx.fillRect(x + 2, y + 2, t - 4, t - 4); }
      break;
    }
    case 'cobble': {
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = shade(base, rng.range(0.75, 1.1));
        ctx.beginPath();
        ctx.ellipse(rng.range(0, size), rng.range(0, size), rng.range(8, 14), rng.range(6, 11), rng.range(0, 3), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'stone': {
      const t = 85;
      for (let y = 0; y < size; y += t) for (let x = 0; x < size; x += t) { ctx.fillStyle = shade(base, rng.range(0.85, 1.08)); ctx.fillRect(x + 3, y + 3, t - 6, t - 6); }
      break;
    }
    case 'grass': {
      for (let i = 0; i < 4000; i++) { ctx.fillStyle = shade(base, rng.range(0.7, 1.25)); ctx.fillRect(rng.range(0, size), rng.range(0, size), 1, rng.range(2, 5)); }
      break;
    }
    case 'planks': {
      for (let y = 0; y < size; y += 32) { ctx.fillStyle = shade(base, rng.range(0.85, 1.05)); ctx.fillRect(0, y + 1, size, 30); }
      break;
    }
    case 'water': {
      for (let i = 0; i < 60; i++) { ctx.strokeStyle = `rgba(255,255,255,${rng.range(0.05, 0.15)})`; ctx.beginPath(); const y = rng.range(0, size); ctx.moveTo(rng.range(0, size), y); ctx.quadraticCurveTo(rng.range(0, size), y + 6, rng.range(0, size), y); ctx.stroke(); }
      break;
    }
    case 'concrete': {
      ctx.strokeStyle = shade(base, 0.8);
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      for (let i = 0; i < 8; i++) { ctx.fillStyle = `rgba(0,0,0,${rng.range(0.03, 0.08)})`; ctx.beginPath(); ctx.arc(rng.range(0, size), rng.range(0, size), rng.range(10, 40), 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'sand':
    default: {
      for (let i = 0; i < 30; i++) { ctx.fillStyle = `rgba(0,0,0,${rng.range(0.02, 0.06)})`; ctx.beginPath(); ctx.ellipse(rng.range(0, size), rng.range(0, size), rng.range(20, 70), rng.range(10, 30), rng.range(0, 3), 0, Math.PI * 2); ctx.fill(); }
    }
  }
  if (kind === 'S') {
    // painted site letters border lines
    ctx.strokeStyle = 'rgba(255,240,200,0.18)';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, size - 16, size - 16);
  }
  noise(ctx, size, rng, 0.07, 3000);
  return finish(c, key);
}

export function crateTexture(kind: 'wood' | 'metal' | 'train' | 'barrel', theme: ThemeId): THREE.Texture {
  const key = `crate-${kind}-${theme}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pal = THEMES[theme];
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const rng = new Rng(kind.length * 13 + theme.length);
  if (kind === 'wood') {
    const base = pal.crate;
    ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 32) { ctx.fillStyle = shade(base, rng.range(0.85, 1.1)); ctx.fillRect(0, y + 1, size, 30); }
    ctx.strokeStyle = shade(base, 0.55); ctx.lineWidth = 14; ctx.strokeRect(7, 7, size - 14, size - 14);
    ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(size - 10, size - 10); ctx.stroke();
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(40,20,0,${rng.range(0.03, 0.1)})`; ctx.fillRect(rng.range(0, size), rng.range(0, size), rng.range(6, 30), 1); }
  } else if (kind === 'train' || kind === 'metal') {
    const base = kind === 'train' ? '#5a6b78' : '#6a7280';
    ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 16) { ctx.fillStyle = shade(base, x % 32 ? 1.08 : 0.88); ctx.fillRect(x, 0, 8, size); }
    ctx.fillStyle = 'rgba(120,60,20,0.25)';
    for (let i = 0; i < 30; i++) ctx.fillRect(rng.range(0, size), rng.range(0, size), rng.range(4, 20), rng.range(4, 40));
    ctx.fillStyle = '#e8e2d0'; ctx.font = 'bold 28px sans-serif'; ctx.fillText(kind === 'train' ? 'SZ-RAIL 4417' : 'CARGO', 20, 60);
  } else {
    const base = '#7a3a2a';
    ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
    for (const y of [40, 128, 216]) { ctx.fillStyle = shade(base, 0.6); ctx.fillRect(0, y, size, 12); }
    ctx.fillStyle = '#e0c040'; ctx.fillRect(80, 70, 96, 40);
  }
  noise(ctx, size, rng, 0.06);
  return finish(c, key);
}

export function skyTexture(theme: ThemeId): THREE.Texture {
  const key = `sky-${theme}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pal = THEMES[theme];
  const [c, ctx] = makeCanvas(512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, pal.sky[0]);
  g.addColorStop(0.55, pal.sky[1]);
  g.addColorStop(1, pal.fog);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const rng = new Rng(theme.length);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.08, 0.25)})`;
    ctx.beginPath();
    ctx.ellipse(rng.range(0, 512), rng.range(40, 230), rng.range(30, 90), rng.range(8, 20), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // skyline silhouettes for urban/construction maps
  if (theme === 'construction' || theme === 'urban') {
    for (let x = 0; x < 512; x += rng.range(12, 30)) {
      const h = rng.range(20, theme === 'construction' ? 140 : 70);
      ctx.fillStyle = `rgba(80,100,130,${rng.range(0.25, 0.45)})`;
      ctx.fillRect(x, 330 - h, rng.range(10, 28), h + 40);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  cache.set(key, t);
  return t;
}

/** Soft radial sprite used by smoke, fire, flashes and muzzle flashes. */
export function softSprite(color = '#ffffff', key = 'soft'): THREE.Texture {
  const k = `sprite-${key}-${color}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const col = new THREE.Color(color);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.4, `rgba(${rgb},0.6)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, k, false);
}

export function smokePuff(): THREE.Texture {
  const k = 'smokepuff';
  const hit = cache.get(k);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(128);
  const rng = new Rng(77);
  for (let i = 0; i < 18; i++) {
    const x = 64 + rng.range(-24, 24), y = 64 + rng.range(-24, 24), r = rng.range(18, 40);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(235,235,235,0.35)');
    g.addColorStop(1, 'rgba(235,235,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return finish(c, k, false);
}

export function decalTexture(): THREE.Texture {
  const k = 'decal';
  const hit = cache.get(k);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(10,8,6,1)');
  g.addColorStop(0.3, 'rgba(30,25,20,0.9)');
  g.addColorStop(0.6, 'rgba(60,50,40,0.4)');
  g.addColorStop(1, 'rgba(60,50,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return finish(c, k, false);
}

export function siteLetterTexture(letter: string): THREE.Texture {
  const k = `site-${letter}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(220,40,30,0.85)';
  ctx.font = 'bold 200px Impact, Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  return finish(c, k, false);
}

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

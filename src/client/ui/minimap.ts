// 2D radar: map drawn once from the grid, then dynamic markers each frame.
import { CELL, type CompiledMap } from '../../sim/maps/mapgrid';
import { THEMES } from '../render/textures';

export function drawMapImage(m: CompiledMap, scale = 6): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = m.w * scale; c.height = m.h * scale;
  const ctx = c.getContext('2d')!;
  const pal = THEMES[m.def.theme];
  ctx.fillStyle = '#0d1016';
  ctx.fillRect(0, 0, c.width, c.height);
  let maxH = 0.01;
  for (const r of m.floorH) for (const v of r) maxH = Math.max(maxH, v);
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const t = m.types[j][i];
    let col: string | null = null;
    const elev = m.floorH[j][i] / maxH;
    const shade = (hex: string, k: number) => {
      const n = parseInt(hex.slice(1), 16);
      const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    };
    switch (t) {
      case '#': case ' ': col = null; break;
      case 'A': case 'B': col = shade('#7a4a3a', 0.9 + elev * 0.3); break;
      case 't': col = shade('#6a5530', 1); break;
      case 'c': col = shade('#2f4766', 1); break;
      case 'D': col = shade(pal.floor2, 0.45 + elev * 0.2); break;
      case '~': col = '#2c5a72'; break;
      case 'x': case 'X': case 'H': case 'r': col = '#3a3326'; break;
      case 'o': case 'w': case 'g': case 'p': col = '#2a2a2a'; break;
      default: col = shade(pal.floor, 0.42 + elev * 0.35);
    }
    if (col) { ctx.fillStyle = col; ctx.fillRect(i * scale, j * scale, scale, scale); }
  }
  // outlines of walls
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    if (m.types[j][i] !== '#') continue;
    const open = (a: number, b: number) => a >= 0 && b >= 0 && a < m.w && b < m.h && m.types[b][a] !== '#';
    if (open(i + 1, j)) { ctx.beginPath(); ctx.moveTo((i + 1) * scale, j * scale); ctx.lineTo((i + 1) * scale, (j + 1) * scale); ctx.stroke(); }
    if (open(i - 1, j)) { ctx.beginPath(); ctx.moveTo(i * scale, j * scale); ctx.lineTo(i * scale, (j + 1) * scale); ctx.stroke(); }
    if (open(i, j + 1)) { ctx.beginPath(); ctx.moveTo(i * scale, (j + 1) * scale); ctx.lineTo((i + 1) * scale, (j + 1) * scale); ctx.stroke(); }
    if (open(i, j - 1)) { ctx.beginPath(); ctx.moveTo(i * scale, j * scale); ctx.lineTo((i + 1) * scale, j * scale); ctx.stroke(); }
  }
  // site letters
  ctx.fillStyle = 'rgba(255,90,70,0.95)';
  ctx.font = `bold ${scale * 4}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of m.sites) ctx.fillText(s.id, (s.center.x / CELL) * scale, (s.center.z / CELL) * scale);
  return c;
}

export interface RadarMarker { x: number; z: number; yaw?: number; color: string; self?: boolean; dead?: boolean; label?: string; kind?: 'player' | 'bomb' | 'smoke' | 'fire' | 'sound' }

export class Minimap {
  private base: HTMLCanvasElement;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  constructor(m: CompiledMap, size = 200) {
    this.base = drawMapImage(m, 6);
    this.canvas = document.createElement('canvas');
    this.canvas.width = size * 2; this.canvas.height = size * 2;
    this.canvas.className = 'minimap';
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(markers: RadarMarker[]): void {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const s = Math.min(W / this.base.width, H / this.base.height);
    const ox = (W - this.base.width * s) / 2, oy = (H - this.base.height * s) / 2;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.base, ox, oy, this.base.width * s, this.base.height * s);
    ctx.globalAlpha = 1;
    const px = (x: number) => ox + (x / CELL) * 6 * s;
    const pz = (z: number) => oy + (z / CELL) * 6 * s;
    for (const mk of markers) {
      const x = px(mk.x), y = pz(mk.z);
      if (mk.kind === 'smoke') { ctx.fillStyle = 'rgba(220,220,220,0.55)'; ctx.beginPath(); ctx.arc(x, y, 3.6 / CELL * 6 * s, 0, Math.PI * 2); ctx.fill(); continue; }
      if (mk.kind === 'fire') { ctx.fillStyle = 'rgba(255,120,30,0.6)'; ctx.beginPath(); ctx.arc(x, y, 3 / CELL * 6 * s, 0, Math.PI * 2); ctx.fill(); continue; }
      if (mk.kind === 'bomb') { ctx.fillStyle = mk.color; ctx.fillRect(x - 6, y - 4, 12, 8); ctx.strokeStyle = '#000'; ctx.strokeRect(x - 6, y - 4, 12, 8); continue; }
      if (mk.kind === 'sound') { ctx.strokeStyle = mk.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke(); continue; }
      if (mk.dead) { ctx.strokeStyle = mk.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); continue; }
      ctx.fillStyle = mk.color;
      ctx.beginPath(); ctx.arc(x, y, mk.self ? 7 : 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = mk.self ? '#fff' : 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2; ctx.stroke();
      if (mk.yaw !== undefined) {
        const dx = -Math.sin(mk.yaw), dz = -Math.cos(mk.yaw);
        ctx.strokeStyle = mk.self ? '#fff' : mk.color;
        ctx.beginPath(); ctx.moveTo(x + dx * 7, y + dz * 7); ctx.lineTo(x + dx * 15, y + dz * 15); ctx.stroke();
      }
    }
  }
}

// Buy menu and scoreboard overlays.
import type { Actor } from '../../sim/actor';
import { buy, checkBuy, itemPrice, type BuyItem } from '../../sim/buy';
import type { Game } from '../../sim/game';
import type { DeathmatchMode } from '../../sim/modes/respawn';
import { DIFFICULTY_NAMES } from '../../ai/difficulty';
import { HEAVY, PISTOLS, RIFLES, SMGS, SNIPERS, WEAPONS } from '../../sim/weapons';
import { h } from './dom';
import { escapeHtml } from './hud';

const NADE_LABEL: Record<string, string> = { he: 'Осколочная', flash: 'Светошумовая', smoke: 'Дымовая', molotov: 'Зажигательная', decoy: 'Приманка' };

export class BuyMenu {
  readonly root: HTMLDivElement;
  open = false;
  constructor(private g: Game, private me: () => Actor, private onBuy: (item: string, ok: boolean, reason?: string) => void) {
    this.root = h('div', { class: 'buy hidden' });
    this.root.addEventListener('mousedown', e => e.stopPropagation());
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.classList.toggle('hidden', !this.open);
    if (this.open) this.render();
  }

  render(): void {
    const a = this.me();
    const g = this.g;
    const free = !!g.mode.freeBuy;
    const item = (id: BuyItem, label: string) => {
      const c = checkBuy(g, a, id);
      const owned = (a.primary?.def.id === id) || (a.secondary?.def.id === id) || (id === 'kit' && a.kit) || (id === 'armorhelmet' && a.helmet && a.armor >= 100) || (id === 'armor' && a.armor >= 100);
      const price = free ? 'бесплатно' : `$${itemPrice(a, id)}`;
      return h('button', {
        class: `item${owned ? ' owned' : ''}`, disabled: !c.ok, title: c.reason ?? '',
        onclick: () => {
          const r = buy(g, a, id);
          if (r.ok && free && g.mode.id === 'deathmatch') {
            const def = WEAPONS[id];
            const dm = g.mode as DeathmatchMode;
            const cur = dm.choice.get(a.id) ?? { primary: 'ak', secondary: 'g9' };
            if (def?.slot === 'primary') cur.primary = id;
            if (def?.slot === 'secondary') cur.secondary = id;
            dm.setLoadout(a, cur.primary, cur.secondary);
          }
          this.onBuy(String(id), r.ok, r.reason);
          this.render();
        },
      }, h('span', {}, label), h('span', { class: 'price' }, price));
    };
    const weapons = (ids: string[]) => ids.filter(id => free || !WEAPONS[id].team || WEAPONS[id].team === a.team).map(id => item(id, WEAPONS[id].name));
    const cats: [string, HTMLElement[]][] = [
      ['Пистолеты', weapons(PISTOLS)],
      ['Пистолеты-пулемёты', weapons(SMGS)],
      ['Винтовки', weapons([...RIFLES, ...SNIPERS])],
      ['Тяжёлое', weapons(HEAVY)],
      ['Снаряжение', [item('armor', 'Бронежилет'), item('armorhelmet', a.armor >= 100 && !a.helmet ? 'Шлем' : 'Бронежилет + шлем'), ...(a.team === 'CT' && g.mode.allowBomb ? [item('kit', 'Набор сапёра')] : [])]],
      ['Гранаты', ['flash', 'smoke', 'he', 'molotov', 'decoy'].map(n => item(n, n === 'molotov' && a.team === 'CT' ? 'Зажигательная граната' : NADE_LABEL[n]))],
    ];
    const t = Math.max(0, (g.mode as unknown as { liveStart?: number; cfg?: { buyTime?: number } }).cfg?.buyTime ?? 0);
    this.root.replaceChildren(
      h('div', { class: 'row' },
        h('h2', { style: 'margin:0' }, 'Магазин'),
        h('div', { class: 'spacer' }),
        h('div', { style: 'font-size:24px;color:#9ef09e;font-weight:800' }, free ? 'Свободная покупка' : `$${a.money}`),
        h('button', { class: 'btn ghost', onclick: () => this.toggle(false) }, 'Закрыть (B)'),
      ),
      h('p', { class: 'sub' }, free ? 'Выбранное оружие выдаётся сразу и при каждом возрождении.' : `Покупка доступна в зоне базы в начале раунда${t ? ` (${t} с)` : ''}.`),
      h('div', { class: 'cats' }, cats.map(([name, items]) => h('div', { class: 'cat' }, h('h4', {}, name), items))),
    );
  }
}

export class Scoreboard {
  readonly root: HTMLDivElement;
  visible = false;
  constructor(private g: Game) {
    this.root = h('div', { class: 'sb hidden' });
  }
  show(on: boolean): void {
    if (on === this.visible) { if (on) this.render(); return; }
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    if (on) this.render();
  }
  render(): void {
    const g = this.g;
    const human = g.human();
    const rounds = Math.max(1, (g.mode as unknown as { rounds?: unknown[] }).rounds?.length ?? 1);
    const table = (actors: Actor[], showMoney: boolean) => h('table', { class: 'tbl' },
      h('tr', {}, ['Игрок', 'Сложность', 'У', 'С', 'П', g.mode.allowBomb ? 'ADR' : 'Очки', 'HS%', 'MVP', showMoney ? '$' : ''].map(t => h('th', {}, t))),
      actors.map(a => h('tr', { class: `${a.id === human?.id ? 'me' : ''} ${a.alive ? '' : 'dead'}` },
        h('td', { html: `${escapeHtml(a.name)}${a.isBot ? '<span class="badge-bot">ИИ</span>' : ''}` }),
        h('td', {}, a.isBot ? DIFFICULTY_NAMES[Math.round(a.botLevel) - 1] ?? '' : '—'),
        h('td', {}, a.stats.kills), h('td', {}, a.stats.deaths), h('td', {}, a.stats.assists),
        h('td', {}, g.mode.allowBomb ? Math.round(a.stats.damage / rounds) : (g.mode.id === 'armsrace' ? `ур. ${a.armsLevel + 1}` : a.dmScore)),
        h('td', {}, a.stats.kills ? `${Math.round((a.stats.headshots / a.stats.kills) * 100)}%` : '0%'),
        h('td', {}, a.stats.mvps ? `★${a.stats.mvps}` : ''),
        h('td', {}, showMoney ? `$${a.money}` : ''),
      )),
    );
    const hud = g.mode.hud();
    if (g.mode.ffa) {
      const all = g.actors.slice().sort((x, y) => (g.mode.id === 'armsrace' ? y.armsLevel - x.armsLevel : y.dmScore - x.dmScore) || y.stats.kills - x.stats.kills);
      this.root.replaceChildren(h('h3', {}, h('span', {}, hud.label), h('span', { class: 'sub' }, 'Все соперники — боты (ИИ)')), table(all, false));
      return;
    }
    const usTeam = human?.team ?? 'CT';
    const us = g.actors.filter(a => a.team === usTeam).sort((x, y) => y.stats.kills - x.stats.kills);
    const them = g.actors.filter(a => a.team !== usTeam).sort((x, y) => y.stats.kills - x.stats.kills);
    const tname = (t: string) => (t === 'CT' ? 'Защита (CT)' : 'Атака (T)');
    this.root.replaceChildren(
      h('h3', {}, h('span', { class: usTeam.toLowerCase() }, `${tname(usTeam)} — ${hud.scoreUs}`), h('span', { class: 'sub' }, `${hud.label} · ${g.map.def.name} · матч против ИИ`)),
      table(us, g.mode.allowBomb),
      h('h3', {}, h('span', { class: usTeam === 'CT' ? 't' : 'ct' }, `${tname(usTeam === 'CT' ? 'T' : 'CT')} — ${hud.scoreThem}`)),
      table(them, false),
    );
  }
}

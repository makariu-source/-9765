// Team-level strategy for bots: economy, site choice, routes, executes with utility,
// defensive setups, rotations, retakes and post-plant. Uses only team knowledge
// (what teammates saw/heard), never hidden enemy positions.
import type { Actor } from '../sim/actor';
import type { Game } from '../sim/game';
import { siteAt, type SiteId } from '../sim/maps/mapgrid';
import { vdist, vdist2d, type Vec3 } from '../sim/math';
import type { BombMode } from '../sim/modes/bomb';
import type { LobbyPlayer } from '../sim/modes/lobby';
import type { HoldSpot, Route } from '../sim/nav';
import { Rng } from '../sim/rng';
import type { GameEvent } from '../sim/types';
import type { Team } from '../sim/weapons';
import { BotController, type Goal, type UtilityTask } from './bot';

export type Role = 'entry' | 'support' | 'lurk' | 'awp' | 'anchor' | 'rotator';
export type PlanKind = 'rush' | 'execute' | 'split' | 'default' | 'chaos';

interface RoundHistory { side: Team; site: string | null; won: boolean; contact: string | null }

interface Sighting { id: number; pos: Vec3; time: number }

export class TeamBrain {
  team: Team = 'T';
  members: BotController[] = [];
  sightings: Sighting[] = [];
  bombSiteKnown: string | null = null;
  economy: 'full' | 'force' | 'eco' = 'full';
  pistolRound = false;
  history: RoundHistory[] = [];
  // current plan
  planKind: PlanKind = 'execute';
  site: SiteId = 'A';
  executeAt = 0;
  executing = false;
  roles = new Map<number, Role>();
  routes = new Map<number, Route>();
  stages = new Map<number, Vec3>();
  holds = new Map<number, HoldSpot>();
  goAt = new Map<number, number>();
  alertSite: string | null = null;
  alertAt = 0;
  private postSpots = new Map<number, { pos: Vec3; look: Vec3 }>();
  private threatCache = new Map<number, { t: number; p: Vec3 | null }>();
  private lastAlertCheck = 0;
  private utilityTasks: { bot: BotController; task: UtilityTask }[] = [];
  private switchedSite = false;
  rng: Rng;

  constructor(readonly squad: number, seed: number) { this.rng = new Rng(seed); }

  get coordination(): number {
    if (!this.members.length) return 0;
    return this.members.reduce((s, b) => s + b.profile.coordination, 0) / this.members.length;
  }
  get adaptation(): number {
    if (!this.members.length) return 0;
    return this.members.reduce((s, b) => s + b.profile.adaptation, 0) / this.members.length;
  }
  get utilitySkill(): number {
    if (!this.members.length) return 0;
    return this.members.reduce((s, b) => s + b.profile.utility, 0) / this.members.length;
  }

  roleOf(id: number): Role | undefined { return this.roles.get(id); }

  // ---------------------------------------------------------------------------

  startRound(g: Game): void {
    const alive = this.members.filter(b => b.actor.alive);
    if (!alive.length) return;
    this.team = alive[0].actor.team;
    this.sightings = [];
    this.bombSiteKnown = null;
    this.executing = false;
    this.alertSite = null;
    this.roles.clear(); this.routes.clear(); this.stages.clear(); this.holds.clear(); this.goAt.clear();
    this.postSpots.clear();
    this.retakeStages.clear();
    this.utilityTasks = [];
    this.switchedSite = false;
    const m = g.mode as BombMode;
    this.pistolRound = m.round === 1 || m.round === m.regulationHalf + 1;
    this.decideEconomy(g);
    if (this.team === 'T') this.planAttack(g);
    else this.planDefense(g);
  }

  private decideEconomy(g: Game): void {
    const mem = this.members.map(b => b.actor);
    const avg = mem.reduce((s, a) => s + a.money, 0) / Math.max(1, mem.length);
    const m = g.mode as BombMode;
    const need = this.team === 'T' ? 3700 : 4000;
    const streak = m.lossStreak?.[this.squad] ?? 0;
    const lastOfHalf = m.round === m.regulationHalf || m.round === m.cfg?.maxRounds;
    if (this.coordination < 0.35) { this.economy = 'full'; return; } // novices buy whatever they can
    if (avg >= need) this.economy = 'full';
    else if (lastOfHalf || (avg >= 2200 && streak >= 2) || (avg >= 2600 && this.rng.chance(0.35))) this.economy = 'force';
    else this.economy = 'eco';
  }

  private siteWeights(g: Game): Record<string, number> {
    const sites = (g.mode.allowedSites ?? g.map.sites.map(s => s.id)) as string[];
    const w: Record<string, number> = {};
    for (const s of sites) w[s] = 1;
    const ad = this.adaptation;
    for (const h of this.history.slice(-6)) {
      if (h.side !== 'T' || !h.site || !(h.site in w)) continue;
      w[h.site] *= h.won ? 1 + 0.25 * ad : 1 - 0.35 * ad;
    }
    // if defenders kept meeting us in force at a site, prefer the other one
    for (const h of this.history.slice(-4)) {
      if (h.side === 'T' && h.contact && h.contact in w && !h.won) w[h.contact] *= 1 - 0.2 * ad;
    }
    return w;
  }

  private pickWeighted(w: Record<string, number>): string {
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    let r = this.rng.next() * tot;
    for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; }
    return Object.keys(w)[0];
  }

  private planAttack(g: Game): void {
    const coord = this.coordination;
    const m = g.mode as BombMode;
    const freezeEnd = g.time + (m.cfg?.freezeTime ?? 0);
    this.site = this.pickWeighted(this.siteWeights(g)) as SiteId;
    const r = this.rng.next();
    if (coord < 0.3) this.planKind = 'chaos';
    else if (coord < 0.55) this.planKind = r < 0.5 ? 'rush' : 'execute';
    else this.planKind = r < 0.2 ? 'rush' : r < 0.45 ? 'split' : r < 0.75 ? 'execute' : 'default';
    if (this.economy === 'eco' && coord > 0.5) this.planKind = r < 0.5 ? 'rush' : 'execute'; // eco stack
    const roundTime = m.cfg?.roundTime ?? 115;
    this.executeAt = freezeEnd + (this.planKind === 'rush' ? 0 : this.planKind === 'default' ? roundTime * this.rng.range(0.35, 0.5) : roundTime * this.rng.range(0.15, 0.3));
    this.assignAttack(g);
  }

  private assignAttack(g: Game): void {
    const routes = g.analysis.routes.filter(rt => rt.site === this.site);
    const otherRoutes = g.analysis.routes.filter(rt => rt.site !== this.site);
    const bots = this.members.filter(b => b.actor.alive).sort((a, b) => b.style.aggression - a.style.aggression);
    const coord = this.coordination;
    bots.forEach((b, i) => {
      let role: Role = i === 0 ? 'entry' : 'support';
      if (b.style.awper && this.economy === 'full' && ![...this.roles.values()].includes('awp')) role = 'awp';
      if (i === bots.length - 1 && bots.length >= 4 && coord >= 0.6 && b.style.patience > 0.5) role = 'lurk';
      this.roles.set(b.actor.id, role);
      let route: Route | undefined;
      switch (this.planKind) {
        case 'chaos': {
          const all = g.analysis.routes.filter(rt => !g.mode.allowedSites || g.mode.allowedSites.includes(rt.site));
          route = this.rng.pick(all.length ? all : routes);
          break;
        }
        case 'split': route = routes[i % Math.max(1, routes.length)]; break;
        case 'default': route = role === 'lurk' && otherRoutes.length ? this.rng.pick(otherRoutes) : this.rng.pick(g.analysis.routes); break;
        default: route = role === 'lurk' && otherRoutes.length ? this.rng.pick(otherRoutes) : routes[0];
      }
      if (!route) route = g.analysis.routes[0];
      if (!route) return; // map without bomb routes (e.g. training range)
      this.routes.set(b.actor.id, route);
      // wait out of sight of the site; 'default' spreads out further back
      const stageIdx = route.cells.findIndex(c => c.i === route.stage.i && c.j === route.stage.j);
      const idx = Math.max(0, (stageIdx >= 0 ? stageIdx : route.cells.length - 8) - (this.planKind === 'default' ? 3 : 0));
      const c = route.cells[idx];
      // spread out around the staging cell
      this.stages.set(b.actor.id, g.nav.center(c.i, c.j));
    });
    this.planUtility(g);
  }

  private planUtility(g: Game): void {
    if (this.pistolRound || this.planKind === 'chaos') return;
    const skill = this.utilitySkill;
    if (skill < 0.25) return;
    const site = g.map.sites.find(s => s.id === this.site);
    if (!site) return;
    const holds = g.analysis.holds.filter(h => h.site === this.site);
    const bots = this.members.filter(b => b.actor.alive);
    const used = new Set<number>();
    const assign = (gtype: 'smoke' | 'flash' | 'molotov', target: Vec3, delay: number, reason: string) => {
      const b = bots.find(x => !used.has(x.actor.id) && this.routes.get(x.actor.id)?.site === this.site);
      if (!b) return;
      used.add(b.actor.id);
      const from = this.stages.get(b.actor.id)!;
      this.utilityTasks.push({ bot: b, task: { grenade: gtype, target, from, plan: null, at: 0, done: false, reason } });
      void delay;
    };
    const route = this.routes.get(bots[0]?.actor.id ?? -1);
    const entry = route ? g.nav.center(route.entry.i, route.entry.j) : site.center;
    if (holds[0]) {
      const hp = g.nav.center(holds[0].cell.i, holds[0].cell.j);
      // smoke between the strongest defender spot and our entry
      assign('smoke', { x: entry.x + (hp.x - entry.x) * 0.55, y: hp.y, z: entry.z + (hp.z - entry.z) * 0.55 }, 0, 'smoke cross');
      if (skill > 0.5) assign('molotov', hp, 0.5, 'molly default');
    }
    assign('flash', { ...site.center }, 1.2, 'entry flash');
    if (skill > 0.7) assign('flash', { ...site.center }, 1.6, 'second flash');
  }

  private planDefense(g: Game): void {
    const sites = (g.mode.allowedSites ?? g.map.sites.map(s => s.id)) as string[];
    const bots = this.members.filter(b => b.actor.alive);
    const n = bots.length;
    if (!n) return;
    // adaptation: stack the site attackers prefer
    const counts: Record<string, number> = {};
    for (const s of sites) counts[s] = 1;
    for (const h of this.history) if (h.side === 'CT' && h.contact && h.contact in counts) counts[h.contact]++;
    const tot = Object.values(counts).reduce((a, b) => a + b, 0);
    const ad = this.adaptation;
    const alloc: string[] = [];
    if (sites.length === 1) for (let i = 0; i < n; i++) alloc.push(sites[0]);
    else {
      const pA = counts.A / tot;
      const shareA = 0.5 + (pA - 0.5) * ad;
      const rotator = n >= 5 && this.coordination > 0.4;
      const m = rotator ? n - 1 : n;
      let nA = Math.round(m * shareA);
      nA = Math.max(n >= 2 ? 1 : 0, Math.min(m - (n >= 2 ? 1 : 0), nA));
      for (let i = 0; i < nA; i++) alloc.push('A');
      for (let i = nA; i < m; i++) alloc.push('B');
      if (rotator) alloc.push('mid');
    }
    const usedHolds = new Set<HoldSpot>();
    bots.forEach((b, i) => {
      const s = alloc[i] ?? sites[0];
      if (s === 'mid') {
        this.roles.set(b.actor.id, 'rotator');
        const spot = this.midSpot(g);
        if (spot) this.holds.set(b.actor.id, spot);
        return;
      }
      this.roles.set(b.actor.id, b.style.awper && this.economy === 'full' ? 'awp' : 'anchor');
      const options = g.analysis.holds.filter(h => h.site === s && !usedHolds.has(h));
      const spot = options.length ? (this.rng.chance(0.4) ? options[0] : this.rng.pick(options)) : g.analysis.holds.find(h => h.site === s);
      if (spot) { usedHolds.add(spot); this.holds.set(b.actor.id, spot); }
    });
  }

  private midSpot(g: Game): HoldSpot | null {
    const a = g.map.sites.find(s => s.id === 'A'), b = g.map.sites.find(s => s.id === 'B');
    if (!a || !b) return null;
    const path = g.nav.findPath(a.center, b.center);
    if (!path) return null;
    const c = path[Math.floor(path.length / 2)];
    const p = g.nav.center(c.i, c.j);
    const t = g.map.tSpawns[0];
    return { cell: c, look: { x: t.x, y: p.y + 1.6, z: t.z }, site: 'mid', score: 0 };
  }

  // ---------------------------------------------------------------------------

  report(g: Game, id: number, pos: Vec3): void {
    const delay = 0.9 - this.coordination * 0.6;
    const last = this.sightings[this.sightings.length - 1];
    if (last && last.id === id && g.time - (last.time - delay) < 0.4) return;
    this.sightings.push({ id, pos: { ...pos }, time: g.time + delay });
    if (this.sightings.length > 60) this.sightings.shift();
  }

  private recent(g: Game, maxAge: number): Sighting[] {
    return this.sightings.filter(s => s.time <= g.time && g.time - s.time < maxAge);
  }

  update(g: Game): void {
    if (!g.mode.allowBomb) return;
    const now = g.time;
    // T: execute when staged or on timer
    if (this.team === 'T' && !this.executing && g.mode.canMove(this.members[0]?.actor ?? ({} as Actor))) {
      const bots = this.members.filter(b => b.actor.alive);
      const staged = bots.filter(b => {
        const s = this.stages.get(b.actor.id);
        return s && vdist2d(b.actor.pos, s) < 3;
      }).length;
      const m = g.mode as BombMode;
      const timeLeft = m.phaseEnd - now;
      const allStaged = staged >= Math.max(1, bots.length - 1);
      if (now >= this.executeAt || (allStaged && this.planKind !== 'default' && now > this.executeAt - 15) || timeLeft < 35) this.startExecute(g);
      // mid-round call: switch site if we saw a stack at the planned site
      if (this.planKind === 'default' && !this.switchedSite && this.adaptation > 0.5) {
        const near = this.recent(g, 8).filter(s => {
          const site = g.map.sites.find(x => x.id === this.site);
          return site && vdist2d(s.pos, site.center) < 16;
        });
        const ids = new Set(near.map(s => s.id));
        const others = (g.mode.allowedSites ?? g.map.sites.map(s => s.id)).filter(s => s !== this.site);
        if (ids.size >= 2 && others.length) {
          this.site = others[0] as SiteId;
          this.switchedSite = true;
          this.assignAttack(g);
          this.executeAt = Math.min(this.executeAt, now + 6);
          this.members[0] && this.members[0].radio(g, this.members[0].actor, `Их много там — идём на ${this.site}!`);
        }
      }
    }
    // CT: detect attacked site & bomb location
    if (this.team === 'CT' && now - this.lastAlertCheck > 0.5) {
      this.lastAlertCheck = now;
      const rs = this.recent(g, 5);
      for (const site of g.map.sites) {
        const ids = new Set(rs.filter(s => vdist2d(s.pos, site.center) < 18).map(s => s.id));
        if (ids.size >= 2 && this.alertSite !== site.id) {
          this.alertSite = site.id;
          this.alertAt = now + (1 - this.coordination) * 6;
          const anyBot = this.members.find(b => b.actor.alive);
          anyBot?.radio(g, anyBot.actor, `Они на ${site.id}! Нужна помощь!`);
        }
      }
      if (g.bomb.state === 'planted' && !this.bombSiteKnown) {
        for (const b of this.members) {
          const a = b.actor;
          if (!a.alive) continue;
          const d = vdist(a.pos, g.bomb.pos);
          const bp = { x: g.bomb.pos.x, y: g.bomb.pos.y + 0.3, z: g.bomb.pos.z };
          if (d < 22 || (d < 45 && g.world.lineClear(a.eye(), bp))) { this.bombSiteKnown = g.bomb.site; break; }
        }
        // heard the plant
        if (!this.bombSiteKnown) {
          for (const s of g.sounds) {
            if (s.kind !== 'plant') continue;
            if (this.members.some(b => b.actor.alive && vdist(b.actor.pos, s.pos) < s.radius)) { this.bombSiteKnown = siteAt(g.map, s.pos.x, s.pos.z); break; }
          }
        }
        // deduce from callouts after a few seconds
        if (!this.bombSiteKnown && now - g.bomb.plantedAt > 4 - this.coordination * 2) {
          const rs2 = this.recent(g, 12);
          let best: string | null = null, bc = 0;
          for (const site of g.map.sites) {
            const c = rs2.filter(s => vdist2d(s.pos, site.center) < 20).length;
            if (c > bc) { bc = c; best = site.id; }
          }
          this.bombSiteKnown = best ?? this.alertSite ?? (now - g.bomb.plantedAt > 9 ? this.rng.pick(g.map.sites).id : null);
        }
        if (this.bombSiteKnown && this.bombSiteKnown !== g.bomb.site) {
          // wrong guess: will be corrected when someone actually sees/hears it
          if (this.members.some(b => b.actor.alive && vdist2d(b.actor.pos, g.map.sites.find(s => s.id === this.bombSiteKnown)!.center) < 8)) this.bombSiteKnown = null;
        }
      }
    }
  }

  private startExecute(g: Game): void {
    this.executing = true;
    const now = g.time;
    let maxDelay = 0;
    for (const { bot, task } of this.utilityTasks) {
      if (!bot.actor.alive || !bot.actor.grenades.includes(task.grenade)) continue;
      if (vdist2d(bot.actor.pos, task.from) > 6) {
        // not at the planned spot: throw from where we are if it is close enough
        if (vdist2d(bot.actor.pos, task.target) > 32) continue;
        task.from = { ...bot.actor.pos };
        task.plan = null;
      }
      const delay = task.grenade === 'smoke' ? 0 : task.grenade === 'molotov' ? 0.6 : 1.4;
      task.at = now + delay;
      maxDelay = Math.max(maxDelay, delay);
      if (this.rng.chance(0.5 + this.utilitySkill * 0.5)) bot.utility = task;
    }
    for (const b of this.members) this.goAt.set(b.actor.id, now + (maxDelay > 0 ? maxDelay + 1.2 : 0) + (this.roles.get(b.actor.id) === 'entry' ? 0 : 0.4));
    const lead = this.members.find(b => b.actor.alive);
    if (lead && this.planKind !== 'chaos') lead.radio(g, lead.actor, this.planKind === 'rush' ? `Раш ${this.site}!` : `Заходим на ${this.site}!`);
  }

  /** Main objective goal for a bot when nothing more urgent is happening. */
  objectiveFor(g: Game, bot: BotController): Goal | null {
    const a = bot.actor;
    const id = a.id;
    if (!g.mode.allowBomb) return null;
    if (this.team === 'T') {
      const route = this.routes.get(id);
      const stage = this.stages.get(id);
      if (!route || !stage) return null;
      const site = g.map.sites.find(s => s.id === route.site)!;
      const go = this.executing && g.time >= (this.goAt.get(id) ?? 0);
      if (!go && this.planKind !== 'rush' && this.planKind !== 'chaos') {
        const look = g.nav.center(route.entry.i, route.entry.j);
        return { kind: 'hold', pos: stage, look: { x: look.x, y: look.y + 1.5, z: look.z }, reason: 'stage' };
      }
      // lurker waits a bit longer then pushes its own lane
      if (this.roles.get(id) === 'lurk' && g.time < (this.goAt.get(id) ?? 0) + 6) {
        return { kind: 'hold', pos: stage, look: g.nav.center(route.entry.i, route.entry.j), reason: 'lurk' };
      }
      // inside the site: clear toward defender spots
      if (siteAt(g.map, a.pos.x, a.pos.z) === route.site) {
        const holds = g.analysis.holds.filter(h => h.site === route.site);
        const h = holds[id % Math.max(1, holds.length)];
        if (h) return { kind: 'move', pos: g.nav.center(h.cell.i, h.cell.j), look: h.look, reason: 'clear' };
      }
      const target = a.hasBomb ? (this.plantSpot(g, site.id) ?? site.center) : this.siteClearPoint(g, site.id, id);
      return { kind: 'move', pos: target, walk: false, reason: 'execute' };
    }
    // CT
    if (this.alertSite && g.time >= this.alertAt && this.coordination > 0.25) {
      const myHold = this.holds.get(id);
      const anchorElsewhere = myHold && myHold.site !== this.alertSite && myHold.site !== 'mid';
      // keep one anchor on the other site when well coordinated
      const others = this.members.filter(b => b.actor.alive && this.holds.get(b.actor.id)?.site === myHold?.site);
      const stay = anchorElsewhere && this.coordination > 0.7 && others[0]?.actor.id === id && g.bomb.state !== 'planted';
      if (!stay) {
        const holds = g.analysis.holds.filter(h => h.site === this.alertSite);
        const h = holds[(id + 1) % Math.max(1, holds.length)];
        if (h) return { kind: 'move', pos: g.nav.center(h.cell.i, h.cell.j), look: h.look, walk: this.coordination > 0.6, reason: 'rotate' };
      }
    }
    if (g.bomb.state === 'planted' && !this.bombSiteKnown) {
      // go check the nearest site
      const near = g.map.sites.slice().sort((x, y) => vdist2d(a.pos, x.center) - vdist2d(a.pos, y.center))[0];
      if (near) return { kind: 'move', pos: { ...near.center }, reason: 'search bomb' };
    }
    const h = this.holds.get(id);
    if (h) return bot.holdFromSpot(g, h);
    return null;
  }

  private siteClearPoint(g: Game, site: string, id: number): Vec3 {
    const cells = g.analysis.siteCells[site] ?? [];
    if (!cells.length) return g.map.sites[0].center;
    const c = cells[(id * 7) % cells.length];
    return g.nav.center(c.i, c.j);
  }

  plantSpot(g: Game, site: string): Vec3 | null {
    const spots = g.analysis.plantSpots[site] ?? [];
    if (!spots.length) return null;
    const c = spots[Math.floor(spots.length / 2)];
    return g.nav.center(c.i, c.j);
  }

  postPlantSpot(g: Game, a: Actor): { pos: Vec3; look: Vec3 } | null {
    const cached = this.postSpots.get(a.id);
    if (cached) return cached;
    const b = g.bomb.pos;
    const c = g.nav.cellOf(b);
    const bp = { x: b.x, y: b.y + 0.4, z: b.z };
    const taken = [...this.postSpots.values()];
    let best: { pos: Vec3; look: Vec3 } | null = null, bs = -Infinity;
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
      const i = c.i + di, j = c.j + dj;
      if (!g.nav.isWalk(i, j)) continue;
      const p = g.nav.center(i, j);
      const d = vdist(p, b);
      if (d < 6 || d > 18) continue;
      if (!g.world.lineClear({ x: p.x, y: p.y + 1.5, z: p.z }, bp)) continue;
      if (taken.some(t => vdist2d(t.pos, p) < 4)) continue;
      const score = g.nav.coverScore[g.nav.idx(i, j)] * 1.5 - Math.abs(d - 11) * 0.3 + this.rng.next();
      if (score > bs) { bs = score; best = { pos: p, look: bp }; }
    }
    if (best) this.postSpots.set(a.id, best);
    return best;
  }

  private retakeStages = new Map<number, Vec3>();
  /** Gathering point on our side of the bomb site for a grouped retake. */
  retakeStage(g: Game, a: Actor): Vec3 | null {
    if (this.coordination < 0.5) return null;
    const cached = this.retakeStages.get(a.id);
    if (cached) return cached;
    const path = g.nav.findPath(a.pos, g.bomb.pos);
    if (!path || path.length < 10) return null;
    // ~16 m before the bomb along our path
    let idx = path.length - 1;
    while (idx > 0 && vdist(g.nav.center(path[idx].i, path[idx].j), g.bomb.pos) < 16) idx--;
    const p = g.nav.center(path[idx].i, path[idx].j);
    this.retakeStages.set(a.id, p);
    return p;
  }

  retakeReady(g: Game): boolean {
    const alive = this.members.filter(b => b.actor.alive);
    const near = alive.filter(b => { const st = this.retakeStages.get(b.actor.id); return st && vdist2d(b.actor.pos, st) < 4; });
    const left = g.bomb.explodeAt - g.time;
    return near.length >= Math.min(2, alive.length) || left < 22 || alive.length <= 1;
  }

  bombFetcher(g: Game): number {
    let best = -1, bd = Infinity;
    for (const b of this.members) {
      if (!b.actor.alive) continue;
      const d = vdist(b.actor.pos, g.bomb.pos);
      if (d < bd) { bd = d; best = b.actor.id; }
    }
    return best;
  }

  knownDefuser(g: Game): number { return g.bomb.defuser; }

  /** Direction a careful player would pre-aim when moving (route chokes ahead). */
  threatDirection(g: Game, a: Actor): Vec3 | null {
    const c = this.threatCache.get(a.id);
    if (c && g.time - c.t < 0.7) return c.p;
    let best: Vec3 | null = null, bs = Infinity;
    const eye = a.eye();
    const pts: Vec3[] = [];
    for (const r of g.analysis.routes) { pts.push(g.nav.center(r.choke.i, r.choke.j)); pts.push(g.nav.center(r.entry.i, r.entry.j)); }
    const avgAnt = this.members.reduce((s2, b) => s2 + b.profile.anticipation, 0) / Math.max(1, this.members.length);
    if (avgAnt > 0.85) for (const h of g.analysis.holds) if (this.rng.chance(0.5)) pts.push(g.nav.center(h.cell.i, h.cell.j));
    const fwd = { x: -Math.sin(a.yaw), z: -Math.cos(a.yaw) };
    const enemyIsT = a.team === 'CT';
    for (const p of pts) {
      const d = vdist(p, a.pos);
      if (d < 4 || d > 30) continue;
      const dx = (p.x - a.pos.x) / d, dz = (p.z - a.pos.z) / d;
      const ahead = dx * fwd.x + dz * fwd.z;
      if (ahead < 0.2) continue;
      // points on the enemy side of the map are more dangerous
      const k = g.nav.idx(Math.floor(p.x / 2), Math.floor(p.z / 2));
      const enemySide = enemyIsT ? g.analysis.distFromT[k] < g.analysis.distFromCT[k] : g.analysis.distFromCT[k] < g.analysis.distFromT[k];
      const tp = { x: p.x, y: p.y + 1.5, z: p.z };
      if (!g.world.lineClear(eye, tp)) continue;
      const s = d * (enemySide ? 0.6 : 1) - ahead * 4;
      if (s < bs) { bs = s; best = tp; }
    }
    this.threatCache.set(a.id, { t: g.time, p: best });
    return best;
  }

  onRoundEnd(g: Game, winner: Team | null): void {
    // where did attackers show up?
    const rs = this.sightings.filter(s => s.time <= g.time);
    let contact: string | null = g.bomb.state === 'planted' || g.bomb.state === 'exploded' || g.bomb.state === 'defused' ? g.bomb.site : null;
    if (!contact) {
      let bc = 0;
      for (const site of g.map.sites) {
        const c = rs.filter(s => vdist2d(s.pos, site.center) < 18).length;
        if (c > bc) { bc = c; contact = site.id; }
      }
    }
    this.history.push({ side: this.team, site: this.team === 'T' ? this.site : null, won: winner === this.team, contact });
    if (this.history.length > 30) this.history.shift();
  }
}

// -----------------------------------------------------------------------------

export class BotDirector {
  bots: BotController[] = [];
  brains: TeamBrain[] = [];

  constructor(readonly g: Game, lobby: LobbyPlayer[], seed: number) {
    const rng = new Rng(seed ^ 0x5bd1e995);
    this.brains = [new TeamBrain(0, rng.int(0, 1e9)), new TeamBrain(1, rng.int(0, 1e9))];
    for (const a of g.actors) {
      if (!a.isBot) continue;
      const lp = lobby.find(l => l.name === a.name) ?? lobby[a.id];
      const bot = new BotController(a, lp?.level ?? a.botLevel ?? 3, rng.int(0, 1e9) ^ (lp?.style ?? 0));
      this.bots.push(bot);
      g.controllers.set(a.id, bot);
      if (g.mode.allowBomb && !g.mode.ffa) {
        const brain = this.brains[a.squad] ?? this.brains[0];
        bot.brain = brain;
        brain.members.push(bot);
      }
    }
    g.listeners.push(e => this.onEvent(e));
    g.onTick.push(() => this.update());
    // the first round started during mode.attach()
    this.roundStart();
  }

  private roundStart(): void {
    for (const b of this.bots) b.onRoundStart(this.g);
    if (this.g.mode.allowBomb && !this.g.mode.ffa) for (const br of this.brains) br.startRound(this.g);
  }

  private onEvent(e: GameEvent): void {
    if (e.type === 'round_start') this.roundStart();
    else if (e.type === 'round_end') for (const br of this.brains) br.onRoundEnd(this.g, e.winner);
    else if (e.type === 'spawn') {
      const b = this.bots.find(x => x.actor.id === e.actor);
      if (b && !this.g.mode.allowBomb) b.onRoundStart(this.g);
    }
  }

  private update(): void {
    for (const br of this.brains) if (br.members.length) br.update(this.g);
  }
}

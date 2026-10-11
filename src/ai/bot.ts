// Individual bot brain. Produces InputCmd like a human would; uses only Perception for enemies.
import type { Actor } from '../sim/actor';
import { buy, checkBuy, type BuyItem } from '../sim/buy';
import type { Controller, Game } from '../sim/game';
import { recoilOffset } from '../sim/game';
import { smokeRadius } from '../sim/grenades';
import { siteAt } from '../sim/maps/mapgrid';
import { DEG, anglesFromDir, clamp, vdist, vdist2d, vlen2d, wrapAngle, type Vec3 } from '../sim/math';
import type { HoldSpot } from '../sim/nav';
import { Rng } from '../sim/rng';
import { emptyInput, type InputCmd } from '../sim/types';
import type { GrenadeType } from '../sim/weapons';
import { profileFor, type BotProfile } from './difficulty';
import { choosePickup, claimDrop, sightline } from './loadout';
import { loadoutValue, pickHideSpot, type HideSpot } from './save';
import { Perception, type Memory } from './perception';
import type { TeamBrain } from './team';
import { planThrow, type ThrowPlan } from './throws';

export type Goal =
  | { kind: 'idle' }
  | { kind: 'move'; pos: Vec3; look?: Vec3; walk?: boolean; reason: string }
  | { kind: 'hold'; pos: Vec3; look: Vec3; reason: string; base?: Vec3 }
  | { kind: 'plant'; pos: Vec3 }
  | { kind: 'defuse'; pos: Vec3 }
  | { kind: 'throw'; task: UtilityTask }
  | { kind: 'retreat'; pos: Vec3 }
  | { kind: 'pickup'; pos: Vec3 };

export interface UtilityTask {
  grenade: GrenadeType;
  target: Vec3;
  from: Vec3;
  plan: ThrowPlan | null;
  /** throw no earlier than */
  at: number;
  done: boolean;
  reason: string;
}

export interface BotStyle { aggression: number; patience: number; awper: boolean }

export class BotController implements Controller {
  profile: BotProfile;
  perception: Perception;
  rng: Rng;
  brain: TeamBrain | null = null;
  style: BotStyle;
  goal: Goal = { kind: 'idle' };
  utility: UtilityTask | null = null;
  // navigation
  private path: Vec3[] = [];
  private pathGoal: Vec3 | null = null;
  private pathTime = 0;
  private lastProgressPos: Vec3 = { x: 0, y: 0, z: 0 };
  private lastProgressTime = 0;
  private stuckCount = 0;
  // aiming
  private targetId = -1;
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private aimHead = false;
  private aimYaw = 0;
  private aimPitch = 0;
  private burstLeft = 0;
  private burstPauseUntil = 0;
  private strafeDir = 1;
  private strafeUntil = 0;
  private nextDecision = 0;
  private boughtRound = -1;
  private buyAt = 0;
  private throwHoldUntil = 0;
  private throwStage: 'none' | 'aim' | 'hold' = 'none';
  private lastRadio = 0;
  private reactFlinch = 0;
  private wanderGoal: Vec3 | null = null;
  private postFlashPeekAt = 0;
  private lastSeenEnemyAt = -10;
  /** weapon-pickup errand the bot has committed to */
  private pickupTask: { dropId: number; until: number } | null = null;
  private nextPickupCheck = 0;
  /** saving the loadout this round: where we hide (decided at most once per round) */
  saving: HideSpot | null = null;
  private saveRound = -1;
  private nextSaveCheck = 0;
  /** why the last pickup was chosen (stats / spectator overlay) */
  lastPickupWhy: 'empty' | 'upgrade' | 'situational' | 'ammo' | '' = '';
  pickupPlans = 0;
  debug = '';

  constructor(readonly actor: Actor, level: number, seed: number) {
    this.profile = profileFor(level);
    this.perception = new Perception(actor, this.profile);
    this.rng = new Rng(seed);
    this.style = { aggression: this.rng.range(0.2, 0.9), patience: this.rng.range(0.2, 0.9), awper: this.rng.chance(0.25) };
    this.aimYaw = actor.yaw;
  }

  setLevel(level: number): void {
    this.profile = profileFor(level);
    this.perception.profile = this.profile;
  }

  onRoundStart(g: Game): void {
    this.perception.reset();
    this.goal = { kind: 'idle' };
    this.utility = null;
    this.path = [];
    this.pathGoal = null;
    this.targetId = -1;
    this.throwStage = 'none';
    this.buyAt = g.time + this.rng.range(0.6, 2.8);
    this.aimYaw = this.actor.yaw;
    this.aimPitch = 0;
    this.wanderGoal = null;
  }

  // ---------------------------------------------------------------------------

  think(g: Game, a: Actor, dt: number): InputCmd {
    const cmd = emptyInput(this.aimYaw, this.aimPitch);
    // perception at 32 Hz, staggered across bots (reaction-time resolution ~31 ms)
    if ((g.tick + a.id) % 2 === 0) this.perception.update(g);
    const canMove = g.mode.canMove(a);

    if (g.mode.canBuy(a) && this.boughtRound !== this.roundKey(g) && g.time >= this.buyAt) {
      this.doBuy(g, a);
      this.boughtRound = this.roundKey(g);
    }
    if (!canMove) {
      // freeze time: look around a bit
      this.turnToward(a, this.aimYaw + Math.sin(g.time * 0.7 + a.id) * 0.002, 0, dt, 0.2);
      cmd.yaw = this.aimYaw; cmd.pitch = this.aimPitch;
      return cmd;
    }

    if (g.time >= this.nextDecision) {
      this.decide(g, a);
      this.nextDecision = g.time + this.profile.decisionInterval * this.rng.range(0.8, 1.25);
    }

    // turn away from a flashbang we can see about to pop (what a human does)
    if (this.avoidFlash(g, a, dt)) { cmd.yaw = this.aimYaw; cmd.pitch = this.aimPitch; return cmd; }

    const acquired = this.perception.acquired(g);
    const target = this.pickTarget(g, a, acquired);
    if (target) {
      this.lastSeenEnemyAt = g.time;
      this.combat(g, a, target, cmd, dt);
    } else {
      this.targetId = -1;
      this.executeGoal(g, a, cmd, dt);
    }
    this.maintenance(g, a, cmd, target);
    cmd.yaw = this.aimYaw;
    cmd.pitch = this.aimPitch;
    return cmd;
  }

  private roundKey(g: Game): number {
    const m = g.mode as unknown as { round?: number };
    return m.round ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Decisions

  private decide(g: Game, a: Actor): void {
    const p = this.perception;
    const now = g.time;
    const bomb = g.bomb;
    const isT = a.team === 'T';
    const brain = this.brain;
    const freshThreat = p.nearestMemory(g, 3);

    // Utility task in progress keeps priority unless enemies are close
    if (this.utility && !this.utility.done && (!freshThreat || vdist(freshThreat.pos, a.pos) > 12)) {
      this.goal = { kind: 'throw', task: this.utility };
      return;
    }

    // Hopeless round with an expensive loadout: hide and keep it for the next round
    const save = this.saveGoal(g, a);
    if (save) { this.goal = save; return; }

    if (g.mode.allowBomb) {
      // Avoid the blast
      if (bomb.state === 'planted') {
        const left = bomb.explodeAt - now;
        const d = vdist(a.pos, bomb.pos);
        const defuseTime = a.kit ? 5 : 10;
        if ((isT && left < 8 && d < 26) || (!isT && left < defuseTime + 0.6 && d < 26 && a.defusing === 0)) {
          this.goal = { kind: 'retreat', pos: this.awayFrom(g, a, bomb.pos, 28) };
          return;
        }
        if (!isT) {
          const known = brain?.bombSiteKnown;
          if (known) {
            const threat = p.nearestMemory(g, 2.5);
            const nearBomb = d < 1.6;
            const threatNear = threat && vdist(threat.pos, bomb.pos) < 12;
            const timeCritical = left < defuseTime + 3;
            if (nearBomb && (!threatNear || timeCritical || this.allEnemiesProbablyDead(g, a))) { this.goal = { kind: 'defuse', pos: bomb.pos }; return; }
            if (d < 25 && (!threatNear || timeCritical)) { this.goal = { kind: 'defuse', pos: bomb.pos }; return; }
            if (brain && brain.knownDefuser(g) !== a.id && d < 12 && threatNear) {
              // cover the defuser / clear the site
              this.goal = { kind: 'move', pos: threat!.pos, look: threat!.pos, reason: 'retake-clear' };
              return;
            }
            // coordinated teams group up before retaking instead of trickling in
            const stage = brain?.retakeStage(g, a);
            if (stage && !timeCritical && vdist(a.pos, bomb.pos) > 14) {
              const grouped = brain!.retakeReady(g);
              if (!grouped) { this.goal = { kind: 'hold', pos: stage, look: { x: bomb.pos.x, y: bomb.pos.y + 1.4, z: bomb.pos.z }, reason: 'retake-group' }; return; }
            }
            this.goal = { kind: 'move', pos: bomb.pos, look: bomb.pos, walk: d < 18 && this.profile.coordination > 0.5, reason: 'retake' };
            return;
          }
        } else {
          // post-plant: hold an angle on the bomb
          const spot = brain?.postPlantSpot(g, a);
          if (spot) { this.goal = { kind: 'hold', pos: spot.pos, look: spot.look, reason: 'post-plant' }; return; }
        }
      }
      // Bomb carrier: plant when on site
      if (isT && a.hasBomb && bomb.state === 'carried') {
        const site = siteAt(g.map, a.pos.x, a.pos.z);
        const allowed = !g.mode.allowedSites || (site && g.mode.allowedSites.includes(site));
        if (site && allowed && (!freshThreat || vdist(freshThreat.pos, a.pos) > 10 || now - freshThreat.time > 1.5)) {
          const spot = brain?.plantSpot(g, site) ?? a.pos;
          this.goal = { kind: 'plant', pos: spot };
          return;
        }
      }
      // Pick up dropped bomb
      if (isT && bomb.state === 'dropped' && brain && brain.bombFetcher(g) === a.id) {
        this.goal = { kind: 'pickup', pos: bomb.pos };
        return;
      }
    }

    // Weapon pickups: a better (or better-suited) gun on the floor, when it is safe
    const pick = this.pickupGoal(g, a, freshThreat);
    if (pick) { this.goal = pick; return; }

    // Defender outnumbered at a site: fall back toward spawn and wait to retake with the team
    if (!isT && g.mode.allowBomb && bomb.state !== 'planted' && this.profile.coordination > 0.45) {
      const near = [...p.memory.values()].filter(m => now - m.time < 4 && vdist(m.pos, a.pos) < 26);
      const mates = g.actors.filter(m => m.alive && m !== a && m.team === a.team && vdist(m.pos, a.pos) < 15).length;
      if (near.length >= 2 + mates && near.length >= 3) {
        const fb = this.fallbackPoint(g, a, near[0].pos);
        if (fb) {
          if (this.goal.kind !== 'retreat') this.radio(g, a, `Их ${near.length}, отхожу!`);
          this.goal = { kind: 'retreat', pos: fb };
          return;
        }
      }
    }
    // Retreat when weak and outnumbered
    if (freshThreat && a.health < 35 && this.profile.coverSense > 0.3 && vdist(freshThreat.pos, a.pos) < 18) {
      const mates = g.actors.filter(m => m.alive && m !== a && !p.isEnemy(g, m)).length;
      if (mates > 0 && this.rng.chance(0.6)) {
        this.goal = { kind: 'retreat', pos: this.coverFrom(g, a, freshThreat.pos) };
        return;
      }
    }

    // Recently heard/seen enemy: hunt or hold depending on role and style
    if (freshThreat) {
      const d = vdist(freshThreat.pos, a.pos);
      const holding = this.goal.kind === 'hold';
      const aggressive = !g.mode.allowBomb || (isT ? (!holding || this.style.aggression > 0.6) : this.style.aggression > 0.8 - (1 - this.profile.coordination) * 0.3);
      // flash before peeking a known position
      if (d > 5 && d < 22 && !freshThreat.seen && a.grenades.includes('flash') && this.rng.chance(this.profile.utility * 0.35) && now - this.lastSeenEnemyAt > 1.5) {
        const plan = planThrow(g, a.eye(), freshThreat.pos, 4, 'flash');
        if (plan) {
          this.utility = { grenade: 'flash', target: freshThreat.pos, from: { ...a.pos }, plan, at: now, done: false, reason: 'pre-peek flash' };
          this.postFlashPeekAt = now + 1.3;
          this.goal = { kind: 'throw', task: this.utility };
          return;
        }
      }
      // HE on a heard group
      if (d > 8 && d < 26 && a.grenades.includes('he') && this.rng.chance(this.profile.utility * 0.25)) {
        const plan = planThrow(g, a.eye(), freshThreat.pos, 3, 'he');
        if (plan) {
          this.utility = { grenade: 'he', target: freshThreat.pos, from: { ...a.pos }, plan, at: now, done: false, reason: 'he heard enemy' };
          this.goal = { kind: 'throw', task: this.utility };
          return;
        }
      }
      // molotov chokes as CT
      if (!isT && d > 7 && d < 22 && a.grenades.includes('molotov') && this.rng.chance(this.profile.utility * 0.3)) {
        const plan = planThrow(g, a.eye(), freshThreat.pos, 3, 'molotov');
        if (plan) {
          this.utility = { grenade: 'molotov', target: freshThreat.pos, from: { ...a.pos }, plan, at: now, done: false, reason: 'molly choke' };
          this.goal = { kind: 'throw', task: this.utility };
          return;
        }
      }
      if (aggressive && now >= this.postFlashPeekAt - 0.4) {
        this.goal = { kind: 'move', pos: freshThreat.pos, look: { x: freshThreat.pos.x, y: freshThreat.pos.y + 1.4, z: freshThreat.pos.z }, walk: d < 14 && this.profile.coordination > 0.4, reason: 'hunt' };
        return;
      }
      if (holding) {
        // keep the crosshair on the angle the enemy has to come through; only look at
        // the noise if that spot is actually in view (a heard enemy behind a wall will
        // still have to peek our angle)
        const gh = this.goal as { pos: Vec3; look: Vec3; reason: string; base?: Vec3 };
        const base = gh.base ?? gh.look;
        const noise = { x: freshThreat.pos.x, y: freshThreat.pos.y + 1.4, z: freshThreat.pos.z };
        let look = base;
        if (g.world.lineClear(a.eye(), noise)) look = noise;
        else if (this.rng.next() < 0.3 + this.profile.anticipation * 0.7) look = this.peekPoint(g, a, freshThreat.pos) ?? base;
        this.goal = { kind: 'hold', pos: gh.pos, look, reason: gh.reason, base } as Goal;
        return;
      }
    }

    // Team objective
    if (brain) {
      const obj = brain.objectiveFor(g, this);
      if (obj) { this.goal = obj; return; }
    }
    // No brain (DM / arms race / TDM): roam between hotspots
    this.goal = this.roam(g, a);
  }

  /**
   * Save: when the round is lost anyway (alone against many, no time to plant or defuse,
   * both sites known to be held) a bot with a valuable loadout may stop playing the
   * objective and hide instead. Only public info (alive counts, timers) and own/team intel.
   */
  private saveGoal(g: Game, a: Actor): Goal | null {
    if (!g.mode.allowBomb || g.mode.ffa) return null;
    const now = g.time;
    const rk = this.roundKey(g);
    if (rk !== this.saveRound) { this.saveRound = rk; this.saving = null; this.nextSaveCheck = 0; }
    if (this.saving) return { kind: 'hold', pos: this.saving.pos, look: this.saving.look, reason: 'save' };
    if (now < this.nextSaveCheck) return null;
    this.nextSaveCheck = now + 3;
    const isT = a.team === 'T';
    if (isT && g.bomb.state === 'planted') return null; // the bomb plays for us now
    const mates = g.actors.filter(o => o !== a && o.alive && o.team === a.team).length;
    const enemies = g.actors.filter(o => o.alive && o.team !== a.team).length;
    if (!enemies || loadoutValue(a) < 2000) return null;
    const m = g.mode as { phaseEnd?: number };
    const left = (m.phaseEnd ?? now + 99) - now;
    let hopeless = (mates === 0 && enemies >= 3) || (mates + 1) * 3 <= enemies;
    if (isT) {
      if (mates === 0 && enemies >= 2 && left < 22) hopeless = true; // no time to get a plant down
      if (mates <= 1 && enemies >= 2 && left < 45 && this.brain?.sitesHeld(g)) hopeless = true; // both sites held
    } else if (g.bomb.state === 'planted') {
      const tl = g.bomb.explodeAt - now;
      if (tl < (a.kit ? 5 : 10) + vdist(a.pos, g.bomb.pos) / 5 + 1) hopeless = true; // cannot make the defuse
      else if (!hopeless) return null;
    }
    if (!hopeless) return null;
    // decided once per round: better players save more often (novices rarely think about
    // the next round); a bot that chose to play it out does not change its mind
    this.nextSaveCheck = Infinity;
    if (!this.rng.chance(0.1 + this.profile.adaptation * 0.6)) return null;
    const threats = [...this.perception.memory.values()].filter(x => now - x.time < 10).map(x => x.pos);
    const spot = pickHideSpot(g, a, threats, g.bomb.state === 'planted' ? g.bomb.pos : null);
    if (!spot) return null;
    this.saving = spot;
    this.brain?.note('save');
    this.radio(g, a, 'Сохраняю оружие, прячусь');
    return { kind: 'hold', pos: spot.pos, look: spot.look, reason: 'save' };
  }

  private pickupGoal(g: Game, a: Actor, threat: Memory | null): Goal | null {
    const now = g.time;
    // keep running for the gun we already chose (no dithering between goals)
    if (this.pickupTask) {
      const d = g.drops.find(x => x.id === this.pickupTask!.dropId);
      if (d && now < this.pickupTask.until && (!threat || vdist(threat.pos, a.pos) > 10)) return { kind: 'pickup', pos: d.pos };
      this.pickupTask = null;
    }
    if (now < this.nextPickupCheck) return null;
    this.nextPickupCheck = now + 0.4;
    const m = g.mode as { phaseEnd?: number; liveStart?: number };
    if (g.mode.allowBomb && m.phaseEnd !== undefined && m.phaseEnd - now < 12 && g.bomb.state !== 'planted') return null;
    // the killer of whoever dropped a fresh gun may still be watching it
    const threats = [...this.perception.memory.values()].filter(x => now - x.time < 4).map(x => x.pos);
    const plan = choosePickup(g, a, this.profile, this.style.awper, threats, this.expectedFightDistance(g, a));
    if (!plan) return null;
    const dist = vdist2d(plan.drop.pos, a.pos);
    if (now - plan.drop.born < 2 && dist > 3) return null;
    const t = 2.5 + dist / 3;
    claimDrop(g, plan.drop.id, a.id, t);
    this.pickupTask = { dropId: plan.drop.id, until: now + t };
    this.lastPickupWhy = plan.why;
    this.pickupPlans++;
    return { kind: 'pickup', pos: plan.drop.pos };
  }

  /** Distance we expect to fight at: sightlines here and where we are heading/holding. */
  private expectedFightDistance(g: Game, a: Actor): number {
    const here = sightline(g, a.pos);
    const gl = this.goal as { kind: string; pos?: Vec3; look?: Vec3 };
    if (!gl.pos) return here;
    const there = sightline(g, gl.pos);
    if (gl.kind === 'hold' && gl.look) return (Math.min(60, vdist(gl.pos, gl.look)) + there) / 2;
    return (here + there * 2) / 3;
  }

  private roam(g: Game, a: Actor): Goal {
    if (!this.wanderGoal || vdist2d(this.wanderGoal, a.pos) < 2.5) {
      const hs = g.analysis.routes.length ? g.analysis.routes : null;
      if (hs && this.rng.chance(0.7)) {
        const r = this.rng.pick(hs);
        const c = this.rng.pick(r.cells);
        this.wanderGoal = g.nav.center(c.i, c.j);
      } else {
        for (let k = 0; k < 20; k++) {
          const i = this.rng.int(1, g.map.w - 2), j = this.rng.int(1, g.map.h - 2);
          if (g.nav.isWalk(i, j)) { this.wanderGoal = g.nav.center(i, j); break; }
        }
      }
    }
    return { kind: 'move', pos: this.wanderGoal ?? a.pos, reason: 'roam' };
  }

  private allEnemiesProbablyDead(g: Game, a: Actor): boolean {
    // public info: the scoreboard shows how many enemies are alive
    return g.actors.filter(o => o.alive && o.team !== a.team).length === 0;
  }

  awayFrom(g: Game, a: Actor, from: Vec3, dist: number): Vec3 {
    let best = a.pos, bd = -1;
    for (let k = 0; k < 30; k++) {
      const i = this.rng.int(1, g.map.w - 2), j = this.rng.int(1, g.map.h - 2);
      if (!g.nav.isWalk(i, j)) continue;
      const c = g.nav.center(i, j);
      const d = vdist(c, from);
      const travel = vdist(c, a.pos);
      if (d > dist && travel < 40) return c;
      if (d - travel * 0.3 > bd) { bd = d - travel * 0.3; best = c; }
    }
    return best;
  }

  /** A point back toward our spawn, out of sight of the threat. */
  fallbackPoint(g: Game, a: Actor, threat: Vec3): Vec3 | null {
    const home = a.team === 'CT' ? g.map.ctSpawns[0] : g.map.tSpawns[0];
    const cells = g.nav.findPath(a.pos, home);
    if (!cells || cells.length < 4) return null;
    const teye = { x: threat.x, y: threat.y + 1.6, z: threat.z };
    for (let k = Math.min(cells.length - 1, 5); k < cells.length; k++) {
      const p = g.nav.center(cells[k].i, cells[k].j);
      if (vdist(p, threat) > 14 && !g.world.lineClear(teye, { x: p.x, y: p.y + 1.5, z: p.z })) return p;
    }
    return g.nav.center(cells[cells.length - 1].i, cells[cells.length - 1].j);
  }

  /** Find a nearby cell without line of sight to the threat. */
  coverFrom(g: Game, a: Actor, threat: Vec3): Vec3 {
    const c = g.nav.cellOf(a.pos);
    let best: Vec3 | null = null, bd = Infinity;
    const teye = { x: threat.x, y: threat.y + 1.6, z: threat.z };
    const r = 4;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = c.i + di, j = c.j + dj;
      if (!g.nav.isWalk(i, j)) continue;
      const p = g.nav.center(i, j);
      if (g.world.lineClear(teye, { x: p.x, y: p.y + 1.4, z: p.z })) continue;
      const d = vdist(p, a.pos) - vdist(p, threat) * 0.3 * this.profile.coverSense;
      if (d < bd) { bd = d; best = p; }
    }
    return best ?? this.awayFrom(g, a, threat, 15);
  }

  // ---------------------------------------------------------------------------
  // Goal execution (no enemy acquired)

  private executeGoal(g: Game, a: Actor, cmd: InputCmd, dt: number): void {
    const goal = this.goal;
    const look = (p: Vec3 | undefined | null, speed = 0.6) => {
      if (p) this.lookAt(a, p, dt, speed);
    };
    switch (goal.kind) {
      case 'idle': break;
      case 'move': {
        const arrived = this.navigate(g, a, goal.pos, cmd);
        cmd.walk = !!goal.walk;
        look(goal.look && vdist(a.pos, goal.pos) < 15 ? goal.look : this.lookAhead(g, a), 0.55);
        if (arrived && goal.reason === 'hunt') this.goal = { kind: 'idle' };
        break;
      }
      case 'hold': {
        const arrived = this.navigate(g, a, goal.pos, cmd, 0.8);
        if (arrived) {
          look(goal.look, 0.5);
          // subtle shuffle to look natural but keep accuracy (walk)
          cmd.crouch = this.style.patience > 0.75 && this.profile.coverSense > 0.6;
        } else look(this.lookAhead(g, a), 0.55);
        break;
      }
      case 'retreat': {
        this.navigate(g, a, goal.pos, cmd);
        const m = this.perception.freshest(3, g);
        look(m ? { x: m.pos.x, y: m.pos.y + 1.4, z: m.pos.z } : this.lookAhead(g, a), 0.5);
        if (vdist2d(a.pos, goal.pos) < 1.5) this.goal = { kind: 'idle' };
        break;
      }
      case 'pickup': {
        const near = vdist2d(a.pos, goal.pos) < 1.3;
        // close enough to grab: stop and look straight at it so "use" connects
        const arrived = near || this.navigate(g, a, goal.pos, cmd, 0.5);
        if (near) { cmd.forward = 0; cmd.right = 0; }
        look({ x: goal.pos.x, y: goal.pos.y, z: goal.pos.z }, near ? 1 : 0.8);
        if (near) cmd.use = (g.tick % 4) < 2;
        if (arrived && vdist2d(a.pos, goal.pos) < 0.6) this.goal = { kind: 'idle' };
        break;
      }
      case 'plant': {
        const arrived = this.navigate(g, a, goal.pos, cmd, 0.6);
        if (arrived || siteAt(g.map, a.pos.x, a.pos.z)) {
          if (siteAt(g.map, a.pos.x, a.pos.z) && (arrived || vdist2d(a.pos, goal.pos) < 3)) {
            cmd.forward = 0; cmd.right = 0;
            if (a.active !== 'bomb') cmd.select = 'bomb';
            else cmd.fire = true;
            look({ x: a.pos.x + Math.sin(a.id) * 3, y: a.pos.y, z: a.pos.z + Math.cos(a.id) * 3 }, 0.3);
          }
        }
        if (!arrived) look(this.lookAhead(g, a), 0.55);
        break;
      }
      case 'defuse': {
        const d = vdist2d(a.pos, goal.pos);
        if (d > 1.0) { this.navigate(g, a, goal.pos, cmd, 0.4); look(this.lookAhead(g, a), 0.6); }
        else {
          cmd.forward = 0; cmd.right = 0;
          cmd.use = true;
          cmd.crouch = this.profile.coverSense > 0.5;
          look({ x: goal.pos.x, y: goal.pos.y + 0.2, z: goal.pos.z }, 0.6);
        }
        break;
      }
      case 'throw': this.executeThrow(g, a, goal.task, cmd, dt); break;
    }
  }

  private executeThrow(g: Game, a: Actor, task: UtilityTask, cmd: InputCmd, dt: number): void {
    if (task.done) { this.goal = { kind: 'idle' }; this.utility = null; return; }
    if (!a.grenades.includes(task.grenade) && a.throwStart === 0) { task.done = true; return; }
    const atSpot = vdist2d(a.pos, task.from) < 1.2;
    if (!atSpot && this.throwStage === 'none') {
      this.navigate(g, a, task.from, cmd, 0.5);
      this.lookAt(a, this.lookAhead(g, a), dt, 0.6);
      return;
    }
    cmd.forward = 0; cmd.right = 0;
    if (g.time < task.at) { this.lookAt(a, task.target, dt, 0.4); return; }
    if (!task.plan) task.plan = planThrow(g, a.eye(), task.target, task.grenade === 'flash' ? 5 : 3.5, task.grenade);
    if (!task.plan) { task.done = true; return; }
    if (a.active !== 'grenade' || a.activeGrenade !== task.grenade) {
      cmd.select = task.grenade;
      this.turnToward(a, task.plan.yaw, task.plan.pitch, dt, 1);
      return;
    }
    this.turnToward(a, task.plan.yaw, task.plan.pitch, dt, 1);
    const err = Math.abs(wrapAngle(this.aimYaw - task.plan.yaw)) + Math.abs(this.aimPitch - task.plan.pitch);
    if (this.throwStage === 'none' && err < 0.02 && g.time >= a.deployEnd) {
      this.throwStage = 'hold';
      this.throwHoldUntil = g.time + 0.3;
    }
    if (this.throwStage === 'hold') {
      if (g.time < this.throwHoldUntil) {
        if (task.plan.strong) cmd.fire = true; else cmd.fire2 = true;
      } else {
        // release
        this.throwStage = 'none';
        task.done = true;
        this.utility = null;
        this.goal = { kind: 'idle' };
        this.nextDecision = g.time + 0.4;
        if (task.grenade === 'flash' && this.profile.utility > 0.5) {
          // look away from our own flash
          this.aimYaw += Math.PI * 0.8;
        }
        this.radio(g, a, task.grenade === 'smoke' ? 'Ставлю дым' : task.grenade === 'flash' ? 'Флешка!' : task.grenade === 'he' ? 'Граната!' : task.grenade === 'molotov' ? 'Поджигаю' : 'Приманка');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Combat

  private pickTarget(g: Game, a: Actor, acquired: number[]): Actor | null {
    if (!acquired.length) return null;
    if (acquired.includes(this.targetId) && g.actors[this.targetId]?.alive) return g.actors[this.targetId];
    let best: Actor | null = null, bs = Infinity;
    for (const id of acquired) {
      const o = g.actors[id];
      if (!o?.alive) continue;
      let s = vdist(o.pos, a.pos);
      // prioritise enemies looking at us and the bomb planter/defuser
      if (o.planting > 0 || o.defusing > 0) s *= 0.4;
      const toMe = anglesFromDir({ x: a.pos.x - o.pos.x, y: 0, z: a.pos.z - o.pos.z });
      if (Math.abs(wrapAngle(toMe.yaw - o.yaw)) < 0.4) s *= 0.7;
      if (s < bs) { bs = s; best = o; }
    }
    if (best && best.id !== this.targetId) this.onAcquire(g, a, best);
    return best;
  }

  private onAcquire(g: Game, a: Actor, t: Actor): void {
    this.targetId = t.id;
    const pr = this.profile;
    const dist = vdist(a.pos, t.pos);
    const tSpeed = vlen2d(t.vel);
    const mag = pr.aimError * DEG * (0.6 + this.rng.next() * 0.8) * (1 + tSpeed / 8) * (dist > 30 ? 0.8 : 1);
    const th = this.rng.next() * Math.PI * 2;
    this.aimErrYaw = Math.cos(th) * mag;
    this.aimErrPitch = Math.sin(th) * mag * 0.6;
    this.aimHead = this.rng.chance(pr.headPref * (dist > 35 ? 0.7 : 1));
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    if (g.time - this.lastRadio > 4) {
      const where = this.callout(g, t.pos);
      this.radio(g, a, where ? `Враг: ${where}` : 'Вижу врага!');
    }
    this.brain?.report(g, t.id, t.pos);
  }

  private combat(g: Game, a: Actor, t: Actor, cmd: InputCmd, dt: number): void {
    const pr = this.profile;
    const def = a.activeDef();
    const eye = a.eye();
    const dist = vdist(eye, t.pos);
    this.brain?.report(g, t.id, t.pos);

    // weapon readiness
    const w = a.activeWeapon();
    if (def.cls === 'grenade' || def.cls === 'bomb' || (def.cls === 'knife' && dist > 3)) {
      if (a.planting > 0 && a.planting > 2.6 && dist > 8) { cmd.fire = true; return; } // finish plant
      if (a.throwStart > 0 && a.throwRelease === 0) { cmd.fire = false; cmd.fire2 = false; } // let it go
      else if (a.primary) cmd.select = 'primary';
      else if (a.secondary) cmd.select = 'secondary';
    }
    if (a.defusing > 0) {
      const left = (a.kit ? 5 : 10) - a.defusing;
      if (left < 1.2 || (g.bomb.explodeAt - g.time) < left + 0.3) { cmd.use = true; return; } // ninja finish
    }
    if (w && w.clip === 0 && def.mag > 0) {
      if (a.active === 'primary' && a.secondary && dist < 15 && pr.level >= 3) cmd.select = 'secondary';
      else cmd.reload = true;
    }

    // aim point with lead
    const lead = pr.leadSkill * 0.12;
    const hb = t.hitboxes();
    const head = hb[0];
    const chestY = (hb[1].y0 + hb[1].y1) / 2;
    const tp = this.aimHead
      ? { x: head.cx + t.vel.x * lead, y: head.cy + t.vel.y * lead * 0.3, z: head.cz + t.vel.z * lead }
      : { x: t.pos.x + t.vel.x * lead, y: chestY, z: t.pos.z + t.vel.z * lead };
    const dir = { x: tp.x - eye.x, y: tp.y - eye.y, z: tp.z - eye.z };
    const ang = anglesFromDir(dir);
    // settle aim error
    const k = Math.exp(-dt / Math.max(0.05, pr.aimSettle));
    this.aimErrYaw *= k; this.aimErrPitch *= k;
    // flinch when hit
    if (a.health < this.reactFlinch) {
      const f = (1 - pr.coverSense) * 0.05;
      this.aimErrYaw += this.rng.range(-f, f); this.aimErrPitch += this.rng.range(-f, f);
    }
    this.reactFlinch = a.health;
    const rec = recoilOffset(def, a.spray);
    // tracking noise that never fully settles (humans can't hold a pixel at 60 m)
    const jit = pr.jitter * DEG;
    const jy = (Math.sin(g.time * 7.3 + a.id * 1.7) + Math.sin(g.time * 3.1 + a.id)) * 0.5 * jit;
    const jp = (Math.sin(g.time * 6.1 + a.id * 2.3) + Math.sin(g.time * 2.3 + a.id * 0.7)) * 0.5 * jit;
    const desiredYaw = ang.yaw + this.aimErrYaw + jy - rec.yaw * pr.recoilControl;
    const desiredPitch = ang.pitch + this.aimErrPitch + jp - rec.pitch * pr.recoilControl;
    this.turnToward(a, desiredYaw, desiredPitch, dt, 1);

    // fire decision
    const radius = this.aimHead ? 0.14 : 0.25;
    const tol = Math.atan2(radius, Math.max(0.5, dist)) * (1.3 + (1 - pr.burstDiscipline) * 2.2);
    const curDir = { yaw: this.aimYaw + rec.yaw, pitch: this.aimPitch + rec.pitch };
    const errYaw = Math.abs(wrapAngle(curDir.yaw - ang.yaw));
    const errPitch = Math.abs(curDir.pitch - ang.pitch);
    const onTarget = Math.hypot(errYaw, errPitch) < tol;

    // movement during fights
    const speed = vlen2d(a.vel);
    const wantsStop = this.rng.next() < pr.stopToShoot || dist > 20;
    const tooFast = speed > def.speed * 0.36;
    if (wantsStop) {
      cmd.forward = 0; cmd.right = 0;
    } else {
      // jiggle strafe
      if (g.time > this.strafeUntil) { this.strafeDir = -this.strafeDir; this.strafeUntil = g.time + this.rng.range(0.25, 0.6); }
      cmd.right = this.strafeDir;
    }
    if (def.cls === 'knife') {
      // rush in for the stab
      this.navigateDirect(a, t.pos, cmd);
      cmd.fire = dist < 2.0;
      return;
    }
    // scope in with snipers
    if (def.scope && a.scopeLevel === 0 && dist > 7 && g.time >= a.deployEnd && a.rezoomAt === 0) cmd.fire2 = true;
    // crouch spray at range for disciplined bots
    if (def.auto && dist > 14 && pr.burstDiscipline > 0.5 && a.spray > 2) cmd.crouch = true;

    let shoot = onTarget && g.time >= this.burstPauseUntil;
    if (wantsStop && tooFast && pr.stopToShoot > 0.6) shoot = false; // counter-strafe first
    if (def.scope && a.scopeLevel === 0 && dist > 7) shoot = false;
    if (shoot && def.auto) {
      if (this.burstLeft <= 0) {
        const disc = pr.burstDiscipline;
        this.burstLeft = dist > 28 ? (disc > 0.5 ? 1 + this.rng.int(0, 2) : 4) : dist > 14 ? (disc > 0.5 ? 3 + this.rng.int(0, 3) : 8) : 30;
      }
      if (a.spray >= this.burstLeft) {
        this.burstPauseUntil = g.time + this.rng.range(0.18, 0.38) * (0.6 + pr.burstDiscipline);
        this.burstLeft = 0;
        shoot = false;
      }
    }
    // semi-auto: release between shots
    if (shoot && !def.auto && a.triggerHeld) shoot = false;
    // never shoot through a teammate standing in the line of fire
    if (shoot && !g.mode.ffa && this.teammateInLine(g, a, dist)) { shoot = false; cmd.right = this.strafeDir; }
    cmd.fire = shoot;
    // after a failed peek with low hp, step back
    if (a.health < 25 && pr.coverSense > 0.5 && dist > 10 && this.rng.chance(0.02)) {
      this.goal = { kind: 'retreat', pos: this.coverFrom(g, a, t.pos) };
    }
  }

  private peekCache: { key: string; p: Vec3 | null } | null = null;
  /**
   * Where an enemy heard at `from` will first become visible to us if he walks
   * toward us: map knowledge + hearing, not hidden information.
   */
  peekPoint(g: Game, a: Actor, from: Vec3): Vec3 | null {
    const key = `${Math.round(from.x / 2)},${Math.round(from.z / 2)},${Math.round(a.pos.x / 2)},${Math.round(a.pos.z / 2)}`;
    if (this.peekCache?.key === key) return this.peekCache.p;
    const cells = g.nav.findPath(from, a.pos);
    let p: Vec3 | null = null;
    if (cells) {
      const eye = a.eye();
      for (const c of cells) {
        const cc = g.nav.center(c.i, c.j);
        const head = { x: cc.x, y: cc.y + 1.5, z: cc.z };
        if (g.world.lineClear(eye, head)) { p = head; break; }
      }
    }
    this.peekCache = { key, p };
    return p;
  }

  private flashDodgeUntil = 0;
  private flashDodgeYaw = 0;
  private avoidFlash(g: Game, a: Actor, dt: number): boolean {
    if (g.time < this.flashDodgeUntil) { this.turnToward(a, this.flashDodgeYaw, 0, dt, 1); return true; }
    const pr = this.profile;
    if (pr.utility < 0.3) return false;
    for (const p of g.projectiles) {
      if (p.type !== 'flash' || g.time - p.born < 0.9) continue;
      const eye = a.eye();
      const d = Math.hypot(p.pos.x - eye.x, p.pos.y - eye.y, p.pos.z - eye.z);
      if (d > 22) continue;
      if (!g.world.lineClear(eye, p.pos) || !g.isLookingAt(a, p.pos, pr.fov / 2)) continue;
      if (!this.rng.chance(pr.utility * pr.coverSense)) { this.flashDodgeUntil = g.time + 0.3; this.flashDodgeYaw = this.aimYaw; return false; }
      const toYaw = Math.atan2(-(p.pos.x - eye.x), -(p.pos.z - eye.z));
      this.flashDodgeYaw = wrapAngle(toYaw + Math.PI);
      this.flashDodgeUntil = g.time + 0.9;
      return true;
    }
    return false;
  }

  private teammateInLine(g: Game, a: Actor, dist: number): boolean {
    const eye = a.eye();
    const rec = recoilOffset(a.activeDef(), a.spray);
    const dir = { x: -Math.sin(this.aimYaw + rec.yaw) * Math.cos(this.aimPitch + rec.pitch), y: Math.sin(this.aimPitch + rec.pitch), z: -Math.cos(this.aimYaw + rec.yaw) * Math.cos(this.aimPitch + rec.pitch) };
    for (const m of g.actors) {
      if (m === a || !m.alive || m.team !== a.team) continue;
      if (vdist(m.pos, a.pos) > dist + 1) continue;
      const hb = m.hitboxes().map(h => ({ ...h, r: h.r + 0.15 }));
      const h = g.traceHitboxes(hb, eye, dir, dist);
      if (h) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------

  private maintenance(g: Game, a: Actor, cmd: InputCmd, target: Actor | null): void {
    const w = a.activeWeapon();
    const def = a.activeDef();
    // reload in safe moments
    if (!target && w && def.mag > 0 && w.clip < def.mag * 0.35 && w.reserve > 0 && a.reloadEnd === 0) {
      const m = this.perception.nearestMemory(g, 2);
      if (!m || vdist(m.pos, a.pos) > 10) cmd.reload = true;
    }
    // switch back to a real gun when idle with knife/grenade/bomb out
    if (!target && this.goal.kind !== 'throw' && this.goal.kind !== 'plant' && (def.cls === 'knife' || def.cls === 'grenade' || def.cls === 'bomb') && a.throwStart === 0) {
      const runningFar = this.goal.kind === 'move' && this.path.length > 3 && !this.perception.nearestMemory(g, 6) && g.mode.allowBomb;
      if (!runningFar) {
        if (a.primary) cmd.select = 'primary'; else if (a.secondary) cmd.select = 'secondary';
      }
    }
    // knife out while running far with no threats (faster movement)
    if (!target && this.goal.kind === 'move' && this.path.length > 5 && !this.perception.nearestMemory(g, 8) && def.cls === 'pistol' && this.profile.level >= 4 && g.mode.allowBomb && this.rng.chance(0.01)) {
      cmd.select = 'melee';
    }
    // jump if stuck
    if (this.stuckCount > 0 && g.tick % 32 === 0) cmd.jump = true;
    // never hold E unless intended
    if (this.goal.kind !== 'defuse' && this.goal.kind !== 'pickup') cmd.use = false;
  }

  // ---------------------------------------------------------------------------
  // Navigation & looking

  /** Steer along a path to `goal`. Returns true when within `tol` meters. */
  navigate(g: Game, a: Actor, goal: Vec3, cmd: InputCmd, tol = 1.0): boolean {
    const now = g.time;
    if (vdist2d(a.pos, goal) < tol && Math.abs(a.pos.y - goal.y) < 1.5) { this.path = []; return true; }
    const needPath = !this.pathGoal || vdist2d(this.pathGoal, goal) > 1.5 || !this.path.length || now - this.pathTime > 6;
    if (needPath) {
      const penalty = this.smokePenalty(g);
      const cells = g.nav.findPath(a.pos, goal, penalty);
      this.path = cells ? g.nav.smooth(cells, a.pos) : [];
      if (this.path.length) this.path[this.path.length - 1] = { ...goal };
      // stuck on a corner: first step back to the middle of our cell, then follow the path
      if (this.stuckCount > 0 && cells?.length) {
        const c = g.nav.center(cells[0].i, cells[0].j);
        if (vdist2d(c, a.pos) > 0.3) this.path.unshift(c);
      }
      this.pathGoal = { ...goal };
      this.pathTime = now;
      this.lastProgressTime = now;
      this.lastProgressPos = { ...a.pos };
    }
    // progress / stuck detection
    if (now - this.lastProgressTime > 1.2) {
      if (vdist2d(a.pos, this.lastProgressPos) < 0.6) {
        this.stuckCount++;
        this.pathGoal = null; // repath next tick
        if (this.stuckCount > 3) {
          // nudge sideways
          cmd.right = this.rng.chance(0.5) ? 1 : -1;
        }
      } else this.stuckCount = 0;
      this.lastProgressPos = { ...a.pos };
      this.lastProgressTime = now;
    }
    while (this.path.length && vdist2d(a.pos, this.path[0]) < 0.55) this.path.shift();
    if (!this.path.length) return vdist2d(a.pos, goal) < tol + 0.8;
    this.navigateDirect(a, this.avoidTeammates(g, a, this.path[0]), cmd);
    return false;
  }

  /**
   * Teammate right in our way (narrow corridors, several bots rotating at once): step around
   * him on the right. Everyone keeping right resolves head-on jams instead of shoving forever.
   */
  private avoidTeammates(g: Game, a: Actor, p: Vec3): Vec3 {
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.3) return p;
    const wx = dx / l, wz = dz / l;
    for (const o of g.actors) {
      if (o === a || !o.alive || o.team !== a.team || Math.abs(o.pos.y - a.pos.y) > 1.2) continue;
      const ox = o.pos.x - a.pos.x, oz = o.pos.z - a.pos.z;
      const d = Math.hypot(ox, oz);
      if (d > 1.5 || d < 1e-3) continue;
      if ((ox * wx + oz * wz) / d < 0.6) continue; // not in front of us
      if (o.vel.x * wx + o.vel.z * wz > 2.5) continue; // he is walking away ahead of us: just follow
      const rx = -wz, rz = wx; // our right-hand side
      const nx = wx * 0.45 + rx * 0.9, nz = wz * 0.45 + rz * 0.9;
      return { x: a.pos.x + nx * 2, y: p.y, z: a.pos.z + nz * 2 };
    }
    return p;
  }

  private smokePenalty(g: Game): Float32Array | undefined {
    if (!g.smokes.length) return undefined;
    const pen = new Float32Array(g.nav.w * g.nav.h);
    const brave = this.style.aggression * (1 - this.profile.coverSense);
    for (const s of g.smokes) {
      const r = smokeRadius(s, g.time);
      const c = g.nav.cellOf(s.pos);
      const rc = Math.ceil(r / 2);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        if (!g.nav.isWalk(c.i + di, c.j + dj)) continue;
        pen[g.nav.idx(c.i + di, c.j + dj)] += 8 * (1 - brave);
      }
    }
    return pen;
  }

  /** Move straight toward a point (relative to current view yaw). */
  navigateDirect(a: Actor, p: Vec3, cmd: InputCmd): void {
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const wx = dx / l, wz = dz / l;
    // project onto view axes: forward=(-sin,-cos), right=(cos,-sin)
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    cmd.forward = clamp(-sy * wx - cy * wz, -1, 1);
    cmd.right = clamp(cy * wx - sy * wz, -1, 1);
    const m = Math.max(Math.abs(cmd.forward), Math.abs(cmd.right));
    if (m > 0) { cmd.forward /= m; cmd.right /= m; }
  }

  private lookAhead(g: Game, a: Actor): Vec3 {
    // anticipate: high-level bots check likely enemy directions instead of staring down the path
    const pr = this.profile;
    if (pr.anticipation > 0.4 && g.mode.allowBomb && this.brain) {
      const threat = this.brain.threatDirection(g, a);
      if (threat && this.rng.next() < pr.anticipation) return threat;
    }
    const wp = this.path[1] ?? this.path[0];
    if (wp) return { x: wp.x, y: wp.y + 1.55, z: wp.z };
    return { x: a.pos.x - Math.sin(a.yaw) * 5, y: a.pos.y + 1.6, z: a.pos.z - Math.cos(a.yaw) * 5 };
  }

  private lookAt(a: Actor, p: Vec3, dt: number, speedFrac: number): void {
    const eye = a.eye();
    const ang = anglesFromDir({ x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z });
    this.turnToward(a, ang.yaw, clamp(ang.pitch, -0.6, 0.6), dt, speedFrac);
  }

  private turnToward(a: Actor, yaw: number, pitch: number, dt: number, speedFrac: number): void {
    const maxStep = this.profile.turnRate * DEG * dt * speedFrac;
    const dy = wrapAngle(yaw - this.aimYaw);
    const dp = pitch - this.aimPitch;
    const dist = Math.hypot(dy, dp);
    // ease-out: slow down near the target (human-like flicks)
    const step = Math.min(dist, Math.max(maxStep * Math.min(1, dist / (12 * DEG)), maxStep * 0.15));
    if (dist > 1e-6) {
      this.aimYaw = wrapAngle(this.aimYaw + (dy / dist) * step);
      this.aimPitch = clamp(this.aimPitch + (dp / dist) * step, -1.5, 1.5);
    }
    void a;
  }

  // ---------------------------------------------------------------------------
  // Economy

  doBuy(g: Game, a: Actor): void {
    if (g.mode.freeBuy) return;
    // rich players buy regardless of the team call
    const econ = a.money >= 5200 ? 'full' : this.brain?.economy ?? 'full';
    const T = a.team === 'T';
    const tryBuy = (item: BuyItem) => (checkBuy(g, a, item).ok ? buy(g, a, item).ok : false);
    const isPistolRound = this.brain?.pistolRound ?? false;
    if (isPistolRound) {
      if (this.profile.level >= 3 && this.rng.chance(0.6)) tryBuy('armor');
      else tryBuy(this.rng.chance(0.5) ? 'p250' : 'flash');
      if (a.money >= 300 && this.rng.chance(this.profile.utility)) tryBuy(T ? 'flash' : 'smoke');
      if (!T && a.money >= 400 && this.rng.chance(0.4)) tryBuy('kit');
      return;
    }
    const role = this.brain?.roleOf(a.id);
    const hasRifle = a.primary && ['rifle', 'sniper', 'lmg'].includes(a.primary.def.cls);
    if (econ === 'full' || (econ === 'force' && hasRifle)) {
      if (!hasRifle) {
        if (role === 'awp' && a.money >= 4750 + 1000) tryBuy('awm');
        else if (!tryBuy(T ? 'ak' : 'm4')) if (!tryBuy(T ? 'galeon' : 'famine')) tryBuy(T ? 'macx' : 'mk5');
      }
      tryBuy('armorhelmet') || tryBuy('armor');
      const nadePriority: GrenadeType[] = this.profile.utility > 0.5 ? ['smoke', 'flash', T ? 'molotov' : 'he', 'flash', 'he'] : ['flash', 'he'];
      for (const gtype of nadePriority) {
        if (a.money < 300) break;
        if (this.rng.chance(0.25 + this.profile.utility * 0.75)) tryBuy(gtype);
      }
      if (!T && a.money >= 400) tryBuy('kit');
    } else if (econ === 'force') {
      tryBuy('armor');
      if (!tryBuy(T ? 'galeon' : 'famine')) if (!tryBuy(T ? 'macx' : 'mk5')) if (!tryBuy('nova')) tryBuy('deagle');
      if (a.money >= 200 && this.rng.chance(this.profile.utility)) tryBuy('flash');
    } else {
      // eco: save, maybe a cheap pistol upgrade
      if (a.money > 2000 && this.profile.level >= 4 && this.rng.chance(0.4)) tryBuy('p250');
    }
  }

  // ---------------------------------------------------------------------------

  callout(g: Game, p: Vec3): string {
    const s = siteAt(g.map, p.x, p.z);
    if (s) return `точка ${s}`;
    const i = Math.floor(p.x / 2), j = Math.floor(p.z / 2);
    for (const c of g.map.def.callouts ?? []) if (i >= c.x && i < c.x + c.w && j >= c.y && j < c.y + c.h) return c.name;
    return '';
  }

  radio(g: Game, a: Actor, text: string): void {
    if (g.time - this.lastRadio < 2.5) return;
    this.lastRadio = g.time;
    g.emit({ type: 'radio', actor: a.id, text });
  }

  private glanceUntil = 0;
  private glanceLook: Vec3 | null = null;
  holdFromSpot(g: Game, h: HoldSpot): Goal {
    const p = g.nav.center(h.cell.i, h.cell.j);
    // check the other entries now and then, but mostly hold the primary (closest) angle
    const looks = h.looks ?? [];
    if (looks.length > 1 && g.time > this.glanceUntil) {
      const glance = this.rng.next() < 0.35;
      this.glanceLook = glance ? this.rng.pick(looks) : h.look;
      this.glanceUntil = g.time + (glance ? this.rng.range(0.8, 1.6) : this.rng.range(2.5, 5));
    }
    return { kind: 'hold', pos: p, look: this.glanceLook ?? h.look, reason: `hold ${h.site}` };
  }

  memoryOf(id: number): Memory | undefined { return this.perception.memory.get(id); }
}


// Seven bot difficulty levels. Difficulty only changes decision quality, reaction and
// aim control — never damage, health, ammo or information.

export interface BotProfile {
  level: number;
  name: string;
  /** seconds of continuous visibility before a target is acquired */
  reaction: number;
  /** initial aim error (degrees) when acquiring a target */
  aimError: number;
  /** time constant (s) for aim error to settle */
  aimSettle: number;
  /** max turn rate (deg/s) */
  turnRate: number;
  /** probability of aiming at the head */
  headPref: number;
  /** fraction of recoil compensated */
  recoilControl: number;
  /** probability to stop moving before shooting (counter-strafe) */
  stopToShoot: number;
  /** willingness to use utility */
  utility: number;
  /** team coordination quality: waits for team, trades, rotates in time */
  coordination: number;
  /** seconds between high-level decisions */
  decisionInterval: number;
  /** adapts strategy using previous rounds */
  adaptation: number;
  /** horizontal field of view (deg) */
  fov: number;
  /** quality of sound localisation 0..1 */
  hearing: number;
  /** fire discipline: shorter bursts at range, crouch spraying */
  burstDiscipline: number;
  /** quality of cover choice 0..1 */
  coverSense: number;
  /** pre-aims likely angles / anticipates routes */
  anticipation: number;
  /** leads moving targets (fraction of velocity compensation) */
  leadSkill: number;
  /** persistent hand tremor / tracking noise (degrees) */
  jitter: number;
}

export const DIFFICULTY_NAMES = ['Новичок', 'Лёгкий', 'Средний', 'Сложный', 'Эксперт', 'Элитный', 'Профессиональный'];

const TABLE: Omit<BotProfile, 'level' | 'name'>[] = [
  { reaction: 0.70, aimError: 9.0, aimSettle: 0.90, turnRate: 200, headPref: 0.08, recoilControl: 0.00, stopToShoot: 0.10, utility: 0.05, coordination: 0.10, decisionInterval: 0.50, adaptation: 0.0, fov: 90, hearing: 0.45, burstDiscipline: 0.15, coverSense: 0.1, anticipation: 0.0, leadSkill: 0.0, jitter: 0.9 },
  { reaction: 0.52, aimError: 6.5, aimSettle: 0.70, turnRate: 280, headPref: 0.15, recoilControl: 0.25, stopToShoot: 0.30, utility: 0.20, coordination: 0.30, decisionInterval: 0.42, adaptation: 0.1, fov: 95, hearing: 0.55, burstDiscipline: 0.30, coverSense: 0.3, anticipation: 0.1, leadSkill: 0.2, jitter: 0.65 },
  { reaction: 0.40, aimError: 4.6, aimSettle: 0.50, turnRate: 380, headPref: 0.22, recoilControl: 0.45, stopToShoot: 0.55, utility: 0.40, coordination: 0.50, decisionInterval: 0.34, adaptation: 0.3, fov: 100, hearing: 0.65, burstDiscipline: 0.50, coverSense: 0.5, anticipation: 0.3, leadSkill: 0.4, jitter: 0.45 },
  { reaction: 0.32, aimError: 3.3, aimSettle: 0.38, turnRate: 480, headPref: 0.30, recoilControl: 0.60, stopToShoot: 0.75, utility: 0.60, coordination: 0.70, decisionInterval: 0.28, adaptation: 0.5, fov: 105, hearing: 0.75, burstDiscipline: 0.65, coverSense: 0.65, anticipation: 0.5, leadSkill: 0.6, jitter: 0.32 },
  { reaction: 0.26, aimError: 2.5, aimSettle: 0.30, turnRate: 600, headPref: 0.38, recoilControl: 0.72, stopToShoot: 0.88, utility: 0.75, coordination: 0.80, decisionInterval: 0.24, adaptation: 0.7, fov: 108, hearing: 0.82, burstDiscipline: 0.75, coverSense: 0.78, anticipation: 0.7, leadSkill: 0.75, jitter: 0.24 },
  { reaction: 0.22, aimError: 1.9, aimSettle: 0.24, turnRate: 720, headPref: 0.43, recoilControl: 0.82, stopToShoot: 0.95, utility: 0.85, coordination: 0.90, decisionInterval: 0.20, adaptation: 0.85, fov: 110, hearing: 0.88, burstDiscipline: 0.85, coverSense: 0.88, anticipation: 0.85, leadSkill: 0.85, jitter: 0.18 },
  { reaction: 0.19, aimError: 1.5, aimSettle: 0.20, turnRate: 850, headPref: 0.49, recoilControl: 0.90, stopToShoot: 1.00, utility: 0.95, coordination: 1.00, decisionInterval: 0.18, adaptation: 1.00, fov: 110, hearing: 0.93, burstDiscipline: 0.92, coverSense: 0.95, anticipation: 1.00, leadSkill: 0.92, jitter: 0.14 },
];

/** Profile for a (possibly fractional) level in [1, 7]. */
export function profileFor(level: number): BotProfile {
  const l = Math.min(7, Math.max(1, level));
  const i = Math.min(5, Math.floor(l - 1));
  const t = l - 1 - i;
  const a = TABLE[i], b = TABLE[i + 1];
  const out = { level: Math.round(l), name: DIFFICULTY_NAMES[Math.round(l) - 1] } as BotProfile;
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    (out as unknown as Record<string, number>)[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/** Hard human-plausibility limits that no profile may exceed (fairness guard). */
export const FAIRNESS_LIMITS = { minReaction: 0.15, maxTurnRate: 1000, minAimError: 1.0 };

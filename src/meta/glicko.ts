// Glicko-2 (Glickman 2012) on a 1000-centred scale. Used for the hidden MMR.
export const BASE = 1000;
export const SCALE = 173.7178;
export const TAU = 0.5;

export interface Glicko { r: number; rd: number; vol: number }

export const newGlicko = (): Glicko => ({ r: BASE, rd: 350, vol: 0.06 });

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

/** Expected score of a vs b. */
export function expected(a: Glicko, b: Glicko): number {
  const mu = (a.r - BASE) / SCALE, muj = (b.r - BASE) / SCALE, phij = b.rd / SCALE;
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
}

/**
 * One rating period with a single game against `opp` (the opposing team as a whole).
 * `score` is 1 / 0.5 / 0. Returns the new rating.
 */
export function updateGlicko(p: Glicko, opp: Glicko, score: number): Glicko {
  const mu = (p.r - BASE) / SCALE, phi = p.rd / SCALE, sigma = p.vol;
  const muj = (opp.r - BASE) / SCALE, phij = opp.rd / SCALE;
  const gj = g(phij);
  const E = 1 / (1 + Math.exp(-gj * (mu - muj)));
  const v = 1 / (gj * gj * E * (1 - E));
  const delta = v * gj * (score - E);
  // volatility (Illinois)
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * Math.pow(phi * phi + v + ex, 2)) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const sigmaP = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaP * sigmaP);
  const phiP = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muP = mu + phiP * phiP * gj * (score - E);
  return { r: muP * SCALE + BASE, rd: Math.max(30, phiP * SCALE), vol: sigmaP };
}

/** Rating deviation grows during inactivity (per idle day). */
export function decayRd(p: Glicko, days: number): Glicko {
  const phi = p.rd / SCALE;
  const per = Math.sqrt(phi * phi + days * p.vol * p.vol * 0.5);
  return { ...p, rd: Math.min(350, per * SCALE) };
}

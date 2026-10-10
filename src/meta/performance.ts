// Match performance rating (≈1.00 = average) and a short strengths/weaknesses report.
import type { ActorStats } from '../sim/types';

export function matchRating(s: ActorStats, rounds: number, minutes: number, ffa: boolean): number {
  if (ffa || rounds <= 0) {
    // respawn modes: kills per minute & K/D
    const kpm = s.kills / Math.max(1, minutes);
    const kd = s.kills / Math.max(1, s.deaths);
    return Math.round((0.6 * (kpm / 2.2) + 0.4 * Math.min(2.5, kd)) * 100) / 100;
  }
  const kpr = s.kills / rounds;
  const adr = s.damage / rounds;
  const spr = (rounds - s.deaths) / rounds;
  const apr = s.assists / rounds;
  const upr = (s.enemiesFlashed * 0.5 + s.utilityDamage / 50) / rounds;
  const r = 0.35 * (kpr / 0.68) + 0.3 * (adr / 78) + 0.15 * (spr / 0.32) + 0.1 * (apr / 0.18) + 0.1 * (upr / 0.3);
  const bonus = (s.mvps * 0.02 + s.clutches * 0.04 + s.entryKills * 0.01) - s.teamKills * 0.08;
  return Math.max(0, Math.round((r + bonus) * 100) / 100);
}

export interface ReportItem { good: boolean; text: string }

export function matchReport(s: ActorStats, rounds: number, minutes: number, ffa: boolean): ReportItem[] {
  const out: ReportItem[] = [];
  const acc = s.shotsFired ? s.shotsHit / s.shotsFired : 0;
  const hs = s.kills ? s.headshots / s.kills : 0;
  const kd = s.kills / Math.max(1, s.deaths);
  const adr = rounds ? s.damage / rounds : s.damage / Math.max(1, minutes);
  if (s.shotsFired >= 20) {
    if (acc >= 0.32) out.push({ good: true, text: `Высокая точность стрельбы (${Math.round(acc * 100)}%)` });
    else if (acc < 0.16) out.push({ good: false, text: `Низкая точность (${Math.round(acc * 100)}%): останавливайтесь перед выстрелом и стреляйте очередями` });
  }
  if (s.kills >= 5) {
    if (hs >= 0.5) out.push({ good: true, text: `Отличный процент попаданий в голову (${Math.round(hs * 100)}%)` });
    else if (hs < 0.2) out.push({ good: false, text: 'Мало убийств в голову: держите прицел на уровне головы' });
  }
  if (kd >= 1.4) out.push({ good: true, text: `Сильное соотношение K/D (${kd.toFixed(2)})` });
  else if (kd < 0.7 && s.deaths >= 5) out.push({ good: false, text: `Частые смерти (K/D ${kd.toFixed(2)}): играйте от укрытий и не выходите в одиночку` });
  if (!ffa && rounds >= 6) {
    if (adr >= 90) out.push({ good: true, text: `Большой урон за раунд (ADR ${Math.round(adr)})` });
    else if (adr < 50) out.push({ good: false, text: `Малый урон за раунд (ADR ${Math.round(adr)})` });
    if (s.enemiesFlashed + s.utilityDamage / 40 < rounds * 0.08) out.push({ good: false, text: 'Редко используете гранаты — покупайте и применяйте флешки и дым' });
    else if (s.enemiesFlashed >= 4 || s.utilityDamage >= 150) out.push({ good: true, text: 'Эффективное использование гранат' });
    if (s.entryKills >= Math.max(3, rounds * 0.15)) out.push({ good: true, text: `Много первых убийств (${s.entryKills})` });
    if (s.clutches > 0) out.push({ good: true, text: `Выигранные клатчи: ${s.clutches}` });
    if (s.plants + s.defuses >= 3) out.push({ good: true, text: 'Активная игра на цели (установки/разминирования)' });
  }
  if (s.teamDamage >= 100 || s.teamKills > 0) out.push({ good: false, text: 'Урон по союзникам: следите за линией огня' });
  if (!out.length) out.push({ good: true, text: 'Ровная игра без явных слабых мест' });
  return out;
}

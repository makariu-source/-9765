// Post-match summary: result, scoreboard, rating/rank changes, report, actions.
import type { App } from '../app';
import type { MatchResult } from '../../sim/modes/mode';
import type { MatchSummary } from '../../meta/profile';
import { matchRating } from '../../meta/performance';
import { rankEmblemSvg, rankProgress, proLevelBadgeSvg, proLevelProgress } from '../../meta/ranks';
import { ranksFor } from '../../meta/profile';
import { getMap } from '../../sim/maps/maps';
import { DIFFICULTY_NAMES } from '../../ai/difficulty';
import type { SessionOptions } from '../session';
import { h, svg } from './dom';
import { escapeHtml } from './hud';

export class PostMatch {
  readonly root: HTMLDivElement;

  constructor(app: App, r: MatchResult, s: MatchSummary | null, opts: SessionOptions) {
    const me = r.players.find(p => p.id === r.humanId)!;
    const banner = r.abandoned ? 'Матч покинут' : r.ffa ? (r.placement === 1 ? 'Победа!' : `${r.placement}-е место`) : r.outcome === 1 ? 'Победа' : r.outcome === 0 ? 'Поражение' : 'Ничья';
    const cls = r.abandoned ? 'lose' : r.outcome === 1 ? 'win' : r.outcome === 0 ? 'lose' : 'draw';
    const rounds = Math.max(1, r.roundsPlayed);
    const minutes = r.duration / 60;
    const mvp = r.players.find(p => p.id === r.mvpId);
    const rows = (ps: typeof r.players) => ps.map(p => h('tr', { class: p.id === r.humanId ? 'me' : '' },
      h('td', { html: `${escapeHtml(p.name)}${p.isBot ? `<span class="badge-bot">ИИ · ${DIFFICULTY_NAMES[Math.round(p.botLevel) - 1] ?? ''}</span>` : ''}${p.id === r.mvpId ? ' <span class="mvp-star">★</span>' : ''}` }),
      h('td', {}, p.stats.kills), h('td', {}, p.stats.deaths), h('td', {}, p.stats.assists),
      h('td', {}, r.ffa ? (r.mode === 'armsrace' ? `ур. ${(p.armsLevel ?? 0) + 1}` : p.dmScore ?? 0) : Math.round(p.stats.damage / rounds)),
      h('td', {}, p.stats.kills ? `${Math.round((p.stats.headshots / p.stats.kills) * 100)}%` : '0%'),
      h('td', {}, p.stats.mvps || ''),
      h('td', {}, matchRating(p.stats, r.roundsPlayed, minutes, r.ffa).toFixed(2)),
    ));
    const head = h('tr', {}, ['Игрок', 'У', 'С', 'П', r.ffa ? 'Очки' : 'ADR', 'HS%', 'MVP', 'Рейтинг'].map(t => h('th', {}, t)));
    const sorted = (ps: typeof r.players) => ps.slice().sort((a, b) => b.stats.kills - a.stats.kills);
    const tables = r.ffa
      ? [h('table', { class: 'tbl' }, head, rows(r.players.slice().sort((a, b) => (r.mode === 'armsrace' ? (b.armsLevel ?? 0) - (a.armsLevel ?? 0) : (b.dmScore ?? 0) - (a.dmScore ?? 0)) || b.stats.kills - a.stats.kills)))]
      : [h('h3', {}, `Ваша команда — ${r.scores[0]}`), h('table', { class: 'tbl' }, head, rows(sorted(r.players.filter(p => p.squad === 0)))),
         h('h3', {}, `Соперники — ${r.scores[1]}`), h('table', { class: 'tbl' }, head.cloneNode(true), rows(sorted(r.players.filter(p => p.squad === 1))))];

    // rating section
    const rating: HTMLElement[] = [];
    if (s?.mmr) {
      const m = s.mmr;
      const ranks = ranksFor(app.profile);
      if (m.rankAfter) {
        const pr = rankProgress(m.visibleAfter, ranks);
        const dv = m.visibleAfter - m.visibleBefore;
        rating.push(h('div', { class: 'card row', style: 'max-width:640px' },
          h('div', { class: m.rankUp ? 'rankup' : '' }, svg(rankEmblemSvg(m.rankAfter, 96))),
          h('div', { style: 'flex:1' },
            h('h3', { style: `color:${m.rankAfter.color}` }, m.rankUp ? `Новый ранг: ${m.rankAfter.name}!` : m.rankDown ? `Ранг понижен: ${m.rankAfter.name}` : m.rankAfter.name),
            h('p', {}, `${m.visibleAfter} очков (${dv >= 0 ? '+' : ''}${dv})${m.calibrationLeft === 0 && !m.rankBefore ? ' · калибровка завершена' : ''}`),
            h('div', { class: 'bar', style: 'margin:8px 0' }, h('i', { style: `width:${pr.frac * 100}%;background:${m.rankAfter.color}` })),
            h('p', {}, pr.next ? `До «${pr.next.name}»: ${pr.next.min - m.visibleAfter}` : 'Высший ранг'))));
      } else {
        rating.push(h('div', { class: 'card', style: 'max-width:640px' }, h('h3', {}, 'Калибровка'), h('p', {}, `Осталось матчей: ${m.calibrationLeft}. Ранг будет показан после калибровки.`)));
      }
      rating.push(h('p', { class: 'sub' }, `Скрытый MMR: ${Math.round(m.before)} → ${Math.round(m.after)} (${m.after >= m.before ? '+' : ''}${Math.round(m.after - m.before)}). Изменение основано на исходе матча и силе соперников; личная игра влияет только на величину.`));
    }
    if (s?.pro) {
      const pd = s.pro;
      const prog = proLevelProgress(pd.after);
      const up = pd.levelAfter.level > pd.levelBefore.level;
      rating.push(h('div', { class: 'card row', style: 'max-width:640px;border-color:var(--accent2)' },
        h('div', { class: up ? 'rankup' : '' }, svg(proLevelBadgeSvg(pd.levelAfter, 80))),
        h('div', { style: 'flex:1' },
          h('h3', { style: `color:${pd.levelAfter.color}` }, up ? `PRO League: новый уровень ${pd.levelAfter.level}!` : `PRO League · Level ${pd.levelAfter.level}`),
          h('p', {}, `${pd.before} → ${pd.after} ELO (${pd.delta >= 0 ? '+' : ''}${pd.delta}) · ${pd.reason}`),
          h('div', { class: 'bar', style: 'margin-top:8px' }, h('i', { style: `width:${prog.frac * 100}%;background:${pd.levelAfter.color}` })))));
    }
    if (s && !s.mmr && !s.pro && r.mode !== 'training') rating.push(h('p', { class: 'sub' }, r.custom ? 'Пользовательский матч — рейтинг не меняется.' : 'Этот режим не влияет на рейтинг.'));
    if (s?.flags.length && !s.flags.includes('duplicate')) rating.push(h('div', { class: 'warn' }, `Отметки честной игры: ${s.flags.join(', ')} — положительное изменение рейтинга не начислено.`));

    this.root = h('div', { class: 'post' },
      h('div', { class: `banner ${cls}` }, banner),
      h('p', { class: 'sub' }, `${opts.title} · ${getMap(r.mapId).def.name} · ${r.ffa ? '' : `${r.scores[0]} : ${r.scores[1]} · `}${Math.round(minutes)} мин · матч против ИИ`),
      mvp ? h('p', {}, h('span', { class: 'mvp-star' }, '★ MVP матча: '), mvp.name, mvp.isBot ? h('span', { class: 'badge-bot' }, 'ИИ') : '') : null,
      h('div', { class: 'row', style: 'margin:14px 0' },
        h('button', { class: 'btn', onclick: () => app.playAgain() }, 'Играть снова'),
        h('button', { class: 'btn ghost', onclick: () => app.showMenu() }, 'В меню'),
        h('button', { class: 'btn ghost', onclick: () => app.watchReplay() }, 'Посмотреть матч'),
      ),
      ...rating,
      h('h2', {}, 'Ваша игра'),
      h('div', { class: 'grid' },
        ...([[me.stats.kills, 'убийств'], [me.stats.deaths, 'смертей'], [me.stats.assists, 'помощи'], [r.ffa ? Math.round(me.stats.damage) : Math.round(me.stats.damage / rounds), r.ffa ? 'урон' : 'ADR'],
          [me.stats.kills ? `${Math.round((me.stats.headshots / me.stats.kills) * 100)}%` : '0%', 'в голову'], [me.stats.shotsFired ? `${Math.round((me.stats.shotsHit / me.stats.shotsFired) * 100)}%` : '—', 'точность'],
          [me.stats.mvps, 'MVP'], [s ? s.rating.toFixed(2) : '—', 'рейтинг матча']] as [string | number, string][]).map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)))),
      s ? h('div', {}, h('h2', {}, 'Отчёт'), h('ul', { class: 'report' }, s.report.map(i => h('li', { class: i.good ? 'good' : 'bad' }, `${i.good ? '▲' : '▼'} ${i.text}`)))) : null,
      s ? h('p', {}, `+${s.xpGain} XP${s.levelAfter > s.levelBefore ? ` · новый уровень аккаунта: ${s.levelAfter}!` : ''}`) : null,
      s?.challengesDone.length ? h('div', { class: 'note' }, `Испытания выполнены: ${s.challengesDone.map(c => c.text).join('; ')}`) : null,
      h('h2', {}, 'Таблица игроков'),
      ...tables,
    );
  }
}

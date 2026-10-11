// Main menu and all non-match screens.
import type { App, SpectateOptions, StartOptions } from '../app';
import { MAP_DEFS, getMap } from '../../sim/maps/maps';
import { ARMS_RACE_DEFAULT, WEAPONS, PISTOLS, RIFLES, SMGS, SNIPERS, HEAVY } from '../../sim/weapons';
import { DIFFICULTY_NAMES } from '../../ai/difficulty';
import { rankEmblemSvg, rankProgress, proLevelBadgeSvg, proLevelProgress, RANKS, DEFAULT_RANK_THRESHOLDS } from '../../meta/ranks';
import { leaderboard, seasonEnds, searchWindow, PRO_CALIBRATION } from '../../meta/proleague';
import { ranksFor, xpForLevel, emptyBlock, DEFAULT_BINDINGS, DEFAULT_TOUCH, type StatsBlock, type RankedTrack } from '../../meta/profile';
import type { ModeId } from '../../sim/modes/mode';
import { DEFAULT_TRAINING, type TrainingSettings } from '../../sim/modes/training';
import { sfx } from '../audio/sfx';
import { add, clear, fmtTime, h, pct, ratio, svg } from './dom';
import { escapeHtml } from './hud';
import { NAME_MAX, validateName } from '../../meta/name';
import { platform } from '../../platform/platform';
import { drawMapImage } from './minimap';
import { CollectionView } from './collection';
import { openTouchEditor } from './touchEditor';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const MODE_INFO: { id: ModeId; name: string; desc: string; tag?: [string, string] }[] = [
  { id: 'casual', name: 'Обычный матч', desc: 'Закладка бомбы 5×5 без влияния на рейтинг. Быстрый запуск.', tag: ['боты', 'ai'] },
  { id: 'competitive', name: 'Соревновательный', desc: 'Рейтинговый матч 5×5: экономика, смена сторон, MMR и ранги.', tag: ['Рейтинг', 'ranked'] },
  { id: 'proleague', name: 'PRO League', desc: 'Отдельная лига с ELO, уровнями 1–10 и сезонами.', tag: ['ELO', 'pro'] },
  { id: 'wingman', name: 'Напарники 2×2', desc: 'Короткие раунды на одной точке, отдельный рейтинг.', tag: ['Рейтинг', 'ranked'] },
  { id: 'armsrace', name: 'Гонка вооружений', desc: 'Каждое убийство — новое оружие. Финал — золотой нож.' },
  { id: 'deathmatch', name: 'Бой насмерть', desc: 'Каждый сам за себя, мгновенное возрождение, выбор оружия.' },
  { id: 'tdm', name: 'Командный бой', desc: 'Команды 5×5 с возрождением до 60 убийств.' },
  { id: 'training', name: 'Тренировка', desc: 'Стрельбище, движущиеся мишени, реакция, отдача, гранаты.' },
];

export class MainMenu {
  readonly root: HTMLDivElement;
  private nav: HTMLDivElement;
  private content: HTMLDivElement;
  private section = 'home';
  private queueTimer = 0;

  constructor(private app: App) {
    this.nav = h('div', { class: 'nav' });
    this.content = h('div', { class: 'content' });
    this.root = h('div', { class: 'menu' }, this.nav, this.content);
  }

  show(section?: string): void {
    if (section) this.section = section;
    clearInterval(this.queueTimer);
    this.renderNav();
    this.renderSection();
    // first launch: ask for a name once
    if (!this.app.profile.nameSet && !this.root.querySelector('.modal-back')) this.askName(true);
  }

  private go(s: string): void { sfx.ui_click(); this.show(s); }

  private renderNav(): void {
    const p = this.app.profile;
    const item = (id: string, label: string, cls = '') => h('button', { class: `${this.section === id ? 'active' : ''} ${cls}`, onclick: () => this.go(id), onmouseenter: () => sfx.ui_hover() }, label);
    const comp = p.competitive;
    const rank = comp.calibrationLeft > 0 ? null : rankProgress(comp.visible, ranksFor(p)).rank;
    clear(this.nav).append(
      h('div', { class: 'logo' }, h('b', {}, 'STRIKE'), 'ZONE', h('small', {}, 'ТАКТИЧЕСКИЙ ШУТЕР'), h('small', { style: 'margin-top:2px;letter-spacing:1px' }, `версия ${APP_VERSION}`), h('span', { class: 'age-mark', title: 'Возрастное ограничение' }, '16+')),
      item('home', '▶  Играть'),
      item('competitive', '★  Соревновательный'),
      item('proleague', '◆  PRO League', 'pro'),
      item('wingman', '⚔  Напарники'),
      item('armsrace', '⇪  Гонка вооружений'),
      item('deathmatch', '✖  Бой насмерть'),
      item('tdm', '⚑  Командный бой'),
      item('training', '◎  Тренировка'),
      item('custom', '⚙  Свой матч'),
      item('spectate', '👁  Наблюдение за ботами'),
      item('help', '?  Как играть'),
      h('div', { class: 'sep' }),
      item('maps', '▦  Карты'),
      item('collection', '⌖  Коллекция оружия'),
      item('profile', '☺  Профиль'),
      item('stats', '▤  Статистика'),
      item('history', '☰  История матчей'),
      item('challenges', '✓  Испытания'),
      item('settings', '⚒  Настройки'),
      h('div', { class: 'profile-chip' },
        rank ? svg(rankEmblemSvg(rank, 34)) : h('span', { class: 'pill' }, `${comp.calibrationLeft}`),
        h('div', {}, h('b', {}, p.name, ' ', h('button', { class: 'link-btn', title: 'Изменить имя', onclick: () => this.askName(false) }, '✎')), h('div', { style: 'color:var(--muted)' }, `Уровень ${p.level} · ${rank ? rank.name : 'калибровка'}`)),
      ),
    );
  }

  private renderSection(): void {
    const c = clear(this.content);
    switch (this.section) {
      case 'home': return this.home(c);
      case 'competitive': return this.ranked(c, 'competitive');
      case 'wingman': return this.ranked(c, 'wingman');
      case 'proleague': return this.pro(c);
      case 'armsrace': return this.simpleMode(c, 'armsrace');
      case 'deathmatch': return this.simpleMode(c, 'deathmatch');
      case 'tdm': return this.simpleMode(c, 'tdm');
      case 'training': return this.training(c);
      case 'custom': return this.custom(c);
      case 'spectate': return this.spectateMenu(c);
      case 'help': return this.help(c);
      case 'maps': return this.maps(c);
      case 'collection': { const v = new CollectionView(); c.append(v.root); return; }
      case 'profile': return this.profileView(c);
      case 'stats': return this.stats(c);
      case 'history': return this.history(c);
      case 'challenges': return this.challenges(c);
      case 'settings': return this.settings(c);
    }
  }

  private start(o: StartOptions): void {
    sfx.ui_click();
    const cd = this.app.cooldown(o.mode);
    if (cd > 0) { alertBox(this.root, 'Поиск недоступен', `После выхода из матча действует ограничение: ${fmtTime(cd / 1000)}.`); return; }
    this.app.start(o);
  }

  // ---------------------------------------------------------------------------

  private home(c: HTMLElement): void {
    add(c, 
      h('h1', {}, 'Играть'),
      h('p', { class: 'sub' }, 'Все союзники и соперники — боты с честными правилами: одинаковая баллистика, обзор и экономика. Матчи против ботов отмечаются отдельно.'),
      h('div', { class: 'row', style: 'margin-bottom:18px' },
        h('button', { class: 'btn', onclick: () => this.start({ mode: 'casual' }) }, 'Быстрая игра'),
        h('button', { class: 'btn ghost', onclick: () => this.go('competitive') }, 'Соревновательный'),
        h('button', { class: 'btn pro', onclick: () => this.go('proleague') }, 'PRO League'),
      ),
      h('div', { class: 'grid' }, MODE_INFO.map(m => h('div', { class: 'card click mode-card', onclick: () => (m.id === 'casual' ? this.start({ mode: 'casual' }) : this.go(m.id)) },
        m.tag ? h('span', { class: `tag ${m.tag[1]}` }, m.tag[0]) : null,
        h('h3', {}, m.name), h('p', {}, m.desc)))),
      this.challengeStrip(),
    );
  }

  private challengeStrip(): HTMLElement {
    const list = this.app.profile.challenges.list;
    return h('div', {}, h('h2', {}, 'Еженедельные испытания'),
      h('div', { class: 'grid' }, list.map(ch => h('div', { class: 'card' }, h('h3', { style: 'font-size:16px' }, ch.text),
        h('div', { class: 'bar', style: 'margin:8px 0' }, h('i', { style: `width:${(ch.progress / ch.goal) * 100}%` })),
        h('p', {}, ch.done ? '✓ Выполнено' : `${ch.progress} / ${ch.goal} · +${ch.xp} XP`)))));
  }

  private rankCard(track: RankedTrack, title: string): HTMLElement {
    const ranks = ranksFor(this.app.profile);
    if (track.calibrationLeft > 0) {
      return h('div', { class: 'card', style: 'max-width:520px' }, h('h3', {}, title),
        h('p', {}, `Калибровка: осталось ${track.calibrationLeft} из 10 матчей. Ранг будет показан после калибровки.`),
        h('div', { class: 'bar', style: 'margin-top:10px' }, h('i', { style: `width:${(1 - track.calibrationLeft / 10) * 100}%` })));
    }
    const pr = rankProgress(track.visible, ranks);
    return h('div', { class: 'card row', style: 'max-width:620px' },
      svg(rankEmblemSvg(pr.rank, 86)),
      h('div', { style: 'flex:1' },
        h('h3', { style: `color:${pr.rank.color}` }, pr.rank.name),
        h('p', {}, `${track.visible} очков ранга${pr.next ? ` · до «${pr.next.name}»: ${pr.next.min - track.visible}` : ' · высший ранг'}`),
        h('div', { class: 'bar', style: 'margin:8px 0' }, h('i', { style: `width:${pr.frac * 100}%;background:${pr.rank.color}` })),
        h('p', {}, `Побед ${track.wins} · поражений ${track.losses} · ничьих ${track.draws} · серия ${track.streak > 0 ? '+' + track.streak : track.streak}`)));
  }

  private mapPicker(onStart: (mapId?: string) => void, label = 'Начать'): HTMLElement {
    let selected: string | undefined;
    const cards = new Map<string, HTMLElement>();
    const root = h('div', {});
    const grid = h('div', { class: 'grid' });
    for (const d of MAP_DEFS) {
      const cv = drawMapImage(getMap(d.id), 4);
      const card = h('div', { class: 'card click map-card', onclick: () => { selected = d.id; for (const [id, el] of cards) el.classList.toggle('sel', id === d.id); sfx.ui_click(); } },
        cv, h('div', { class: 'meta' }, h('b', {}, d.name), h('br', {}), h('small', {}, d.description)));
      cards.set(d.id, card);
      grid.append(card);
    }
    const vote = () => {
      // vote between 3 random maps: you + 9 bots (bots vote randomly, transparently)
      const pool = [...MAP_DEFS].sort(() => Math.random() - 0.5).slice(0, 3);
      const box = h('div', { class: 'modal' }, h('h2', {}, 'Голосование за карту'), h('p', { class: 'sub' }, 'Выберите карту. Боты голосуют случайно, побеждает большинство (ничья — жребий).'));
      const row = h('div', { class: 'grid' });
      pool.forEach(d => row.append(h('div', { class: 'card click map-card', onclick: () => {
        const votes = new Map<string, number>(pool.map(p => [p.id, 0]));
        votes.set(d.id, 1);
        for (let i = 0; i < 9; i++) { const v = pool[Math.floor(Math.random() * 3)].id; votes.set(v, votes.get(v)! + 1); }
        const max = Math.max(...votes.values());
        const top = pool.filter(p => votes.get(p.id) === max);
        const win = top[Math.floor(Math.random() * top.length)];
        box.replaceChildren(h('h2', {}, 'Итоги голосования'), ...pool.map(p => h('p', {}, `${p.name}: ${votes.get(p.id)} гол.${p === win ? '  ✓' : ''}`)), h('button', { class: 'btn', onclick: () => { back.remove(); onStart(win.id); } }, `Играть на ${win.name}`));
      } }, drawMapImage(getMap(d.id), 4), h('div', { class: 'meta' }, h('b', {}, d.name)))));
      box.append(row);
      const back = h('div', { class: 'modal-back', onclick: (e: Event) => { if (e.target === back) back.remove(); } }, box);
      this.root.append(back);
    };
    root.append(
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('button', { class: 'btn', onclick: () => onStart(selected) }, label),
        h('button', { class: 'btn ghost', onclick: () => onStart(undefined) }, 'Случайная карта'),
        h('button', { class: 'btn ghost', onclick: vote }, 'Голосование'),
        h('span', { class: 'sub', style: 'margin:0' }, 'Выберите карту ниже или оставьте случайную'),
      ),
      grid,
    );
    return root;
  }

  private ranked(c: HTMLElement, mode: 'competitive' | 'wingman'): void {
    const p = this.app.profile;
    const track = mode === 'competitive' ? p.competitive : p.wingman;
    const cd = this.app.cooldown(mode);
    add(c, 
      h('h1', {}, mode === 'competitive' ? 'Соревновательный режим' : 'Напарники 2×2'),
      h('p', { class: 'sub' }, mode === 'competitive'
        ? 'Атака и защита, экономика, смена сторон в середине матча, MVP. Сила ботов подбирается по вашему скрытому MMR и плавно меняется от матча к матчу.'
        : 'Два на два на одной точке (A). Отдельный рейтинг и ранг.'),
      this.rankCard(track, mode === 'competitive' ? 'Ваш ранг' : 'Ранг напарников'),
      cd > 0 ? h('div', { class: 'warn' }, `Ограничение поиска за выход из матча: ${fmtTime(cd / 1000)}`) : null,
      mode === 'competitive' ? h('div', { class: 'row', style: 'margin:14px 0' },
        h('label', {}, h('input', { type: 'checkbox', checked: p.settings.shortCompetitive, onchange: (e: Event) => { p.settings.shortCompetitive = (e.target as HTMLInputElement).checked; this.app.save(); } }), ' Короткий формат (до 9 побед, MR8)')) : null,
      h('div', { class: 'note' }, 'Рейтинг меняется по фактическому результату матча: победа всегда повышает, поражение всегда понижает. Личная статистика влияет только на величину изменения.'),
      h('h2', {}, 'Карта'),
      this.mapPicker(mapId => this.start({ mode, mapId }), 'Найти матч'),
    );
  }

  private simpleMode(c: HTMLElement, mode: 'armsrace' | 'deathmatch' | 'tdm'): void {
    const info = MODE_INFO.find(m => m.id === mode)!;
    add(c, h('h1', {}, info.name), h('p', { class: 'sub' }, info.desc));
    if (mode === 'armsrace') {
      add(c, h('div', { class: 'card', style: 'margin-bottom:14px' }, h('h3', {}, 'Последовательность оружия'),
        h('p', {}, ARMS_RACE_DEFAULT.map((w, i) => `${i + 1}. ${WEAPONS[w].name}`).join(' → ')),
        h('p', { style: 'margin-top:6px' }, 'Убийство ножом понижает соперника на уровень. Прогресс сохраняется после смерти. Изменить список можно в «Свой матч».')));
    }
    if (mode === 'deathmatch') c.append(h('div', { class: 'note' }, 'Оружие выбирается в магазине (B) в любой момент — бесплатно. Очки: 10 за убийство, +5 за попадание в голову.'));
    add(c, h('h2', {}, 'Карта'), this.mapPicker(mapId => this.start({ mode, mapId })));
  }

  private training(c: HTMLElement): void {
    const s: TrainingSettings = { ...DEFAULT_TRAINING };
    const scen: [TrainingSettings['scenario'], string, string][] = [
      ['static', 'Стрельбище', 'Неподвижные манекены на выбранной дистанции'],
      ['moving', 'Движущиеся цели', 'Мишени двигаются с заданной скоростью и направлением'],
      ['reaction', 'Реакция', 'Мишени появляются в случайный момент — измеряется время реакции'],
      ['recoil', 'Отдача', 'Стена для изучения разброса и паттерна отдачи'],
      ['grenades', 'Гранаты', 'Бесконечные гранаты и площадка для бросков'],
    ];
    const cards = h('div', { class: 'grid' });
    const renderCards = () => cards.replaceChildren(...scen.map(([id, n, d]) => h('div', { class: `card click${s.scenario === id ? ' sel' : ''}`, onclick: () => { s.scenario = id; renderCards(); } }, h('h3', {}, n), h('p', {}, d))));
    renderCards();
    const num = (label: string, key: 'distance' | 'speed' | 'count', min: number, max: number, step: number, unit: string) => {
      const out = h('span', {}, `${s[key]} ${unit}`);
      return [h('label', {}, label), h('div', { class: 'row' }, h('input', { type: 'range', min, max, step, value: s[key], oninput: (e: Event) => { s[key] = +(e.target as HTMLInputElement).value; out.textContent = `${s[key]} ${unit}`; } }), out)];
    };
    add(c, 
      h('h1', {}, 'Тренировка'), h('p', { class: 'sub' }, 'Полигон с мишенями, статистикой точности и временем реакции. Пополнение боеприпасов бесконечное, оружие — в магазине (B).'),
      cards,
      h('h2', {}, 'Параметры'),
      h('div', { class: 'form' },
        ...num('Дистанция', 'distance', 5, 48, 1, 'м'),
        ...num('Скорость целей', 'speed', 0.5, 7, 0.5, 'м/с'),
        ...num('Количество целей', 'count', 1, 8, 1, ''),
        h('label', {}, 'Направление движения'),
        h('select', { onchange: (e: Event) => { s.axis = (e.target as HTMLSelectElement).value as 'x' | 'z'; } }, h('option', { value: 'x' }, 'Влево-вправо'), h('option', { value: 'z' }, 'Вперёд-назад')),
        h('label', {}, 'Броня у целей'),
        h('input', { type: 'checkbox', onchange: (e: Event) => { s.armor = (e.target as HTMLInputElement).checked; } }),
      ),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn', onclick: () => this.start({ mode: 'training', training: s }) }, 'Начать тренировку')),
    );
  }

  private custom(c: HTMLElement): void {
    const st = { mode: 'casual' as ModeId, mapId: '' as string, ally: 3, enemy: 3, team: 5, short: true, ladder: [...ARMS_RACE_DEFAULT], stages: ARMS_RACE_DEFAULT.length, time: 8, ffaCount: 8 };
    const body = h('div', {});
    const render = () => {
      const isAR = st.mode === 'armsrace';
      const ladderEl = h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', {}, 'Этапы гонки вооружений'),
        h('div', { class: 'row' }, h('label', {}, 'Количество этапов'), h('input', { type: 'number', min: 2, max: ARMS_RACE_DEFAULT.length, value: st.stages, onchange: (e: Event) => { st.stages = Math.max(2, Math.min(ARMS_RACE_DEFAULT.length, +(e.target as HTMLInputElement).value)); render(); } })),
        h('div', {}, st.ladder.slice(0, st.stages - 1).map((w, i) => h('div', { class: 'row', style: 'margin:4px 0' }, h('span', { style: 'width:30px' }, `${i + 1}.`),
          h('select', { onchange: (e: Event) => { st.ladder[i] = (e.target as HTMLSelectElement).value; } }, [...RIFLES, ...SMGS, ...SNIPERS, ...HEAVY, ...PISTOLS].map(id => h('option', { value: id, selected: id === w }, WEAPONS[id].name)))))),
        h('p', {}, `${st.stages}. Золотой нож (финал)`));
      const lvl = (label: string, key: 'ally' | 'enemy') => [h('label', {}, label), h('select', { onchange: (e: Event) => { st[key] = +(e.target as HTMLSelectElement).value; } }, DIFFICULTY_NAMES.map((n, i) => h('option', { value: i + 1, selected: st[key] === i + 1 }, `${i + 1}. ${n}`)))];
      clear(body);
      add(body,
        h('div', { class: 'form' },
          h('label', {}, 'Режим'),
          h('select', { onchange: (e: Event) => { st.mode = (e.target as HTMLSelectElement).value as ModeId; if (st.mode === 'wingman') st.team = 2; render(); } },
            (['casual', 'competitive', 'wingman', 'deathmatch', 'tdm', 'armsrace'] as ModeId[]).map(m => h('option', { value: m, selected: st.mode === m }, MODE_INFO.find(x => x.id === m)!.name + (m === 'competitive' || m === 'wingman' ? ' (без рейтинга)' : '')))),
          h('label', {}, 'Карта'),
          h('select', { onchange: (e: Event) => { st.mapId = (e.target as HTMLSelectElement).value; } }, h('option', { value: '' }, 'Случайная'), MAP_DEFS.map(d => h('option', { value: d.id, selected: st.mapId === d.id }, d.name))),
          ...(st.mode === 'deathmatch' ? [h('label', {}, 'Игроков'), h('input', { type: 'number', min: 2, max: 12, value: st.ffaCount, onchange: (e: Event) => { st.ffaCount = +(e.target as HTMLInputElement).value; } })]
            : [h('label', {}, 'Размер команды'), h('input', { type: 'number', min: 1, max: 5, value: st.team, onchange: (e: Event) => { st.team = Math.max(1, Math.min(5, +(e.target as HTMLInputElement).value)); } }),
               ...lvl('Сложность союзников', 'ally')]),
          ...lvl('Сложность соперников', 'enemy'),
          ...(['deathmatch', 'tdm', 'armsrace'].includes(st.mode) ? [h('label', {}, 'Лимит времени, мин'), h('input', { type: 'number', min: 2, max: 30, value: st.time, onchange: (e: Event) => { st.time = +(e.target as HTMLInputElement).value; } })] : []),
          ...(st.mode === 'competitive' ? [h('label', {}, 'Короткий формат'), h('input', { type: 'checkbox', checked: st.short, onchange: (e: Event) => { st.short = (e.target as HTMLInputElement).checked; } })] : []),
        ),
        isAR ? ladderEl : null,
        h('div', { class: 'note' }, 'Пользовательские матчи не влияют на рейтинг и PRO League.'),
        h('button', { class: 'btn', style: 'margin-top:12px', onclick: () => {
          const o: StartOptions = {
            mode: st.mode, mapId: st.mapId || undefined,
            custom: { allyLevel: st.ally, enemyLevel: st.enemy, teamSize: st.team, short: st.short, ffaCount: st.ffaCount, timeLimit: st.time * 60,
              armsRace: isAR ? { ladder: [...st.ladder.slice(0, st.stages - 1), 'goldknife'], timeLimit: st.time * 60 } : undefined },
          };
          this.app.start(o);
        } }, 'Создать матч'),
      );
    };
    render();
    add(c, h('h1', {}, 'Пользовательский матч'), h('p', { class: 'sub' }, 'Любой режим, карта, размер команд и сложность ботов.'), body);
  }

  private spectateMenu(c: HTMLElement): void {
    const st: SpectateOptions = { mode: 'competitive', mapId: undefined, ctCount: 5, tCount: 5, ctLevel: 4, tLevel: 4, short: true, ffaCount: 8, ffaLevel: 4 };
    const body = h('div', {});
    const num = (label: string, key: 'ctCount' | 'tCount' | 'ffaCount', min: number, max: number) => [h('label', {}, label),
      h('input', { type: 'number', min, max, value: st[key], onchange: (e: Event) => { st[key] = Math.max(min, Math.min(max, +(e.target as HTMLInputElement).value)); } })];
    const lvl = (label: string, key: 'ctLevel' | 'tLevel' | 'ffaLevel') => [h('label', {}, label),
      h('select', { onchange: (e: Event) => { st[key] = +(e.target as HTMLSelectElement).value; } }, DIFFICULTY_NAMES.map((n, i) => h('option', { value: i + 1, selected: st[key] === i + 1 }, `${i + 1}. ${n}`)))];
    const render = () => {
      const ffa = st.mode === 'deathmatch';
      clear(body);
      add(body,
        h('div', { class: 'form' },
          h('label', {}, 'Режим'),
          h('select', { onchange: (e: Event) => { st.mode = (e.target as HTMLSelectElement).value as ModeId; if (st.mode === 'wingman') { st.ctCount = 2; st.tCount = 2; } render(); } },
            (['competitive', 'casual', 'wingman', 'tdm', 'deathmatch'] as ModeId[]).map(m => h('option', { value: m, selected: st.mode === m }, MODE_INFO.find(x => x.id === m)!.name))),
          h('label', {}, 'Карта'),
          h('select', { onchange: (e: Event) => { st.mapId = (e.target as HTMLSelectElement).value || undefined; } }, h('option', { value: '' }, 'Случайная'), MAP_DEFS.map(d => h('option', { value: d.id, selected: st.mapId === d.id }, d.name))),
          ...(ffa ? [...num('Ботов', 'ffaCount', 2, 12), ...lvl('Сложность', 'ffaLevel')]
            : [...num('Спецназ: ботов', 'ctCount', 1, 5), ...lvl('Спецназ: сложность', 'ctLevel'), ...num('Атака: ботов', 'tCount', 1, 5), ...lvl('Атака: сложность', 'tLevel')]),
          ...(st.mode === 'competitive' ? [h('label', {}, 'Короткий формат'), h('input', { type: 'checkbox', checked: st.short, onchange: (e: Event) => { st.short = (e.target as HTMLInputElement).checked; } })] : []),
        ),
        h('div', { class: 'note' }, 'Вы только смотрите: в матче играют одни боты. Камеры: авто (следит за самым интересным), за бойцом, глазами бойца, обзор карты. Список всех бойцов — нажмите, чтобы следить за любым; противники видны сквозь стены (X). Над бойцами видно, что они делают: обход в тыл, лёркер, роумер, выход вперёд и т. д. После смены сторон команды меняются ролями.'),
        h('button', { class: 'btn', style: 'margin-top:12px', onclick: () => this.app.spectate({ ...st }) }, 'Смотреть матч'),
      );
    };
    render();
    add(c, h('h1', {}, 'Наблюдение за ботами'), h('p', { class: 'sub' }, 'Выберите карту, количество и сложность ботов — и смотрите, как они играют.'), body);
  }

  private help(c: HTMLElement): void {
    const li = (t: string) => h('li', {}, t);
    add(c, h('h1', {}, 'Как играть'),
      h('p', { class: 'sub' }, 'Командный тактический шутер против ботов. Атака закладывает бомбу на точку A или B, защита не даёт это сделать или обезвреживает бомбу. Раунд выигрывает команда, выполнившая свою задачу или устранившая соперников.'),
      h('h2', {}, 'Управление на компьютере'),
      h('ul', {}, ['W A S D — движение, Пробел — прыжок, Ctrl — присесть, Shift — тихий шаг', 'Мышь — обзор, ЛКМ — выстрел, ПКМ — прицел снайперской винтовки / сильный удар ножом', 'R — перезарядка, 1–5 и колесо мыши — выбор оружия, G — граната, Q — выбросить оружие',
        'E — подобрать оружие, разминировать бомбу', 'B — магазин оружия (в начале раунда), Tab — таблица счёта, Esc — пауза и настройки', 'Клавиши можно переназначить: Настройки → Управление'].map(li)),
      h('h2', {}, 'Управление на телефоне'),
      h('ul', {}, ['Левая половина экрана — джойстик движения, правая — обзор', 'Кнопки огня, прицела, прыжка, приседа, перезарядки, гранат и магазина — на экране',
        'Расположение и размер кнопок: Настройки → «Редактор сенсорных кнопок» или Пауза в матче'].map(li)),
      h('h2', {}, 'Режимы'),
      h('ul', {}, ['Соревновательный и PRO League — рейтинговые матчи с рангами и ELO', 'Обычный и Напарники (2×2) — без рейтинга', 'Бой насмерть, Командный бой, Гонка вооружений — бой с возрождением',
        'Тренировка — стрельбище, движущиеся цели, тест реакции, отдача и гранаты', 'Свой матч — любой режим, карта и сложность; Наблюдение — смотреть, как играют боты'].map(li)),
      h('p', { class: 'note' }, 'Все соперники и союзники — компьютерные боты. Чувствительность, графика и звук — в разделе «Настройки».'));
  }

  /** Ask for the player's name (first launch, or from the home screen). */
  askName(first: boolean): void {
    const p = this.app.profile;
    const input: HTMLInputElement = h('input', { type: 'text', value: first ? '' : p.name, maxlength: NAME_MAX, placeholder: 'Ваше имя' });
    const err = h('p', { class: 'sub', style: 'color:#ff8a7a;min-height:1.2em' });
    const close = () => { m.remove(); this.show(this.section); };
    const save = () => {
      const v = validateName(input.value);
      if (!v.ok) { err.textContent = v.error; return; }
      p.name = v.name; p.nameSet = true; this.app.save(); close();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); e.stopPropagation(); });
    const m = h('div', { class: 'modal-back' }, h('div', { class: 'modal' },
      h('h2', {}, first ? 'Как вас называть?' : 'Изменить имя'),
      h('p', { class: 'sub' }, `Имя видно в таблицах и на экране матча. ${NAME_MAX} символов максимум, только буквы, цифры, пробел, _ и -.`),
      input, err,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: save }, 'Сохранить'),
        h('button', { class: 'btn ghost', onclick: () => { if (first) { p.nameSet = true; this.app.save(); } close(); } }, first ? 'Пропустить' : 'Отмена'))));
    this.root.append(m);
    setTimeout(() => input.focus(), 50);
  }

  /** In-game confirmation (native confirm() dialogs can be blocked inside the platform iframe). */
  private confirmReset(): void {
    const m = h('div', { class: 'modal-back' }, h('div', { class: 'modal' },
      h('h2', {}, 'Сбросить весь прогресс?'),
      h('p', { class: 'sub' }, 'Ранги, PRO League, статистика, история и настройки будут удалены. Это нельзя отменить.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn danger', onclick: () => { m.remove(); this.app.resetProgress(); } }, 'Сбросить'),
        h('button', { class: 'btn ghost', onclick: () => m.remove() }, 'Отмена'))));
    this.root.append(m);
  }

  private maps(c: HTMLElement): void {
    add(c, h('h1', {}, 'Карты'), h('p', { class: 'sub' }, 'Оригинальные карты для режима закладки бомбы.'),
      h('div', { class: 'grid' }, MAP_DEFS.map(d => h('div', { class: 'card map-card' }, drawMapImage(getMap(d.id), 4),
        h('div', { class: 'meta' }, h('b', {}, d.name), h('p', {}, d.description),
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { class: 'btn ghost', onclick: () => this.start({ mode: 'casual', mapId: d.id }) }, 'Обычный'),
            h('button', { class: 'btn ghost', onclick: () => this.start({ mode: 'deathmatch', mapId: d.id }) }, 'DM')))))));
  }

  // ---------------------------------------------------------------------------
  // PRO League

  private pro(c: HTMLElement): void {
    const p = this.app.profile;
    const st = p.pro;
    const prog = proLevelProgress(st.elo, st.levels);
    const ban = this.app.cooldown('proleague');
    const daysLeft = Math.max(0, Math.ceil((seasonEnds(st.season) - Date.now()) / 86400000));
    const tabs = h('div', { class: 'tabs' });
    const body = h('div', {});
    let tab = 'hub';
    const renderTabs = () => tabs.replaceChildren(...([['hub', 'Обзор'], ['leaderboard', 'Таблица лидеров'], ['history', 'История'], ['rules', 'Правила']] as const).map(([id, n]) => h('button', { class: tab === id ? 'active' : '', onclick: () => { tab = id; renderTabs(); renderBody(); } }, n)));
    const renderBody = () => {
      clear(body);
      if (tab === 'hub') {
        add(body, 
          h('div', { class: 'card row', style: 'max-width:720px;border-color:var(--accent2)' },
            svg(proLevelBadgeSvg(prog.level, 86)),
            h('div', { style: 'flex:1' },
              h('h3', { style: `color:${prog.level.color}` }, `Level ${prog.level.level} — ${prog.level.name}`),
              h('p', {}, st.calibrationLeft > 0 ? `Калибровка: ${PRO_CALIBRATION - st.calibrationLeft}/${PRO_CALIBRATION} (повышенный коэффициент изменения ELO)` : `${st.elo} ELO · ${prog.toNext ? `до Level ${prog.level.level + 1}: ${prog.toNext}` : 'максимальный уровень'}`),
              h('div', { class: 'bar', style: 'margin:8px 0' }, h('i', { style: `width:${prog.frac * 100}%;background:${prog.level.color}` })),
              h('p', {}, `Сезон ${st.season} · осталось ${daysLeft} дн. · матчей ${st.matches} · побед ${st.wins} · пик ${st.peakElo} ELO`))),
          ban > 0 ? h('div', { class: 'warn' }, `Запрет поиска за выход из матча: ${fmtTime(ban / 1000)}`) : null,
          h('div', { class: 'note' }, 'Уровни 1–3: базовые боты · 4–6: опытные · 7–8: элитные · 9–10: максимально продвинутые тактические боты. Сила ботов растёт только за счёт качества решений и командной игры — без бонусов к урону, здоровью или «зрения сквозь стены». Все соперники в PRO League — боты.'),
          h('button', { class: 'btn pro', style: 'margin-top:10px', disabled: ban > 0, onclick: () => this.proQueue() }, 'Найти матч PRO League'),
        );
      } else if (tab === 'leaderboard') {
        const rows = leaderboard(st, p.name);
        add(body, h('p', { class: 'sub' }, `Сезон ${st.season}. Участники с меткой «БОТ» — боты лиги; их рейтинг меняется между вашими матчами.`),
          h('table', { class: 'tbl' }, h('tr', {}, ['#', 'Участник', 'Level', 'ELO', 'Матчи', 'Винрейт'].map(t => h('th', {}, t))),
            rows.slice(0, 60).map((r, i) => h('tr', { class: r.isYou ? 'me' : '', style: 'cursor:pointer', onclick: () => r.isAI && this.proProfile(r.id) },
              h('td', {}, i + 1), h('td', { html: `${escapeHtml(r.name)}${r.isAI ? '<span class="badge-bot">БОТ</span>' : ' (вы)'}` }), h('td', {}, r.level), h('td', {}, r.elo), h('td', {}, r.matches), h('td', {}, pct(r.winrate, 1))))));
        if (st.calibrationLeft > 0) body.append(h('p', { class: 'sub' }, 'Вы появитесь в таблице после калибровки.'));
      } else if (tab === 'history') {
        add(body, st.history.length ? h('table', { class: 'tbl' }, h('tr', {}, ['Дата', 'Карта', 'Счёт', 'K/D', 'Рейтинг', 'ELO'].map(t => h('th', {}, t))),
          st.history.map(m => h('tr', {}, h('td', {}, new Date(m.time).toLocaleString()), h('td', {}, getMap(m.map).def.name), h('td', {}, `${m.score[0]}:${m.score[1]}${m.left ? ' (выход)' : ''}`),
            h('td', {}, `${m.kills}/${m.deaths}`), h('td', {}, m.rating.toFixed(2)),
            h('td', {}, h('span', { class: `pill ${m.eloAfter >= m.eloBefore ? 'good' : 'bad'}` }, `${m.eloAfter >= m.eloBefore ? '+' : ''}${m.eloAfter - m.eloBefore}`))))) : h('p', { class: 'sub' }, 'Матчей пока нет.'));
      } else {
        add(body, h('div', { class: 'card' }, h('h3', {}, 'Правила PRO League'), h('ul', {},
          h('li', {}, 'Отдельный ELO, независимый от соревновательного MMR. Калибровка — 5 матчей с увеличенным коэффициентом K=50, далее K=32.'),
          h('li', {}, 'ELO зависит только от исхода: победа всегда повышает (минимум +5), поражение всегда понижает (минимум −5). Ничьих нет — при равенстве играется овертайм MR3.'),
          h('li', {}, 'Подбор строже: соперники в пределах ±50 ELO, окно поиска расширяется медленно.'),
          h('li', {}, `Выход из матча: поражение, дополнительный штраф 50 ELO и растущий запрет поиска (15/30/60… мин).`),
          h('li', {}, 'Сезон длится 8 недель. Пик сезона и статистика сохраняются отдельно.'),
          h('li', {}, 'Статистика PRO League ведётся отдельно и помечается как «против ботов».'),
        )));
      }
    };
    renderTabs(); renderBody();
    add(c, h('h1', { style: 'color:var(--accent2)' }, 'PRO League'), h('p', { class: 'sub' }, 'Независимая соревновательная лига с ELO и уровнями мастерства.'), tabs, body);
  }

  private proProfile(id: string): void {
    const pp = this.app.profile.pro.league.find(x => x.id === id);
    if (!pp) return;
    const l = proLevelProgress(pp.elo, this.app.profile.pro.levels).level;
    const back = h('div', { class: 'modal-back', onclick: (e: Event) => { if (e.target === back) back.remove(); } }, h('div', { class: 'modal' },
      h('div', { class: 'row' }, svg(proLevelBadgeSvg(l, 60)), h('div', {}, h('h2', { style: 'margin:0' }, pp.name, h('span', { class: 'badge-bot' }, 'бот лиги')), h('p', { class: 'sub', style: 'margin:0' }, `Level ${l.level} · ${pp.elo} ELO`))),
      h('div', { class: 'grid', style: 'margin-top:14px' },
        h('div', { class: 'stat' }, h('b', {}, pp.matches), h('span', {}, 'матчей')),
        h('div', { class: 'stat' }, h('b', {}, pct(pp.wins, pp.matches)), h('span', {}, 'побед')),
        h('div', { class: 'stat' }, h('b', {}, pp.kd.toFixed(2)), h('span', {}, 'K/D')),
        h('div', { class: 'stat' }, h('b', {}, `${pp.hs}%`), h('span', {}, 'в голову')),
        h('div', { class: 'stat' }, h('b', {}, getMap(pp.favMap).def.name), h('span', {}, 'любимая карта'))),
      h('p', { class: 'note' }, 'Это бот лиги. Его статистика смоделирована и не принадлежит реальному человеку.'),
      h('button', { class: 'btn ghost', onclick: () => back.remove() }, 'Закрыть')));
    this.root.append(back);
  }

  private proQueue(): void {
    sfx.ui_click();
    const elo = this.app.profile.pro.elo;
    const t0 = Date.now();
    const found = 3000 + Math.random() * 4000;
    const status = h('p', { class: 'sub' }, '');
    const box = h('div', { class: 'modal queue-box' }, h('h2', {}, 'Поиск матча PRO League'), h('div', { class: 'spinner' }), status,
      h('button', { class: 'btn ghost', onclick: () => { clearInterval(this.queueTimer); back.remove(); } }, 'Отменить'));
    const back = h('div', { class: 'modal-back' }, box);
    this.root.append(back);
    const tick = () => {
      const sec = (Date.now() - t0) / 1000;
      const w = searchWindow(sec);
      status.textContent = `${fmtTime(sec)} · подбор соперников в диапазоне ${elo - w}–${elo + w} ELO · состав заполняется ботами`;
      if (Date.now() - t0 > found) {
        clearInterval(this.queueTimer);
        // accept dialog with veto (ban two maps, random from the rest)
        const pool = [...MAP_DEFS].sort(() => Math.random() - 0.5).slice(0, 5);
        const banned = new Set<string>();
        const renderVeto = () => {
          box.replaceChildren(h('h2', {}, 'Матч найден'), h('p', { class: 'sub' }, `Исключите ${2 - banned.size} карт(ы). Соперники — боты.`),
            h('div', { class: 'grid' }, pool.map(d => h('div', { class: `card click map-card${banned.has(d.id) ? ' sel' : ''}`, style: banned.has(d.id) ? 'opacity:.35' : '', onclick: () => {
              if (banned.has(d.id)) return;
              banned.add(d.id);
              // the opponent (AI captain) bans one map after yours
              const rest = pool.filter(x => !banned.has(x.id));
              if (banned.size === 1 && rest.length > 1) banned.add(rest[Math.floor(Math.random() * rest.length)].id);
              if (banned.size >= 2 || pool.length - banned.size <= 2) {
                const left = pool.filter(x => !banned.has(x.id));
                const pick = left[Math.floor(Math.random() * left.length)];
                back.remove();
                this.app.start({ mode: 'proleague', mapId: pick.id });
                return;
              }
              renderVeto();
            } }, drawMapImage(getMap(d.id), 3), h('div', { class: 'meta' }, h('b', {}, d.name), banned.has(d.id) ? ' — исключена' : '')))));
        };
        renderVeto();
      }
    };
    tick();
    this.queueTimer = window.setInterval(tick, 250);
  }

  // ---------------------------------------------------------------------------

  private profileView(c: HTMLElement): void {
    const p = this.app.profile;
    const nameInput = h('input', { type: 'text', value: p.name, maxlength: NAME_MAX });
    const nameErr = h('span', { class: 'sub', style: 'color:#ff8a7a' });
    const ranks = ranksFor(p);
    const comp = p.competitive;
    const hist = comp.rankHistory;
    const chart = (() => {
      if (hist.length < 2) return h('p', { class: 'sub' }, 'История рангов появится после нескольких матчей.');
      const W = 600, H = 160;
      const pts = hist.map((e, i) => [(i / (hist.length - 1)) * W, H - (e.rankId / (ranks.length - 1)) * H] as const);
      return svg(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}"><polyline fill="none" stroke="#f5b83d" stroke-width="3" points="${pts.map(p2 => p2.join(',')).join(' ')}"/>${pts.map((p2, i) => `<circle cx="${p2[0]}" cy="${p2[1]}" r="4" fill="${ranks[hist[i].rankId].color}"/>`).join('')}</svg>`);
    })();
    add(c, 
      h('h1', {}, 'Профиль'),
      p.tampered ? h('div', { class: 'warn' }, 'Локальные данные профиля были изменены вне игры. Рейтинг помечен как непроверенный.') : null,
      h('div', { class: 'row' }, h('label', {}, 'Имя'), nameInput, h('button', { class: 'btn ghost', onclick: () => {
        const v = validateName(nameInput.value);
        if (!v.ok) { nameErr.textContent = v.error; return; }
        p.name = v.name; p.nameSet = true; this.app.save(); this.show('profile');
      } }, 'Сохранить'), nameErr),
      h('h2', {}, `Уровень аккаунта ${p.level}`),
      h('div', { class: 'bar', style: 'max-width:520px' }, h('i', { style: `width:${(p.xp / xpForLevel(p.level)) * 100}%` })),
      h('p', { class: 'sub' }, `${p.xp} / ${xpForLevel(p.level)} XP`),
      h('div', { class: 'grid' }, this.rankCard(p.competitive, 'Соревновательный'), this.rankCard(p.wingman, 'Напарники'),
        h('div', { class: 'card row' }, svg(proLevelBadgeSvg(proLevelProgress(p.pro.elo).level, 64)), h('div', {}, h('h3', {}, 'PRO League'), h('p', {}, `${p.pro.elo} ELO · Level ${proLevelProgress(p.pro.elo).level.level}`)))),
      h('h2', {}, 'История рангов'), chart,
      h('h2', {}, 'Все ранги'),
      h('div', { class: 'row' }, ranks.map(r => h('div', { style: 'text-align:center;width:90px' }, svg(rankEmblemSvg(r, 48)), h('div', { style: 'font-size:12px' }, r.name), h('div', { style: 'font-size:11px;color:var(--muted)' }, r.min)))),
      h('h2', {}, 'Данные'),
      h('div', { class: 'row' },
        // file downloads are not allowed on Yandex Games
        platform().id === 'yandex' ? null : h('button', { class: 'btn ghost', onclick: () => { const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'strikezone-profile.json' }); a.click(); } }, 'Экспорт профиля'),
        h('button', { class: 'btn danger', onclick: () => this.confirmReset() }, 'Сбросить прогресс')),
    );
  }

  private stats(c: HTMLElement): void {
    const p = this.app.profile;
    const tabs = h('div', { class: 'tabs' });
    const body = h('div', {});
    let tab = 'all';
    const block = (b: StatsBlock) => h('div', { class: 'grid' },
      ...([
        [b.matches, 'матчей'], [pct(b.wins, b.matches), 'винрейт'], [ratio(b.kills, b.deaths), 'K/D'], [b.rounds ? Math.round(b.damage / b.rounds) : '—', 'урон за раунд (ADR)'],
        [pct(b.shotsHit, b.shotsFired), 'точность'], [pct(b.headshots, b.kills), 'в голову'], [b.mvps, 'MVP'], [b.kills, 'убийств'], [b.assists, 'помощи'],
        [b.plants, 'установок бомбы'], [b.defuses, 'разминирований'], [b.clutches, 'клатчей'], [Math.round(b.timePlayed / 60), 'минут в игре'],
      ] as [string | number, string][]).map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l))));
    const render = () => {
      clear(body);
      if (tab === 'all') body.append(block(p.stats.all), h('h2', {}, 'Серии'), h('p', {}, `Соревновательный: ${p.competitive.streak > 0 ? 'победная серия ' + p.competitive.streak : p.competitive.streak < 0 ? 'серия поражений ' + -p.competitive.streak : '—'} · PRO League: ${p.pro.streak}`));
      if (tab === 'modes') for (const m of MODE_INFO) { const b = p.stats.byMode[m.id]; if (b) body.append(h('h2', {}, m.name), block(b)); }
      if (tab === 'maps') body.append(h('table', { class: 'tbl' }, h('tr', {}, ['Карта', 'Матчи', 'Винрейт', 'K/D', 'ADR', 'Раунды'].map(t => h('th', {}, t))),
        MAP_DEFS.map(d => { const b = p.stats.byMap[d.id] ?? emptyBlock(); return h('tr', {}, h('td', {}, d.name), h('td', {}, b.matches), h('td', {}, pct(b.wins, b.matches)), h('td', {}, ratio(b.kills, b.deaths)), h('td', {}, b.rounds ? Math.round(b.damage / b.rounds) : '—'), h('td', {}, b.rounds)); })));
      if (tab === 'weapons') {
        const rows = Object.entries(p.stats.byWeapon).sort((a, b) => b[1].kills - a[1].kills);
        add(body, rows.length ? h('table', { class: 'tbl' }, h('tr', {}, ['Оружие', 'Убийства'].map(t => h('th', {}, t))), rows.map(([w, s]) => h('tr', {}, h('td', {}, WEAPONS[w]?.name ?? w), h('td', {}, s.kills)))) : h('p', { class: 'sub' }, 'Пока нет данных.'));
      }
    };
    tabs.append(...([['all', 'Общая'], ['modes', 'По режимам'], ['maps', 'По картам'], ['weapons', 'По оружию']] as const).map(([id, n]) => h('button', { class: tab === id ? 'active' : '', onclick: (e: Event) => { tab = id; tabs.querySelectorAll('button').forEach(b => b.classList.remove('active')); (e.target as HTMLElement).classList.add('active'); render(); } }, n)));
    render();
    add(c, h('h1', {}, 'Статистика'), h('div', { class: 'note' }, 'Все матчи в этой версии сыграны против ботов; статистика помечена соответствующим образом и не смешивается с играми против людей.'), tabs, body);
  }

  private history(c: HTMLElement): void {
    const p = this.app.profile;
    const modeName = (m: string) => MODE_INFO.find(x => x.id === m)?.name ?? m;
    add(c, h('h1', {}, 'История матчей'),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, this.app.lastReplay ? h('button', { class: 'btn ghost', onclick: () => this.app.watchReplay() }, 'Посмотреть последний матч') : null),
      p.history.length ? h('table', { class: 'tbl' },
        h('tr', {}, ['Дата', 'Режим', 'Карта', 'Итог', 'Счёт', 'У/С/П', 'ADR', 'HS%', 'Рейтинг', 'Изменение'].map(t => h('th', {}, t))),
        p.history.map(m => h('tr', {},
          h('td', {}, new Date(m.time).toLocaleString()), h('td', {}, `${modeName(m.mode)} · боты`), h('td', {}, getMap(m.map).def.name),
          h('td', {}, h('span', { class: `pill ${m.outcome === 1 ? 'good' : m.outcome === 0 ? 'bad' : ''}` }, m.placement ? `#${m.placement}` : m.outcome === 1 ? 'Победа' : m.outcome === 0 ? (m.abandoned ? 'Выход' : 'Поражение') : 'Ничья')),
          h('td', {}, `${m.score[0]}:${m.score[1]}`), h('td', {}, `${m.kills}/${m.deaths}/${m.assists}`), h('td', {}, m.adr), h('td', {}, `${m.hs}%`), h('td', {}, m.rating.toFixed(2)),
          h('td', {}, m.visibleDelta !== undefined ? `${m.visibleDelta >= 0 ? '+' : ''}${m.visibleDelta} очк.` : m.eloDelta !== undefined ? `${m.eloDelta >= 0 ? '+' : ''}${m.eloDelta} ELO` : '—'),
        ))) : h('p', { class: 'sub' }, 'Сыгранных матчей пока нет.'),
      h('h2', {}, 'Журнал изменений рейтинга'),
      h('p', { class: 'sub' }, 'Записи только добавляются и не изменяются задним числом.'),
      h('table', { class: 'tbl' }, h('tr', {}, ['Дата', 'Система', 'Было', 'Стало', 'Причина'].map(t => h('th', {}, t))),
        p.ledger.slice(-30).reverse().map(l => h('tr', {}, h('td', {}, new Date(l.time).toLocaleString()), h('td', {}, { mmr: 'MMR (скрытый)', visible: 'Очки ранга', elo: 'PRO ELO', wingman: 'MMR напарников' }[l.system]), h('td', {}, Math.round(l.before)), h('td', {}, Math.round(l.after)), h('td', {}, l.reason)))),
    );
  }

  private challenges(c: HTMLElement): void {
    const p = this.app.profile;
    add(c, h('h1', {}, 'Еженедельные испытания'), h('p', { class: 'sub' }, `Неделя ${p.challenges.week}. Прогресс засчитывается по реальным результатам матчей.`), this.challengeStrip());
  }

  // ---------------------------------------------------------------------------

  private settings(c: HTMLElement): void {
    const app = this.app;
    const s = app.profile.settings;
    const save = () => { app.save(); app.applySettings(); };
    const range = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) => {
      const out = h('span', { style: 'min-width:54px' }, fmt(get()));
      return [h('label', {}, label), h('div', { class: 'row' }, h('input', { type: 'range', min, max, step, value: get(), oninput: (e: Event) => { set(+(e.target as HTMLInputElement).value); out.textContent = fmt(get()); save(); } }), out)];
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => [h('label', {}, label), h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); save(); } })];
    const select = <T extends string>(label: string, get: () => T, set: (v: T) => void, opts: [T, string][]) => [h('label', {}, label), h('select', { onchange: (e: Event) => { set((e.target as HTMLSelectElement).value as T); save(); } }, opts.map(([v, n]) => h('option', { value: v, selected: get() === v }, n)))];
    // crosshair preview
    const chPrev = h('div', { style: 'width:120px;height:120px;background:#2a3140;border-radius:10px;position:relative' });
    const drawCh = () => {
      const ch = s.crosshair;
      chPrev.replaceChildren();
      const bar = (st: string) => chPrev.append(h('i', { style: `position:absolute;background:${ch.color};${st}` }));
      const cx = 60, cy = 60, L = ch.size, T = ch.thickness, G = ch.gap;
      if (ch.style === 'dot') { bar(`left:${cx - T}px;top:${cy - T}px;width:${T * 2}px;height:${T * 2}px;border-radius:50%`); return; }
      if (ch.style !== 'cross') bar(`left:${cx - T / 2}px;top:${cy - G - L}px;width:${T}px;height:${L}px`);
      bar(`left:${cx - T / 2}px;top:${cy + G}px;width:${T}px;height:${L}px`);
      bar(`left:${cx - G - L}px;top:${cy - T / 2}px;width:${L}px;height:${T}px`);
      bar(`left:${cx + G}px;top:${cy - T / 2}px;width:${L}px;height:${T}px`);
      if (ch.dot) bar(`left:${cx - T / 2}px;top:${cy - T / 2}px;width:${T}px;height:${T}px`);
    };
    drawCh();
    // key bindings
    const labels: Record<string, string> = { forward: 'Вперёд', back: 'Назад', left: 'Влево', right: 'Вправо', jump: 'Прыжок', crouch: 'Присесть', walk: 'Тихий шаг', reload: 'Перезарядка', use: 'Взаимодействие', buy: 'Магазин', scoreboard: 'Таблица', grenade: 'Граната', inspect: 'Осмотр', drop: 'Выбросить', slot1: 'Основное', slot2: 'Пистолет', slot3: 'Нож', slot4: 'Гранаты', slot5: 'Бомба', lastWeapon: 'Прошлое оружие' };
    const binds = h('div', { class: 'form' });
    const renderBinds = () => {
      binds.replaceChildren(...Object.keys(DEFAULT_BINDINGS).flatMap(a => {
        const cap = h('span', { class: 'keycap' }, s.controls.bindings[a] ?? '—');
        cap.addEventListener('click', () => {
          cap.classList.add('wait'); cap.textContent = 'нажмите клавишу…';
          const on = (e: KeyboardEvent) => {
            e.preventDefault(); e.stopPropagation();
            if (e.code !== 'Escape') {
              // a key already used by another action: swap the two bindings instead of losing one
              const other = Object.keys(s.controls.bindings).find(k => k !== a && s.controls.bindings[k] === e.code);
              if (other) s.controls.bindings[other] = s.controls.bindings[a];
              s.controls.bindings[a] = e.code;
            }
            window.removeEventListener('keydown', on, true); save(); renderBinds();
          };
          window.addEventListener('keydown', on, true);
        });
        return [h('label', {}, labels[a] ?? a), cap];
      }));
    };
    renderBinds();
    add(c, 
      h('h1', {}, 'Настройки'),
      h('h2', {}, 'Управление'),
      h('div', { class: 'form' },
        ...select('Схема управления', () => s.controls.scheme, v => (s.controls.scheme = v), [['auto', 'Автоопределение'], ['desktop', 'Клавиатура и мышь'], ['touch', 'Сенсорная']]),
        ...range('Чувствительность мыши', () => s.sensitivity, v => (s.sensitivity = v), 0.2, 6, 0.05),
        ...check('Инверсия по вертикали', () => s.invertY, v => (s.invertY = v)),
        ...check('Приседание — переключение', () => s.controls.crouchToggle, v => (s.controls.crouchToggle = v)),
        ...check('Тихий шаг — переключение', () => s.controls.walkToggle, v => (s.controls.walkToggle = v)),
      ),
      h('h2', {}, 'Клавиши'), binds,
      h('button', { class: 'btn ghost', style: 'margin-top:8px', onclick: () => { s.controls.bindings = { ...DEFAULT_BINDINGS }; save(); renderBinds(); } }, 'Сбросить клавиши'),
      h('h2', {}, 'Сенсорное управление'),
      h('div', { class: 'form' },
        ...range('Чувствительность обзора', () => s.touch.sensitivity, v => (s.touch.sensitivity = v), 0.2, 3, 0.05),
        ...range('Прозрачность кнопок', () => s.touch.opacity, v => (s.touch.opacity = v), 0.1, 0.8, 0.05),
        ...range('Размер джойстика', () => s.touch.joystickSize, v => (s.touch.joystickSize = v), 0.6, 1.6, 0.05),
        ...range('Размер кнопки огня', () => s.touch.buttons.fire.size, v => (s.touch.buttons.fire.size = v), 0.6, 2, 0.05),
        ...range('Размер остальных кнопок', () => s.touch.buttons.jump.size, v => { for (const [k, b] of Object.entries(s.touch.buttons)) if (k !== 'fire') b.size = v; }, 0.5, 1.6, 0.05),
        ...check('Помощь в прицеливании (только вне рейтинга)', () => s.touch.aimAssist, v => (s.touch.aimAssist = v)),
      ),
      h('button', { class: 'btn', style: 'margin:6px 0', onclick: () => openTouchEditor(this.root, s, save) }, 'Редактор сенсорных кнопок'),
      h('p', { class: 'sub' }, 'Перетаскивайте кнопки, меняйте размер каждой, скрывайте ненужные. Это же можно сделать в игре: Пауза → «Настроить сенсорные кнопки».'),
      h('button', { class: 'btn ghost', onclick: () => { s.touch.buttons = JSON.parse(JSON.stringify(DEFAULT_TOUCH)); save(); } }, 'Сбросить расположение кнопок'),
      h('h2', {}, 'Графика'),
      h('div', { class: 'form' },
        ...select('Качество', () => s.graphics.quality, v => (s.graphics.quality = v), [['low', 'Низкое (телефоны)'], ['medium', 'Среднее'], ['high', 'Высокое']]),
        ...range('Яркость', () => s.graphics.brightness ?? 1, v => (s.graphics.brightness = v), 0.6, 1.8, 0.05),
        ...check('Тени', () => s.graphics.shadows, v => (s.graphics.shadows = v)),
        ...range('Масштаб рендеринга', () => s.graphics.renderScale, v => (s.graphics.renderScale = v), 0.5, 1, 0.05),
        ...range('Частицы', () => s.graphics.particles, v => (s.graphics.particles = v), 0.25, 1, 0.05),
        ...range('Поле зрения (FOV)', () => s.fov, v => (s.fov = v), 70, 110, 1, v => `${v}°`),
        ...check('Покачивание оружия', () => s.viewBob, v => (s.viewBob = v)),
        ...check('Показывать FPS', () => s.graphics.showFps, v => (s.graphics.showFps = v)),
      ),
      h('h2', {}, 'Прицел'),
      h('div', { class: 'row', style: 'align-items:flex-start;gap:24px' },
        h('div', { class: 'form', style: 'flex:1' },
          ...select('Стиль', () => s.crosshair.style, v => { s.crosshair.style = v; drawCh(); }, [['classic', 'Классический'], ['cross', 'Т-образный'], ['dot', 'Точка']]),
          h('label', {}, 'Цвет'), h('input', { type: 'color', value: s.crosshair.color, oninput: (e: Event) => { s.crosshair.color = (e.target as HTMLInputElement).value; drawCh(); save(); } }),
          ...range('Длина', () => s.crosshair.size, v => { s.crosshair.size = v; drawCh(); }, 2, 16, 1, v => String(v)),
          ...range('Зазор', () => s.crosshair.gap, v => { s.crosshair.gap = v; drawCh(); }, 0, 12, 1, v => String(v)),
          ...range('Толщина', () => s.crosshair.thickness, v => { s.crosshair.thickness = v; drawCh(); }, 1, 5, 1, v => String(v)),
          ...check('Точка в центре', () => s.crosshair.dot, v => { s.crosshair.dot = v; drawCh(); }),
          ...check('Динамический (разброс)', () => s.crosshair.dynamic, v => (s.crosshair.dynamic = v)),
        ),
        chPrev),
      h('h2', {}, 'Звук'),
      h('div', { class: 'form' },
        ...range('Общая громкость', () => s.volume.master, v => (s.volume.master = v), 0, 1, 0.05),
        ...range('Эффекты', () => s.volume.sfx, v => (s.volume.sfx = v), 0, 1, 0.05),
        ...range('Музыка', () => s.volume.music, v => (s.volume.music = v), 0, 1, 0.05),
        ...range('Интерфейс', () => s.volume.ui, v => (s.volume.ui = v), 0, 1, 0.05),
      ),
      h('h2', {}, 'Пороги рангов'),
      h('p', { class: 'sub' }, 'Минимальные очки для каждого ранга (фиксированные значения — высший ранг всегда достижим).'),
      h('div', { class: 'row' }, RANKS.map((r, i) => h('div', { style: 'display:flex;flex-direction:column;width:110px;font-size:12px' }, r.name,
        h('input', { type: 'number', value: s.rankThresholds[i] ?? r.min, onchange: (e: Event) => {
          const v = Math.max(0, +(e.target as HTMLInputElement).value);
          s.rankThresholds[i] = v;
          // keep thresholds increasing
          for (let k = 1; k < s.rankThresholds.length; k++) if (s.rankThresholds[k] <= s.rankThresholds[k - 1]) s.rankThresholds[k] = s.rankThresholds[k - 1] + 1;
          save();
        } })))),
      h('button', { class: 'btn ghost', style: 'margin-top:10px', onclick: () => { s.rankThresholds = [...DEFAULT_RANK_THRESHOLDS]; save(); this.show('settings'); } }, 'Сбросить пороги'),
    );
  }
}

function alertBox(root: HTMLElement, title: string, text: string): void {
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('h2', {}, title), h('p', {}, text), h('button', { class: 'btn', onclick: () => back.remove() }, 'OK')));
  root.append(back);
}


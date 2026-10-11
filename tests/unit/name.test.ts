import { validateName } from '../../src/meta/name';

describe('player name', () => {
  it('accepts normal names (Cyrillic, Latin, digits, space, _ and -)', () => {
    for (const n of ['Игрок', 'Тестер 007', 'Max_Power', 'Ёжик-2', 'Аня']) expect(validateName(n).ok, n).toBe(true);
  });
  it('trims and collapses spaces', () => {
    const v = validateName('  Вася   Пупкин ');
    expect(v.ok && v.name).toBe('Вася Пупкин');
  });
  it('refuses too short/long names, odd symbols and bot look-alikes', () => {
    for (const n of ['A', 'x'.repeat(17), 'name!!', '<script>', 'BOT Ivan', 'бот Петя']) expect(validateName(n).ok, n).toBe(false);
  });
  it('refuses obscene and hateful words, also with look-alike letters', () => {
    for (const n of ['хуй', 'XyЙ', 'пиздец', 'f u c k', 'Fuck123', 'сука', 'Hitler88']) expect(validateName(n).ok, n).toBe(false);
  });
});

// Player name rules: short, readable, no obscenities or hate words, can't pose as a bot.
// The name only lives in the player's own save (and the platform cloud copy of it).

export const NAME_MIN = 2;
export const NAME_MAX = 16;

// Latin look-alikes and digits commonly used to dodge filters -> Cyrillic letters
const LOOKALIKE: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
  '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '@': 'а', ё: 'е',
};

// roots of obscene / abusive / hateful words (checked on a normalised form)
const BANNED_RU = ['хуй', 'хуя', 'хуе', 'хуи', 'пизд', 'ебат', 'ебан', 'ебал', 'ебуч', 'еблан', 'выеб', 'заеб', 'уеб', 'бля', 'сука', 'суки', 'мудак', 'мудил',
  'пидор', 'пидар', 'гандон', 'залуп', 'шлюх', 'дроч', 'гитлер', 'нацист', 'игил', 'хохл', 'чурк', 'жид'];
const BANNED_EN = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'whore', 'hitler', 'nazi', 'isis', 'pussy'];

function normRu(s: string): string {
  return [...s.toLowerCase()].map(ch => LOOKALIKE[ch] ?? ch).join('').replace(/[^а-я]/g, '');
}

export function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN) return { ok: false, error: `Имя должно быть не короче ${NAME_MIN} символов` };
  if (name.length > NAME_MAX) return { ok: false, error: `Имя должно быть не длиннее ${NAME_MAX} символов` };
  if (!/^[A-Za-zА-Яа-яЁё0-9 _\-]+$/.test(name)) return { ok: false, error: 'Можно использовать буквы, цифры, пробел, _ и -' };
  if (/^(bot|бот)([\s_\-]|$)/i.test(name)) return { ok: false, error: 'Имя не может начинаться с «BOT» — так подписаны боты' };
  const lat = name.toLowerCase().replace(/[^a-z]/g, '');
  const ru = normRu(name);
  if (BANNED_EN.some(w => lat.includes(w)) || BANNED_RU.some(w => ru.includes(w))) return { ok: false, error: 'Такое имя недопустимо — выберите другое' };
  return { ok: true, name };
}

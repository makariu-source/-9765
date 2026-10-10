// Original maps inspired by the layouts of classic tactical-shooter maps.
// Orientation: row 0 = north. Elevation unit = 0.5 m. CELL = 2 m.
import { compileMap, type CompiledMap, type MapDef } from './mapgrid';

const sandstorm: MapDef = {
  id: 'sandstorm', name: 'Sandstorm', inspiredBy: 'Dust II', theme: 'desert', w: 44, h: 42, wallHeight: 7,
  description: 'Пустынный город: длинная простреливаемая улица к A, центр с дверями CT и тоннели к B.',
  paint: p => {
    // T spawn
    p.floor(15, 34, 14, 6); p.rect(17, 35, 10, 3, 't');
    p.set(15, 34, 'X'); p.set(28, 39, 'x'); p.set(16, 39, 'r');
    // CT spawn
    p.floor(17, 2, 10, 6); p.rect(18, 3, 6, 3, 'c'); p.set(26, 2, 'x');
    // A site (raised 1 m)
    p.floor(28, 2, 14, 12, 2); p.rect(30, 3, 9, 7, 'A');
    p.rect(31, 6, 2, 1, 'x'); p.rect(39, 3, 2, 1, 'X'); p.set(29, 11, 'x'); p.set(35, 12, 'o'); p.set(36, 12, 'o');
    p.set(41, 9, 'r');
    // CT -> A ramp
    p.floor(25, 3, 4, 4); p.rampX(25, 3, 4, 4, 0, 2);
    // Long A
    p.floor(36, 14, 5, 25); p.rampY(36, 14, 5, 9, 2, 0);
    p.rect(36, 31, 5, 1, '#'); p.rect(37, 31, 2, 1, 'D');
    p.set(36, 20, 'x'); p.set(40, 24, 'X'); p.set(40, 36, 'r');
    p.floor(29, 35, 7, 4); p.set(33, 35, 'x');
    // Mid + mid doors
    p.floor(19, 8, 5, 26); p.rect(19, 9, 1, 1, '#'); p.rect(23, 9, 1, 1, '#'); p.rect(20, 9, 3, 1, 'D');
    p.set(20, 25, 'x'); p.set(23, 14, 'X');
    // break the spawn-to-spawn sightline down mid
    p.rect(19, 13, 3, 1, 'X'); p.rect(22, 21, 2, 1, 'X'); p.rect(19, 30, 3, 1, 'X');
    // site entrance chokes: long corner, catwalk top, tunnel exit
    p.rect(36, 13, 3, 2, '#'); p.set(38, 10, 'X');
    p.rect(27, 14, 1, 2, '#');
    p.rect(4, 14, 2, 1, 'X'); p.set(7, 11, 'x');
    // Short A / catwalk
    p.floor(24, 18, 3, 3); p.floor(27, 14, 3, 6); p.rampY(27, 14, 3, 6, 2, 0); p.set(29, 15, 'g');
    // B site
    p.floor(2, 2, 11, 12); p.rect(3, 3, 8, 7, 'B');
    p.rect(5, 5, 2, 2, 'X'); p.set(9, 4, 'x'); p.set(3, 9, 'x'); p.rect(8, 10, 2, 1, 'x'); p.set(11, 12, 'r');
    // CT -> B (B doors)
    p.floor(12, 3, 5, 4); p.rect(14, 3, 1, 4, '#'); p.rect(14, 4, 1, 2, 'D'); p.set(16, 6, 'x');
    // Upper tunnels to B
    p.floor(5, 34, 10, 4); p.floor(4, 14, 4, 24); p.rect(4, 16, 4, 15, 'D');
    p.set(7, 33, 'x');
    // Lower tunnels: mid <-> tunnels
    p.floor(8, 26, 11, 3); p.rect(8, 26, 11, 3, 'D'); p.set(13, 28, 'x');
  },
  callouts: [
    { name: 'Длинная A', x: 36, y: 14, w: 5, h: 25 }, { name: 'Кэтвок', x: 24, y: 14, w: 6, h: 7 },
    { name: 'Центр', x: 19, y: 8, w: 5, h: 26 }, { name: 'Тоннели B', x: 4, y: 14, w: 4, h: 24 },
    { name: 'Нижние тоннели', x: 8, y: 26, w: 11, h: 3 }, { name: 'База T', x: 15, y: 34, w: 14, h: 6 },
    { name: 'База CT', x: 17, y: 2, w: 12, h: 6 }, { name: 'Двери B', x: 12, y: 3, w: 5, h: 4 },
    { name: 'Выход на длинную', x: 29, y: 35, w: 7, h: 4 },
  ],
};

const oasis: MapDef = {
  id: 'oasis', name: 'Oasis', inspiredBy: 'Mirage', theme: 'mediterranean', w: 44, h: 40, wallHeight: 7,
  description: 'Городской комплекс: дворец над рампой A, широкий центр и квартиры к B.',
  paint: p => {
    // T spawn (east)
    p.floor(36, 16, 6, 9); p.rect(37, 17, 4, 7, 't'); p.set(41, 16, 'x');
    // CT spawn (west)
    p.floor(2, 15, 6, 10); p.rect(3, 16, 4, 8, 'c');
    // A site (south-west)
    p.floor(4, 26, 14, 12); p.rect(6, 28, 9, 7, 'A');
    p.rect(9, 30, 2, 2, 'X'); p.set(13, 33, 'x'); p.set(6, 35, 'x'); p.set(16, 27, 'o'); p.set(16, 28, 'o');
    // T ramp + A ramp
    p.floor(30, 25, 12, 4); p.floor(18, 28, 16, 3); p.set(26, 29, 'x'); p.set(31, 26, 'r');
    // Palace (raised, covered)
    p.floor(38, 25, 3, 8); p.rampY(38, 25, 3, 8, 0, 4);
    p.floor(21, 33, 20, 3, 4); p.rect(21, 33, 17, 3, 'D');
    p.floor(16, 33, 5, 3); p.rampX(16, 33, 5, 3, 0, 4);
    // Mid
    p.floor(26, 18, 10, 4); p.floor(16, 17, 10, 6); p.rect(20, 19, 2, 1, 'X'); p.set(25, 17, 'x');
    p.floor(8, 19, 8, 2); p.set(12, 19, 'o');
    p.set(13, 20, 'X'); p.set(10, 19, 'X'); p.rect(29, 20, 1, 2, 'X'); p.rect(32, 18, 1, 2, 'X');
    // site chokes
    p.set(18, 28, 'X'); p.set(16, 33, 'X'); p.set(18, 4, 'X'); p.set(18, 9, 'X');
    // Connector mid -> A
    p.floor(16, 23, 3, 5); p.rect(16, 23, 3, 3, 'D');
    // Window room (raised sniper nest at CT side of mid)
    p.floor(12, 21, 3, 3, 3); p.floor(8, 21, 4, 3); p.rampX(8, 21, 4, 3, 0, 3); p.set(14, 23, 'o');
    // B apartments
    p.floor(36, 6, 4, 10); p.rect(36, 7, 4, 7, 'D');
    p.floor(18, 4, 22, 3); p.rect(24, 4, 12, 3, 'D'); p.set(30, 6, 'x');
    // B site (north-west)
    p.floor(4, 2, 14, 11); p.rect(6, 3, 9, 6, 'B'); p.rect(8, 5, 2, 1, 'X'); p.set(13, 7, 'x'); p.set(5, 10, 'x');
    // Short / catwalk to B
    p.floor(19, 9, 3, 8); p.floor(18, 9, 4, 3); p.set(21, 13, 'x');
    // CT <-> B, CT <-> A
    p.floor(4, 12, 3, 4); p.floor(3, 24, 3, 3);
  },
  callouts: [
    { name: 'Дворец', x: 16, y: 33, w: 25, h: 3 }, { name: 'Рампа A', x: 18, y: 28, w: 16, h: 3 },
    { name: 'Центр', x: 16, y: 17, w: 20, h: 6 }, { name: 'Квартиры', x: 18, y: 4, w: 22, h: 12 },
    { name: 'Коннектор', x: 16, y: 23, w: 3, h: 5 }, { name: 'Окно', x: 8, y: 21, w: 7, h: 3 },
    { name: 'Шорт B', x: 18, y: 9, w: 4, h: 8 }, { name: 'База T', x: 36, y: 16, w: 6, h: 9 }, { name: 'База CT', x: 2, y: 15, w: 6, h: 10 },
  ],
};

const villa: MapDef = {
  id: 'villa', name: 'Villa', inspiredBy: 'Inferno', theme: 'italian', w: 44, h: 44, wallHeight: 8,
  description: 'Узкие улицы, «банан» к B, квартиры и арка к A, яма под точкой.',
  paint: p => {
    p.floor(2, 34, 10, 8); p.rect(3, 36, 8, 4, 't'); p.set(11, 41, 'r');
    // Banana -> B (B raised 1.5 m)
    p.floor(4, 26, 4, 8); p.floor(5, 12, 4, 14); p.rampY(5, 12, 4, 7, 3, 0);
    p.set(5, 21, 'x'); p.set(8, 23, 'x'); p.set(6, 16, 'o'); p.set(8, 25, 'r');
    p.floor(4, 2, 15, 10, 3); p.rect(7, 3, 9, 6, 'B');
    p.rect(10, 5, 2, 2, 'X'); p.set(14, 4, 'x'); p.set(5, 9, 'x'); p.rect(17, 9, 1, 2, 'X');
    // Mid
    p.floor(12, 34, 8, 3); p.floor(18, 18, 5, 19); p.floor(19, 36, 4, 2); p.set(22, 30, 'x'); p.set(18, 24, 'x');
    p.floor(20, 9, 3, 9); p.set(20, 12, 'r');
    // CT spawn
    p.floor(21, 2, 6, 7); p.rect(22, 3, 4, 5, 'c');
    // CT <-> B (construction)
    p.floor(19, 3, 2, 3); p.rampX(17, 3, 4, 3, 3, 0); p.rect(19, 3, 2, 3, 'D');
    // A site (raised 1 m)
    p.floor(28, 8, 14, 14, 2); p.rect(31, 10, 8, 7, 'A');
    p.rect(33, 12, 2, 2, 'X'); p.set(37, 15, 'x'); p.set(30, 18, 'x'); p.set(40, 9, 'r');
    // CT -> A
    p.floor(27, 5, 4, 4); p.rampX(27, 5, 4, 4, 0, 2);
    // Short / arch: mid -> A
    p.floor(23, 19, 7, 3); p.rampX(23, 19, 7, 3, 0, 2); p.rect(24, 19, 2, 3, 'D');
    // Apartments: T -> A (raised balcony)
    p.floor(20, 38, 14, 3); p.set(26, 38, 'x');
    p.floor(30, 26, 4, 12); p.rampY(30, 26, 4, 12, 4, 0); p.rect(30, 26, 4, 12, 'D');
    p.floor(30, 20, 4, 6); p.rampY(30, 20, 4, 6, 2, 4); p.rect(30, 22, 4, 4, 'D');
    // Pit
    p.floor(36, 22, 6, 8); p.rampY(36, 21, 6, 5, 2, 0); p.set(40, 28, 'x');
    // site chokes
    p.rect(30, 21, 2, 1, 'X');
  },
  callouts: [
    { name: 'Банан', x: 4, y: 12, w: 5, h: 22 }, { name: 'Центр', x: 18, y: 9, w: 5, h: 28 },
    { name: 'Арка', x: 23, y: 19, w: 7, h: 3 }, { name: 'Квартиры', x: 30, y: 20, w: 4, h: 18 },
    { name: 'Яма', x: 36, y: 22, w: 6, h: 8 }, { name: 'Стройка', x: 17, y: 3, w: 4, h: 3 },
    { name: 'База T', x: 2, y: 34, w: 10, h: 8 }, { name: 'База CT', x: 21, y: 2, w: 6, h: 7 },
    { name: 'Нижняя улица', x: 12, y: 34, w: 22, h: 7 },
  ],
};

const reactor: MapDef = {
  id: 'reactor', name: 'Reactor', inspiredBy: 'Nuke', theme: 'industrial', w: 44, h: 40, wallHeight: 9,
  description: 'Промышленный объект: точка A в ангаре, B на нижнем уровне, вентиляция и открытый двор.',
  paint: p => {
    // Base elevation 3 m everywhere walkable; B is underground at 0.
    p.floor(36, 14, 6, 12, 6); p.rect(37, 16, 4, 8, 't');
    p.floor(28, 16, 8, 6, 6); p.set(31, 16, 'x');
    // A hangar (covered)
    p.floor(12, 12, 16, 12, 6); p.rect(12, 12, 16, 12, 'D'); p.rect(15, 14, 8, 7, 'A');
    p.rect(18, 15, 2, 2, 'X'); p.set(22, 20, 'x'); p.set(14, 22, 'x'); p.set(25, 13, 'r'); p.rect(23, 15, 1, 2, 'X'); p.set(21, 18, 'X'); p.set(20, 17, 'X');
    // Squeaky + hut doors into hangar
    p.wall(27, 12, 1, 12); p.floor(27, 16, 1, 3, 6); p.rect(27, 16, 1, 3, 'D'); p.floor(27, 20, 1, 2, 6); p.rect(27, 20, 1, 2, 'D');
    // garage door: yard -> hangar
    p.floor(19, 11, 2, 1, 6); p.rect(19, 11, 2, 1, 'D');
    // Outside yard
    p.floor(8, 2, 32, 9, 6); p.rect(16, 4, 3, 2, 'X'); p.rect(26, 6, 2, 3, 'X'); p.set(32, 3, 'x'); p.set(11, 8, 'x');
    p.floor(36, 10, 6, 4, 6);
    // CT spawn
    p.floor(2, 8, 6, 16, 6); p.rect(3, 12, 4, 6, 'c');
    p.floor(8, 13, 4, 2, 6); p.rect(8, 13, 4, 2, 'D');
    // Ramp room -> B
    p.floor(30, 22, 5, 6, 6); p.rect(30, 22, 5, 6, 'D');
    // B (underground, covered)
    p.floor(12, 28, 16, 10, 0); p.rect(12, 28, 16, 10, 'D'); p.rect(15, 30, 9, 5, 'B');
    p.floor(27, 28, 8, 4); p.rampX(27, 28, 8, 4, 0, 6); p.rect(27, 28, 8, 4, 'D');
    p.rect(18, 31, 2, 2, 'X'); p.set(23, 35, 'x'); p.set(13, 29, 'x'); p.set(26, 36, 'r');
    // Secret: CT -> B
    p.floor(4, 24, 4, 10); p.rampY(4, 24, 4, 10, 6, 0); p.rect(4, 24, 4, 10, 'D');
    p.floor(8, 32, 4, 3, 0); p.rect(8, 32, 4, 3, 'D');
    // Vent: hangar -> B (one-way drop)
    p.floor(13, 24, 1, 4); p.rampY(13, 24, 1, 4, 6, 0); p.rect(13, 24, 1, 4, 'D');
  },
  callouts: [
    { name: 'Ангар', x: 12, y: 12, w: 16, h: 12 }, { name: 'Двор', x: 8, y: 2, w: 32, h: 9 },
    { name: 'Лобби', x: 28, y: 16, w: 8, h: 6 }, { name: 'Рамп-рум', x: 26, y: 22, w: 9, h: 10 },
    { name: 'Секрет', x: 4, y: 24, w: 8, h: 11 }, { name: 'Вентиляция', x: 13, y: 24, w: 1, h: 4 },
    { name: 'База T', x: 36, y: 10, w: 6, h: 16 }, { name: 'База CT', x: 2, y: 8, w: 6, h: 16 },
  ],
};

const ruins: MapDef = {
  id: 'ruins', name: 'Ruins', inspiredBy: 'Ancient', theme: 'jungle', w: 44, h: 42, wallHeight: 7,
  description: 'Древние руины в джунглях: «пончик» к A, пещера к B и водный центр.',
  paint: p => {
    p.floor(16, 34, 12, 6); p.rect(18, 35, 8, 4, 't'); p.set(16, 34, 'v'); p.set(27, 39, 'v');
    // A main
    p.floor(4, 34, 12, 4); p.floor(4, 16, 5, 18); p.rampY(4, 16, 5, 6, 2, 0);
    p.set(8, 27, 'x'); p.set(4, 30, 'v'); p.set(6, 24, 'p');
    p.floor(2, 4, 14, 12, 2); p.rect(4, 6, 9, 7, 'A');
    p.rect(7, 8, 2, 2, 'X'); p.set(11, 11, 'x'); p.set(3, 5, 'v'); p.set(14, 14, 'p');
    // Donut (A <-> mid, covered)
    p.floor(9, 12, 10, 3); p.rampX(14, 12, 5, 3, 2, 0); p.rect(15, 12, 4, 3, 'D');
    // Mid with channel
    p.floor(19, 14, 6, 20); p.over(20, 22, 4, 6, '~'); p.set(19, 18, 'x'); p.set(24, 30, 'p');
    p.rect(19, 15, 3, 1, 'X'); p.rect(22, 24, 3, 1, 'X'); p.rect(19, 31, 3, 1, 'X');
    // site chokes
    p.rect(4, 16, 3, 1, '#'); p.rect(34, 16, 3, 1, '#');
    p.floor(20, 9, 4, 5);
    // B main
    p.floor(28, 34, 8, 4); p.floor(34, 16, 5, 22); p.set(38, 26, 'x'); p.set(34, 20, 'p'); p.set(37, 32, 'v');
    p.floor(30, 4, 12, 12); p.rect(32, 6, 8, 6, 'B'); p.rect(35, 8, 2, 1, 'X'); p.set(33, 12, 'x'); p.set(40, 5, 'v');
    // Cave (mid -> B main)
    p.floor(25, 20, 9, 3); p.rect(26, 20, 7, 3, 'D'); p.set(29, 22, 'r');
    // CT spawn
    p.floor(17, 2, 10, 7); p.rect(18, 3, 8, 4, 'c');
    p.floor(16, 4, 1, 4); p.rampX(14, 4, 4, 4, 2, 0);
    p.floor(27, 4, 3, 4);
  },
  callouts: [
    { name: 'Главный A', x: 4, y: 16, w: 5, h: 22 }, { name: 'Пончик', x: 9, y: 12, w: 10, h: 3 },
    { name: 'Центр', x: 19, y: 9, w: 6, h: 25 }, { name: 'Пещера', x: 25, y: 20, w: 9, h: 3 },
    { name: 'Главный B', x: 28, y: 16, w: 11, h: 22 }, { name: 'База T', x: 16, y: 34, w: 12, h: 6 }, { name: 'База CT', x: 17, y: 2, w: 13, h: 7 },
  ],
};

const canal: MapDef = {
  id: 'canal', name: 'Canal', inspiredBy: 'Overpass', theme: 'urban', w: 46, h: 42, wallHeight: 8,
  description: 'Городская инфраструктура: парк с точкой A, канал и «монстр» к точке B.',
  paint: p => {
    // Street level 2 m, canal at 0
    p.floor(2, 32, 10, 8, 4); p.rect(3, 34, 8, 4, 't');
    p.floor(3, 14, 5, 18, 4); p.set(7, 22, 'x'); p.set(3, 27, 'v');
    p.floor(2, 2, 14, 12, 4); p.rect(4, 4, 8, 6, 'A');
    p.rect(6, 6, 2, 2, 'X'); p.set(10, 8, 'x'); p.set(13, 11, 'v'); p.set(3, 12, 'v'); p.set(14, 3, 'r');
    // Toilets connector
    p.floor(8, 20, 8, 3, 4); p.rect(9, 20, 5, 3, 'D');
    p.floor(16, 20, 4, 3); p.rampX(14, 20, 6, 3, 4, 0);
    // Canal
    p.floor(20, 7, 4, 33); p.over(20, 11, 4, 29, '~'); p.rampY(20, 7, 4, 4, 4, 0);
    p.set(21, 16, 'x'); p.set(22, 30, 'X');
    // Underpass from T spawn
    p.floor(12, 34, 8, 3); p.rampX(12, 34, 8, 3, 4, 0); p.rect(14, 34, 5, 3, 'D');
    // Monster tunnel -> B
    p.floor(24, 18, 4, 3); p.rect(24, 18, 4, 3, 'D');
    // B site (low, pillars)
    p.floor(28, 14, 12, 10); p.rect(30, 16, 8, 6, 'B'); p.set(32, 18, 'p'); p.set(36, 18, 'p');
    p.rect(33, 20, 2, 1, 'X'); p.set(29, 15, 'x'); p.set(38, 22, 'r');
    // Water / short B
    p.floor(24, 26, 7, 2); p.floor(29, 24, 2, 2); p.set(27, 27, 'x');
    // CT spawn + road to A
    p.floor(36, 2, 8, 10, 4); p.rect(37, 3, 6, 6, 'c');
    p.floor(16, 4, 20, 3, 4); p.set(26, 4, 'x'); p.set(31, 6, 'r');
    p.floor(38, 12, 3, 4); p.rampY(38, 12, 3, 5, 4, 0);
    // site chokes
    p.rect(5, 14, 3, 1, '#');
  },
  callouts: [
    { name: 'Длинная A', x: 3, y: 14, w: 5, h: 18 }, { name: 'Туалеты', x: 8, y: 20, w: 12, h: 3 },
    { name: 'Канал', x: 20, y: 7, w: 4, h: 33 }, { name: 'Монстр', x: 24, y: 18, w: 4, h: 3 },
    { name: 'Вода', x: 24, y: 24, w: 7, h: 4 }, { name: 'Дорога', x: 16, y: 4, w: 20, h: 3 },
    { name: 'База T', x: 2, y: 32, w: 10, h: 8 }, { name: 'База CT', x: 36, y: 2, w: 8, h: 10 }, { name: 'Подземка', x: 12, y: 34, w: 8, h: 3 },
  ],
};

const skyline: MapDef = {
  id: 'skyline', name: 'Skyline', inspiredBy: 'Vertigo', theme: 'construction', w: 40, h: 40, wallHeight: 4,
  description: 'Высотная стройка: рампа на A, лестница на B и лифтовая шахта CT.',
  paint: p => {
    p.floor(14, 32, 12, 6); p.rect(16, 33, 8, 4, 't'); p.set(25, 37, 'x');
    // A ramp
    p.floor(28, 17, 5, 15); p.rampY(28, 18, 5, 10, 4, 0); p.level(28, 17, 5, 1, 4);
    p.set(32, 24, 'x'); p.set(28, 29, 'w');
    p.floor(24, 3, 14, 14, 4); p.rect(27, 5, 8, 7, 'A');
    p.rect(29, 7, 2, 2, 'X'); p.set(34, 10, 'x'); p.set(25, 14, 'x'); p.rect(36, 4, 1, 3, 'g');
    // B stairs
    p.floor(5, 15, 5, 17); p.rampY(5, 16, 5, 10, 4, 0); p.level(5, 15, 5, 1, 4);
    p.set(9, 27, 'x');
    p.floor(2, 3, 13, 12, 4); p.rect(4, 5, 8, 6, 'B'); p.rect(6, 7, 2, 1, 'X'); p.set(10, 10, 'x'); p.set(3, 12, 'p');
    p.floor(5, 32, 9, 4); p.floor(26, 32, 7, 4);
    // Mid
    p.floor(17, 10, 6, 22); p.rampY(17, 10, 6, 6, 4, 0); p.set(21, 22, 'X'); p.set(17, 27, 'x');
    p.rect(17, 18, 3, 1, '#'); p.rect(20, 25, 3, 1, '#'); p.rect(17, 30, 3, 1, '#');
    // site chokes
    p.rect(28, 17, 3, 1, '#'); p.rect(7, 15, 3, 1, '#');
    p.rect(29, 13, 2, 1, 'X'); p.set(35, 14, 'x'); p.rect(8, 12, 2, 1, 'X'); p.set(3, 9, 'x');
    p.floor(10, 22, 7, 3); p.floor(23, 26, 5, 3); p.set(13, 22, 'w');
    // CT
    p.floor(15, 2, 8, 8, 4); p.rect(16, 3, 6, 4, 'c');
    p.wall(15, 2, 1, 8); p.floor(15, 5, 1, 2, 4); p.rect(15, 5, 1, 2, 'D');
    p.floor(23, 4, 1, 4, 4); p.rect(23, 4, 1, 4, 'D');
  },
  callouts: [
    { name: 'Рампа A', x: 28, y: 17, w: 5, h: 15 }, { name: 'Лестница B', x: 5, y: 15, w: 5, h: 17 },
    { name: 'Центр', x: 17, y: 10, w: 6, h: 22 }, { name: 'База T', x: 14, y: 32, w: 12, h: 6 }, { name: 'Лифты CT', x: 15, y: 2, w: 9, h: 8 },
  ],
};

const depot: MapDef = {
  id: 'depot', name: 'Depot', inspiredBy: 'Train', theme: 'rail', w: 46, h: 40, wallHeight: 8,
  description: 'Железнодорожное депо: вагоны на обеих точках, плющ и нижний проход.',
  paint: p => {
    p.floor(2, 30, 10, 8); p.rect(3, 32, 8, 4, 't');
    // A main + yard
    p.floor(4, 18, 5, 12); p.set(4, 24, 'x');
    p.floor(2, 4, 22, 14); p.rect(6, 7, 14, 8, 'A');
    p.rect(8, 9, 6, 1, 'H'); p.rect(8, 13, 6, 1, 'H'); p.rect(16, 8, 1, 5, 'H'); p.set(21, 6, 'x'); p.set(3, 15, 'r');
    // Ivy
    p.floor(12, 30, 6, 3); p.floor(15, 18, 3, 12); p.set(16, 24, 'x');
    // Connector (covered)
    p.floor(18, 24, 14, 3); p.rect(19, 24, 12, 3, 'D'); p.set(24, 25, 'r');
    // B site
    p.floor(31, 4, 13, 14); p.rect(33, 6, 9, 8, 'B'); p.rect(35, 7, 1, 6, 'H'); p.rect(39, 9, 1, 6, 'H'); p.set(42, 5, 'x');
    // Lower B hall
    p.floor(12, 35, 22, 3); p.rect(14, 35, 18, 3, 'D'); p.set(22, 36, 'x');
    p.floor(32, 18, 4, 20); p.rect(32, 28, 4, 10, 'D'); p.set(35, 21, 'x');
    // Upper B platform
    p.floor(38, 18, 4, 8, 3); p.rampY(38, 18, 4, 4, 0, 3); p.set(41, 24, 'x');
    // CT spawn
    p.floor(25, 2, 5, 10); p.rect(26, 3, 3, 6, 'c');
    p.wall(24, 2, 1, 10); p.floor(24, 5, 1, 3); p.rect(24, 5, 1, 3, 'D');
    p.wall(30, 2, 1, 16); p.floor(30, 8, 1, 2); p.rect(30, 8, 1, 2, 'D');
    // Z connector CT <-> connector
    p.floor(26, 12, 3, 12); p.set(27, 16, 'x');
    // site chokes
    p.rect(4, 18, 3, 1, '#'); p.rect(32, 18, 2, 1, '#');
  },
  callouts: [
    { name: 'Главный A', x: 4, y: 18, w: 5, h: 12 }, { name: 'Плющ', x: 12, y: 18, w: 6, h: 15 },
    { name: 'Коннектор', x: 18, y: 24, w: 14, h: 3 }, { name: 'Нижний B', x: 12, y: 28, w: 24, h: 10 },
    { name: 'Верхний B', x: 36, y: 18, w: 6, h: 8 }, { name: 'Z-проход', x: 26, y: 12, w: 3, h: 12 },
    { name: 'База T', x: 2, y: 30, w: 10, h: 8 }, { name: 'База CT', x: 25, y: 2, w: 5, h: 10 },
  ],
};

const pharaoh: MapDef = {
  id: 'pharaoh', name: 'Pharaoh', inspiredBy: 'Anubis', theme: 'egypt', w: 44, h: 42, wallHeight: 8,
  description: 'Древнеегипетский город: канал в центре, мост к A и коннектор к B.',
  paint: p => {
    p.floor(16, 34, 12, 6); p.rect(18, 35, 8, 4, 't'); p.set(16, 39, 'p'); p.set(27, 39, 'p');
    // B main
    p.floor(4, 34, 12, 3); p.floor(4, 16, 5, 18); p.rampY(4, 16, 5, 4, 2, 0); p.rect(4, 22, 5, 7, 'D'); p.set(8, 31, 'x');
    p.floor(2, 3, 14, 13, 2); p.rect(4, 5, 9, 7, 'B'); p.rect(7, 7, 2, 2, 'X'); p.set(12, 11, 'x'); p.set(3, 13, 'p'); p.set(14, 4, 'p');
    // A main
    p.floor(28, 34, 12, 3); p.floor(35, 16, 5, 18); p.rampY(35, 16, 5, 4, 2, 0); p.set(35, 26, 'x'); p.set(39, 30, 'p');
    p.floor(28, 3, 14, 13, 2); p.rect(30, 5, 9, 7, 'A'); p.rect(33, 7, 2, 2, 'X'); p.set(37, 11, 'x'); p.set(29, 13, 'p'); p.set(40, 4, 'p');
    // Mid canal
    p.floor(19, 12, 6, 22); p.over(20, 14, 4, 18, '~'); p.set(19, 28, 'x');
    p.rect(19, 13, 3, 1, 'X'); p.rect(22, 23, 3, 1, 'X'); p.rect(19, 30, 3, 1, 'X');
    // site chokes
    p.rect(4, 16, 3, 1, '#'); p.rect(37, 16, 3, 1, '#');
    p.rect(25, 16, 3, 1, '#'); p.set(36, 13, 'X'); p.set(30, 13, 'x'); p.set(5, 13, 'X'); p.set(12, 13, 'x');
    p.floor(20, 9, 4, 3);
    p.floor(9, 20, 10, 3); p.rect(10, 20, 6, 3, 'D');
    p.floor(25, 14, 10, 3); p.rampX(25, 14, 10, 3, 0, 2);
    // CT
    p.floor(17, 2, 10, 7); p.rect(18, 3, 8, 4, 'c');
    p.floor(27, 4, 1, 4); p.rampX(26, 4, 3, 4, 0, 2);
    p.floor(16, 4, 1, 4); p.rampX(15, 4, 3, 4, 2, 0);
  },
  callouts: [
    { name: 'Главный B', x: 4, y: 16, w: 5, h: 21 }, { name: 'Главный A', x: 35, y: 16, w: 5, h: 21 },
    { name: 'Канал', x: 19, y: 9, w: 6, h: 25 }, { name: 'Коннектор B', x: 9, y: 20, w: 10, h: 3 },
    { name: 'Мост A', x: 25, y: 14, w: 10, h: 3 }, { name: 'База T', x: 16, y: 34, w: 12, h: 6 }, { name: 'База CT', x: 17, y: 2, w: 10, h: 7 },
  ],
};

const range: MapDef = {
  id: 'range', name: 'Полигон', inspiredBy: 'Training range', theme: 'range', w: 40, h: 34, wallHeight: 6, training: true,
  description: 'Стрельбище: дорожки с мишенями, зона для гранат и стенд отдачи.',
  paint: p => {
    p.floor(2, 2, 36, 30);
    p.rect(14, 28, 12, 3, 't'); p.rect(14, 3, 12, 1, 'c');
    // Lane separators
    for (const x of [10, 30]) p.rect(x, 6, 1, 18, 'o');
    // Grenade practice area (west)
    p.rect(3, 8, 2, 1, 'X'); p.rect(6, 14, 1, 3, '#'); p.set(4, 20, 'x'); p.rect(3, 4, 5, 1, 'o');
    // Recoil wall (east)
    p.rect(32, 4, 5, 1, '#');
    p.set(34, 18, 'x'); p.set(36, 12, 'X');
  },
};

export const MAP_DEFS: MapDef[] = [sandstorm, oasis, villa, reactor, ruins, canal, skyline, depot, pharaoh];
export const TRAINING_MAP = range;

const cache = new Map<string, CompiledMap>();
export function getMap(id: string): CompiledMap {
  let m = cache.get(id);
  if (!m) {
    const def = [...MAP_DEFS, range].find(d => d.id === id);
    if (!def) throw new Error(`Unknown map ${id}`);
    m = compileMap(def);
    cache.set(id, m);
  }
  return m;
}

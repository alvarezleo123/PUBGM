/* =========================================================
   CARD SWAP — данные карточек и коллекций
   ---------------------------------------------------------
   КАК ДОБАВИТЬ/ИЗМЕНИТЬ КАРТОЧКУ:
   1. Положи файл картинки в images/cards/<имя-файла>.png
   2. Впиши это имя в поле "image" нужной карты ниже
   3. Больше НИЧЕГО менять не нужно — карточка появится
      в приложении автоматически.

   КАК ДОБАВИТЬ НОВУЮ КОЛЛЕКЦИЮ:
   1. Скопируй один из блоков COLLECTIONS ниже
   2. Поменяй id, name, type ('past' или 'current'), cards
   3. Готово — коллекция появится в нужном разделе
      («Прошлые коллекции» / «Актуальные коллекции»)
      автоматически, без правок в других файлах.

   ПОЛЯ КАРТЫ:
   id         — уникальный идентификатор (строка, без пробелов)
   name       — название карты
   collection — id коллекции, к которой относится карта
   rarity     — 'legendary' | 'gold' | 'blue' | 'common'
   image      — имя файла в images/cards/ (или null — тогда
                показывается заглушка с иконкой редкости)
   ========================================================= */

const RARITY = {
  legendary: { label: { ru: 'Легендарная', en: 'Legendary' }, color: '#FF7A45', glow: 'rgba(255,122,69,0.45)' },
  gold:      { label: { ru: 'Золотая',     en: 'Gold' },      color: '#FFC94A', glow: 'rgba(255,201,74,0.4)' },
  blue:      { label: { ru: 'Синяя',       en: 'Blue' },      color: '#4EA1FF', glow: 'rgba(78,161,255,0.4)' },
  common:    { label: { ru: 'Обычная',     en: 'Common' },    color: '#9AA5B1', glow: 'rgba(154,165,177,0.3)' }
};

function card(id, name_ru, name_en, collection, rarity, image = null) {
  return { id, name: { ru: name_ru, en: name_en }, collection, rarity, image };
}

const COLLECTIONS = [

  /* ================= ПРОШЛЫЕ КОЛЛЕКЦИИ ================= */

  {
    id: 'changing_universe',
    type: 'past',
    name: { ru: 'Меняющая вселенная', en: 'Changing Universe' },
    cards: [
      card('cu_01', 'Мастер эвакуации', 'Evacuation Master', 'changing_universe', 'gold'),
      card('cu_02', 'Сильнейшая команда «Мелодия»', 'Strongest Squad: Melody', 'changing_universe', 'gold'),
      card('cu_03', 'Сильнейшая команда «Неистовая страсть»', 'Strongest Squad: Fierce Passion', 'changing_universe', 'gold'),

      card('cu_04', 'Концертный зал', 'Concert Hall', 'changing_universe', 'blue'),
      card('cu_05', 'Гоночный зал', 'Racing Hall', 'changing_universe', 'blue'),
      card('cu_06', 'Динамический направляющий рельс', 'Dynamic Guide Rail', 'changing_universe', 'blue'),
      card('cu_07', 'Парашютное испытание', 'Parachute Trial', 'changing_universe', 'blue'),
      card('cu_08', 'Гоночное испытание', 'Racing Trial', 'changing_universe', 'blue'),
      card('cu_09', 'Хранилище S-ранга', 'S-Rank Vault', 'changing_universe', 'blue'),

      card('cu_10', 'Хранилище A-ранга', 'A-Rank Vault', 'changing_universe', 'common'),
      card('cu_11', 'Хранилище B-ранга', 'B-Rank Vault', 'changing_universe', 'common'),
      card('cu_12', 'Рулетка Lucky Spin', 'Lucky Spin', 'changing_universe', 'common'),
      card('cu_13', 'Рулетка Lucky Spin: Годовщина', 'Lucky Spin: Anniversary', 'changing_universe', 'common'),
      card('cu_14', 'Энергетический щит', 'Energy Shield', 'changing_universe', 'common'),
      card('cu_15', 'Зона пространственных искажений', 'Spatial Distortion Zone', 'changing_universe', 'common'),
      card('cu_16', 'Зона пространственных искажений II', 'Spatial Distortion Zone II', 'changing_universe', 'common'),
      card('cu_17', 'Подвесной ускоритель', 'Suspended Accelerator', 'changing_universe', 'common')
    ]
  },

  {
    id: 'magic_battle',
    type: 'past',
    name: { ru: 'Магическая битва', en: 'Magic Battle' },
    cards: [
      card('mb_01', 'Магическая битва', 'Magic Battle', 'magic_battle', 'gold'),
      card('mb_02', 'Рёмен Сукуна', 'Ryomen Sukuna', 'magic_battle', 'gold'),
      card('mb_03', 'Сугуру Гэто', 'Suguru Geto', 'magic_battle', 'gold'),

      card('mb_04', 'Сатору Годзё', 'Satoru Gojo', 'magic_battle', 'blue'),
      card('mb_05', 'Юдзи Итадори', 'Yuji Itadori', 'magic_battle', 'blue'),
      card('mb_06', 'Мэгуми Фусигуро', 'Megumi Fushiguro', 'magic_battle', 'blue'),
      card('mb_07', 'Нюэ', 'Nue', 'magic_battle', 'blue'),
      card('mb_08', 'Нобара Кугисаки', 'Nobara Kugisaki', 'magic_battle', 'blue'),

      card('mb_09', 'Кэти', 'Kechizu', 'magic_battle', 'common'),
      card('mb_10', 'Проклятый труп-медведь', 'Cursed Corpse Bear', 'magic_battle', 'common'),
      card('mb_11', 'Перевёрнутое копьё небес', 'Inverted Spear of Heaven', 'magic_battle', 'common')
    ]
  },

  {
    id: 'anniversary',
    type: 'past',
    name: { ru: 'Годовщина', en: 'Anniversary' },
    cards: [
      card('an_01', 'Коллекционер-профи', 'Pro Collector', 'anniversary', 'legendary'),

      card('an_02', 'Столб поля боя', 'Battlefield Pillar', 'anniversary', 'blue'),
      card('an_03', 'Золотой век', 'Golden Age', 'anniversary', 'blue'),
      card('an_04', 'Время аркад', 'Arcade Time', 'anniversary', 'blue'),
      card('an_05', 'Герои ритма', 'Rhythm Heroes', 'anniversary', 'blue'),
      card('an_06', 'Яркий мир', 'Vivid World', 'anniversary', 'blue'),
      card('an_07', 'Земля динозавров', 'Dinosaur Land', 'anniversary', 'blue'),
      card('an_08', 'Морская одиссея', 'Sea Odyssey', 'anniversary', 'blue'),
      card('an_09', 'Золотая династия', 'Golden Dynasty', 'anniversary', 'blue'),
      card('an_10', 'Телепортальное хранилище', 'Teleport Vault', 'anniversary', 'blue')
    ]
  },

  {
    id: 'game_battlefield',
    type: 'past',
    name: { ru: 'Игровое поле боя', en: 'Game Battlefield' },
    cards: [
      card('gb_01', 'Mr. Beast', 'Mr. Beast', 'game_battlefield', 'gold'),
      card('gb_02', 'Шут судьбы', 'Jester of Fate', 'game_battlefield', 'gold'),
      card('gb_03', 'Династия секретов: Возвышение', 'Dynasty of Secrets: Rise', 'game_battlefield', 'gold'),

      card('gb_04', 'Рэй', 'Ray', 'game_battlefield', 'blue'),
      card('gb_05', 'Восемь лет вместе', 'Eight Years Together', 'game_battlefield', 'blue'),
      card('gb_06', 'Шутовской трюк', 'Jester\'s Trick', 'game_battlefield', 'blue'),
      card('gb_07', 'Испытание Хелиона', 'Helion Trial', 'game_battlefield', 'blue'),
      card('gb_08', 'Ящик «Скорпион»', 'Scorpion Crate', 'game_battlefield', 'blue'),
      card('gb_09', 'Битва древесного скелета', 'Wooden Skeleton Battle', 'game_battlefield', 'blue'),

      card('gb_10', 'Герент', 'Gerent', 'game_battlefield', 'common'),
      card('gb_11', 'Грузовая водоходная амфибия', 'Cargo Amphibious Vehicle', 'game_battlefield', 'common')
    ]
  },

  /* ================= АКТУАЛЬНЫЕ КОЛЛЕКЦИИ =================
     Заглушки — названия и редкость подставь свои позже,
     просто отредактировав cards ниже. Структура (30 карт,
     разбивка по редкости) — на твой вкус, это шаблон. */

  ...['1', '2', '3', '4', '5'].map((n) => ({
    id: 'current_' + n,
    type: 'current',
    name: { ru: `Актуальная коллекция ${n}`, en: `Current Collection ${n}` },
    cards: Array.from({ length: 30 }, (_, i) => {
      const idx = i + 1;
      const rarity = idx <= 3 ? 'gold' : idx <= 12 ? 'blue' : 'common';
      return card(
        `c${n}_${String(idx).padStart(2, '0')}`,
        `Карта ${idx}`,
        `Card ${idx}`,
        'current_' + n,
        rarity
      );
    })
  }))
];

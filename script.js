/* =========================================================
   CARD SWAP — app logic (v3)
   ---------------------------------------------------------
   ⚠️ ДЕМО-ДАННЫЕ ДЛЯ ПРИМЕРА:
   Массив DEMO_OPPONENTS ниже — это ненастоящие игроки,
   вставленные только для того, чтобы экраны "совпадение",
   "профиль игрока" и "топ-100" не были пустыми во время
   тестирования. Перед публикацией для реальных пользователей
   этот массив и весь код, который на него ссылается
   (startMatch(), buildLeaderboardData()), нужно убрать и
   подключить настоящий backend с реальными игроками.
   Помечено также ниже прямо в коде комментариями "ДЕМО".
   ---------------------------------------------------------
   ПРО РЕАЛЬНЫЙ БЭКЕНД (см. подробности в README):
   Всё в объекте `db` — заглушка на localStorage, работает
   только на одном устройстве. Для реальных игроков нужен
   сервер (БД + проверка Telegram initData + подбор пар +
   уведомления от бота). Каждая функция db.* — это то место,
   где нужно подставить серверный вызов вместо localStorage.
   ========================================================= */

/* ---------------------------------------------------------
   0. TELEGRAM WEBAPP INIT
   --------------------------------------------------------- */
const tg = window.Telegram ? window.Telegram.WebApp : null;

if (tg) {
  tg.ready();
  tg.expand();
}

const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;

// Telegram avatar limits (mirrored here for the upload flow):
// square crop, JPG/PNG, up to 5MB — matches standard Telegram profile-photo constraints.
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 512; // px, square

/* ---------------------------------------------------------
   1. "DATABASE" LAYER (localStorage stand-in)
   --------------------------------------------------------- */

const db = {
  _read(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  },
  _write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },

  isNicknameTaken(nickname, excludeUserId = null) {
    const index = this._read('cs_nicknames', {});
    const owner = index[nickname.toLowerCase()];
    return !!owner && owner !== excludeUserId;
  },

  createUser(userId, { nickname, gameId }) {
    const users = this._read('cs_users', {});
    const index = this._read('cs_nicknames', {});
    users[userId] = {
      nickname, gameId,
      avatarType: 'emoji',       // 'emoji' | 'telegram' | 'custom'
      avatarEmoji: '🎮',
      avatarImage: null,          // data URL if avatarType === 'custom'
      bio: '',
      createdAt: Date.now(),
      have: [], want: [],
      theme: 'dark',
      ratingSum: 0, ratingCount: 0,
      tradesTotal: 0, tradesSuccess: 0,
      blockedUsers: [],            // list of userIds this player has blocked locally
      lastNicknameChangeAt: null   // tracks the 15-day nickname change limit
    };
    index[nickname.toLowerCase()] = userId;
    this._write('cs_users', users);
    this._write('cs_nicknames', index);
    return users[userId];
  },

  getUser(userId) {
    const users = this._read('cs_users', {});
    return users[userId] || null;
  },

  updateUser(userId, patch) {
    const users = this._read('cs_users', {});
    if (!users[userId]) return null;
    const index = this._read('cs_nicknames', {});
    if (patch.nickname && patch.nickname.toLowerCase() !== users[userId].nickname.toLowerCase()) {
      delete index[users[userId].nickname.toLowerCase()];
      index[patch.nickname.toLowerCase()] = userId;
      this._write('cs_nicknames', index);
    }
    Object.assign(users[userId], patch);
    this._write('cs_users', users);
    return users[userId];
  },

  updateSelections(userId, have, want) {
    this.updateUser(userId, { have, want });
  },

  createTrade(trade) {
    const trades = this._read('cs_trades', {});
    trades[trade.id] = trade;
    this._write('cs_trades', trades);
    return trade;
  },
  getTrade(tradeId) {
    const trades = this._read('cs_trades', {});
    return trades[tradeId] || null;
  },
  updateTrade(tradeId, patch) {
    const trades = this._read('cs_trades', {});
    if (!trades[tradeId]) return null;
    Object.assign(trades[tradeId], patch);
    this._write('cs_trades', trades);
    return trades[tradeId];
  },
  getTradesForUser(userId) {
    const trades = this._read('cs_trades', {});
    return Object.values(trades)
      .filter(t => t.playerA === userId || t.playerB === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  addReview(review) {
    const reviews = this._read('cs_reviews', []);
    reviews.unshift(review);
    this._write('cs_reviews', reviews);
    const users = this._read('cs_users', {});
    if (users[review.toUserId]) {
      users[review.toUserId].ratingSum += review.stars;
      users[review.toUserId].ratingCount += 1;
      this._write('cs_users', users);
    }
    return review;
  },
  getReviewsForUser(userId) {
    const reviews = this._read('cs_reviews', []);
    return reviews.filter(r => r.toUserId === userId);
  },

  createReport(report) {
    const reports = this._read('cs_reports', []);
    reports.unshift(report);
    this._write('cs_reports', reports);
    return report;
  },

  // Real deletion — removes the user record and nickname index entry
  // entirely (not a soft "deactivated" flag). Trades/reviews the deleted
  // player took part in are kept for the *other* player's history, but
  // their nickname is displayed as "Deleted account" (see renderMyTrades).
  deleteUser(userId) {
    const users = this._read('cs_users', {});
    const index = this._read('cs_nicknames', {});
    if (users[userId]) {
      delete index[users[userId].nickname.toLowerCase()];
      delete users[userId];
      this._write('cs_users', users);
      this._write('cs_nicknames', index);
    }
  }
};

const SESSION_KEY = 'cs_session_id';
let userId = localStorage.getItem(SESSION_KEY);
if (!userId) {
  userId = tgUser && tgUser.id ? String(tgUser.id) : 'local_' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem(SESSION_KEY, userId);
}

/* ---------------------------------------------------------
   2. ДЕМО-ИГРОКИ (убрать перед публикацией — см. заметку выше)
   --------------------------------------------------------- */

const DEMO_OPPONENTS = [
  { nickname: 'ShroudRU', gameId: '5123489210', avatarEmoji: '🎯', rating: 4.8, ratingCount: 132, bio: { ru: 'Меняюсь только редкими карточками, всегда на связи', en: 'Trading rare cards only, always online' }, trades: 58 },
  { nickname: 'NightFox', gameId: '5987123044', avatarEmoji: '🦊', rating: 4.6, ratingCount: 47, bio: { ru: 'Коллекционирую PMGC с первого сезона', en: 'Collecting PMGC since season one' }, trades: 21 },
  { nickname: 'K1LLuA_pro', gameId: '5233419988', avatarEmoji: '⚡', rating: 4.9, ratingCount: 201, bio: { ru: 'Быстрый обмен, честная сделка', en: 'Fast trade, fair deal' }, trades: 94 },
  { nickname: 'Аниме_Тян', gameId: '5678234501', avatarEmoji: '🎭', rating: 4.4, ratingCount: 19, bio: { ru: 'Люблю Magic Battle коллекцию', en: 'I love the Magic Battle collection' }, trades: 12 },
  { nickname: 'DesertEagle', gameId: '5344009812', avatarEmoji: '🦅', rating: 4.7, ratingCount: 88, bio: { ru: 'В игре с 2019 года', en: 'Playing since 2019' }, trades: 40 }
];

/* ---------------------------------------------------------
   3. I18N
   --------------------------------------------------------- */

const STRINGS = {
  ru: {
    regTitle: 'Добро пожаловать!',
    nicknameLabel: 'Никнейм',
    nicknamePlaceholder: 'Выбери никнейм',
    nicknameHint: 'Никнейм должен быть уникальным — так тебя увидят другие игроки',
    nicknameTaken: 'Этот никнейм уже занят, попробуй другой',
    nicknameLatinOnly: 'Никнейм может содержать только английские буквы, цифры и «_»',
    gameIdDigitsOnly: 'Игровой ID может состоять только из цифр',
    gameIdLabel: 'Игровой ID',
    gameIdPlaceholder: 'Выбери ID',
    gameIdHint: 'ID указан в профиле PUBG Mobile — нажми на свой аватар в верхнем левом углу игры, номер будет под ником',
    startBtn: 'Продолжить',
    editBtn: 'Редактировать',
    editAvatarTitle: 'Отредактировать аватар',
    chooseFromGalleryBtn: 'Выбрать из галереи',

    navProfile: 'Профиль',
    navNotifications: 'Уведомления',
    navExchange: 'Обмен',
    navRating: 'Рейтинг',
    navHistory: 'История',

    exchangeIntroTitle: 'Обменивайся и получай коллекционные карты',
    planetStartBtn: 'Начать',
    planetDisclaimer: 'Card Swap — это площадка для обмена карточками между игроками. Все сделки совершаются напрямую в PUBG Mobile, сервис не хранит и не передаёт игровые предметы.',

    pastTab: 'Прошлые коллекции',
    currentTab: 'Актуальные коллекции',
    haveTab: 'У меня есть',
    wantTab: 'Хочу получить',
    haveLabel: 'есть',
    wantLabel: 'хочу',
    searchBtn: 'Поиск обмена',

    rarityAll: 'Все',
    rarityLegendary: 'Легендарные',
    rarityGold: 'Золотые',
    rarityBlue: 'Синие',
    rarityCommon: 'Обычные',
    rarityLockedNotice: 'Обмен только внутри редкости:',
    maxCardsToast: 'Максимум 3 карты за один обмен',

    searching: 'Ищем игрока…',
    searchingHint: 'Подбираем игрока с подходящими карточками',
    searchLongWarning: '⏳ Поиск может занять некоторое время — среди игроков ищем того, кто сейчас может создать трейд',
    cancelBtn: 'Отмена',

    matchFoundTitle: 'Игрок найден!',
    matchIdLabel: 'Игровой ID игрока',
    copyBtn: 'Копировать',
    matchInstruction: 'Добавь этого игрока в друзья в PUBG Mobile и обменяйтесь внутри игры',
    giveCardLabel: 'Ты отдаёшь',
    getCardLabel: 'Ты получаешь',
    viewProfileBtnShort: 'Профиль',
    reportBtnShort: 'Пожаловаться',
    reportBtn: 'Пожаловаться на игрока',
    completeExchangeBtn: 'Обмен завершён',

    rateTitle: 'Как прошёл обмен?',
    rateSubtitle: 'Оцени игрока, с которым обменивался — это поможет другим',
    commentLabel: 'Комментарий (необязательно)',
    commentPlaceholder: 'Как всё прошло?',
    submitRatingBtn: 'Отправить оценку',
    skipBtn: 'Пропустить',

    tradesLabel: 'обменов',
    successLabel: 'успешных',
    reviewsTitle: 'Отзывы',

    drawerTitle: 'Меню',
    accProfile: 'Мой профиль',
    accRating: 'Рейтинг',
    accHistory: 'История обменов',
    accNotif: 'Уведомления',
    uploadAvatarBtn: 'Загрузить своё фото',
    avatarTooBig: 'Файл слишком большой — максимум 5 МБ',
    avatarBadType: 'Поддерживаются только JPG, PNG и WebP',
    changeNickLabel: 'Изменить никнейм',
    nickChangeHint: 'Менять никнейм можно раз в 15 дней',
    nickChangeTooSoon: 'Никнейм можно менять раз в 15 дней — следующая смена будет доступна',
    saveBtn: 'Сохранить',
    themeTitle: 'Оформление',
    themeDark: 'Тёмная',
    themeLight: 'Светлая',
    notifMatches: 'Совпадения обмена',
    notifReviews: 'Новые отзывы',
    notifNews: 'Новости и коллекции',
    leaderboardBtn: '🏆 Топ-100 игроков',
    leaderboardTitle: 'Топ-100 по обменам',
    leaderboardHint: 'Рейтинг считается по оценкам и количеству обменов',
    myRankLabel: 'Твоё место:',
    outOfRankText: 'вне рейтинга',
    rankNeedMoreText: 'нужно ещё',
    demoNote: '⚠️ Пока показаны демо-игроки для примера — перед публикацией их нужно убрать',

    reportTitle: 'Пожаловаться на игрока',
    reasonNoShow: 'Не вышел на обмен',
    reasonScam: 'Обманул при обмене',
    reasonRude: 'Оскорбления / грубость',
    reasonSpam: 'Спам / реклама',
    reasonOther: 'Другое',
    reportOtherLabel: 'Опиши причину',
    reportSubmitBtn: 'Отправить жалобу',
    reportNote: 'Жалоба уходит модератору и не видна другому игроку',
    reportSent: 'Жалоба отправлена',

    tradeStatusPending: 'В процессе',
    tradeStatusCompleted: 'Завершён',
    tradeStatusFailed: 'Не состоялся',
    tradeExpiredToast: 'Время на обмен истекло — отмечен как «Не состоялся»',
    savedToast: 'Сохранено',
    copiedToast: 'ID скопирован',
    noReviewsYet: 'Пока нет отзывов',
    noTradesYet: 'Пока нет обменов',

    limitModalTitle: 'Можешь создать обмен карт?',
    limitModalText: 'В PUBG Mobile обмен доступен раз в 3 дня. Уточни у себя в игре, есть ли у тебя сейчас лимит.',
    limitYesBtn: 'Да, могу',
    limitNoBtn: 'Нет, лимит',
    limitYesInfo: 'Подтверждаю, что могу создать обмен',
    limitNoInfo: 'Понятно — у тебя лимит, но поиск всё равно продолжится: обмен возможен, если создать его сможет партнёр',
    limitConfirmBtn: 'Подтвердить и искать',
    accBlocked: 'Заблокированные',
    noBlockedYet: 'Список пуст',
    unblockBtn: 'Разблокировать',
    blockConfirmTitle: 'Заблокировать игрока?',
    blockedToast: 'Игрок заблокирован — больше не появится в поиске',
    unblockedToast: 'Игрок разблокирован',
    tradeDetailTitle: 'Детали обмена',
    tradeDetailWith: 'Игрок',
    tradeDetailDate: 'Дата',
    tradeDetailStatus: 'Статус',
    tradeDetailGaveCard: 'Ты отдал',
    tradeDetailGotCard: 'Ты получил',

    deleteAccountBtn: 'Удалить аккаунт',
    deleteConfirmTitle: 'Удалить аккаунт?',
    deleteConfirmText: 'Это действие необратимо. Все твои данные — карты, история обменов, рейтинг — будут удалены из базы данных без возможности восстановления.',
    deleteConfirmStep1Btn: 'Да, удалить аккаунт',
    deleteConfirmTitle2: 'Точно уверен?',
    deleteConfirmText2: 'Последнее предупреждение: аккаунт удалится навсегда, отменить это будет нельзя.',
    deleteConfirmStep2Btn: 'Удалить навсегда',
    accountDeletedToast: 'Аккаунт удалён',
    deletedAccountLabel: 'Удалённый профиль'
  },
  en: {
    regTitle: 'Welcome!',
    nicknameLabel: 'Nickname',
    nicknamePlaceholder: 'Pick a nickname',
    nicknameHint: 'Nickname must be unique — this is how other players will see you',
    nicknameTaken: 'This nickname is taken, try another one',
    nicknameLatinOnly: 'Nickname can only contain English letters, digits, and "_"',
    gameIdDigitsOnly: 'Game ID can only contain digits',
    gameIdLabel: 'Game ID',
    gameIdPlaceholder: 'Pick your ID',
    gameIdHint: 'Find it in your PUBG Mobile profile — tap your avatar in the top-left corner, the ID is under your name',
    startBtn: 'Continue',
    editBtn: 'Edit',
    editAvatarTitle: 'Edit avatar',
    chooseFromGalleryBtn: 'Choose from gallery',

    navProfile: 'Profile',
    navNotifications: 'Notifications',
    navExchange: 'Exchange',
    navRating: 'Rating',
    navHistory: 'History',

    exchangeIntroTitle: 'Trade and collect cards',
    planetStartBtn: 'Start',
    planetDisclaimer: 'Card Swap is a platform for trading cards between players. All deals happen directly in PUBG Mobile — the service does not hold or transfer in-game items.',

    pastTab: 'Past Collections',
    currentTab: 'Current Collections',
    haveTab: 'I have',
    wantTab: 'I want',
    haveLabel: 'have',
    wantLabel: 'want',
    searchBtn: 'Search Exchange',

    rarityAll: 'All',
    rarityLegendary: 'Legendary',
    rarityGold: 'Gold',
    rarityBlue: 'Blue',
    rarityCommon: 'Common',
    rarityLockedNotice: 'Trading within one rarity only:',
    maxCardsToast: 'Maximum 3 cards per trade',

    searching: 'Looking for a player…',
    searchingHint: 'Matching you with a player who has what you need',
    searchLongWarning: "⏳ This may take a moment — we're looking for someone who can create a trade right now",
    cancelBtn: 'Cancel',

    matchFoundTitle: 'Player found!',
    matchIdLabel: "Player's game ID",
    copyBtn: 'Copy',
    matchInstruction: 'Add this player as a friend in PUBG Mobile and trade in-game',
    giveCardLabel: 'You give',
    getCardLabel: 'You get',
    viewProfileBtnShort: 'Profile',
    reportBtnShort: 'Report',
    reportBtn: 'Report this player',
    completeExchangeBtn: 'Trade completed',

    rateTitle: 'How did the trade go?',
    rateSubtitle: 'Rate the player you traded with — it helps everyone else',
    commentLabel: 'Comment (optional)',
    commentPlaceholder: 'How did it go?',
    submitRatingBtn: 'Submit rating',
    skipBtn: 'Skip',

    tradesLabel: 'trades',
    successLabel: 'successful',
    reviewsTitle: 'Reviews',

    drawerTitle: 'Menu',
    accProfile: 'My profile',
    accRating: 'Rating',
    accHistory: 'Trade history',
    accNotif: 'Notifications',
    uploadAvatarBtn: 'Upload your photo',
    avatarTooBig: 'File is too large — 5MB max',
    avatarBadType: 'Only JPG, PNG and WebP are supported',
    changeNickLabel: 'Change nickname',
    nickChangeHint: 'Nickname can be changed once every 15 days',
    nickChangeTooSoon: 'Nickname can only be changed once every 15 days — next change available',
    saveBtn: 'Save',
    themeTitle: 'Appearance',
    themeDark: 'Dark',
    themeLight: 'Light',
    notifMatches: 'Trade matches',
    notifReviews: 'New reviews',
    notifNews: 'News & collections',
    leaderboardBtn: '🏆 Top 100 players',
    leaderboardTitle: 'Top 100 traders',
    leaderboardHint: 'Ranking is based on post-trade ratings and number of trades',
    myRankLabel: 'Your rank:',
    outOfRankText: 'unranked',
    rankNeedMoreText: 'need',
    demoNote: '⚠️ Demo players shown for preview — remove before going live',

    reportTitle: 'Report this player',
    reasonNoShow: "Didn't show up to trade",
    reasonScam: 'Scammed during trade',
    reasonRude: 'Abuse / rudeness',
    reasonSpam: 'Spam / advertising',
    reasonOther: 'Other',
    reportOtherLabel: 'Describe the issue',
    reportSubmitBtn: 'Send report',
    reportNote: "The report goes to a moderator and isn't visible to the other player",
    reportSent: 'Report sent',

    tradeStatusPending: 'In progress',
    tradeStatusCompleted: 'Completed',
    tradeStatusFailed: "Didn't happen",
    tradeExpiredToast: 'Trade window expired — marked as "Didn\'t happen"',
    savedToast: 'Saved',
    copiedToast: 'ID copied',
    noReviewsYet: 'No reviews yet',
    noTradesYet: 'No trades yet',

    limitModalTitle: 'Can you create a card exchange?',
    limitModalText: "PUBG Mobile allows a trade once every 3 days. Check in-game whether you currently have a limit.",
    limitYesBtn: 'Yes, I can',
    limitNoBtn: "No, I'm limited",
    limitYesInfo: "Confirming that you can create an exchange",
    limitNoInfo: "Got it — you're limited, but search continues: a trade can still happen if your partner can create one",
    limitConfirmBtn: 'Confirm and search',
    accBlocked: 'Blocked players',
    noBlockedYet: 'Nothing here yet',
    unblockBtn: 'Unblock',
    blockConfirmTitle: 'Block this player?',
    blockedToast: "Player blocked — won't appear in search anymore",
    unblockedToast: 'Player unblocked',
    tradeDetailTitle: 'Trade details',
    tradeDetailWith: 'Player',
    tradeDetailDate: 'Date',
    tradeDetailStatus: 'Status',
    tradeDetailGaveCard: 'You gave',
    tradeDetailGotCard: 'You got',

    deleteAccountBtn: 'Delete account',
    deleteConfirmTitle: 'Delete account?',
    deleteConfirmText: "This can't be undone. All your data — cards, trade history, rating — will be permanently removed from the database.",
    deleteConfirmStep1Btn: 'Yes, delete my account',
    deleteConfirmTitle2: 'Are you absolutely sure?',
    deleteConfirmText2: 'Last warning: your account will be deleted forever and this cannot be undone.',
    deleteConfirmStep2Btn: 'Delete forever',
    accountDeletedToast: 'Account deleted',
    deletedAccountLabel: 'Deleted account'
  }
};

let currentLang = localStorage.getItem('cs_lang') || 'ru';

function t(key) {
  return (STRINGS[currentLang] && STRINGS[currentLang][key]) || STRINGS.ru[key] || key;
}

const RARITY_ORDER = ['legendary', 'gold', 'blue', 'common'];
function rarityTabLabel(r) {
  return { all: 'rarityAll', legendary: 'rarityLegendary', gold: 'rarityGold', blue: 'rarityBlue', common: 'rarityCommon' }[r];
}

function applyI18n() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });

  document.getElementById('langFlag').textContent = currentLang === 'ru' ? '🇷🇺' : '🇺🇸';
  document.getElementById('langCode').textContent = currentLang === 'ru' ? 'RU' : 'EN';

  renderCollections();
  updateSearchButtonState();
}

document.getElementById('langToggle').addEventListener('click', () => {
  currentLang = currentLang === 'ru' ? 'en' : 'ru';
  localStorage.setItem('cs_lang', currentLang);
  applyI18n();
});

/* ---------------------------------------------------------
   4. TOAST
   --------------------------------------------------------- */

let toastTimeout = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------------------------------------------------
   5. THEME
   --------------------------------------------------------- */

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeChoice === theme);
  });
  if (tg) {
    try { tg.setHeaderColor(theme === 'dark' ? '#0A0A0D' : '#FFFFFF'); } catch (e) {}
    try { tg.setBackgroundColor(theme === 'dark' ? '#0A0A0D' : '#F3F2F7'); } catch (e) {}
  }
}

document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.themeChoice;
    applyTheme(theme);
    db.updateUser(userId, { theme });
  });
});

/* ---------------------------------------------------------
   6. SCREEN NAVIGATION
   ---------------------------------------------------------
   Bottom nav (profile / notifications / exchange / rating / history)
   stays visible on those five "home" screens; it hides once the player
   goes deeper (into collections, search, a match, someone's profile...)
   so the back-navigation inside those flows isn't confused with the
   main tab bar.
   --------------------------------------------------------- */

const NAV_SCREEN_MAP = {
  profile: 'screen-profile',
  notifications: 'screen-notifications',
  exchange: 'screen-exchange-intro',
  rating: 'screen-rating',
  history: 'screen-history'
};
const NAV_HOME_SCREENS = new Set(Object.values(NAV_SCREEN_MAP));

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  const bottomNav = document.querySelector('.bottom-nav');
  bottomNav.classList.toggle('hidden', !NAV_HOME_SCREENS.has(id));

  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', NAV_SCREEN_MAP[btn.dataset.nav] === id);
  });
}

document.querySelectorAll('.bottom-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = NAV_SCREEN_MAP[btn.dataset.nav];
    if (!target) return;

    if (btn.dataset.nav === 'profile') refreshProfileScreen();
    if (btn.dataset.nav === 'rating') refreshRatingScreen();
    if (btn.dataset.nav === 'history') refreshHistoryScreen();

    showScreen(target);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  });
});

/* ---------------------------------------------------------
   7. AVATAR RENDERING HELPER
   ---------------------------------------------------------
   Renders whatever avatar source a user record has into a
   target element (emoji text, or an <img> for telegram/custom).
   --------------------------------------------------------- */

function renderAvatarInto(el, userLike) {
  if (userLike.avatarType === 'custom' && userLike.avatarImage) {
    el.innerHTML = `<img src="${userLike.avatarImage}" alt="">`;
  } else if (userLike.avatarType === 'telegram' && userLike.avatarImage) {
    el.innerHTML = `<img src="${userLike.avatarImage}" alt="">`;
  } else {
    el.innerHTML = `<span class="reg-avatar-fallback">${userLike.avatarEmoji || '@'}</span>`;
  }
}

/* ---------------------------------------------------------
   7b. AVATAR PICKER (registration screen)
   ---------------------------------------------------------
   The avatar chosen here is held in memory until the form is
   actually submitted (db.createUser then persists it) — mirrors
   the reference flow where "Редактировать" just updates a preview.
   --------------------------------------------------------- */

let regAvatarPendingType = 'emoji';
let regAvatarPendingImage = null;

function cropImageToSquareDataUrl(imgSrc, callback) {
  const img = new Image();
  img.onload = () => {
    const size = Math.min(img.width, img.height);
    const sx = (img.width - size) / 2;
    const sy = (img.height - size) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
    callback(canvas.toDataURL('image/jpeg', 0.9));
  };
  img.src = imgSrc;
}

function handleAvatarFileSelected(file, onDone) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast(t('avatarBadType'));
    return;
  }
  if (file.size > AVATAR_MAX_BYTES) {
    showToast(t('avatarTooBig'));
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    cropImageToSquareDataUrl(ev.target.result, (dataUrl) => onDone(dataUrl));
  };
  reader.readAsDataURL(file);
}

// -- registration screen avatar modal --
document.getElementById('regEditAvatarBtn').addEventListener('click', () => {
  document.getElementById('regAvatarModalOverlay').classList.add('open');
});
document.getElementById('regAvatarModalCloseBtn').addEventListener('click', () => {
  document.getElementById('regAvatarModalOverlay').classList.remove('open');
});
document.getElementById('regAvatarCancelBtn').addEventListener('click', () => {
  document.getElementById('regAvatarModalOverlay').classList.remove('open');
});
document.getElementById('regChooseFromGalleryBtn').addEventListener('click', () => {
  document.getElementById('regAvatarFileInput').click();
});
document.getElementById('regAvatarFileInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  handleAvatarFileSelected(file, (dataUrl) => {
    regAvatarPendingType = 'custom';
    regAvatarPendingImage = dataUrl;
    renderAvatarInto(document.getElementById('regAvatarPreview'), { avatarType: 'custom', avatarImage: dataUrl });
    document.getElementById('regAvatarModalOverlay').classList.remove('open');
  });
  e.target.value = '';
});

/* ---------------------------------------------------------
   8. REGISTRATION
   --------------------------------------------------------- */

const registerForm = document.getElementById('registerForm');
const nicknameInput = document.getElementById('nicknameInput');
const gameIdInput = document.getElementById('gameIdInput');
const nicknameField = nicknameInput.closest('.field');
const gameIdField = gameIdInput.closest('.field');
const nicknameStatusIcon = document.getElementById('nicknameStatusIcon');
const gameIdStatusIcon = document.getElementById('gameIdStatusIcon');

// Only prefill from Telegram if the username is itself valid Latin —
// a Cyrillic Telegram username would otherwise silently fail our own rule.
const LATIN_NICK_RE = /^[A-Za-z0-9_]+$/;
if (tgUser && tgUser.username && LATIN_NICK_RE.test(tgUser.username)) {
  nicknameInput.value = tgUser.username;
}

function showFieldError(field, input, messageKey) {
  field.classList.add('has-error');
  field.classList.remove('has-success');
  const errEl = field.querySelector('.field-error');
  if (errEl) errEl.textContent = t(messageKey);
  input.focus();
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
}

// Telegram-style emoji status icons — reads as more "alive" than a flat
// checkmark/X glyph, and matches the visual language players already
// know from Telegram's own UI (as requested).
const STATUS_ICON_OK = '✅';
const STATUS_ICON_BAD = '❌';

function setFieldStatusIcon(iconEl, field, state) {
  // state: 'ok' | 'bad' | null
  field.classList.remove('has-error', 'has-success');
  if (state === 'ok') {
    iconEl.textContent = STATUS_ICON_OK;
    iconEl.classList.add('show');
    field.classList.add('has-success');
  } else if (state === 'bad') {
    iconEl.textContent = STATUS_ICON_BAD;
    iconEl.classList.add('show');
    field.classList.add('has-error');
  } else {
    iconEl.classList.remove('show');
  }
}

function validateNicknameLive() {
  const val = nicknameInput.value.trim();
  const errEl = nicknameField.querySelector('.field-error');

  if (!val) { setFieldStatusIcon(nicknameStatusIcon, nicknameField, null); return; }

  if (!LATIN_NICK_RE.test(val)) {
    errEl.textContent = t('nicknameLatinOnly');
    setFieldStatusIcon(nicknameStatusIcon, nicknameField, 'bad');
    return;
  }
  if (db.isNicknameTaken(val, userId)) {
    errEl.textContent = t('nicknameTaken');
    setFieldStatusIcon(nicknameStatusIcon, nicknameField, 'bad');
    return;
  }
  setFieldStatusIcon(nicknameStatusIcon, nicknameField, 'ok');
}

function validateGameIdLive() {
  const val = gameIdInput.value.trim();
  if (!val) { setFieldStatusIcon(gameIdStatusIcon, gameIdField, null); return; }

  if (!/^\d+$/.test(val)) {
    setFieldStatusIcon(gameIdStatusIcon, gameIdField, 'bad');
    return;
  }
  setFieldStatusIcon(gameIdStatusIcon, gameIdField, 'ok');
}

nicknameInput.addEventListener('input', validateNicknameLive);
gameIdInput.addEventListener('input', validateGameIdLive);

registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nickname = nicknameInput.value.trim();
  const gameId = gameIdInput.value.trim();
  if (!nickname || !gameId) return;

  // Nickname: Latin letters, digits, underscore only — blocks Cyrillic,
  // emoji, and other scripts that could be used to impersonate or spam.
  if (!LATIN_NICK_RE.test(nickname)) {
    showFieldError(nicknameField, nicknameInput, 'nicknameLatinOnly');
    return;
  }

  // Game ID: digits only — PUBG Mobile IDs are numeric, so any letter
  // in this field means it's not a real ID (bot/junk input).
  if (!/^\d+$/.test(gameId)) {
    showFieldError(gameIdField, gameIdInput, 'gameIdDigitsOnly');
    return;
  }

  if (db.isNicknameTaken(nickname, userId)) {
    showFieldError(nicknameField, nicknameInput, 'nicknameTaken');
    return;
  }

  db.createUser(userId, { nickname, gameId, avatarType: regAvatarPendingType, avatarImage: regAvatarPendingImage });
  enterApp();
});

/* ---------------------------------------------------------
   9. HOME / COLLECTIONS / SELECTION (with rarity filter)
   --------------------------------------------------------- */

let collectionScope = 'past'; // 'past' | 'current'
let mode = 'have'; // 'have' | 'want'
let selection = { have: new Set(), want: new Set() };
let rarityFilters = {}; // { [collectionId]: 'all'|'legendary'|'gold'|'blue'|'common' } — user-chosen filter tabs, independent of the trade-lock below

const MAX_CARDS_PER_SIDE = 3;

const collectionsContainer = document.getElementById('collectionsContainer');

// PUBG only allows trading cards of the same rarity (gold-for-gold,
// blue-for-blue, etc). Once the player picks their first card (in either
// tab), that rarity is "locked" for the whole trade — every other rarity
// disappears from view, everywhere, until the selection is cleared.
function getLockedRarity() {
  const allIds = [...selection.have, ...selection.want];
  if (allIds.length === 0) return null;
  const firstId = allIds[0];
  const card = findCardById(firstId);
  return card ? card.rarity : null;
}

function renderCard(cardObj) {
  const rarityMeta = RARITY[cardObj.rarity];
  const iconInner = cardObj.image
    ? `<img src="images/cards/${cardObj.image}" alt="">`
    : `<span style="color:${rarityMeta.color}">${rarityIconFallback(cardObj.rarity)}</span>`;

  return `
    <div class="card-item rarity-${cardObj.rarity}" data-card-id="${cardObj.id}" data-rarity="${cardObj.rarity}" role="button" tabindex="0">
      <div class="card-icon">${iconInner}</div>
      <div class="card-name">${cardObj.name[currentLang]}</div>
      <div class="card-rarity" style="color:${rarityMeta.color}; background:${rarityMeta.glow}">${rarityMeta.label[currentLang]}</div>
    </div>
  `;
}

function rarityIconFallback(rarity) {
  return { legendary: '◆', gold: '●', blue: '▲', common: '■' }[rarity] || '●';
}

function renderCollections() {
  const collections = COLLECTIONS.filter(c => c.type === collectionScope);
  const lockedRarity = getLockedRarity();

  collectionsContainer.innerHTML = collections.map(col => {
    const activeRarity = rarityFilters[col.id] || 'all';

    // Trade-lock takes priority over the manual "all/gold/blue/..." filter
    // chips — once a rarity is locked in, the other chips are hidden too,
    // since picking anything else would be impossible to trade anyway.
    let visibleCards;
    let raritiesToShowAsChips;
    if (lockedRarity) {
      visibleCards = col.cards.filter(c => c.rarity === lockedRarity);
      raritiesToShowAsChips = [lockedRarity];
    } else {
      visibleCards = activeRarity === 'all' ? col.cards : col.cards.filter(c => c.rarity === activeRarity);
      raritiesToShowAsChips = RARITY_ORDER.filter(r => col.cards.some(c => c.rarity === r));
    }

    if (visibleCards.length === 0) return '';

    return `
      <div class="collection-block fade-in">
        <div class="collection-head">
          <div class="collection-title">${col.name[currentLang]}</div>
          <div class="collection-tag">${col.cards.length} 🃏</div>
        </div>

        <div class="rarity-filter" data-collection="${col.id}">
          ${lockedRarity ? '' : `<button class="rarity-chip ${activeRarity === 'all' ? 'active' : ''}" data-rarity="all">${t('rarityAll')}</button>`}
          ${raritiesToShowAsChips.map(r => `
            <button class="rarity-chip ${(lockedRarity ? true : activeRarity === r) ? 'active' : ''} ${lockedRarity ? 'rarity-chip-locked' : ''}" data-rarity="${r}" ${lockedRarity ? 'disabled' : ''}>${t(rarityTabLabel(r))}</button>
          `).join('')}
        </div>

        <div class="card-grid">
          ${visibleCards.map(renderCard).join('')}
        </div>
      </div>
    `;
  }).join('');

  if (lockedRarity) {
    const banner = document.createElement('div');
    banner.className = 'rarity-lock-banner';
    banner.innerHTML = `🔒 ${t('rarityLockedNotice')} <strong>${t(rarityTabLabel(lockedRarity))}</strong>`;
    collectionsContainer.prepend(banner);
  }

  syncCardVisuals();

  collectionsContainer.querySelectorAll('.card-item').forEach(el => {
    el.addEventListener('click', () => toggleCard(el.dataset.cardId));
  });

  collectionsContainer.querySelectorAll('.rarity-chip:not([disabled])').forEach(chip => {
    chip.addEventListener('click', () => {
      const collId = chip.closest('.rarity-filter').dataset.collection;
      rarityFilters[collId] = chip.dataset.rarity;
      renderCollections();
    });
  });
}

document.querySelectorAll('.collection-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    collectionScope = tab.dataset.ctab;
    document.querySelectorAll('.collection-tab').forEach(t2 => t2.classList.toggle('active', t2 === tab));
    renderCollections();
  });
});

function toggleCard(cardId) {
  const set = selection[mode];

  if (set.has(cardId)) {
    set.delete(cardId);
  } else {
    const lockedRarity = getLockedRarity();
    const card = findCardById(cardId);

    // Safety check — shouldn't happen since locked-out cards aren't
    // rendered at all, but guards against stale DOM clicks.
    if (lockedRarity && card.rarity !== lockedRarity) return;

    if (set.size >= MAX_CARDS_PER_SIDE) {
      showToast(t('maxCardsToast'));
      if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
      return;
    }
    set.add(cardId);
  }

  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  renderCollections(); // full re-render: locked rarity may have just changed, hiding/showing cards
  updateCounts();
  updateSearchButtonState();
  db.updateSelections(userId, Array.from(selection.have), Array.from(selection.want));
}

// Only the currently active tab's selection is shown highlighted —
// switching tabs visually clears the other tab's highlight (but keeps the data).
function syncCardVisuals() {
  collectionsContainer.querySelectorAll('.card-item').forEach(el => {
    const id = el.dataset.cardId;
    const inHave = selection.have.has(id);
    const inWant = selection.want.has(id);
    el.classList.remove('selected-have', 'selected-want', 'selected');

    if (mode === 'have' && inHave) {
      el.classList.add('selected-have', 'selected');
    } else if (mode === 'want' && inWant) {
      el.classList.add('selected-want', 'selected');
    }
  });
}

function updateCounts() {
  document.getElementById('haveCount').textContent = selection.have.size;
  document.getElementById('wantCount').textContent = selection.want.size;
}

function updateSearchButtonState() {
  document.getElementById('searchBtn').disabled = !(selection.have.size > 0 && selection.want.size > 0);
  document.getElementById('selectionCounts').style.display =
    (selection.have.size > 0 || selection.want.size > 0) ? 'block' : 'none';
}

document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    document.querySelectorAll('.mode-tab').forEach(t2 => t2.classList.toggle('active', t2 === tab));
    syncCardVisuals();
  });
});

function ratingLabel(user) {
  if (!user.ratingCount) return '—';
  return (user.ratingSum / user.ratingCount).toFixed(1);
}

function enterApp() {
  const user = db.getUser(userId);
  if (!user) return;

  applyTheme(user.theme || 'dark');
  showScreen('screen-exchange-intro');
}

function enterCollectionsScreen() {
  const user = db.getUser(userId);
  if (!user) return;

  selection.have = new Set(user.have || []);
  selection.want = new Set(user.want || []);

  showScreen('screen-home');
  document.querySelector('.bottom-nav').classList.add('hidden');
  renderCollections();
  updateCounts();
  updateSearchButtonState();
  checkExpiredTrades();
}

document.getElementById('planetStartBtn').addEventListener('click', () => {
  enterCollectionsScreen();
});

/* ---------------------------------------------------------
   10. EXCHANGE SEARCH FLOW
   ---------------------------------------------------------
   IMPORTANT — how the "can I trade" check works here:
   The 3-day trade limit is PUBG Mobile's own rule, not something
   our app tracks automatically (a player could have created a
   trade outside the app, so we can't reliably know their real
   status). Instead, right after tapping "Search Exchange" we ask
   the player directly via a small modal: can you actually create
   a trade right now? Their answer is remembered for this search
   only (asked again next time). Matchmaking should only pair two
   players when at least one of them answered "yes" — if both
   said "no", search keeps looking (demo: just re-prompts).
   --------------------------------------------------------- */

const searchBtn = document.getElementById('searchBtn');
const cancelSearchBtn = document.getElementById('cancelSearchBtn');
let searchTimeout = null;
let activeTradeId = null;
let activeOpponent = null; // ДЕМО: заполняется случайным демо-игроком, см. заметку сверху файла
let canCreateTradeThisSearch = null; // true/false — player's answer in the limit modal for this search

searchBtn.addEventListener('click', () => {
  if (searchBtn.disabled) return;
  openTradeLimitModal();
});

function openTradeLimitModal() {
  canCreateTradeThisSearch = null;
  clearTimeout(limitInfoRevealTimeout);
  document.getElementById('limitYesBtn').classList.remove('chosen');
  document.getElementById('limitNoBtn').classList.remove('chosen');
  const info = document.getElementById('limitAnswerInfo');
  info.classList.remove('show', 'info-yes', 'info-no');
  info.textContent = '';
  document.getElementById('limitConfirmSearchBtn').style.display = 'none';
  document.getElementById('tradeLimitModalOverlay').classList.add('open');
}

function closeTradeLimitModal() {
  document.getElementById('tradeLimitModalOverlay').classList.remove('open');
}

let limitInfoRevealTimeout = null;

document.getElementById('limitYesBtn').addEventListener('click', () => {
  canCreateTradeThisSearch = true;
  document.getElementById('limitYesBtn').classList.add('chosen');
  document.getElementById('limitNoBtn').classList.remove('chosen');
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  revealLimitInfo('info-yes', t('limitYesInfo'));
});

document.getElementById('limitNoBtn').addEventListener('click', () => {
  canCreateTradeThisSearch = false;
  document.getElementById('limitNoBtn').classList.add('chosen');
  document.getElementById('limitYesBtn').classList.remove('chosen');
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
  revealLimitInfo('info-no', t('limitNoInfo'));
});

// The explanatory line + confirm button appear a moment after the yes/no
// choice, rather than instantly — gives the choice a second to register.
function revealLimitInfo(variantClass, text) {
  clearTimeout(limitInfoRevealTimeout);
  const info = document.getElementById('limitAnswerInfo');
  const confirmBtn = document.getElementById('limitConfirmSearchBtn');
  info.classList.remove('show', 'info-yes', 'info-no');
  confirmBtn.style.display = 'none';

  limitInfoRevealTimeout = setTimeout(() => {
    info.textContent = text;
    info.className = `limit-answer-info show ${variantClass}`;
    confirmBtn.style.display = 'block';
  }, 3000);
}

document.getElementById('limitConfirmSearchBtn').addEventListener('click', () => {
  closeTradeLimitModal();
  beginSearch();
});

function beginSearch() {
  showScreen('screen-search');
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');

  // ДЕМО: здесь позже встанет реальный запрос к серверу матчинга,
  // который может ждать сколько угодно (минуты/часы), пока не
  // найдётся подходящий живой игрок. Сейчас — фиксированная пауза.
  searchTimeout = setTimeout(() => {
    startMatch();
  }, 2600 + Math.random() * 1400);
}

cancelSearchBtn.addEventListener('click', () => {
  clearTimeout(searchTimeout);
  showScreen('screen-home');
});

function pickRandomCard(idSet) {
  const ids = Array.from(idSet);
  if (ids.length === 0) return null;
  const id = ids[Math.floor(Math.random() * ids.length)];
  for (const col of COLLECTIONS) {
    const found = col.cards.find(c => c.id === id);
    if (found) return found;
  }
  return null;
}

function startMatch() {
  // ДЕМО ИГРОК — заменить на реальный результат matchmaking-сервера.
  // Заблокированные игроки исключаются из пула — это и есть эффект блокировки.
  const user = db.getUser(userId);
  const blockedIds = new Set(user.blockedUsers || []);
  const availableOpponents = DEMO_OPPONENTS.filter(d => !blockedIds.has('demo_' + d.nickname));
  const pool = availableOpponents.length ? availableOpponents : DEMO_OPPONENTS;
  const demo = pool[Math.floor(Math.random() * pool.length)];
  activeOpponent = {
    id: 'demo_' + demo.nickname,
    nickname: demo.nickname,
    gameId: demo.gameId,
    avatarType: 'emoji',
    avatarEmoji: demo.avatarEmoji,
    bio: demo.bio,
    ratingSum: demo.rating * demo.ratingCount,
    ratingCount: demo.ratingCount,
    tradesTotal: demo.trades,
    tradesSuccess: Math.round(demo.trades * 0.92)
  };

  const myCard = pickRandomCard(selection.have);
  const theirCard = pickRandomCard(selection.want);

  const trade = {
    id: 'trade_' + Date.now(),
    playerA: userId,
    playerB: activeOpponent.id,
    cardFromA: myCard ? myCard.id : null,
    cardFromB: theirCard ? theirCard.id : null,
    status: 'pending',
    createdAt: Date.now(),
    deadlineAt: Date.now() + 24 * 60 * 60 * 1000,
    ratedByA: false,
    ratedByB: false
  };
  db.createTrade(trade);
  activeTradeId = trade.id;

  renderAvatarInto(document.getElementById('matchAvatar'), activeOpponent);
  document.getElementById('matchNick').textContent = activeOpponent.nickname;
  document.getElementById('matchRating').textContent = ratingLabel(activeOpponent);
  document.getElementById('matchGameId').textContent = activeOpponent.gameId;

  const preview = document.getElementById('matchSwapPreview');
  preview.innerHTML = (myCard && theirCard) ? `
    <div class="swap-side">
      <div class="swap-side-label">${t('giveCardLabel')}</div>
      <div class="swap-side-icon">${cardEmojiFallback(myCard)}</div>
      <div class="swap-side-name">${myCard.name[currentLang]}</div>
      <div class="swap-side-rarity" style="color:${RARITY[myCard.rarity].color}">${RARITY[myCard.rarity].label[currentLang]}</div>
    </div>
    <div class="swap-arrow-icon">⇄</div>
    <div class="swap-side">
      <div class="swap-side-label">${t('getCardLabel')}</div>
      <div class="swap-side-icon">${cardEmojiFallback(theirCard)}</div>
      <div class="swap-side-name">${theirCard.name[currentLang]}</div>
      <div class="swap-side-rarity" style="color:${RARITY[theirCard.rarity].color}">${RARITY[theirCard.rarity].label[currentLang]}</div>
    </div>
  ` : '';

  startExchangeTimer(trade.deadlineAt);

  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  showScreen('screen-match');
}

function cardEmojiFallback(cardObj) {
  return rarityIconFallback(cardObj.rarity);
}

let timerInterval = null;
function startExchangeTimer(deadlineAt) {
  clearInterval(timerInterval);
  function tick() {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      clearInterval(timerInterval);
      document.getElementById('exchangeTimer').textContent = '00:00:00';
      if (activeTradeId) {
        const trade = db.getTrade(activeTradeId);
        if (trade && trade.status === 'pending') {
          db.updateTrade(activeTradeId, { status: 'failed' });
          showToast(t('tradeExpiredToast'));
        }
      }
      return;
    }
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('exchangeTimer').textContent =
      `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

document.getElementById('copyIdBtn').addEventListener('click', () => {
  const id = document.getElementById('matchGameId').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(id).then(() => showToast(t('copiedToast'))).catch(() => showToast(id));
  } else {
    showToast(id);
  }
});

document.getElementById('completeExchangeBtn').addEventListener('click', () => {
  if (!activeTradeId) { showScreen('screen-home'); return; }
  const trade = db.getTrade(activeTradeId);
  if (trade) {
    db.updateTrade(activeTradeId, { status: 'completed' });
    const user = db.getUser(userId);
    db.updateUser(userId, {
      tradesTotal: (user.tradesTotal || 0) + 1,
      tradesSuccess: (user.tradesSuccess || 0) + 1
    });
  }
  clearInterval(timerInterval);
  openRatingScreen();
});

document.getElementById('viewProfileBtn').addEventListener('click', () => {
  if (activeOpponent) {
    openPlayerProfile(activeOpponent, 'screen-match');
    document.getElementById('reportFromProfileBtn').style.display = 'block';
  }
});

/* ---------------------------------------------------------
   11. RATING SCREEN
   --------------------------------------------------------- */

let selectedStars = 0;

function openRatingScreen() {
  selectedStars = 0;
  document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('filled'));
  document.getElementById('rateComment').value = '';
  document.getElementById('rateSubtitle').textContent =
    (currentLang === 'ru' ? 'Оцени игрока ' : 'Rate player ') + (activeOpponent ? activeOpponent.nickname : '');
  showScreen('screen-rate');
}

document.querySelectorAll('.star-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedStars = parseInt(btn.dataset.star, 10);
    document.querySelectorAll('.star-btn').forEach(b => {
      b.classList.toggle('filled', parseInt(b.dataset.star, 10) <= selectedStars);
    });
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  });
});

document.getElementById('submitRatingBtn').addEventListener('click', () => {
  if (selectedStars === 0 || !activeOpponent) { showScreen('screen-home'); return; }

  db.addReview({
    id: 'review_' + Date.now(),
    tradeId: activeTradeId,
    fromUserId: userId,
    toUserId: activeOpponent.id,
    fromNickname: db.getUser(userId).nickname,
    stars: selectedStars,
    comment: document.getElementById('rateComment').value.trim(),
    createdAt: Date.now()
  });

  showToast(t('savedToast'));
  enterApp();
});

document.getElementById('skipRatingBtn').addEventListener('click', () => enterApp());

/* ---------------------------------------------------------
   12. PLAYER PROFILE (public view)
   --------------------------------------------------------- */

let viewingPlayer = null;
let profileReturnScreen = 'screen-home';

function openPlayerProfile(playerLike, returnScreen) {
  viewingPlayer = playerLike;
  if (returnScreen) profileReturnScreen = returnScreen;

  renderAvatarInto(document.getElementById('playerAvatar'), playerLike);
  document.getElementById('playerNick').textContent = playerLike.nickname;
  document.getElementById('playerRatingBig').textContent = ratingLabel(playerLike);
  document.getElementById('playerRatingCount').textContent =
    playerLike.ratingCount ? `(${playerLike.ratingCount})` : '';
  const bio = playerLike.bio
    ? (typeof playerLike.bio === 'string' ? playerLike.bio : playerLike.bio[currentLang])
    : '';
  document.getElementById('playerBio').textContent = bio;
  document.getElementById('playerTradesTotal').textContent = playerLike.tradesTotal || 0;
  document.getElementById('playerTradesSuccess').textContent = playerLike.tradesSuccess || 0;

  const reviews = playerLike.id ? db.getReviewsForUser(playerLike.id) : [];
  const list = document.getElementById('playerReviewsList');
  list.innerHTML = reviews.length
    ? reviews.map(r => `
        <div class="review-item">
          <div class="review-item-head">
            <span class="review-item-author">${escapeHtml(r.fromNickname)}</span>
            <span class="review-item-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span>
          </div>
          ${r.comment ? `<div class="review-item-text">${escapeHtml(r.comment)}</div>` : ''}
        </div>
      `).join('')
    : `<div class="review-item-empty">${t('noReviewsYet')}</div>`;

  showScreen('screen-player');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.getElementById('playerBackBtn').addEventListener('click', () => showScreen(profileReturnScreen));

/* ---------------------------------------------------------
   13. REPORT MODAL
   --------------------------------------------------------- */

let reportTarget = null;
let selectedReason = null;

function openReportModal(playerLike) {
  reportTarget = playerLike;
  selectedReason = null;
  document.getElementById('reportOtherField').style.display = 'none';
  document.getElementById('reportOtherText').value = '';
  document.querySelectorAll('.report-opt').forEach(b => b.classList.remove('selected'));
  document.getElementById('submitReportBtn').disabled = true;
  document.getElementById('reportTargetLine').textContent =
    (currentLang === 'ru' ? 'На игрока: ' : 'Reporting: ') + playerLike.nickname;
  document.getElementById('reportModalOverlay').classList.add('open');
}

function closeReportModal() {
  document.getElementById('reportModalOverlay').classList.remove('open');
}

document.getElementById('reportFromMatchBtn').addEventListener('click', () => {
  if (activeOpponent) openReportModal(activeOpponent);
});
document.getElementById('reportFromProfileBtn').addEventListener('click', () => {
  if (viewingPlayer && viewingPlayer.id !== userId) openReportModal(viewingPlayer);
});
document.getElementById('reportCloseBtn').addEventListener('click', closeReportModal);
document.getElementById('reportModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'reportModalOverlay') closeReportModal();
});

document.querySelectorAll('.report-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedReason = btn.dataset.reason;
    document.querySelectorAll('.report-opt').forEach(b => b.classList.toggle('selected', b === btn));
    document.getElementById('reportOtherField').style.display = selectedReason === 'other' ? 'flex' : 'none';
    document.getElementById('submitReportBtn').disabled = selectedReason === 'other'
      ? document.getElementById('reportOtherText').value.trim().length === 0
      : false;
  });
});

document.getElementById('reportOtherText').addEventListener('input', (e) => {
  if (selectedReason === 'other') {
    document.getElementById('submitReportBtn').disabled = e.target.value.trim().length === 0;
  }
});

document.getElementById('submitReportBtn').addEventListener('click', () => {
  if (!selectedReason || !reportTarget) return;
  db.createReport({
    id: 'report_' + Date.now(),
    fromUserId: userId,
    targetUserId: reportTarget.id || reportTarget.nickname,
    reason: selectedReason,
    details: selectedReason === 'other' ? document.getElementById('reportOtherText').value.trim() : '',
    tradeId: activeTradeId,
    createdAt: Date.now(),
    status: 'open'
  });
  closeReportModal();
  showToast(t('reportSent'));
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
});

/* ---------------------------------------------------------
   13b. BLOCK PLAYER
   ---------------------------------------------------------
   Local block only (per your decision): hides the blocked
   player from future matchmaking results. Does NOT send
   a report to the moderator by itself — reporting is a
   separate, explicit action.
   --------------------------------------------------------- */

function blockPlayer(playerLike) {
  if (!playerLike || !playerLike.id) return;
  const user = db.getUser(userId);
  const blocked = new Set(user.blockedUsers || []);
  blocked.add(playerLike.id);
  db.updateUser(userId, { blockedUsers: Array.from(blocked) });
  showToast(t('blockedToast'));
  if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
}

function unblockPlayer(targetId) {
  const user = db.getUser(userId);
  const blocked = new Set(user.blockedUsers || []);
  blocked.delete(targetId);
  db.updateUser(userId, { blockedUsers: Array.from(blocked) });
  showToast(t('unblockedToast'));
  renderBlockedList();
}

document.getElementById('blockFromMatchBtn').addEventListener('click', () => {
  if (!activeOpponent) return;
  if (confirm(t('blockConfirmTitle'))) {
    blockPlayer(activeOpponent);
  }
});

function renderBlockedList() {
  const user = db.getUser(userId);
  const blockedIds = user.blockedUsers || [];
  const list = document.getElementById('blockedList');

  if (!blockedIds.length) {
    list.innerHTML = `<div class="trades-empty">${t('noBlockedYet')}</div>`;
    return;
  }

  list.innerHTML = blockedIds.map(id => {
    const nick = id.startsWith('demo_') ? id.replace('demo_', '') : id;
    return `
      <div class="trade-item">
        <span class="blocked-item-nick">${escapeHtml(nick)}</span>
        <button class="unblock-btn" data-unblock-id="${id}">${t('unblockBtn')}</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-unblock-id]').forEach(btn => {
    btn.addEventListener('click', () => unblockPlayer(btn.dataset.unblockId));
  });
}

/* ---------------------------------------------------------
   14. MY PROFILE SCREEN
   --------------------------------------------------------- */

function refreshProfileScreen() {
  const user = db.getUser(userId);
  if (!user) return;

  renderAvatarInto(document.getElementById('profileAvatarPreview'), user);
  document.getElementById('editNickInput').value = user.nickname;
  document.getElementById('editNickInput').closest('.field').classList.remove('has-error', 'has-success');
  document.getElementById('editNickStatusIcon').classList.remove('show');

  applyTheme(user.theme || 'dark');
  renderBlockedList();
}

// -- profile screen avatar modal (same crop/validate helpers as registration) --
document.getElementById('profileEditAvatarBtn').addEventListener('click', () => {
  document.getElementById('profileAvatarModalOverlay').classList.add('open');
});
document.getElementById('profileAvatarModalCloseBtn').addEventListener('click', () => {
  document.getElementById('profileAvatarModalOverlay').classList.remove('open');
});
document.getElementById('profileAvatarCancelBtn').addEventListener('click', () => {
  document.getElementById('profileAvatarModalOverlay').classList.remove('open');
});
document.getElementById('chooseFromGalleryBtn').addEventListener('click', () => {
  document.getElementById('avatarFileInput').click();
});
document.getElementById('avatarFileInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  handleAvatarFileSelected(file, (dataUrl) => {
    db.updateUser(userId, { avatarType: 'custom', avatarImage: dataUrl });
    renderAvatarInto(document.getElementById('profileAvatarPreview'), db.getUser(userId));
    document.getElementById('profileAvatarModalOverlay').classList.remove('open');
    showToast(t('savedToast'));
  });
  e.target.value = '';
});

const NICKNAME_CHANGE_LIMIT_MS = 15 * 24 * 60 * 60 * 1000;

document.getElementById('saveProfileBtn').addEventListener('click', () => {
  const nickInput = document.getElementById('editNickInput');
  const nickField = nickInput.closest('.field');
  const newNick = nickInput.value.trim();
  const user = db.getUser(userId);

  if (!newNick) return;

  // No-op if nickname didn't actually change — don't burn the 15-day limit
  if (newNick.toLowerCase() === user.nickname.toLowerCase()) {
    showToast(t('savedToast'));
    return;
  }

  if (!LATIN_NICK_RE.test(newNick)) {
    nickField.classList.add('has-error');
    const errEl = nickField.querySelector('.field-error');
    if (errEl) errEl.textContent = t('nicknameLatinOnly');
    return;
  }

  if (user.lastNicknameChangeAt) {
    const remaining = user.lastNicknameChangeAt + NICKNAME_CHANGE_LIMIT_MS - Date.now();
    if (remaining > 0) {
      const daysLeft = Math.ceil(remaining / (24 * 60 * 60 * 1000));
      showToast(`${t('nickChangeTooSoon')} ${currentLang === 'ru' ? 'через ' + daysLeft + ' дн.' : 'in ' + daysLeft + ' days'}`);
      return;
    }
  }

  if (db.isNicknameTaken(newNick, userId)) {
    nickField.classList.add('has-error');
    const errEl = nickField.querySelector('.field-error');
    if (errEl) errEl.textContent = t('nicknameTaken');
    return;
  }
  nickField.classList.remove('has-error');

  db.updateUser(userId, { nickname: newNick, lastNicknameChangeAt: Date.now() });
  setFieldStatusIcon(document.getElementById('editNickStatusIcon'), nickField, 'ok');
  showToast(t('savedToast'));
});

/* ---------------------------------------------------------
   14b. DELETE ACCOUNT (double confirmation, real deletion)
   --------------------------------------------------------- */

document.getElementById('deleteAccountBtn').addEventListener('click', () => {
  document.getElementById('deleteAccountOverlay').classList.add('open');
});

document.getElementById('deleteAccountCloseBtn').addEventListener('click', () => {
  document.getElementById('deleteAccountOverlay').classList.remove('open');
});

document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
  document.getElementById('deleteAccountOverlay').classList.remove('open');
});

document.getElementById('confirmDeleteStep1Btn').addEventListener('click', () => {
  document.getElementById('deleteAccountOverlay').classList.remove('open');
  document.getElementById('deleteAccountOverlay2').classList.add('open');
});

document.getElementById('cancelDeleteBtn2').addEventListener('click', () => {
  document.getElementById('deleteAccountOverlay2').classList.remove('open');
});

document.getElementById('confirmDeleteStep2Btn').addEventListener('click', () => {
  document.getElementById('deleteAccountOverlay2').classList.remove('open');
  db.deleteUser(userId);
  localStorage.removeItem(SESSION_KEY);
  showToast(t('accountDeletedToast'));
  // Reload the flow as if this were a brand-new visitor
  setTimeout(() => {
    location.reload();
  }, 900);
});

function resolveOpponentDisplayName(opponentId) {
  if (opponentId.startsWith('demo_')) return opponentId.replace('demo_', '');
  const stillExists = db.getUser(opponentId);
  return stillExists ? opponentId : `💀 ${t('deletedAccountLabel')}`;
}

function renderMyTrades() {
  const trades = db.getTradesForUser(userId);
  const list = document.getElementById('myTradesList');
  if (!trades.length) {
    list.innerHTML = `<div class="trades-empty">${t('noTradesYet')}</div>`;
    return;
  }
  list.innerHTML = trades.slice(0, 10).map(trade => {
    const opponentIsA = trade.playerA === userId;
    const opponentId = opponentIsA ? trade.playerB : trade.playerA;
    const statusClass = 'trade-status-' + (trade.status === 'completed' ? 'completed' : trade.status === 'failed' ? 'failed' : 'pending');
    const statusLabel = trade.status === 'completed' ? `✅ ${t('tradeStatusCompleted')}` : trade.status === 'failed' ? `❌ ${t('tradeStatusFailed')}` : t('tradeStatusPending');
    const opponentNick = resolveOpponentDisplayName(opponentId);
    return `
      <div class="trade-item" data-trade-id="${trade.id}">
        <span class="trade-item-nick">${escapeHtml(opponentNick)}</span>
        <span class="trade-item-status ${statusClass}">${statusLabel}</span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-trade-id]').forEach(el => {
    el.addEventListener('click', () => openTradeDetail(el.dataset.tradeId));
  });
}

function findCardById(cardId) {
  if (!cardId) return null;
  for (const col of COLLECTIONS) {
    const found = col.cards.find(c => c.id === cardId);
    if (found) return found;
  }
  return null;
}

function openTradeDetail(tradeId) {
  const trade = db.getTrade(tradeId);
  if (!trade) return;

  const opponentIsA = trade.playerA === userId;
  const opponentId = opponentIsA ? trade.playerB : trade.playerA;
  const opponentNick = resolveOpponentDisplayName(opponentId);

  const gaveCard = findCardById(opponentIsA ? trade.cardFromA : trade.cardFromB);
  const gotCard = findCardById(opponentIsA ? trade.cardFromB : trade.cardFromA);

  const statusClass = trade.status === 'completed' ? 'status-completed' : trade.status === 'failed' ? 'status-failed' : 'status-pending';
  const statusLabel = trade.status === 'completed' ? `✅ ${t('tradeStatusCompleted')}` : trade.status === 'failed' ? `❌ ${t('tradeStatusFailed')}` : t('tradeStatusPending');
  const dateStr = new Date(trade.createdAt).toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  document.getElementById('tradeDetailBody').innerHTML = `
    <div class="trade-detail-row">
      <span class="trade-detail-label">${t('tradeDetailWith')}</span>
      <span class="trade-detail-value">${escapeHtml(opponentNick)}</span>
    </div>
    <div class="trade-detail-row">
      <span class="trade-detail-label">${t('tradeDetailDate')}</span>
      <span class="trade-detail-value">${dateStr}</span>
    </div>
    <div class="trade-detail-row">
      <span class="trade-detail-label">${t('tradeDetailStatus')}</span>
      <span class="trade-detail-value ${statusClass}">${statusLabel}</span>
    </div>
    ${gaveCard ? `
    <div class="trade-detail-row">
      <span class="trade-detail-label">${t('tradeDetailGaveCard')}</span>
      <span class="trade-detail-value">${gaveCard.name[currentLang]}</span>
    </div>` : ''}
    ${gotCard ? `
    <div class="trade-detail-row">
      <span class="trade-detail-label">${t('tradeDetailGotCard')}</span>
      <span class="trade-detail-value">${gotCard.name[currentLang]}</span>
    </div>` : ''}
  `;

  document.getElementById('tradeDetailOverlay').classList.add('open');
}

document.getElementById('tradeDetailCloseBtn').addEventListener('click', () => {
  document.getElementById('tradeDetailOverlay').classList.remove('open');
});
document.getElementById('tradeDetailOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'tradeDetailOverlay') document.getElementById('tradeDetailOverlay').classList.remove('open');
});

function checkExpiredTrades() {
  const trades = db.getTradesForUser(userId);
  trades.forEach(trade => {
    if (trade.status === 'pending' && trade.deadlineAt < Date.now()) {
      db.updateTrade(trade.id, { status: 'failed' });
    }
  });
}

/* ---------------------------------------------------------
   15. RATING SCREEN (self) — average score + reviews only,
   no leaderboard/ranking, per your decision to drop the top-100.
   --------------------------------------------------------- */

function refreshRatingScreen() {
  const user = db.getUser(userId);
  if (!user) return;

  document.getElementById('myRatingBig').textContent = ratingLabel(user);
  document.getElementById('myRatingCount').textContent = user.ratingCount
    ? `${user.ratingCount} ${currentLang === 'ru' ? 'оценок' : 'ratings'}`
    : (currentLang === 'ru' ? 'Пока нет оценок' : 'No ratings yet');

  const reviews = db.getReviewsForUser(userId);
  const list = document.getElementById('myReviewsList');
  list.innerHTML = reviews.length
    ? reviews.map(r => `
        <div class="review-item">
          <div class="review-item-head">
            <span class="review-item-author">${escapeHtml(r.fromNickname)}</span>
            <span class="review-item-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span>
          </div>
          ${r.comment ? `<div class="review-item-text">${escapeHtml(r.comment)}</div>` : ''}
        </div>
      `).join('')
    : `<div class="review-item-empty">${t('noReviewsYet')}</div>`;
}

/* ---------------------------------------------------------
   15b. HISTORY SCREEN
   --------------------------------------------------------- */

function refreshHistoryScreen() {
  renderMyTrades();
}

/* ---------------------------------------------------------
   16. BOOTSTRAP
   --------------------------------------------------------- */

(function init() {
  applyI18n();

  const existingUser = db.getUser(userId);
  if (existingUser) {
    enterApp();
  } else {
    showScreen('screen-register');
  }
})();

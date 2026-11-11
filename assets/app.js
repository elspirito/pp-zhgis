/* ============================================================
   ПП-каталог рецептов — логика приложения
   Без зависимостей, работает из файла и с локального сервера
   ============================================================ */
(function () {
  'use strict';

  const DATA = window.COOKBOOK;
  if (!DATA) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">Не удалось загрузить данные рецептов.</p>';
    return;
  }

  const SHORT_SECTION = {
    'Минимум усилий — максимум пользы': 'Минимум усилий',
    'Завтраки и перекусы': 'Завтраки',
    'Сборник лучших рецептов из творога': 'Из творога',
    'Фастфуд для похудения': 'Фастфуд',
    'Хлебобулочные': 'Выпечка',
    'Гарниры помимо гречки': 'Гарниры',
    'Десерты': 'Десерты',
    'Три полезных перекуса': 'Перекусы',
    'Во время переездов без возможности готовить': 'Без готовки',
    'Новогодний стол': 'Новый год',
    'Гайды и лайфхаки': 'Гайды',
    'Другие рецепты': 'Другое'
  };

  const TAG_CLASS = { 'Много белка': 'protein', 'Хит': 'hit', 'Быстро': 'fast' };
  const TAG_ORDER = ['Много белка', 'Хит', 'Быстро', 'Запекаем', 'Жарим', 'Варим', 'Тушим', 'Блендерим', 'Аэрогриль', 'Су-вид', 'Красивое', 'Фри'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const normalize = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const wordTokens = (s) => normalize(s).split(/\s+/).filter(Boolean);
  const stems = (s) => wordTokens(s).filter((w) => w.length > 1).map((w) => (w.length >= 5 ? w.slice(0, 4) : w));
  const SEARCH_ALIASES = { 'куриц': 'кури', 'говяд': 'говя', 'тунец': 'тун', 'свини': 'свин' };
  const searchStems = (s) => wordTokens(s).filter((w) => w.length > 1).map((w) => {
    let stem = w;
    if (w.length >= 6) stem = w.slice(0, 5);
    else if (w.length === 4) stem = /[аеёиоуыэюяь]$/.test(w) ? w.slice(0, 3) : w;
    return SEARCH_ALIASES[stem] || stem;
  });

  const plural = (n, forms) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  };

  const nf = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => (n == null ? '—' : nf.format(n));

  const formatWeight = (g) => {
    if (!g) return null;
    if (g >= 1000) return (g / 1000).toFixed(1).replace('.', ',') + ' кг';
    return g + ' г';
  };

  const formatMacro = (v) => (v == null ? '—' : String(v).replace('.', ','));

  /* ---------- localStorage ---------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* noop */ }
    }
  };

  const favorites = new Set(store.get('ppsk.favs', []));
  let recentSearches = store.get('ppsk.recent', []).filter((x) => typeof x === 'string').slice(0, 8);
  const saveRecent = () => store.set('ppsk.recent', recentSearches.slice(0, 8));
  const mqMobile = window.matchMedia('(max-width: 900px)');
  const isMobile = () => mqMobile.matches;
  let shopping = store.get('ppsk.shopping', []);
  const saveFavs = () => store.set('ppsk.favs', Array.from(favorites));
  const saveShopping = () => store.set('ppsk.shopping', shopping);

  /* ---------- derived data ---------- */
  const RECIPES = DATA.recipes.map((r, index) => {
    const variants = r.nutrition || [];
    const withKcal = variants.filter((v) => typeof v.kcal100 === 'number');
    const primary = (withKcal.length ? withKcal : variants).slice().sort((a, b) => (a.kcal100 ?? 1e9) - (b.kcal100 ?? 1e9))[0] || {};
    const minKcal = withKcal.length ? Math.min(...withKcal.map((v) => v.kcal100)) : 999;
    const maxProtein = Math.max(...variants.map((v) => v.protein100 ?? 0), 0);
    const maxKcal = withKcal.length ? Math.max(...withKcal.map((v) => v.kcal100)) : 999;
    const searchText = normalize([
      r.title, ...(r.tags || []),
      ...(r.ingredients || []).map((i) => i.name)
    ].join(' '));
    const searchWords = searchText.split(' ').filter(Boolean);
    return Object.assign({}, r, {
      _index: index,
      _primary: primary,
      _minKcal: minKcal,
      _maxKcal: maxKcal,
      _maxProtein: maxProtein,
      _search: ' ' + searchText + ' ',
      _words: searchWords

    });
  });

  const ALL_TAGS = TAG_ORDER.filter((t) => DATA.tags.includes(t)).concat(DATA.tags.filter((t) => !TAG_ORDER.includes(t)));

  /* ---------- state ---------- */
  const state = {
    q: '',
    section: 'all',
    tags: new Set(),
    maxKcal: 400,
    minProtein: 0,
    favOnly: false,
    sort: 'book',
    filtersOpen: false
  };

  let currentRecipe = null;
  let currentList = RECIPES.slice();
  let currentIndex = -1;
  let lastFocused = null;
  let searchTimer = null;
  let sheetSearchTimer = null;

  /* ---------- история: системная кнопка «назад» закрывает слои ---------- */
  const hashFor = (kind, id) => (kind === 'recipe' ? '#recipe=' + encodeURIComponent(id) : '#' + kind);
  function pushUI(kind, id) {
    try { history.pushState({ ui: kind, id: id || null }, '', hashFor(kind, id)); } catch (e) { /* noop */ }
  }
  function replaceUI(kind, id) {
    try {
      if (!kind) history.replaceState({}, '', location.pathname + location.search);
      else history.replaceState({ ui: kind, id: id || null }, '', hashFor(kind, id));
    } catch (e) { /* noop */ }
  }
  // Закрытие слоя: если мы «стоим» на своей записи истории — идём назад,
  // иначе просто чистим адрес (например, при прямом переходе по ссылке).
  function closeUI(kind) {
    const st = history.state;
    if (st && st.ui === kind) { history.back(); return true; }
    if (location.hash === hashFor(kind, st && st.id)) { replaceUI(null); }
    return false;
  }

  // стек открытых слоёв — чтобы Esc и «назад» закрывали верхний
  const overlays = [];
  const pushOverlay = (name) => {
    if (!overlays.includes(name)) overlays.push(name);
    syncBodyLock();
  };
  const popOverlay = (name) => {
    const i = overlays.indexOf(name);
    if (i > -1) overlays.splice(i, 1);
    syncBodyLock();
  };
  const topOverlay = () => overlays[overlays.length - 1] || null;
  function syncBodyLock() {
    document.body.classList.toggle('no-scroll', overlays.length > 0);
  }

  /* ---------- matching ---------- */
  function matches(r, opts = {}) {
    const section = opts.section !== undefined ? opts.section : state.section;
    const tags = opts.tags || state.tags;
    const maxKcal = opts.maxKcal !== undefined ? opts.maxKcal : state.maxKcal;
    const minProtein = opts.minProtein !== undefined ? opts.minProtein : state.minProtein;
    const favOnly = opts.favOnly !== undefined ? opts.favOnly : state.favOnly;
    const q = opts.q !== undefined ? opts.q : state.q;

    if (section !== 'all' && r.section !== section) return false;
    if (favOnly && !favorites.has(r.id)) return false;
    if (maxKcal < 400 && r._minKcal > maxKcal) return false;
    if (minProtein > 0 && r._maxProtein < minProtein) return false;
    for (const t of tags) if (!r.tags.includes(t)) return false;
    if (q) {
      const qs = searchStems(q);
      for (const s of qs) if (!r._words.some((w) => w.startsWith(s))) return false;
    }
    return true;
  }

  function baseMatches(r) {
    return matches(r, { section: 'all', tags: new Set() });
  }

  function getVisible() {
    const list = RECIPES.filter((r) => matches(r));
    const collator = new Intl.Collator('ru');
    switch (state.sort) {
      case 'kcal-asc': list.sort((a, b) => a._minKcal - b._minKcal || a._index - b._index); break;
      case 'protein-desc': list.sort((a, b) => b._maxProtein - a._maxProtein || a._minKcal - b._minKcal); break;
      case 'title': list.sort((a, b) => collator.compare(a.title, b.title)); break;
      default: list.sort((a, b) => a._index - b._index);
    }
    return list;
  }

  const hasActiveFilters = () => state.q || state.section !== 'all' || state.tags.size || state.maxKcal < 400 || state.minProtein > 0 || state.favOnly;

  /* ---------- rendering helpers ---------- */
  function badgeHTML(tag) {
    const cls = TAG_CLASS[tag] ? ' ' + TAG_CLASS[tag] : '';
    return `<span class="badge${cls}">${esc(tag)}</span>`;
  }

  function cardBadges(r) {
    const tags = r.tags.slice().sort((a, b) => {
      const ia = TAG_ORDER.indexOf(a), ib = TAG_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    const shown = tags.slice(0, 2).map(badgeHTML).join('');
    const rest = tags.length > 2 ? `<span class="badge">+${tags.length - 2}</span>` : '';
    return shown + rest;
  }

  function macroHTML(n) {
    return `<div class="macros">
      <span class="macro p"><i></i>Б <b>${formatMacro(n.protein100)}</b></span>
      <span class="macro f"><i></i>Ж <b>${formatMacro(n.fat100)}</b></span>
      <span class="macro c"><i></i>У <b>${formatMacro(n.carbs100)}</b></span>
    </div>`;
  }

  function highlight(text, q) {
    const toks = wordTokens(q).filter((t) => t.length >= 2 && t.length < 30);
    if (!toks.length) return esc(text);
    const re = new RegExp('(' + toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    return String(text).split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
  }

  function cardHTML(r, i) {
    const n = r._primary;
    const w = n.weight || r.weight;
    const weight = w ? formatWeight(w) : null;
    const foot = weight
      ? `<span>≈ ${weight} · ${fmt(n.kcalTotal)} ккал</span>`
      : `<span>${fmt(n.kcal100)} ккал / 100 г</span>`;
    const variantPill = r.nutrition.length > 1 ? `<span class="variants-pill">${r.nutrition.length} ${plural(r.nutrition.length, ['вариант', 'варианта', 'вариантов'])}</span>` : '';
    return `<article class="card" data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Открыть рецепт: ${esc(r.title)}" style="--i:${i % 9}">
      <div class="card-media">
        <img src="${esc(r.photo)}" alt="${esc(r.title)}" loading="lazy" decoding="async">
        <div class="card-badges">${cardBadges(r)}</div>
        <button class="fav-btn" type="button" data-fav="${esc(r.id)}" aria-pressed="${favorites.has(r.id)}" aria-label="Добавить в избранное" title="В избранное">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.2S3.8 15.4 3.8 9.6A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.2 2.6c0 5.8-8.2 10.6-8.2 10.6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </button>
        <div class="kcal-pill"><b>${fmt(n.kcal100)}</b> ккал<span>/100 г</span></div>
        ${variantPill}
      </div>
      <div class="card-body">
        <div class="card-cat">${esc(r.subsection || SHORT_SECTION[r.section] || r.section)}</div>
        <h3 class="card-title">${highlight(r.title, state.q)}</h3>
        ${macroHTML(n)}
        <div class="card-foot">${foot}<span class="card-open">Рецепт <span aria-hidden="true">→</span></span></div>
      </div>
    </article>`;
  }

  /* ---------- catalog rendering ---------- */
  function renderCategories() {
    const row = $('#catRow');
    const items = [];
    const allCount = RECIPES.filter((r) => baseMatches(r)).length;
    items.push(`<button class="cat-btn" role="tab" aria-selected="${state.section === 'all'}" data-section="all">
      <span class="emoji">📚</span>Все рецепты <span class="n">${allCount}</span></button>`);
    for (const s of DATA.sections) {
      const count = RECIPES.filter((r) => baseMatches(r) && r.section === s.name).length;
      items.push(`<button class="cat-btn" role="tab" aria-selected="${state.section === s.name}" data-section="${esc(s.name)}">
        <span class="emoji">${s.emoji}</span>${esc(SHORT_SECTION[s.name] || s.name)} <span class="n">${count}</span></button>`);
    }
    const scroller = document.querySelector('.cat-scroller');
    const keep = scroller ? scroller.scrollLeft : 0;
    row.innerHTML = items.join('');
    if (scroller) scroller.scrollLeft = keep;
  }

  function renderTagCloud() {
    const cloud = $('#tagCloud');
    const counts = {};
    const base = RECIPES.filter(baseMatches);
    for (const t of ALL_TAGS) counts[t] = base.filter((r) => r.tags.includes(t)).length;
    cloud.innerHTML = ALL_TAGS.map((t) => {
      const active = state.tags.has(t);
      return `<button type="button" class="tag-chip" data-tag="${esc(t)}" aria-pressed="${active}" ${counts[t] === 0 && !active ? 'disabled' : ''}>${esc(t)} <span class="n">${counts[t]}</span></button>`;
    }).join('');
  }

  function renderQuickChips() {
    const quick = $('#quickChips');
    const defs = [
      { icon: '🔥', label: 'До 100 ккал', type: 'kcal', value: 100 },
      { icon: '💪', label: 'Много белка', type: 'tag', value: 'Много белка' },
      { icon: '⚡', label: 'Быстро', type: 'tag', value: 'Быстро' },
      { icon: '⭐', label: 'Хиты', type: 'tag', value: 'Хит' },
      { icon: '🍳', label: 'Завтраки', type: 'section', value: 'Завтраки и перекусы' },
      { icon: '🍫', label: 'Десерты', type: 'section', value: 'Десерты' }
    ];
    quick.innerHTML = defs.map((d) => {
      let active = false;
      if (d.type === 'kcal') active = state.maxKcal === d.value;
      if (d.type === 'tag') active = state.tags.has(d.value);
      if (d.type === 'section') active = state.section === d.value;
      return `<button type="button" class="quick-chip" aria-pressed="${active}" data-quick="${d.type}" data-value="${esc(d.value)}"><span>${d.icon}</span>${esc(d.label)}</button>`;
    }).join('');
  }

  function renderActiveChips() {
    const box = $('#activeChips');
    const chips = [];
    for (const t of state.tags) chips.push(`<span class="chip">${esc(t)}<button type="button" data-remove-tag="${esc(t)}" aria-label="Убрать фильтр ${esc(t)}">×</button></span>`);
    if (state.maxKcal < 400) chips.push(`<span class="chip">до ${state.maxKcal} ккал<button type="button" data-remove-kcal aria-label="Убрать фильтр калорий">×</button></span>`);
    if (state.minProtein > 0) chips.push(`<span class="chip">белка от ${state.minProtein} г<button type="button" data-remove-protein aria-label="Убрать фильтр белка">×</button></span>`);
    if (state.favOnly) chips.push(`<span class="chip">избранное<button type="button" data-remove-fav aria-label="Убрать фильтр избранного">×</button></span>`);
    box.innerHTML = chips.join('');
    $('#filterDot').hidden = !(state.tags.size || state.maxKcal < 400 || state.minProtein > 0 || state.favOnly);
  }

  function updateRangeFill(input) {
    const min = Number(input.min), max = Number(input.max), val = Number(input.value);
    input.style.setProperty('--fill', ((val - min) / (max - min) * 100) + '%');
  }

  function renderResults() {
    const list = getVisible();
    currentList = list;
    $('#grid').innerHTML = list.map(cardHTML).join('');
    $('#empty').hidden = list.length > 0;

    let title = 'Все рецепты';
    if (state.favOnly) title = 'Избранное';
    else if (state.q) title = 'Результаты поиска';
    else if (state.section !== 'all') title = SHORT_SECTION[state.section] || state.section;

    $('#resultsTitle').textContent = title;

    const emptyBox = $('#empty');
    if (!list.length) {
      const h = emptyBox.querySelector('h3');
      const pEl = emptyBox.querySelector('p');
      if (state.favOnly) {
        h.textContent = 'В избранном пока пусто';
        pEl.textContent = 'Нажмите на сердечко у любого рецепта — он появится здесь.';
      } else if (state.q) {
        h.textContent = 'Ничего не нашлось';
        pEl.textContent = 'Попробуйте другой запрос или снимите часть фильтров — в книге точно есть что-то вкусное.';
      } else {
        h.textContent = 'Под эти фильтры ничего не подошло';
        pEl.textContent = 'Смягчите ограничения по калориям или белку — и рецепты появятся.';
      }
    }

    const avg = list.length ? Math.round(list.reduce((s, r) => s + (r._primary.kcal100 || 0), 0) / list.length) : 0;
    const parts = [`${list.length} ${plural(list.length, ['рецепт', 'рецепта', 'рецептов'])}`];
    if (list.length) parts.push(`${avg} ккал в среднем на 100 г`);
    if (state.q) parts.push(`по запросу «${state.q}»`);
    $('#resultsMeta').textContent = parts.join(' · ');

    $('#resetBtn').hidden = !hasActiveFilters();
    $('#favBtn').setAttribute('aria-pressed', state.favOnly ? 'true' : 'false');
    if (!state.favOnly) {
      const current = $('#tabbar .tab[aria-current="page"]');
      if (current && current.dataset.tab === 'favorites') setActiveTab('catalog');
    }
  }

  function renderAll() {
    renderCategories();
    renderTagCloud();
    renderQuickChips();
    renderActiveChips();
    renderResults();
    renderCounts();
  }

  function renderCounts() {
    $('#favCount').textContent = favorites.size;
    $('#shopCount').textContent = shopping.length;
    $('#heroTotal').textContent = RECIPES.length;
    $('#footerCount').textContent = RECIPES.length;

    const tabFav = $('#tabFavCount');
    if (tabFav) {
      tabFav.textContent = favorites.size;
      tabFav.hidden = favorites.size === 0;
    }
    const tabShop = $('#tabShopCount');
    if (tabShop) {
      tabShop.textContent = shopping.length;
      tabShop.hidden = shopping.length === 0;
    }
    const mCount = $('#mFilterCount');
    if (mCount) {
      const n = activeFilterCount();
      mCount.textContent = n;
      mCount.hidden = n === 0;
    }
    const mReset = $('#mResetBtn');
    if (mReset) mReset.hidden = !hasActiveFilters();
    const seg = $$('#sortSeg button');
    seg.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort)));
  }

  function activeFilterCount() {
    return state.tags.size
      + (state.maxKcal < 400 ? 1 : 0)
      + (state.minProtein > 0 ? 1 : 0)
      + (state.favOnly ? 1 : 0);
  }

  /* ---------- filters UI ---------- */
  function syncFilterInputs() {
    const kcal = $('#kcalRange');
    kcal.value = state.maxKcal;
    updateRangeFill(kcal);
    $('#kcalOut').textContent = state.maxKcal >= 400 ? 'без ограничений' : 'до ' + state.maxKcal + ' ккал';
    $$('#kcalPresets button').forEach((b) => b.classList.toggle('active', Number(b.dataset.kcal) === state.maxKcal));

    const protein = $('#proteinRange');
    protein.value = state.minProtein;
    updateRangeFill(protein);
    $('#proteinOut').textContent = state.minProtein > 0 ? 'от ' + state.minProtein + ' г' : 'без ограничений';
    $$('#proteinPresets button').forEach((b) => b.classList.toggle('active', Number(b.dataset.protein) === state.minProtein));

    $('#favOnly').checked = state.favOnly;
    $('#sortSelect').value = state.sort;
  }

  function setFilterPanel(open, opts = {}) {
    const panel = $('#filterPanel');
    const isOpen = !panel.hidden;
    if (open === isOpen && !opts.force) return;

    // закрытие/открытие через историю, чтобы работала системная кнопка «назад»
    if (!open && isOpen && !opts.fromHistory && isMobile() && closeUI('filters')) return;
    if (open && !isOpen && opts.push !== false && isMobile()) pushUI('filters');

    applyFilterPanel(open);
  }

  function applyFilterPanel(open) {
    const panel = $('#filterPanel');
    state.filtersOpen = open;
    panel.hidden = !open;
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    $('#filterBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    const mBtn = $('#mFilterBtn');
    if (mBtn) mBtn.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (isMobile()) {
      if (open) pushOverlay('filters');
      else popOverlay('filters');
      if (open) {
        panel.style.transform = '';
        const first = panel.querySelector('.tag-chip:not([disabled]), button');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 220);
      }
    }
  }

  function resetFilters() {
    state.q = '';
    state.section = 'all';
    state.tags.clear();
    state.maxKcal = 400;
    state.minProtein = 0;
    state.favOnly = false;
    state.sort = 'book';
    $('#searchInput').value = '';
    $('#searchClear').hidden = true;
    applySearch('');
    syncFilterInputs();
    renderAll();
    setActiveTab('catalog');
  }

  /* ---------- modal ---------- */
  function nutritionCells(v) {
    const total = (val, unit) => (val == null ? '' : `<div class="t">${fmt(val)}${unit ? ' ' + unit : ''} на блюдо</div>`);
    return `
      <div class="nutri-cell"><div class="v">${fmt(v.kcal100)}<small>ккал</small></div><div class="l">Калории</div>${v.kcalTotal ? `<div class="t">${fmt(v.kcalTotal)} на блюдо</div>` : ''}</div>
      <div class="nutri-cell"><div class="v">${formatMacro(v.protein100)}<small>г</small></div><div class="l">Белки</div>${v.proteinTotal ? `<div class="t">${fmt(v.proteinTotal)} г на блюдо</div>` : ''}</div>
      <div class="nutri-cell"><div class="v">${formatMacro(v.fat100)}<small>г</small></div><div class="l">Жиры</div>${v.fatTotal ? `<div class="t">${fmt(v.fatTotal)} г на блюдо</div>` : ''}</div>
      <div class="nutri-cell"><div class="v">${formatMacro(v.carbs100)}<small>г</small></div><div class="l">Углеводы</div>${v.carbsTotal ? `<div class="t">${fmt(v.carbsTotal)} г на блюдо</div>` : ''}</div>`;
  }

  const GROUP_STOP = new Set(['блин', 'блина', 'блины', 'блино', 'тест', 'тесто', 'начи', 'соус', 'для', 'или', 'вариант', 'овощ', 'глаз']);
  function groupMatches(label, group) {
    if (!label || !group) return false;
    const clean = (s) => stems(String(s).replace(/[:]/g, ' ')).filter((w) => w.length >= 2 && !GROUP_STOP.has(w));
    const a = clean(label);
    const b = clean(group);
    if (!a.length) return false;
    const overlap = a.filter((w) => b.some((g) => g === w || g.startsWith(w) || w.startsWith(g))).length;
    return overlap >= Math.min(2, a.length);
  }

  function ingredientsHTML(r, activeVariant) {
    const label = activeVariant != null && r.nutrition[activeVariant] ? r.nutrition[activeVariant].label : null;
    let lastGroup = '__none__';
    const parts = [];
    r.ingredients.forEach((it, i) => {
      const g = it.group || null;
      if (g && g !== lastGroup) {
        const hl = groupMatches(label, g) ? ' highlight' : '';
        parts.push(`<div class="ing-group"><h4 class="${hl}">${esc(g)}</h4></div>`);
        lastGroup = g;
      } else if (!g && lastGroup !== '__none__') {
        parts.push(`<div class="ing-group"><h4>Ингредиенты</h4></div>`);
        lastGroup = null;
      }
      parts.push(`<div class="ing">
        <input type="checkbox" id="ing-${i}" data-ing="${i}">
        <label for="ing-${i}">${esc(it.name)}</label>
        ${it.amount ? `<span class="amount">${esc(it.amount)}</span>` : ''}
      </div>`);
    });
    return parts.join('');
  }

  function stepsHTML(steps) {
    let lastGroup = '__none__';
    const parts = [];
    steps.forEach((s, i) => {
      if (s.group && s.group !== lastGroup) {
        parts.push(`<div class="step-group">${esc(s.group)}</div>`);
        lastGroup = s.group;
      }
      parts.push(`<div class="step" data-step="${i}"><div class="step-text">${esc(s.text)}</div></div>`);
    });
    return parts.join('');
  }

  function portionHTML(r, variantIndex = 0) {
    const v = r.nutrition[variantIndex] || r.nutrition[0] || {};
    const w = v.weight || r.weight;
    const weight = w ? `Выход блюда ≈ <b>${formatWeight(w)}</b> · ${fmt(v.kcalTotal)} ккал всего` : 'Пищевая ценность указана на 100 г';
    return `<div class="portion">
      <div class="portion-head">
        <span>Порция</span>
        <span class="portion-input"><input type="number" id="portionInput" value="100" min="10" max="2000" step="10" inputmode="numeric"> г</span>
        <span class="portion-presets">
          <button type="button" data-portion="100">100</button>
          <button type="button" data-portion="150">150</button>
          <button type="button" data-portion="200">200</button>
          <button type="button" data-portion="250">250</button>
        </span>
      </div>
      <div class="portion-result" id="portionResult"></div>
      <div class="dish-weight" id="dishWeight">${weight}</div>
    </div>`;
  }

  function updatePortion(r, variantIndex) {
    const v = r.nutrition[variantIndex] || r.nutrition[0] || {};
    const input = $('#portionInput');
    if (!input) return;
    const grams = Math.max(1, Number(input.value) || 100);
    const k = grams / 100;
    const calc = (x) => (x == null ? '—' : formatMacro(Math.round(x * k * 10) / 10));
    $('#portionResult').innerHTML = `<span>≈ <b>${calc(v.kcal100)} ккал</b></span><span>Б <b>${calc(v.protein100)} г</b></span><span>Ж <b>${calc(v.fat100)} г</b></span><span>У <b>${calc(v.carbs100)} г</b></span>`;
    const dw = $('#dishWeight');
    if (dw) {
      const w = v.weight || r.weight;
      dw.innerHTML = w ? `Выход блюда ≈ <b>${formatWeight(w)}</b> · ${fmt(v.kcalTotal)} ккал всего` : 'Пищевая ценность указана на 100 г';
    }
  }

  function setVariant(index) {
    if (!currentRecipe) return;
    const r = currentRecipe;
    const v = r.nutrition[index] || r.nutrition[0];
    $('#nutriGrid').innerHTML = nutritionCells(v);
    $$('.variant-tab').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.variant) === index)));
    $('#ingList').innerHTML = ingredientsHTML(r, index);
    updatePortion(r, index);
    currentVariant = index;
  }

  let currentVariant = 0;

  function modalHTML(r) {
    const tabs = r.nutrition.length > 1
      ? `<div class="variant-tabs" role="tablist" aria-label="Варианты рецепта">${r.nutrition.map((v, i) => `<button type="button" class="variant-tab" role="tab" data-variant="${i}" aria-selected="${i === 0}">${esc(v.label || 'Вариант ' + (i + 1))}</button>`).join('')}</div>`
      : '';
    const weight = r.weight ? `Выход блюда ≈ ${formatWeight(r.weight)} · ${fmt(r.nutrition[0].kcalTotal)} ккал всего` : 'Пищевая ценность указана на 100 г';
    const ingCount = r.ingredients.length;
    const stepCount = r.steps.length;
    return `<div class="modal-hero">
      <img src="${esc(r.photo)}" alt="${esc(r.title)}">
      <div class="modal-head">
        <div class="modal-cat">${esc(SHORT_SECTION[r.section] || r.section)}${r.subsection ? ' · ' + esc(r.subsection) : ''}</div>
        <h2 class="modal-title" id="modalTitle">${esc(r.title)}</h2>
        <div class="modal-tags">${r.tags.map(badgeHTML).join('')}</div>
      </div>
    </div>
    <div class="modal-body">
      <div class="modal-col-left">
        <div class="section-title">Пищевая ценность <span class="hint">на 100 г / на блюдо</span></div>
        <div class="nutri-grid" id="nutriGrid">${nutritionCells(r.nutrition[0])}</div>
        ${tabs}
        ${portionHTML(r)}
        <div class="section-title" style="margin-top:28px">Ингредиенты <span class="hint">${ingCount} ${plural(ingCount, ['позиция', 'позиции', 'позиций'])}</span></div>
        <div class="ing-list" id="ingList">${ingredientsHTML(r, 0)}</div>
        <div class="modal-actions">
          <button type="button" class="btn primary" data-add-shop="${esc(r.id)}">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4.5 5h2l1.7 10.2a2 2 0 0 0 2 1.7h6.9a2 2 0 0 0 2-1.6L20.5 8H7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            В список покупок
          </button>
          <button type="button" class="btn ghost" data-copy-ing>Скопировать</button>
          <button type="button" class="btn ghost" data-fav-modal="${esc(r.id)}" aria-pressed="${favorites.has(r.id)}">${favorites.has(r.id) ? '♥ В избранном' : '♡ В избранное'}</button>
        </div>
      </div>
      <div class="modal-col-right">
        <div class="section-title">Приготовление <span class="hint">${stepCount} ${plural(stepCount, ['шаг', 'шага', 'шагов'])}</span></div>
        <div class="steps">${stepsHTML(r.steps)}</div>
        <div class="modal-source">
          <span>Источник: «Книга рецептов. Руководство по вкусному похудению», стр. ${r.page}</span>
          <span>${esc(SHORT_SECTION[r.section] || r.section)}</span>
        </div>
      </div>
    </div>`;
  }

  function openRecipe(id, opts = {}) {
    const r = RECIPES.find((x) => x.id === id);
    if (!r) return;
    lastFocused = document.activeElement;
    currentRecipe = r;
    currentVariant = 0;
    currentList = getVisible();
    if (!currentList.some((x) => x.id === id)) currentList = RECIPES.slice();
    currentIndex = currentList.findIndex((x) => x.id === id);

    $('#modalContent').innerHTML = modalHTML(r);
    const modal = $('#modal');
    modal.setAttribute('aria-hidden', 'false');
    pushOverlay('recipe');
    const content = $('#modalContent');
    if (content) content.scrollTop = 0;
    updatePortion(r, 0);
    updateModalNav();
    updateRecipeBar(r);
    if (opts.push !== false) pushUI('recipe', id);
    const closeBtn = $('.modal-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function closeModal(opts = {}) {
    const modal = $('#modal');
    if (modal.getAttribute('aria-hidden') === 'true') return;
    if (!opts.fromHistory && closeUI('recipe')) return;
    modal.setAttribute('aria-hidden', 'true');
    popOverlay('recipe');
    if (opts.clearHash !== false && !opts.fromHistory) {
      try { history.replaceState({}, '', location.pathname + location.search); } catch (e) { /* noop */ }
    }
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    }
    currentRecipe = null;
  }

  function updateRecipeBar(r) {
    const bar = $('#recipeBar');
    if (!bar) return;
    bar.hidden = false;
    const fav = bar.querySelector('[data-fav-modal]');
    if (fav) {
      fav.dataset.favModal = r.id;
      const on = favorites.has(r.id);
      fav.setAttribute('aria-pressed', String(on));
      fav.setAttribute('aria-label', on ? 'Убрать из избранного' : 'В избранное');
    }
    const add = bar.querySelector('[data-add-shop]');
    if (add) add.dataset.addShop = r.id;
    const share = $('#shareRecipe');
    if (share) share.hidden = !(navigator.share || navigator.clipboard);
    const mini = $('#modalMiniTitle');
    if (mini) mini.textContent = r.title;
    const miniMeta = $('#modalMiniMeta');
    if (miniMeta) miniMeta.textContent = `${fmt(r._primary.kcal100)} ккал · Б ${formatMacro(r._primary.protein100)} г`;
    const miniBar = $('#modalMini');
    if (miniBar) miniBar.classList.remove('show');
  }

  function updateModalNav() {
    $('#prevRecipe').disabled = currentList.length < 2;
    $('#nextRecipe').disabled = currentList.length < 2;
  }

  function navigateRecipe(delta) {
    if (!currentRecipe || currentList.length < 2) return;
    currentIndex = (currentIndex + delta + currentList.length) % currentList.length;
    openRecipe(currentList[currentIndex].id, { push: true });
  }

  /* ---------- поиск (шторка) ---------- */
  function openSearchSheet(opts = {}) {
    const sheet = $('#searchSheet');
    if (!sheet) return;
    lastFocused = lastFocused || document.activeElement;
    sheet.setAttribute('aria-hidden', 'false');
    pushOverlay('search');
    if (opts.push !== false) pushUI('search');
    const input = $('#sheetSearchInput');
    if (input) {
      input.value = state.q;
      $('#sheetSearchClear').hidden = !input.value;
      renderRecentSearches();
      renderSheetResults(input.value);
    }
    if (opts.focus !== false) setTimeout(() => input && input.focus({ preventScroll: true }), 180);
  }

  function closeSearchSheet(opts = {}) {
    const sheet = $('#searchSheet');
    if (!sheet || sheet.getAttribute('aria-hidden') === 'true') return;
    if (!opts.fromHistory && closeUI('search')) return;
    sheet.setAttribute('aria-hidden', 'true');
    popOverlay('search');
    const input = $('#sheetSearchInput');
    if (input) input.blur();
  }

  function rememberSearch(q) {
    const value = q.trim();
    if (value.length < 2) return;
    recentSearches = [value, ...recentSearches.filter((x) => x.toLowerCase() !== value.toLowerCase())].slice(0, 8);
    saveRecent();
  }

  function renderRecentSearches() {
    const block = $('#recentBlock');
    const list = $('#recentList');
    if (!block || !list) return;
    block.hidden = recentSearches.length === 0;
    list.innerHTML = recentSearches.map((q) => `<button type="button" class="recent-chip" data-recent="${esc(q)}">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.6V12l3 1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      ${esc(q)}</button>`).join('');
  }

  function renderSheetResults(query) {
    const box = $('#searchResults');
    const empty = $('#searchEmpty');
    const title = $('#searchResultsTitle');
    if (!box) return;
    const q = (query || '').trim();
    const all = RECIPES.filter((r) => matches(r, { q, section: 'all', tags: new Set(), favOnly: false }))
      .sort((a, b) => a._index - b._index);
    const list = all.slice(0, 40);
    if (title) title.textContent = q ? `Найдено: ${all.length}` : 'Все рецепты';
    empty.hidden = all.length > 0 || !q;
    box.innerHTML = list.map((r) => {
      const n = r._primary;
      return `<button type="button" class="srow" data-open-recipe="${esc(r.id)}">
        <img src="${esc(r.photo)}" alt="" loading="lazy" decoding="async">
        <span class="srow-main">
          <span class="srow-title">${highlight(r.title, q)}</span>
          <span class="srow-meta"><span><b>${fmt(n.kcal100)}</b> ккал</span><span>Б <b>${formatMacro(n.protein100)}</b></span><span>${esc(SHORT_SECTION[r.section] || r.section)}</span></span>
        </span>
        <span class="srow-go" aria-hidden="true">›</span>
      </button>`;
    }).join('');
  }

  function applySearch(value, opts = {}) {
    state.q = value.trim();
    const main = $('#searchInput');
    if (main) main.value = state.q;
    const clear = $('#searchClear');
    if (clear) clear.hidden = !state.q;
    const pill = $('#searchPill');
    if (pill) {
      pill.classList.toggle('has-query', !!state.q);
      const label = pill.querySelector('span');
      if (label) label.textContent = state.q || 'Найти рецепт или ингредиент';
    }
    renderAll();
    if (opts.remember) rememberSearch(state.q);
  }

  /* ---------- вкладки нижней навигации ---------- */
  function setActiveTab(tab) {
    $$('#tabbar .tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function goToTab(tab) {
    if (tab === 'search') {
      setActiveTab('search');
      openSearchSheet();
      return;
    }
    if (tab === 'favorites') {
      // избранное показываем без остальных ограничений — иначе легко получить пустоту
      state.favOnly = true;
      state.tags.clear();
      state.maxKcal = 400;
      state.minProtein = 0;
      state.section = 'all';
      applySearch('');
      syncFilterInputs();
      renderAll();
      setActiveTab('favorites');
      scrollToCatalog();
      return;
    }
    if (tab === 'shopping') {
      setActiveTab('shopping');
      openDrawer();
      return;
    }
    // catalog
    state.favOnly = false;
    syncFilterInputs();
    renderAll();
    setActiveTab('catalog');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openRandom() {
    const list = getVisible();
    if (!list.length) { toast('Нет рецептов под текущие фильтры'); return; }
    const r = list[Math.floor(Math.random() * list.length)];
    openRecipe(r.id);
  }

  function scrollToCatalog() {
    const catalog = $('#catalog');
    if (!catalog) return;
    const header = $('#appbar');
    const offset = (header ? header.getBoundingClientRect().height : 0) + 8;
    const y = catalog.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  /* ---------- favorites ---------- */
  function toggleFavorite(id) {
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    saveFavs();
    refreshFavUI();
    if (state.favOnly) renderResults();
  }

  function refreshFavUI() {
    $$('.fav-btn[data-fav]').forEach((b) => {
      const on = favorites.has(b.dataset.fav);
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Убрать из избранного' : 'В избранное';
    });
    $$('[data-fav-modal]').forEach((btn) => {
      const id = btn.dataset.favModal;
      if (!id) return;
      const on = favorites.has(id);
      btn.setAttribute('aria-pressed', String(on));
      if (btn.classList.contains('btn')) btn.textContent = on ? '♥ В избранном' : '♡ В избранное';
      else btn.setAttribute('aria-label', on ? 'Убрать из избранного' : 'В избранное');
    });
    renderCounts();
  }

  /* ---------- shopping list ---------- */
  function addRecipeToShopping(r) {
    const before = shopping.length;
    r.ingredients.forEach((it) => {
      const key = r.id + '|' + (it.group || '') + '|' + it.name + '|' + it.amount;
      if (!shopping.some((x) => x.key === key)) {
        shopping.push({ key, recipeId: r.id, recipeTitle: r.title, name: it.name, amount: it.amount, group: it.group || '', checked: false });
      }
    });
    saveShopping();
    renderCounts();
    const added = shopping.length - before;
    toast(added ? `Добавлено в список: ${added} ${plural(added, ['ингредиент', 'ингредиента', 'ингредиентов'])}` : 'Эти ингредиенты уже в списке');
    openDrawer();
  }

  function renderDrawer() {
    const body = $('#drawerBody');
    if (!shopping.length) {
      body.innerHTML = `<div class="shop-empty"><div class="big">🧺</div><p>Список пока пуст. Откройте рецепт и нажмите «В список покупок» — все ингредиенты соберутся здесь.</p></div>`;
      return;
    }
    const groups = new Map();
    for (const item of shopping) {
      if (!groups.has(item.recipeId)) groups.set(item.recipeId, { title: item.recipeTitle, items: [] });
      groups.get(item.recipeId).items.push(item);
    }
    const html = [];
    for (const [rid, g] of groups) {
      html.push(`<div class="shop-group">
        <h3><span>Рецепт</span>${esc(g.title)}</h3>
        ${g.items.map((it) => `<div class="shop-item ${it.checked ? 'checked' : ''}" data-key="${esc(it.key)}">
          <input type="checkbox" ${it.checked ? 'checked' : ''} data-shop-check="${esc(it.key)}" aria-label="${esc(it.name)}">
          <span class="t">${esc(it.name)}</span>
          ${it.amount ? `<span class="a">${esc(it.amount)}</span>` : ''}
          <button type="button" class="shop-remove" data-shop-remove="${esc(it.key)}" aria-label="Удалить ${esc(it.name)}">×</button>
        </div>`).join('')}
      </div>`);
    }
    body.innerHTML = html.join('');
  }

  function openDrawer(opts = {}) {
    renderDrawer();
    $('#drawer').setAttribute('aria-hidden', 'false');
    pushOverlay('drawer');
    setActiveTab('shopping');
    if (opts.push !== false) pushUI('shopping');
    if (!isMobile()) {
      const close = $('#drawer .icon-btn');
      if (close) close.focus({ preventScroll: true });
    }
  }

  function closeDrawer(opts = {}) {
    const drawer = $('#drawer');
    if (drawer.getAttribute('aria-hidden') === 'true') return;
    if (!opts.fromHistory && closeUI('shopping')) return;
    drawer.setAttribute('aria-hidden', 'true');
    popOverlay('drawer');
    if (state.favOnly) setActiveTab('favorites');
    else setActiveTab('catalog');
  }

  function copyText(text) {
    const done = () => toast('Скопировано в буфер обмена');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Не удалось скопировать'); }
    document.body.removeChild(ta);
  }

  function ingredientsToText(r) {
    let lastGroup = null;
    const lines = [];
    r.ingredients.forEach((it) => {
      if (it.group && it.group !== lastGroup) { lines.push('', it.group + ':'); lastGroup = it.group; }
      lines.push('— ' + it.name + (it.amount ? ' — ' + it.amount : ''));
    });
    return r.title + '\n' + lines.join('\n').trim();
  }

  function shoppingToText() {
    const groups = new Map();
    for (const item of shopping) {
      if (!groups.has(item.recipeId)) groups.set(item.recipeId, { title: item.recipeTitle, items: [] });
      groups.get(item.recipeId).items.push(item);
    }
    const out = ['Список покупок', ''];
    for (const [, g] of groups) {
      out.push(g.title);
      g.items.forEach((it) => out.push('— ' + it.name + (it.amount ? ' — ' + it.amount : '')));
      out.push('');
    }
    return out.join('\n');
  }

  /* ---------- поделиться ---------- */
  function shareRecipe(r) {
    const url = location.origin + location.pathname + '#recipe=' + encodeURIComponent(r.id);
    const data = {
      title: r.title,
      text: `${r.title} — ${fmt(r._primary.kcal100)} ккал на 100 г, Б ${formatMacro(r._primary.protein100)} г`,
      url
    };
    if (navigator.share) {
      navigator.share(data).catch(() => { /* отменили */ });
      return;
    }
    copyText(url);
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------- theme ---------- */
  function initTheme() {
    const saved = store.get('ppsk.theme', null);
    const theme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    store.set('ppsk.theme', cur);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', cur === 'dark' ? '#111612' : '#f7f3ea');
  }

  /* ---------- collage ---------- */
  function renderCollage() {
    const pick = (t) => RECIPES.find((r) => r.title === t);
    const items = [pick('Суп с творожными клецками'), pick('Пицца из тунца'), pick('Сырники впрок')].filter(Boolean);
    const box = $('#heroCollage');
    if (!items.length) return;
    box.innerHTML = items.slice(0, 3).map((r, i) => `<img class="c${i + 1}" src="${esc(r.photo)}" alt="" loading="eager" decoding="async">`).join('') +
      `<div class="collage-badge"><strong>${RECIPES.length}</strong><span>рецептов из книги</span></div>`;
  }

  /* ---------- event wiring ---------- */
  function bindEvents() {
    // search
    const input = $('#searchInput');
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const val = input.value;
      $('#searchClear').hidden = !val;
      searchTimer = setTimeout(() => applySearch(val), 140);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { applySearch(''); input.blur(); }
      if (e.key === 'Enter') { rememberSearch(input.value); }
    });
    $('#searchClear').addEventListener('click', () => {
      applySearch('');
      input.focus();
    });

    // --- мобильный поиск ---
    const pill = $('#searchPill');
    if (pill) pill.addEventListener('click', () => openSearchSheet());

    const sheetInput = $('#sheetSearchInput');
    if (sheetInput) {
      sheetInput.addEventListener('input', () => {
        const val = sheetInput.value;
        $('#sheetSearchClear').hidden = !val;
        clearTimeout(sheetSearchTimer);
        sheetSearchTimer = setTimeout(() => {
          applySearch(val);
          renderSheetResults(val);
        }, 120);
      });
      sheetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applySearch(sheetInput.value, { remember: true });
          renderSheetResults(sheetInput.value);
          closeSearchSheet();
          scrollToCatalog();
        }
      });
    }
    const sheetClear = $('#sheetSearchClear');
    if (sheetClear) sheetClear.addEventListener('click', () => {
      if (sheetInput) { sheetInput.value = ''; sheetInput.focus(); }
      sheetClear.hidden = true;
      applySearch('');
      renderSheetResults('');
    });

    const recentList = $('#recentList');
    if (recentList) recentList.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-recent]');
      if (!chip) return;
      const q = chip.dataset.recent;
      if (sheetInput) { sheetInput.value = q; $('#sheetSearchClear').hidden = false; }
      applySearch(q, { remember: true });
      renderSheetResults(q);
    });

    const searchResults = $('#searchResults');
    if (searchResults) searchResults.addEventListener('click', (e) => {
      const row = e.target.closest('[data-open-recipe]');
      if (!row) return;
      rememberSearch(state.q);
      // закрываем шторку без отката истории: рецепт добавит свою запись,
      // и «назад» вернёт пользователя к результатам поиска
      closeSearchSheet({ fromHistory: true });
      openRecipe(row.dataset.openRecipe);
    });

    // --- вкладки ---
    const tabbar = $('#tabbar');
    if (tabbar) tabbar.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      goToTab(tab.dataset.tab);
    });

    // --- мобильная панель ---
    const mFilter = $('#mFilterBtn');
    if (mFilter) mFilter.addEventListener('click', () => setFilterPanel(true));
    const mReset = $('#mResetBtn');
    if (mReset) mReset.addEventListener('click', resetFilters);
    const mRandom = $('#mRandomBtn');
    if (mRandom) mRandom.addEventListener('click', openRandom);

    const filterReset = $('#filterReset');
    if (filterReset) filterReset.addEventListener('click', resetFilters);
    const filterApply = $('#filterApply');
    if (filterApply) filterApply.addEventListener('click', () => {
      setFilterPanel(false);
      scrollToCatalog();
    });

    const sortSeg = $('#sortSeg');
    if (sortSeg) sortSeg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]');
      if (!b) return;
      state.sort = b.dataset.sort;
      $('#sortSelect').value = state.sort;
      renderCounts();
      renderResults();
    });

    // categories
    $('#catRow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-section]');
      if (!btn) return;
      state.section = btn.dataset.section;
      renderAll();
      $('#catalog').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    // quick chips
    $('#quickChips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quick]');
      if (!btn) return;
      const { quick: type, value } = btn.dataset;
      if (type === 'kcal') state.maxKcal = state.maxKcal === Number(value) ? 400 : Number(value);
      if (type === 'tag') {
        if (state.tags.has(value)) state.tags.delete(value); else state.tags.add(value);
      }
      if (type === 'section') state.section = state.section === value ? 'all' : value;
      syncFilterInputs();
      renderAll();
    });

    // filters
    $('#filterBtn').addEventListener('click', () => setFilterPanel(!state.filtersOpen));
    const filterPanel = $('#filterPanel');
    if (filterPanel) {
      filterPanel.addEventListener('click', (e) => {
        // клик по затемнению (::before) закрывает шторку
        if (e.target === filterPanel) setFilterPanel(false);
      });
      attachSheetDrag(filterPanel, filterPanel.querySelector('.sheet-grip'), () => setFilterPanel(false));
    }
    $('#tagCloud').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tag]');
      if (!btn) return;
      const tag = btn.dataset.tag;
      if (state.tags.has(tag)) state.tags.delete(tag); else state.tags.add(tag);
      renderAll();
    });
    $('#kcalRange').addEventListener('input', (e) => {
      state.maxKcal = Number(e.target.value);
      updateRangeFill(e.target);
      $('#kcalOut').textContent = state.maxKcal >= 400 ? 'без ограничений' : 'до ' + state.maxKcal + ' ккал';
      $$('#kcalPresets button').forEach((b) => b.classList.toggle('active', Number(b.dataset.kcal) === state.maxKcal));
      renderAll();
    });
    $('#proteinRange').addEventListener('input', (e) => {
      state.minProtein = Number(e.target.value);
      updateRangeFill(e.target);
      $('#proteinOut').textContent = state.minProtein > 0 ? 'от ' + state.minProtein + ' г' : 'без ограничений';
      $$('#proteinPresets button').forEach((b) => b.classList.toggle('active', Number(b.dataset.protein) === state.minProtein));
      renderAll();
    });
    $('#kcalPresets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kcal]');
      if (!b) return;
      state.maxKcal = Number(b.dataset.kcal);
      syncFilterInputs();
      renderAll();
    });
    $('#proteinPresets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-protein]');
      if (!b) return;
      state.minProtein = Number(b.dataset.protein);
      syncFilterInputs();
      renderAll();
    });
    $('#favOnly').addEventListener('change', (e) => {
      state.favOnly = e.target.checked;
      renderAll();
    });
    $('#sortSelect').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderResults();
    });

    // active chips
    $('#activeChips').addEventListener('click', (e) => {
      const t = e.target.closest('[data-remove-tag]');
      if (t) { state.tags.delete(t.dataset.removeTag); renderAll(); return; }
      if (e.target.closest('[data-remove-kcal]')) { state.maxKcal = 400; syncFilterInputs(); renderAll(); return; }
      if (e.target.closest('[data-remove-protein]')) { state.minProtein = 0; syncFilterInputs(); renderAll(); return; }
      if (e.target.closest('[data-remove-fav]')) { state.favOnly = false; syncFilterInputs(); renderAll(); }
    });

    // reset
    $('#resetBtn').addEventListener('click', resetFilters);
    $('#emptyReset').addEventListener('click', resetFilters);

    // header
    $('#favBtn').addEventListener('click', () => {
      state.favOnly = !state.favOnly;
      syncFilterInputs();
      renderAll();
      $('#catalog').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    $('#shopBtn').addEventListener('click', openDrawer);
    $('#themeToggle').addEventListener('click', toggleTheme);
    const jump = $('#searchJump');
    if (jump) jump.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => $('#searchInput').focus({ preventScroll: true }), 350);
    });

    // random
    $('#randomBtn').addEventListener('click', openRandom);

    // grid
    const grid = $('#grid');
    grid.addEventListener('click', (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) { toggleFavorite(fav.dataset.fav); return; }
      const card = e.target.closest('.card');
      if (card) openRecipe(card.dataset.id);
    });
    grid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.card');
      if (card && !e.target.closest('[data-fav]')) {
        e.preventDefault();
        openRecipe(card.dataset.id);
      }
    });

    // modal
    $('#modal').addEventListener('click', (e) => {
      if (e.target.closest('[data-close="modal"]')) { closeModal(); return; }
      const variant = e.target.closest('[data-variant]');
      if (variant) { setVariant(Number(variant.dataset.variant)); return; }
      const portion = e.target.closest('[data-portion]');
      if (portion) {
        const inp = $('#portionInput');
        if (inp) { inp.value = portion.dataset.portion; updatePortion(currentRecipe, currentVariant); }
        return;
      }
      const addShop = e.target.closest('[data-add-shop]');
      if (addShop && currentRecipe) { addRecipeToShopping(currentRecipe); return; }
      const copyIng = e.target.closest('[data-copy-ing]');
      if (copyIng && currentRecipe) { copyText(ingredientsToText(currentRecipe)); return; }
      const favModal = e.target.closest('[data-fav-modal]');
      if (favModal) { toggleFavorite(favModal.dataset.favModal); refreshFavUI(); return; }
    });
    $('#modal').addEventListener('input', (e) => {
      if (e.target.id === 'portionInput' && currentRecipe) updatePortion(currentRecipe, currentVariant);
    });
    $('#prevRecipe').addEventListener('click', () => navigateRecipe(-1));
    $('#nextRecipe').addEventListener('click', () => navigateRecipe(1));

    const shareBtn = $('#shareRecipe');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      if (currentRecipe) shareRecipe(currentRecipe);
    });

    // мини-заголовок появляется при прокрутке рецепта
    const modalContent = $('#modalContent');
    if (modalContent) {
      modalContent.addEventListener('scroll', () => {
        const mini = $('#modalMini');
        if (mini) mini.classList.toggle('show', modalContent.scrollTop > 150);
      }, { passive: true });
    }

    const searchSheet = $('#searchSheet');
    if (searchSheet) {
      searchSheet.addEventListener('click', (e) => {
        if (e.target.closest('[data-close="search"]')) closeSearchSheet();
      });
      attachSheetDrag(searchSheet.querySelector('.sheet-panel'), searchSheet.querySelector('.sheet-grip'), closeSearchSheet);
    }

    // drawer
    $('#drawer').addEventListener('click', (e) => {
      if (e.target.closest('[data-close="drawer"]')) { closeDrawer(); return; }
      const check = e.target.closest('[data-shop-check]');
      if (check) {
        const item = shopping.find((x) => x.key === check.dataset.shopCheck);
        if (item) { item.checked = check.checked; saveShopping(); renderDrawer(); }
        return;
      }
      const remove = e.target.closest('[data-shop-remove]');
      if (remove) {
        shopping = shopping.filter((x) => x.key !== remove.dataset.shopRemove);
        saveShopping(); renderDrawer(); renderCounts();
      }
    });
    const drawerPanel = $('#drawer .drawer-panel');
    if (drawerPanel) attachSheetDrag(drawerPanel, drawerPanel.querySelector('.sheet-grip'), closeDrawer);

    const modalPanel = $('#modalPanel');
    if (modalPanel) {
      attachSheetDrag(modalPanel, modalPanel.querySelector(':scope > .sheet-grip'), () => closeModal());
      attachSheetDrag(modalPanel, $('#modalMini'), () => closeModal());
    }

    $('#copyShopping').addEventListener('click', () => {
      if (!shopping.length) { toast('Список пуст'); return; }
      copyText(shoppingToText());
    });
    $('#clearShopping').addEventListener('click', () => {
      if (!shopping.length) return;
      shopping = [];
      saveShopping(); renderDrawer(); renderCounts();
      toast('Список очищен');
    });

    // keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === '/' && !typing) { e.preventDefault(); $('#searchInput').focus(); return; }
      if (e.key === 'Escape') {
        const top = topOverlay();
        if (top === 'search') { closeSearchSheet(); return; }
        if (top === 'drawer') { closeDrawer(); return; }
        if (top === 'recipe') { closeModal(); return; }
        if (state.filtersOpen) { setFilterPanel(false); return; }
      }
      if ($('#modal').getAttribute('aria-hidden') === 'false') {
        if (!typing && e.key === 'ArrowLeft') { e.preventDefault(); navigateRecipe(-1); }
        if (!typing && e.key === 'ArrowRight') { e.preventDefault(); navigateRecipe(1); }
        if (e.key === 'Tab') trapFocus(e);
      }
    });

    // sticky shadow
    const toolbar = $('#toolbar');
    const appbar = $('#appbar');
    const onScroll = () => {
      const top = toolbar.getBoundingClientRect().top;
      const appbarH = appbar ? appbar.getBoundingClientRect().height : 0;
      toolbar.classList.toggle('is-stuck', top <= appbarH + 2);
      if (appbar) appbar.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // history
    window.addEventListener('popstate', syncFromHash);
    window.addEventListener('hashchange', syncFromHash);
  }

  function trapFocus(e) {
    const panel = $('#modalPanel');
    const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', panel).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function clearHash() {
    try { history.replaceState({}, '', location.pathname + location.search); } catch (e) { /* noop */ }
  }

  function syncFromHash() {
    const hash = location.hash || '';
    const m = hash.match(/^#recipe=(.+)$/);
    const id = m ? decodeURIComponent(m[1]) : null;

    if (id) {
      if (!currentRecipe || currentRecipe.id !== id) openRecipe(id, { push: false });
    } else if (currentRecipe) {
      closeModal({ clearHash: false, fromHistory: true });
    }

    // шторки
    const wantSearch = hash === '#search';
    const wantShopping = hash === '#shopping';
    const wantFilters = hash === '#filters';

    if ($('#searchSheet').getAttribute('aria-hidden') === 'false' && !wantSearch) {
      closeSearchSheet({ fromHistory: true });
    }
    if (wantSearch && $('#searchSheet').getAttribute('aria-hidden') === 'true') {
      openSearchSheet({ push: false });
    }

    if ($('#drawer').getAttribute('aria-hidden') === 'false' && !wantShopping) {
      closeDrawer({ fromHistory: true });
    }
    if (wantShopping && $('#drawer').getAttribute('aria-hidden') === 'true') {
      openDrawer({ push: false });
    }

    const filtersVisible = !$('#filterPanel').hidden;
    if (filtersVisible && !wantFilters) setFilterPanel(false, { fromHistory: true });
    if (wantFilters && !filtersVisible) setFilterPanel(true, { push: false });

    // ярлыки из манифеста
    if (hash === '#favorites') { clearHash(); goToTab('favorites'); return; }
  }

  /* ============================================================
     PWA: установка, офлайн, обновления
     ============================================================ */
  const PWA = {
    deferredPrompt: null,
    updateWorker: null,
    standalone: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,

    init() {
      this.watchDisplayMode();
      this.watchNetwork();
      this.watchInstall();
      this.register();
    },

    watchDisplayMode() {
      const mq = window.matchMedia('(display-mode: standalone)');
      const onChange = () => { this.standalone = mq.matches; this.hideInstall(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    },

    watchNetwork() {
      const bar = $('#offlineBar');
      const update = () => {
        if (bar) bar.hidden = navigator.onLine;
        document.documentElement.classList.toggle('is-offline', !navigator.onLine);
      };
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      update();
    },

    watchInstall() {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredPrompt = e;
        this.maybeShowInstall();
      });
      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null;
        this.hideInstall();
        store.set('ppsk.installDismissed', true);
        toast('Приложение установлено');
      });
      const btn = $('#installBtn');
      if (btn) btn.addEventListener('click', () => this.promptInstall());
      const close = $('#installClose');
      if (close) close.addEventListener('click', () => {
        this.hideInstall();
        store.set('ppsk.installDismissed', true);
      });
      const icon = $('#installIcon');
      if (icon) icon.addEventListener('click', () => this.promptInstall());
      this.maybeShowInstall();
    },

    maybeShowInstall() {
      if (this.standalone || store.get('ppsk.installDismissed', false)) return;
      const banner = $('#installBanner');
      if (!banner) return;
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (this.deferredPrompt) {
        const hint = $('#installHint');
        if (hint) hint.textContent = 'Открывается на весь экран и работает офлайн';
        banner.hidden = false;
      } else if (isIOS) {
        const hint = $('#installHint');
        if (hint) hint.textContent = 'Safari: «Поделиться» → «На экран Домой»';
        const btn = $('#installBtn');
        if (btn) btn.textContent = 'Как?';
        banner.hidden = false;
      }
    },

    hideInstall() {
      const banner = $('#installBanner');
      if (banner) banner.hidden = true;
    },

    async promptInstall() {
      if (!this.deferredPrompt) {
        toast('Откройте меню браузера → «Установить приложение»');
        return;
      }
      this.deferredPrompt.prompt();
      try {
        const choice = await this.deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') this.hideInstall();
      } catch (e) { /* пользователь закрыл */ }
      this.deferredPrompt = null;
    },

    register() {
      if (!('serviceWorker' in navigator)) return;
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

      navigator.serviceWorker.register('sw.js').then((reg) => {
        if (reg.waiting) this.showUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              this.showUpdate(worker);
            }
          });
        });
        // тихая проверка обновлений при возврате в приложение
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      }).catch(() => { /* офлайн-режим недоступен */ });

      // Перезагружаемся только при смене уже существующего контроллера
      // (обновление). Первая установка SW тоже вызывает controllerchange,
      // и слепая перезагрузка ломала бы deep-link'и вроде #favorites.
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });
    },

    showUpdate(worker) {
      this.updateWorker = worker;
      const bar = $('#updateBar');
      if (!bar) return;
      bar.hidden = false;
      const btn = $('#updateBtn');
      if (btn) {
        btn.onclick = () => {
          worker.postMessage({ type: 'SKIP_WAITING' });
          bar.hidden = true;
        };
      }
    }
  };

  /* ============================================================
     Жесты: свайп вниз закрывает шторку
     ============================================================ */
  function attachSheetDrag(panel, handle, onClose) {
    if (!panel || !handle || handle.dataset.dragBound === '1') return;
    handle.dataset.dragBound = '1';
    let startY = 0;
    let dy = 0;
    let dragging = false;
    let startTime = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (!isMobile() || e.button !== 0) return;
      if (e.target.closest('input, button, a, select')) return;
      dragging = true;
      startY = e.clientY;
      dy = 0;
      startTime = performance.now();
      panel.style.transition = 'none';
      if (handle.setPointerCapture) {
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      panel.style.transform = `translateY(${dy}px)`;
    });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      const fast = performance.now() - startTime < 320;
      if (dy > 110 || (fast && dy > 46)) {
        panel.style.transform = '';
        onClose();
      } else {
        panel.style.transform = '';
      }
      dy = 0;
    };

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  }

  /* ---------- init ---------- */
  function init() {
    initTheme();
    renderCollage();
    syncFilterInputs();
    renderAll();
    bindEvents();
    setActiveTab('catalog');
    syncFromHash();
    PWA.init();
    // подстраховка: тема могла не примениться из inline-скрипта
    if (!document.documentElement.getAttribute('data-theme')) initTheme();
  }

  init();
})();
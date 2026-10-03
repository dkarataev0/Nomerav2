import { Config, Rarities, Regions, rarityInfo, formatMoney } from './core.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const dateLabel = value => {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};
const plateKey = plate => plate ? `${plate.letters}-${plate.digits}-${plate.region?.code}-${plate.type ?? 'standard'}` : '';
const plateLabel = plate => `${plate.letters[0]} ${plate.digits} ${plate.letters.slice(1)} · ${plate.region.code}`;
const rgb = color => {
  const hex = String(color).replace('#', '');
  return /^\w{6}$/.test(hex) ? [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16)).join(',') : '168,178,196';
};
let drawingID = 0;

/** The entire sign is drawn from live text and vector primitives, never a plate image. */
function plateSVG(plate) {
  const id = `plate-metal-${++drawingID}`;
  const first = escapeHTML(plate.letters[0]);
  const tail = escapeHTML(plate.letters.slice(1));
  const digits = escapeHTML(plate.digits);
  const region = escapeHTML(plate.region.code);
  const square = plate.type === 'square';
  const font = '"DIN Condensed","DINCondensed-Bold","Arial Narrow",Impact,"Helvetica Neue",Arial,sans-serif';
  const text = (x, y, size, width, value) => `<text x="${x}" y="${y}" font-family="${escapeHTML(font)}" font-size="${size}" font-weight="700" textLength="${width}" lengthAdjust="spacingAndGlyphs" fill="#08090a">${value}</text>`;
  const regionText = square ? text(193, 126, region.length === 3 ? 48 : 54, 70, region)
    : text(435, 69, region.length === 3 ? 57 : 63, 70, region);
  const rus = square ? '<text x="191" y="151" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="#111">RUS</text><rect x="230" y="138" width="30" height="16" fill="#fff"/><rect x="230" y="143.33" width="30" height="5.34" fill="#17439b"/><rect x="230" y="148.67" width="30" height="5.33" fill="#bb2733"/><rect x="230" y="138" width="30" height="16" fill="none" stroke="#111" stroke-opacity=".3" stroke-width=".6"/>'
    : '<text x="433" y="94" font-family="Arial,sans-serif" font-size="16" font-weight="600" letter-spacing=".3" fill="#111">RUS</text><rect x="473" y="80" width="29" height="18" fill="#fff"/><rect x="473" y="86" width="29" height="6" fill="#17439b"/><rect x="473" y="92" width="29" height="6" fill="#bb2733"/><rect x="473" y="80" width="29" height="18" fill="none" stroke="#111" stroke-opacity=".3" stroke-width=".6"/>';
  const width = square ? 290 : 520;
  const height = square ? 170 : 112;
  return `<svg class="plate${square ? ' plate-square' : ''}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(`Российский номер ${plateLabel(plate)}`)}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ededee"/><stop offset=".52" stop-color="#d5d6d8"/><stop offset="1" stop-color="#e4e5e6"/></linearGradient></defs><rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="10" fill="url(#${id})" stroke="#17181a" stroke-width="2"/><rect x="7" y="7" width="${width - 14}" height="${height - 14}" rx="6" fill="none" stroke="#08090a" stroke-width="2.8"/><rect x="9" y="9" width="${width - 18}" height="${height - 18}" rx="5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width=".8"/>${square ? `${text(23, 80, 76, 50, first)}${text(86, 80, 93, 165, digits)}${text(37, 150, 72, 113, tail)}<path d="M181 95v61" stroke="#111" stroke-width="2.5"/>` : `${text(27, 93, 80, 55, first)}${text(88, 94, 104, 181, digits)}${text(282, 93, 80, 111, tail)}<path d="M416 9v94" stroke="#111" stroke-width="2.5"/>`}${regionText}${rus}<path d="M24 14h10M${width - 34} 14h10" stroke="#111" stroke-opacity=".25" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}

function icon(name) {
  const paths = {
    collection: '<rect x="5" y="7" width="14" height="13" rx="2"/><path d="M8 4h8M10 1h4"/>',
    settings: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/>',
    record: '<path d="M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 14v5m-4 2h8M8 19h8"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.collection}</svg>`;
}

export class GameUI {
  constructor() {
    this.elements = Object.fromEntries(['game', 'balance', 'rarity-name', 'rarity-segments', 'price', 'reel-stage', 'reel-strip', 'traits', 'status', 'generate-controls', 'resolve-controls', 'generate-button', 'generate-label', 'roll-cost', 'sale-hint', 'recovery-button', 'first-hint', 'record-toast', 'notification', 'app-dialog', 'dialog-content'].map(id => [id, document.getElementById(id)]));
    this.state = null;
    this.rolling = false;
    this._plateKey = '';
    this._traitIDs = [];
    this._notifyTimer = null;
    this._recordTimer = null;
    this._previousFocus = null;
    this.collectionFilter = 'all';
    this.collectionSort = 'newest';
    this.elements['app-dialog'].addEventListener('close', () => {
      this.elements['app-dialog'].dataset.screen = '';
      this._previousFocus?.focus({ preventScroll: true });
    });
    this.elements['app-dialog'].addEventListener('click', event => {
      if (event.target === this.elements['app-dialog']) this.closeDialog();
      if (event.target.closest('[data-action="close"]')) this.closeDialog();
      event.stopPropagation();
    });
    const particles = $('.gold-particles');
    particles.innerHTML = Array.from({ length: 12 }, (_, index) => `<i style="--x:${8 + index * 7.5}%;--duration:${9 + index * .38}s;--delay:${-index * .74}s"></i>`).join('');
    const updateVisibility = () => document.body.classList.toggle('paused', document.hidden);
    document.addEventListener('visibilitychange', updateVisibility);
    updateVisibility();
    this.setPlate({ letters: 'АОО', digits: '001', region: Regions.find(region => region.code === '77') ?? { code: '77', name: 'Москва' }, type: 'standard' });
  }

  update(state) {
    const previous = this.state;
    this.state = state;
    const phase = state.phase ?? 'idle';
    const rarity = state.displayRarity ?? 'common';
    const theme = rarityInfo(rarity);
    const progress = state.progress;
    const settings = progress.settings;
    const el = this.elements;
    el.game.dataset.phase = phase;
    el.game.dataset.rarity = rarity;
    document.body.classList.toggle('effects-reduced', !!settings.reducedEffects);
    if (!previous || previous.displayRarity !== rarity) {
      document.documentElement.style.setProperty('--rarity', theme.color);
      document.documentElement.style.setProperty('--rarity-rgb', rgb(theme.color));
      document.body.dataset.rarity = rarity;
      el['rarity-name'].textContent = theme.label;
      [...el['rarity-segments'].children].forEach((segment, index) => segment.classList.toggle('active', index <= theme.rank));
      if (previous && !settings.reducedEffects && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const flash = $('.rarity-flash');
        flash.classList.remove('flash');
        void flash.offsetWidth;
        flash.classList.add('flash');
      }
    }
    if (!previous || previous.progress.balance !== progress.balance) el.balance.textContent = formatMoney(progress.balance);
    if (!previous || previous.displayPrice !== state.displayPrice) el.price.textContent = formatMoney(state.displayPrice);
    el['generate-button'].disabled = !state.canRoll;
    el['generate-controls'].hidden = !!state.canResolve;
    el['resolve-controls'].hidden = !state.canResolve;
    el['generate-label'].textContent = phase === 'rolling' ? 'Ищем ваш номер' : ['selected', 'revealing', 'valuating', 'finishing'].includes(phase) ? 'Оценка номера' : 'Получить номер';
    el['roll-cost'].textContent = formatMoney(Config.rollCost);
    el['recovery-button'].hidden = !state.recoveryAvailable;
    el['recovery-button'].textContent = state.recoveryText ?? 'Получить стартовый резерв';
    el['sale-hint'].textContent = `Продажа добавит ${formatMoney(state.currentPlate?.finalPrice ?? 0)} к балансу`;
    el['first-hint'].hidden = phase !== 'idle' || progress.numberOfRolls > 0;
    const status = state.statusText ?? ({ idle: 'Каждый номер — новая история', rolling: 'Ищем ваш следующий номер', selected: 'Номер найден. Начинаем оценку', revealing: 'Раскрываем особенности', valuating: 'Раскрываем особенности', finishing: 'Финальная оценка', completed: 'Продать или сохранить в коллекции?' }[phase] ?? '');
    el.status.lastChild.nodeValue = status;
    const revealed = state.revealedTraits ?? [];
    const traitIDs = revealed.map(trait => trait.id);
    if (traitIDs.join('|') !== this._traitIDs.join('|')) {
      if (this._traitIDs.some(id => !traitIDs.includes(id))) el.traits.replaceChildren();
      const visible = new Set([...el.traits.children].map(element => element.dataset.traitId));
      for (const trait of revealed) {
        if (visible.has(trait.id)) continue;
        const element = document.createElement('div');
        element.className = 'trait';
        element.dataset.traitId = trait.id;
        const name = document.createElement('span');
        name.className = 'trait-name';
        name.textContent = trait.name;
        element.append(name);
        el.traits.prepend(element);
      }
      this._traitIDs = traitIDs;
    }
    if (state.currentPlate?.plate && phase !== 'rolling' && !this.rolling && plateKey(state.currentPlate.plate) !== this._plateKey) this.setPlate(state.currentPlate.plate);
    if (state.legendaryPulse && !previous?.legendaryPulse && !settings.reducedEffects) {
      el['reel-stage'].classList.remove('legendary-pulse');
      void el['reel-stage'].offsetWidth;
      el['reel-stage'].classList.add('legendary-pulse');
    }
  }

  setPlate(plate) {
    if (!plate) return;
    const strip = this.elements['reel-strip'];
    strip.style.transform = 'none';
    strip.innerHTML = `<div class="reel-row" style="top:50%;transform:translateY(-50%)">${plateSVG(plate)}</div>`;
    this.elements['reel-stage'].setAttribute('aria-label', `Российский номер ${plateLabel(plate)}`);
    this._plateKey = plateKey(plate);
  }

  async roll(plates, durationSeconds, signal, onTick = () => {}) {
    if (signal?.aborted) throw new DOMException('Прокрутка отменена', 'AbortError');
    if (!plates?.length) return;
    this.rolling = true;
    const stage = this.elements['reel-stage'];
    const strip = this.elements['reel-strip'];
    const width = stage.clientWidth;
    const height = width * 112 / 520;
    const stride = height + Math.max(16, height * .28);
    const center = stage.clientHeight / 2 - height / 2;
    strip.style.transform = 'translateY(0px)';
    strip.innerHTML = plates.map((plate, index) => `<div class="reel-row" style="height:${height}px;top:${center - index * stride}px">${plateSVG(plate)}</div>`).join('');
    const distance = (plates.length - 1) * stride;
    const milliseconds = Math.max(1, durationSeconds * 1000);
    let animation;
    const timers = [];
    const abort = () => animation?.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      animation = strip.animate([{ transform: 'translateY(0px)' }, { transform: `translateY(${distance}px)` }], { duration: milliseconds, easing: 'cubic-bezier(.333333,1,.666667,1)', fill: 'forwards' });
      for (let index = 1; index < plates.length; index++) {
        const time = milliseconds * (1 - Math.cbrt(1 - index / (plates.length - 1)));
        timers.push(setTimeout(() => { if (!signal?.aborted) onTick(index); }, time));
      }
      await animation.finished;
      if (signal?.aborted) throw new DOMException('Прокрутка отменена', 'AbortError');
      strip.style.transform = `translateY(${distance}px)`;
      animation.cancel();
      const reduced = this.state?.progress.settings.reducedEffects || matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduced) {
        animation = strip.animate([{ transform: `translateY(${distance}px)` }, { transform: `translateY(${distance + height * .035}px)`, offset: .38 }, { transform: `translateY(${distance}px)` }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        await animation.finished;
      }
      if (signal?.aborted) throw new DOMException('Прокрутка отменена', 'AbortError');
      this.setPlate(plates.at(-1));
    } finally {
      timers.forEach(clearTimeout);
      signal?.removeEventListener('abort', abort);
      animation?.cancel();
      this.rolling = false;
      if (signal?.aborted) strip.style.transform = 'none';
    }
  }

  showRecord(result, onOpen) {
    const toast = this.elements['record-toast'];
    clearTimeout(this._recordTimer);
    toast.innerHTML = `<span class="record-icon" aria-hidden="true">🏆</span><div class="record-copy"><strong>Новый рекорд</strong><p>Номер за ${escapeHTML(formatMoney(result.finalPrice))}</p></div><button class="record-open" data-action="open-record" type="button">Открыть ↗</button><button class="record-dismiss" type="button" aria-label="Скрыть рекорд">×</button>`;
    toast.hidden = false;
    $('.record-open', toast).onclick = event => { event.stopPropagation(); this.hideRecord(); onOpen?.(); };
    $('.record-dismiss', toast).onclick = event => { event.stopPropagation(); this.hideRecord(); };
    this._recordTimer = setTimeout(() => this.hideRecord(), 4500);
  }

  hideRecord() { clearTimeout(this._recordTimer); this.elements['record-toast'].hidden = true; }

  notify(message) {
    clearTimeout(this._notifyTimer);
    this.elements.notification.textContent = message;
    this.elements.notification.hidden = false;
    this._notifyTimer = setTimeout(() => { this.elements.notification.hidden = true; }, 3800);
  }

  closeDialog() { if (this.elements['app-dialog'].open) this.elements['app-dialog'].close(); }

  _openDialog(screen, title, contents, subtitle = '') {
    const dialog = this.elements['app-dialog'];
    if (!dialog.open) this._previousFocus = document.activeElement;
    dialog.dataset.screen = screen;
    this.elements['dialog-content'].innerHTML = `<section class="dialog-sheet"><header class="dialog-header"><h2 id="dialog-title">${escapeHTML(title)}</h2><button class="close-button" type="button" data-action="close" aria-label="Закрыть">×</button></header>${subtitle ? `<p class="dialog-subtitle">${escapeHTML(subtitle)}</p>` : ''}${contents}</section>`;
    if (!dialog.open) dialog.showModal();
    $('.dialog-sheet', dialog).scrollTop = 0;
  }

  openMenu({ collection, settings, record }) {
    const progress = this.state?.progress;
    const menuCard = (name, title, caption, action) => `<button class="menu-card" type="button" data-action="${action}"><span class="menu-icon">${icon(name)}</span><span class="menu-card-copy"><strong>${title}</strong><small>${caption}</small></span><span class="menu-arrow">›</span></button>`;
    this._openDialog('menu', 'Ваш гараж', `<div class="menu-grid">${menuCard('collection', 'Мои номера', `${progress?.collection.length ?? 0} в коллекции`, 'collection')}${menuCard('record', 'Самый ценный номер', formatMoney(progress?.highestPrice ?? 0), 'back-record')}${menuCard('settings', 'Настройки', 'Звук, вибрация и эффекты', 'settings')}</div><p class="section-label">История коллекции</p><div class="stats-grid"><div class="stat-card"><span>Открыто номеров</span><strong>${progress?.numberOfRolls ?? 0}</strong></div><div class="stat-card"><span>Продано на сумму</span><strong>${formatMoney(progress?.totalEarned ?? 0)}</strong></div></div>`);
    $('[data-action="collection"]', this.elements['app-dialog']).onclick = collection;
    $('[data-action="settings"]', this.elements['app-dialog']).onclick = settings;
    $('[data-action="back-record"]', this.elements['app-dialog']).onclick = record;
  }

  openCollection(progress, onSell) {
    this._openDialog('collection', 'Мои номера', `<div class="filter-strip" aria-label="Фильтр редкости"><button class="filter-chip" data-filter="all" type="button">Все</button>${Rarities.map(rarity => `<button class="filter-chip" data-filter="${rarity.key}" style="--chip-color:${rarity.color};--chip-rgb:${rgb(rarity.color)}" type="button">${escapeHTML(rarity.label)}</button>`).join('')}</div><div class="sort-row" aria-label="Сортировка"><button class="sort-button" data-sort="newest" type="button">Новые</button><button class="sort-button" data-sort="valuable" type="button">Дорогие</button><button class="sort-button" data-sort="rarest" type="button">Редкие</button></div><div class="collection-list" id="collection-list"></div>`, `${progress.collection.length} в гараже · рекорд ${formatMoney(progress.highestPrice)}`);
    const render = () => {
      const currentProgress = this.state?.progress ?? progress;
      [...this.elements['app-dialog'].querySelectorAll('[data-filter]')].forEach(button => { button.classList.toggle('selected', button.dataset.filter === this.collectionFilter); button.setAttribute('aria-pressed', button.dataset.filter === this.collectionFilter); });
      [...this.elements['app-dialog'].querySelectorAll('[data-sort]')].forEach(button => { button.classList.toggle('selected', button.dataset.sort === this.collectionSort); button.setAttribute('aria-pressed', button.dataset.sort === this.collectionSort); });
      const values = currentProgress.collection.filter(result => this.collectionFilter === 'all' || result.rarity === this.collectionFilter).sort((left, right) => this.collectionSort === 'valuable' ? right.finalPrice - left.finalPrice : this.collectionSort === 'rarest' ? rarityInfo(right.rarity).rank - rarityInfo(left.rarity).rank || right.finalPrice - left.finalPrice : new Date(right.obtainedAt) - new Date(left.obtainedAt));
      const list = $('#collection-list');
      if (!values.length) {
        list.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">▤</span><h3>${currentProgress.collection.length ? 'Таких номеров пока нет' : 'Начните свою коллекцию'}</h3><p>${currentProgress.collection.length ? 'Выберите другую редкость, чтобы увидеть номера в гараже.' : 'Получите номер и нажмите «Оставить».<br>Он останется здесь вместе с ценой и характеристиками.'}</p></div>`;
        return;
      }
      list.innerHTML = values.map(result => `<button class="collection-card" type="button" data-action="detail" data-plate-id="${escapeHTML(result.id)}" style="--card-rarity:${rarityInfo(result.rarity).color}">${plateSVG(result.plate)}<div class="collection-meta"><span class="collection-rarity">${escapeHTML(rarityInfo(result.rarity).label)}</span><strong class="collection-price">${formatMoney(result.finalPrice)}</strong></div><div class="collection-subline"><span>Регион ${escapeHTML(result.plate.region.code)} · ${escapeHTML(result.plate.region.name)}</span><span>${escapeHTML(dateLabel(result.obtainedAt))}</span></div></button>`).join('');
      [...list.querySelectorAll('[data-action="detail"]')].forEach(button => {
        button.onclick = () => {
          const result = values.find(value => value.id === button.dataset.plateId);
          this.openDetail(result, { onSell: async () => { await onSell(result.id); this.openCollection(this.state?.progress ?? progress, onSell); } });
        };
      });
    };
    this.elements['app-dialog'].querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => { this.collectionFilter = button.dataset.filter; render(); }; });
    this.elements['app-dialog'].querySelectorAll('[data-sort]').forEach(button => { button.onclick = () => { this.collectionSort = button.dataset.sort; render(); }; });
    render();
  }

  openDetail(result, { onSell = null } = {}) {
    if (!result) return;
    const theme = rarityInfo(result.rarity);
    this._openDialog('detail', 'Номер в деталях', `<div class="detail-plate">${plateSVG(result.plate)}</div><p class="detail-rarity">${escapeHTML(theme.label)}</p><p class="detail-price">${formatMoney(result.finalPrice)}</p><div class="detail-facts"><div class="fact-row"><span>Регион</span><strong>${escapeHTML(result.plate.region.name)} · ${escapeHTML(result.plate.region.code)}</strong></div><div class="fact-row"><span>Получен</span><strong>${escapeHTML(dateLabel(result.obtainedAt))}</strong></div><div class="fact-row"><span>Характеристики</span><strong>${result.traits.length}</strong></div></div><div class="detail-traits">${result.traits.length ? result.traits.map(trait => `<div class="detail-trait"><strong>${escapeHTML(trait.name)}</strong><p>${escapeHTML(trait.description)}</p></div>`).join('') : '<div class="detail-trait"><strong>Стандартная комбинация</strong><p>Спокойный повседневный номер без коллекционных совпадений.</p></div>'}</div>${onSell ? `<button class="primary-button" type="button" data-action="sell-collected" data-plate-id="${escapeHTML(result.id)}">Продать за ${formatMoney(result.finalPrice)}</button><div id="sale-confirm"></div>` : '<button class="secondary-button" type="button" data-action="close">Вернуться к игре</button>'}`);
    const sheet = $('.dialog-sheet', this.elements['app-dialog']);
    sheet.style.setProperty('--rarity', theme.color);
    sheet.style.setProperty('--rarity-rgb', rgb(theme.color));
    if (onSell) {
      $('[data-action="sell-collected"]', sheet).onclick = () => {
        $('#sale-confirm').innerHTML = `<div class="sale-confirm" role="alert"><p>Номер покинет коллекцию. На баланс поступит ${formatMoney(result.finalPrice)}.</p><div class="confirm-row"><button class="secondary-button" data-action="cancel-sell" type="button">Оставить</button><button class="primary-button" data-action="confirm-sell" type="button">Продать</button></div></div>`;
        $('[data-action="cancel-sell"]', sheet).onclick = () => $('#sale-confirm').replaceChildren();
        $('[data-action="confirm-sell"]', sheet).onclick = async event => {
          const button = event.currentTarget;
          button.disabled = true;
          try { await onSell(); if (this.elements['app-dialog'].dataset.screen === 'detail') this.closeDialog(); }
          catch (error) { this.notify(error.message ?? 'Не удалось продать номер'); button.disabled = false; }
        };
        $('#sale-confirm').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
    }
  }

  openSettings(progress, onSettings, onReset) {
    const settings = progress.settings;
    const row = (name, title, caption) => `<label class="setting-row"><span class="setting-copy"><strong>${title}</strong><small>${caption}</small></span><span class="switch"><input type="checkbox" name="${name}" ${settings[name] ? 'checked' : ''} role="switch" aria-label="${title}"><span class="switch-track"></span></span></label>`;
    this._openDialog('settings', 'Настройки', `<div class="setting-group">${row('soundEnabled', 'Звук', 'Щелчки рулетки, раскрытие и финальный акцент')}${row('hapticsEnabled', 'Вибрация', 'Отклик при выпадении и повышении редкости')}${row('reducedEffects', 'Уменьшить эффекты', 'Спокойное свечение и меньше движения')}</div><p class="settings-note">Прогресс сохраняется автоматически в этом браузере. Сохранение другой вкладки учитывается перед каждым действием.</p><p class="section-label">Прогресс</p><div class="stats-grid"><div class="stat-card"><span>Открыто номеров</span><strong>${progress.numberOfRolls}</strong></div><div class="stat-card"><span>Рекорд</span><strong>${formatMoney(progress.highestPrice)}</strong></div></div><p class="section-label">Начать заново</p><button class="danger-button" type="button" data-action="reset-progress">Сбросить прогресс</button><div id="reset-confirm"></div>`);
    this.elements['app-dialog'].querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.onchange = () => onSettings(Object.fromEntries([...this.elements['app-dialog'].querySelectorAll('input[type="checkbox"]')].map(control => [control.name, control.checked])));
    });
    $('[data-action="reset-progress"]', this.elements['app-dialog']).onclick = () => {
      $('#reset-confirm').innerHTML = '<div class="reset-confirm" role="alert"><p>Баланс, коллекция и рекорды будут удалены. Вы получите новый стартовый баланс.</p><div class="confirm-row"><button class="secondary-button" data-action="cancel-reset" type="button">Отмена</button><button class="danger-button" data-action="confirm-reset" type="button">Сбросить</button></div></div>';
      $('[data-action="cancel-reset"]', this.elements['app-dialog']).onclick = () => $('#reset-confirm').replaceChildren();
      $('[data-action="confirm-reset"]', this.elements['app-dialog']).onclick = async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try { await onReset(); this.closeDialog(); }
        catch (error) { this.notify(error.message ?? 'Не удалось сбросить прогресс'); button.disabled = false; }
      };
      $('#reset-confirm').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  }

  openCountry() {
    const example = { letters: 'АВС', digits: '123', region: Regions.find(region => region.code === '77') ?? { code: '77', name: 'Москва' }, type: 'standard' };
    this._openDialog('country', 'Россия', `<div class="country-card active"><div class="country-card-header"><h3>Стандартный</h3><span class="type-state">✓ Активен</span></div><p>Классический российский автомобильный номер. Основной формат вашей коллекции.</p>${plateSVG(example)}</div><div class="country-card"><div class="country-card-header"><h3>Квадратный</h3><span class="type-state">В справочнике</span></div><p>Двухстрочный формат для автомобилей с квадратным местом крепления.</p><div style="max-width:210px;margin:16px auto 0">${plateSVG({ ...example, type: 'square' })}</div></div><div class="country-card"><div class="country-card-header"><h3>Особый</h3><span class="type-state">В справочнике</span></div><p>Отдельные форматы для специальных категорий транспорта. Сейчас генерация использует стандартные номера.</p></div><button class="primary-button" type="button" data-action="close">Продолжить со стандартным</button>`, 'Автомобильные регистрационные знаки');
  }

  openDebug(callbacks) {
    this._openDialog('debug', 'Проверка механики', `<div class="menu-grid">${Object.entries(callbacks).map(([name], index) => `<button class="secondary-button" type="button" data-debug-index="${index}">${escapeHTML(name)}</button>`).join('')}</div>`, 'Панель разработчика');
    Object.values(callbacks).forEach((callback, index) => {
      $(`[data-debug-index="${index}"]`, this.elements['app-dialog']).onclick = () => { this.closeDialog(); callback(); };
    });
  }
}

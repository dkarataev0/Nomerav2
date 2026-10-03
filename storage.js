import {Config, Rarities, Regions, isValidPlate} from './core.js';

const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;
const SETTINGS = ['soundEnabled', 'hapticsEnabled', 'reducedEffects'];
const clone = value => JSON.parse(JSON.stringify(value));
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export class SaveError extends Error {
  constructor(message, code = 'storage', cause = null) {
    super(message);
    this.name = 'SaveError';
    this.code = code;
    this.cause = cause;
  }
}

function requireValue(condition, message) {
  if (!condition) throw new SaveError(`Сохранение не прошло проверку: ${message}`, 'invalid-save');
}
const amount = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT;
const isoDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const rarityRank = key => Rarities.findIndex(rarity => rarity.key === key);

export function validateGeneratedPlate(result) {
  requireValue(result && typeof result === 'object', 'нет номера');
  requireValue(typeof result.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.id), 'неверный идентификатор номера');
  requireValue(isValidPlate(result.plate) && Regions.some(region => region.code === result.plate.region.code), 'неверный формат или регион');
  requireValue(amount(result.basePrice) && result.basePrice > 0 && amount(result.finalPrice) && result.finalPrice >= result.basePrice, 'неверная цена');
  requireValue(Number.isFinite(result.variationFactor) && result.variationFactor > 0, 'неверный коэффициент стоимости');
  requireValue(isoDate(result.obtainedAt), 'неверная дата получения');
  requireValue(rarityRank(result.rarity) >= 0, 'неизвестная редкость');
  requireValue(Array.isArray(result.traits) && new Set(result.traits.map(trait => trait.id)).size === result.traits.length, 'повтор характеристики');
  for (const trait of result.traits) {
    requireValue(typeof trait.id === 'string' && trait.id.length > 0 && typeof trait.name === 'string' && trait.name.length > 0
      && typeof trait.description === 'string' && Number.isFinite(trait.priceMultiplier) && trait.priceMultiplier >= 1
      && amount(trait.flatBonus) && Number.isFinite(trait.rarityWeight) && trait.rarityWeight >= 0
      && Number.isInteger(trait.revealPriority), 'неверная характеристика');
  }
  requireValue(Array.isArray(result.valuationSteps) && result.valuationSteps.length > 0, 'нет этапов оценки');
  let previousPrice = result.basePrice;
  let previousRarity = 0;
  for (const step of result.valuationSteps) {
    const rank = rarityRank(step.rarity);
    requireValue(amount(step.price) && step.price >= previousPrice && rank >= previousRarity, 'оценка должна постепенно расти');
    if (step.trait !== null) requireValue(result.traits.some(trait => trait.id === step.trait?.id), 'неизвестная характеристика оценки');
    previousPrice = step.price;
    previousRarity = rank;
  }
  requireValue(previousPrice === result.finalPrice && previousRarity === rarityRank(result.rarity), 'итоговая оценка не совпадает с этапами');
}

export function validateProgress(progress) {
  requireValue(progress && typeof progress === 'object' && !Array.isArray(progress), 'нет прогресса');
  requireValue(Number.isInteger(progress.schemaVersion), 'нет версии сохранения');
  if (progress.schemaVersion !== 1) throw new SaveError('Сохранение создано другой версией игры. Оно не изменено.', 'unsupported-schema');
  for (const key of ['balance', 'highestPrice', 'numberOfRolls', 'totalEarned']) requireValue(amount(progress[key]), `неверное значение ${key}`);
  requireValue(Array.isArray(progress.collection) && Array.isArray(progress.settledPlateIDs), 'неверная коллекция');
  requireValue(new Set(progress.collection.map(item => item.id)).size === progress.collection.length, 'повтор номера в гараже');
  const settled = new Set(progress.settledPlateIDs);
  requireValue(settled.size === progress.settledPlateIDs.length && progress.settledPlateIDs.every(id => typeof id === 'string'), 'повтор квитанции');
  requireValue(typeof progress.rollInFlight === 'boolean' && (!progress.rollInFlight || progress.pendingPlate !== null), 'незавершённая генерация без номера');
  for (const plate of progress.collection) {
    validateGeneratedPlate(plate);
    requireValue(settled.has(plate.id), 'нет квитанции получения номера');
  }
  if (progress.pendingPlate !== null) {
    validateGeneratedPlate(progress.pendingPlate);
    requireValue(!settled.has(progress.pendingPlate.id) && !progress.collection.some(item => item.id === progress.pendingPlate.id), 'номер уже выдан');
  }
  if (progress.recordPlate !== null) {
    validateGeneratedPlate(progress.recordPlate);
    requireValue(progress.recordPlate.finalPrice === progress.highestPrice, 'неверный рекорд');
  } else requireValue(progress.highestPrice === 0, 'нет рекордного номера');
  requireValue(progress.rarityStats && typeof progress.rarityStats === 'object' && !Array.isArray(progress.rarityStats), 'неверная статистика');
  let total = 0;
  for (const [key, value] of Object.entries(progress.rarityStats)) {
    requireValue(rarityRank(key) >= 0 && amount(value), 'неверная статистика редкостей');
    total += value;
  }
  requireValue(Number.isSafeInteger(total) && total === progress.numberOfRolls, 'неверное число генераций');
  const completedPending = progress.pendingPlate !== null && !progress.rollInFlight ? 1 : 0;
  requireValue(settled.size + completedPending === progress.numberOfRolls, 'неверное число обработанных номеров');
  requireValue(progress.settings && SETTINGS.every(key => typeof progress.settings[key] === 'boolean'), 'неверные настройки');
  requireValue(progress.lastRecoveryGrant === null || isoDate(progress.lastRecoveryGrant), 'неверная дата помощи');
  return progress;
}

function initialProgress(config) {
  return validateProgress({schemaVersion: 1, balance: config.initialBalance, collection: [], pendingPlate: null,
    highestPrice: 0, recordPlate: null, numberOfRolls: 0, totalEarned: 0, rarityStats: {},
    settings: {soundEnabled: true, hapticsEnabled: true, reducedEffects: false},
    lastRecoveryGrant: null, rollInFlight: false, settledPlateIDs: []});
}

function decode(raw) {
  const result = JSON.parse(raw);
  // Inspect schema before checking v1 fields. A future schema may rename them.
  if (result && Number.isInteger(result.schemaVersion) && result.schemaVersion !== 1)
    throw new SaveError('Сохранение создано другой версией игры. Оно не изменено.', 'unsupported-schema');
  return validateProgress(result);
}

function restoreKey(storage, key, value) {
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, value);
}

function writePair(storage, key, primary, backup) {
  const previousPrimary = storage.getItem(key);
  const previousBackup = storage.getItem(`${key}.backup`);
  try {
    storage.setItem(`${key}.backup`, backup);
    storage.setItem(key, primary);
  } catch (cause) {
    let rollbackFailed = false;
    try { restoreKey(storage, key, previousPrimary); } catch { rollbackFailed = true; }
    try { restoreKey(storage, `${key}.backup`, previousBackup); } catch { rollbackFailed = true; }
    const suffix = rollbackFailed ? ' Перезагрузите страницу перед следующим действием.' : '';
    throw new SaveError(`Не удалось сохранить действие. Освободите место в хранилище браузера.${suffix}`, 'write-failed', cause);
  }
}

/** Progress is immutable outside synchronous, persisted transactions. */
export class GameStore {
  #progress;
  #lastRaw;
  #storage;
  #key;
  #config;
  loadWarning = null;

  constructor(options = {}) {
    this.#key = options.key ?? 'nomera-v2.progress';
    this.#config = options.config ?? Config;
    try {
      this.#storage = options.storage ?? globalThis.localStorage;
      if (!this.#storage) throw new Error('Local storage unavailable');
      const raw = this.#storage.getItem(this.#key);
      const backup = this.#storage.getItem(`${this.#key}.backup`);
      this.#lastRaw = raw;
      if (raw === null && backup === null) this.#progress = deepFreeze(initialProgress(this.#config));
      else {
        try {
          if (raw === null) throw new Error('Missing primary snapshot');
          this.#progress = deepFreeze(decode(raw));
        } catch (error) {
          if (error instanceof SaveError && error.code === 'unsupported-schema') throw error;
          if (backup === null) throw new SaveError('Прогресс повреждён; резервная копия недоступна. Данные сохранены без изменений. Можно явно сбросить прогресс.', 'corrupt-save', error);
          let recovered;
          try { recovered = decode(backup); }
          catch (backupError) {
            if (backupError instanceof SaveError && backupError.code === 'unsupported-schema') throw backupError;
            throw new SaveError('Прогресс и резервная копия повреждены. Данные сохранены без изменений. Можно явно сбросить прогресс.', 'corrupt-save', backupError);
          }
          // Archive the damaged primary before restoring a valid snapshot.
          if (raw !== null) this.#storage.setItem(`${this.#key}.corrupt.${Date.now()}`, raw);
          this.#storage.setItem(this.#key, backup);
          this.#lastRaw = backup;
          this.#progress = deepFreeze(recovered);
          this.loadWarning = 'Прогресс восстановлен из последней рабочей резервной копии.';
        }
      }
    } catch (error) {
      if (error instanceof SaveError) throw error;
      throw new SaveError('Хранилище браузера недоступно. Прогресс не перезаписан.', 'storage-unavailable', error);
    }
  }

  get progress() { return this.#progress; }

  #transact(change) {
    const proposed = clone(this.#progress);
    const value = change(proposed);
    validateProgress(proposed);
    try {
      const currentRaw = this.#storage.getItem(this.#key);
      if (currentRaw !== this.#lastRaw) throw new SaveError('Прогресс изменён в другой вкладке. Обновите страницу перед следующим действием.', 'conflict');
      const serialized = JSON.stringify(proposed);
      writePair(this.#storage, this.#key, serialized, currentRaw ?? serialized);
      this.#lastRaw = serialized;
      this.#progress = deepFreeze(proposed);
      return value;
    } catch (error) {
      if (error instanceof SaveError) throw error;
      throw new SaveError('Не удалось сохранить действие. Прогресс не изменён.', 'write-failed', error);
    }
  }

  beginRoll(result) {
    if (this.#progress.settledPlateIDs.includes(result.id) || this.#progress.pendingPlate?.id === result.id) return;
    return this.#transact(progress => {
      if (progress.pendingPlate) throw new SaveError('Сначала продайте полученный номер или оставьте его в коллекции.', 'pending-decision');
      validateGeneratedPlate(result);
      if (progress.balance < this.#config.rollCost) throw new SaveError('Недостаточно рублей для генерации.', 'insufficient-balance');
      progress.balance -= this.#config.rollCost;
      progress.pendingPlate = clone(result);
      progress.rollInFlight = true;
    });
  }

  completeRoll() {
    if (!this.#progress.rollInFlight || !this.#progress.pendingPlate) return false;
    return this.#transact(progress => {
      const result = progress.pendingPlate;
      progress.rollInFlight = false;
      progress.numberOfRolls += 1;
      progress.rarityStats[result.rarity] = (progress.rarityStats[result.rarity] ?? 0) + 1;
      const record = result.finalPrice > progress.highestPrice;
      if (record) { progress.highestPrice = result.finalPrice; progress.recordPlate = clone(result); }
      return record;
    });
  }

  keepPending() {
    if (!this.#progress.pendingPlate) return;
    return this.#transact(progress => {
      if (progress.rollInFlight) throw new SaveError('Оценка номера ещё не закончена.', 'still-rolling');
      if (progress.collection.length >= this.#config.maximumCollectionCount) throw new SaveError('Гараж заполнен. Продайте один из сохранённых номеров.', 'collection-full');
      progress.collection.push(progress.pendingPlate);
      progress.settledPlateIDs.push(progress.pendingPlate.id);
      progress.pendingPlate = null;
    });
  }

  sellPending() {
    if (!this.#progress.pendingPlate) return 0;
    return this.#transact(progress => {
      if (progress.rollInFlight) throw new SaveError('Оценка номера ещё не закончена.', 'still-rolling');
      const result = progress.pendingPlate;
      progress.balance += result.finalPrice;
      progress.totalEarned += result.finalPrice;
      progress.settledPlateIDs.push(result.id);
      progress.pendingPlate = null;
      return result.finalPrice;
    });
  }

  sellCollected(id) {
    const index = this.#progress.collection.findIndex(plate => plate.id === id);
    if (index < 0) return 0;
    return this.#transact(progress => {
      const [result] = progress.collection.splice(index, 1);
      progress.balance += result.finalPrice;
      progress.totalEarned += result.finalPrice;
      return result.finalPrice;
    });
  }

  updateSettings(settings) {
    return this.#transact(progress => {
      for (const key of SETTINGS) if (Object.hasOwn(settings, key)) progress.settings[key] = settings[key];
    });
  }

  // The controller exposes this only on localhost with its debug query flag.
  addDebugMoney(addition = 1_000_000) {
    requireValue(amount(addition), 'неверная сумма отладки');
    return this.#transact(progress => { progress.balance += addition; });
  }

  claimRecovery(now = Date.now()) {
    requireValue(Number.isFinite(now), 'неверное время помощи');
    const progress = this.#progress;
    if (progress.balance >= this.#config.rollCost || progress.pendingPlate || progress.collection.length > 0 || progress.rollInFlight) return 0;
    if (progress.lastRecoveryGrant !== null && now - Date.parse(progress.lastRecoveryGrant) < this.#config.recoveryCooldown * 1000) return 0;
    return this.#transact(proposed => {
      proposed.balance += this.#config.recoveryGrant;
      proposed.lastRecoveryGrant = new Date(now).toISOString();
      return this.#config.recoveryGrant;
    });
  }

  reset() {
    const fresh = initialProgress(this.#config);
    const raw = JSON.stringify(fresh);
    try {
      writePair(this.#storage, this.#key, raw, raw);
      this.#progress = deepFreeze(fresh);
      this.#lastRaw = raw;
      this.loadWarning = null;
    } catch (error) {
      if (error instanceof SaveError) throw error;
      throw new SaveError('Не удалось сбросить прогресс. Данные не изменены.', 'write-failed', error);
    }
    return this.#progress;
  }

  /** Explicit reset remains available when an unreadable save blocks construction. */
  static resetStorage(options = {}) {
    const key = options.key ?? 'nomera-v2.progress';
    const config = options.config ?? Config;
    try {
      const storage = options.storage ?? globalThis.localStorage;
      const raw = JSON.stringify(initialProgress(config));
      writePair(storage, key, raw, raw);
      return new GameStore({...options, storage});
    } catch (error) {
      if (error instanceof SaveError) throw error;
      throw new SaveError('Не удалось сбросить прогресс. Хранилище браузера недоступно.', 'storage-unavailable', error);
    }
  }
}

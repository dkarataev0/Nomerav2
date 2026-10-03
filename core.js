import { GAME_DATA } from './game-data.js';

// Balance and catalog facts are generated from the native Swift source of truth.
export const Config = Object.freeze(GAME_DATA.config);
export const Rarities = Object.freeze(GAME_DATA.rarities.map(Object.freeze));
export const Regions = Object.freeze(GAME_DATA.regions.map(Object.freeze));
export const AllowedLetters = Object.freeze(GAME_DATA.allowedLetters);
export const SpecialSeries = Object.freeze(GAME_DATA.specialSeries.map(Object.freeze));

const rankByKey = new Map(Rarities.map(rarity => [rarity.key, rarity.rank]));
const regionByCode = new Map(Regions.map(region => [region.code, region]));
const seriesByLetters = new Map(SpecialSeries.map(series => [series.letters, series]));
const beautifulDigits = new Set(Config.beautifulDigits);
const sequences = new Set(Config.sequences);
const latinToCyrillic = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х', R: 'Р' };
const cyrillicToLatin = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));

export function normalizeLetters(value) {
  return Array.from(String(value).toUpperCase(), letter => latinToCyrillic[letter] ?? letter).join('');
}

export function isValidPlate(plate) {
  return Boolean(plate && typeof plate.letters === 'string' && plate.letters.length === 3
    && Array.from(plate.letters).every(letter => AllowedLetters.includes(letter))
    && typeof plate.digits === 'string' && /^\d{3}$/.test(plate.digits)
    && plate.region && typeof plate.region.code === 'string' && /^\d{2,3}$/.test(plate.region.code)
    && ['standard', 'square', 'special'].includes(plate.type ?? 'standard'));
}

export function formatMoney(value) {
  const amount = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

export function rarityInfo(key) {
  return Rarities.find(rarity => rarity.key === key) ?? Rarities[0];
}

/** Portable SplitMix64 stream. Top 53 bits become a standard [0, 1) random function. */
export function createRng(seed) {
  let state;
  try { state = BigInt.asUintN(64, BigInt(seed)); }
  catch {
    state = 0n;
    for (const character of String(seed)) state = BigInt.asUintN(64, state * 31n + BigInt(character.codePointAt(0)));
  }
  const nextUint64 = () => {
    state = BigInt.asUintN(64, state + 0x9E3779B97F4A7C15n);
    let value = state;
    value = BigInt.asUintN(64, (value ^ (value >> 30n)) * 0xBF58476D1CE4E5B9n);
    value = BigInt.asUintN(64, (value ^ (value >> 27n)) * 0x94D049BB133111EBn);
    return BigInt.asUintN(64, value ^ (value >> 31n));
  };
  const random = () => Number(nextUint64() >> 11n) / 9007199254740992;
  random.nextUint64 = nextUint64;
  return random;
}

function randomUnit(rng) {
  const value = Number(rng());
  return Number.isFinite(value) ? clamp(value, 0, 1 - Number.EPSILON) : 0;
}
const choose = (values, rng) => values[Math.floor(randomUnit(rng) * values.length)];
const randomInteger = (maximum, rng) => Math.floor(randomUnit(rng) * (maximum + 1));

function weightedChoice(values, weight, rng) {
  const total = values.reduce((sum, value) => sum + Math.max(0, weight(value)), 0);
  let sample = randomUnit(rng) * Math.max(0.0001, total);
  for (const value of values) {
    sample -= Math.max(0, weight(value));
    if (sample < 0) return value;
  }
  return values[0];
}

function rarityForTraits(traits) {
  const score = traits.reduce((sum, trait) => sum + trait.rarityWeight, 0);
  return [...Rarities].reverse().find(rarity => score >= (Config.rarityThresholds[rarity.key] ?? Infinity))?.key ?? 'common';
}

/** Pure feature detection. All multipliers and rarity weights come from GameBalanceConfig. */
export function analyzePlate(plate) {
  if (!isValidPlate(plate)) return [];
  const digits = Array.from(plate.digits);
  const letters = Array.from(plate.letters);
  const traits = [];
  const add = (id, name, description, ruleID = id) => {
    const rule = Config.traitRules[ruleID] ?? { priceMultiplier: 1, flatBonus: 0, rarityWeight: 0, revealPriority: 90 };
    traits.push({ id, name, description, ...rule });
  };
  const tripleDigits = new Set(digits).size === 1;
  if (tripleDigits) {
    add('tripleDigits', '3 одинаковые цифры', `Тройное повторение ${plate.digits} — узнаваемая цифровая комбинация.`);
  } else {
    if (digits[0] === digits[2]) add('mirrorDigits', 'Зеркальные цифры', `${plate.digits} читается одинаково в обе стороны.`);
    if (sequences.has(plate.digits)) add('sequenceDigits', 'Последовательность цифр', `Цифры ${plate.digits} идут по порядку.`);
    if (beautifulDigits.has(plate.digits)) add('beautifulDigits', `Красивая комбинация ${plate.digits}`, 'Коллекционная цифровая комбинация из игрового справочника.');
    if (new Set(digits).size === 2) add('doubleDigits', '2 одинаковые цифры', `Две цифры в комбинации ${plate.digits} совпадают.`);
  }
  if (new Set(letters).size === 1) add('tripleLetters', '3 одинаковые буквы', `Все буквы серии ${plate.letters} совпадают.`);
  else if (new Set(letters).size === 2) add('doubleLetters', '2 одинаковые буквы', `Две буквы серии ${plate.letters} совпадают.`);
  if ([['О', '0'], ['В', '8']].some(([letter, digit]) => letters.filter(value => value === letter).length >= 2 && digits.filter(value => value === digit).length >= 2)) {
    add('visualMatch', 'Визуальное совпадение', 'Форма букв и цифр образует единый визуальный ритм.');
  }
  const region = plate.region.code;
  if (new Set(region).size === 1) add('repeatedRegion', 'Одинаковые цифры региона', `Код региона ${region} состоит из одинаковых цифр.`);
  const matchesRegion = region.length === 3 ? plate.digits === region
    : plate.digits.startsWith(region) || plate.digits.endsWith(region) || Number(plate.digits) === Number(region);
  if (matchesRegion) add('regionMatch', 'Цифры совпадают с регионом', `Комбинация ${plate.digits} повторяет код ${region} в начале, конце или без ведущего нуля.`);
  if (plate.region.isRare) add('rareRegion', 'Редкий регион', `${plate.region.name}: редкий регион в игровой коллекции.`);
  const series = seriesByLetters.get(plate.letters);
  if (series) {
    const specific = `specialSeries.${series.id}`;
    add('specialSeries', series.name, series.description, Config.traitRules[specific] ? specific : `specialSeries.${series.profile}`);
  }
  const latin = letters.map(letter => cyrillicToLatin[letter] ?? letter);
  const iconicKey = `${latin[0]}${plate.digits}${latin[1]}${latin[2]}${region}`;
  if (Config.traitRules[`iconicCombination.${iconicKey}`]) {
    const display = `${letters[0]} ${plate.digits} ${letters.slice(1).join('')} · ${region}`;
    add('iconicCombination', 'Знаковая комбинация', `${display} — редкое сочетание серии, цифр и региона в игровом каталоге.`, `iconicCombination.${iconicKey}`);
  } else if (tripleDigits && new Set(letters).size === 1 && series) {
    add('seriesResonance', 'Коллекционная связка', 'Тройные цифры и буквы усиливают коллекционную ценность особой серии.');
  }
  return traits.sort((left, right) => left.revealPriority - right.revealPriority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function presentationRarity(traits, price) {
  const analyzedRank = rankByKey.get(rarityForTraits(traits));
  return [...Rarities].reverse().find(tier => tier.rank <= analyzedRank && (tier.key === 'common'
    || price >= (Config.priceBands[tier.key]?.minimum ?? Infinity) * Config.variationRange[0]))?.key ?? 'common';
}

export function evaluatePlate(plate, {
  variationFactor = 1, id = globalThis.crypto.randomUUID(), obtainedAt = new Date().toISOString()
} = {}) {
  if (!isValidPlate(plate)) throw new TypeError('Неверный формат российского номера.');
  const traits = analyzePlate(plate);
  const letterValue = Array.from(plate.letters).reduce((sum, letter) => sum + Math.max(0, AllowedLetters.indexOf(letter)), 0);
  const span = Math.max(1, Config.basePriceRange[1] - Config.basePriceRange[0] + 1);
  const hash = Number(plate.digits) * Config.baseHashDigitMultiplier + Number(plate.region.code) * Config.baseHashRegionMultiplier
    + letterValue * Config.baseHashLetterMultiplier;
  const basePrice = Config.basePriceRange[0] + Math.abs(hash) % span;
  const variation = Number.isFinite(variationFactor) ? clamp(variationFactor, ...Config.variationRange) : 1;
  let rawPrice = basePrice;
  const revealed = [];
  const valuationSteps = [{ trait: null, price: basePrice, rarity: 'common' }];
  for (const trait of traits) {
    rawPrice = clamp(rawPrice * trait.priceMultiplier + trait.flatBonus, basePrice, Number.MAX_SAFE_INTEGER / 4);
    revealed.push(trait);
    const rarity = rarityForTraits(revealed);
    const band = Config.priceBands[rarity];
    const appraised = Math.round(clamp(rawPrice, band.minimum, band.maximum) * variation);
    valuationSteps.push({ trait, price: Math.max(valuationSteps.at(-1).price, appraised), rarity });
  }
  if (!traits.length) valuationSteps.push({ trait: null, price: Math.max(basePrice, Math.round(basePrice * variation)), rarity: 'common' });
  return { id, plate, traits, basePrice, finalPrice: valuationSteps.at(-1).price, rarity: rarityForTraits(traits),
    variationFactor: variation, obtainedAt, valuationSteps };
}

function candidate(rarity, rng) {
  let letters = Array.from({ length: 3 }, () => choose(AllowedLetters, rng)).join('');
  let digits = String(randomInteger(999, rng)).padStart(3, '0');
  let region = weightedChoice(Regions, item => Config.regionGenerationWeights[item.code] ?? item.generationWeight, rng);
  switch (rarity) {
    case 'uncommon': {
      const choice = randomInteger(3, rng);
      if (choice === 0) digits = String(randomInteger(9, rng)).repeat(3);
      else if (choice === 1) digits = choose(Config.beautifulDigits, rng);
      else if (choice === 2) digits = choose(Config.sequences, rng);
      else letters = choose(AllowedLetters, rng).repeat(3);
      break;
    }
    case 'rare':
      if (randomUnit(rng) < 0.5) {
        letters = choose(['В', 'Н', 'Р', 'Т', 'У'], rng).repeat(3);
        digits = String(randomInteger(9, rng)).repeat(3);
      } else {
        letters = choose(['АОО', 'МОО', 'ВОО', 'СОО', 'АМР', 'ЕКХ'], rng);
        digits = choose(Config.beautifulDigits, rng);
      }
      break;
    case 'epic':
      letters = choose(['ААА', 'ООО', 'МММ', 'ССС', 'ККК', 'ХХХ', 'ЕЕЕ'], rng);
      digits = String(randomInteger(9, rng)).repeat(3);
      break;
    case 'legendary': {
      const patterns = [['ЕЕЕ', '222', '52'], ['АОО', '770', '77'], ['ООО', '777', '77'], ['ААА', '001', '77']];
      const selected = choose(patterns, rng);
      letters = selected[0]; digits = selected[1]; region = regionByCode.get(selected[2]);
      break;
    }
  }
  return { letters, digits, region, type: 'standard' };
}

/** The weighted rarity budget is verified by the analyzer; no rarity is written into a plate. */
export function generatePlate(targetRarity = null, rng = Math.random) {
  const rarity = targetRarity ?? weightedChoice(Rarities, item => Config.rarityWeights[item.key] ?? 0, rng).key;
  if (!rankByKey.has(rarity)) throw new TypeError(`Неизвестная редкость: ${rarity}`);
  for (let attempt = 0; attempt < Math.max(1, Config.generationAttempts); attempt++) {
    const plate = candidate(rarity, rng);
    if (rarityForTraits(analyzePlate(plate)) === rarity) return plate;
  }
  const fallbacks = { common: ['НТР', '483'], uncommon: ['АКТ', '777'], rare: ['ВВВ', '777'], epic: ['МММ', '777'], legendary: ['ЕЕЕ', '222'] };
  const [letters, digits] = fallbacks[rarity];
  return { letters, digits, region: regionByCode.get('52'), type: 'standard' };
}

export function revealDuration(traitCount, rarity) {
  const duration = Config.selectionPause + Math.max(1, traitCount) * Config.traitRevealInterval + Config.finishingDuration;
  const band = Config.revealDurationBands[rarity] ?? [Config.revealMinimum, Config.revealMaximum];
  const tierDuration = clamp(duration + (rarity === 'legendary' ? Config.legendaryPause : 0), ...band);
  return clamp(tierDuration, Config.revealMinimum, Config.revealMaximum);
}

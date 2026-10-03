import { Config, Regions, generatePlate, evaluatePlate, formatMoney, rarityInfo,
  presentationRarity, revealDuration } from './core.js';
import { GameStore } from './storage.js';
import { Feedback } from './feedback.js';
import { GameUI } from './ui.js';

const localDebug = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  && new URLSearchParams(location.search).has('debug');
const fast = localDebug && new URLSearchParams(location.search).has('fast');
const timingScale = fast ? 0.045 : 1;
const feedback = new Feedback();
const ui = new GameUI();
let store;
let storageError;
try { store = new GameStore(); } catch (error) { storageError = error; }

const emptyProgress = {
  balance: Config.initialBalance, collection: [], pendingPlate: null, highestPrice: 0,
  recordPlate: null, numberOfRolls: 0, totalEarned: 0, rarityStats: {}, rollInFlight: false,
  settings: { soundEnabled: true, hapticsEnabled: true, reducedEffects: false }, lastRecoveryGrant: null,
};
const state = { phase: 'idle', progress: store?.progress ?? emptyProgress, currentPlate: null,
  displayPrice: 0, displayRarity: 'common', revealedTraits: [], legendaryPulse: false };
let activeRun = null;
let recordTimer = null;
let resumeTask = null;

function isBusy() { return !['idle', 'completed'].includes(state.phase); }
function canRoll() { return Boolean(store && state.phase === 'idle' && !state.progress.pendingPlate
  && state.progress.balance >= Config.rollCost); }
function canResolve() { return Boolean(store && state.phase === 'completed'
  && state.progress.pendingPlate && !state.progress.rollInFlight); }
function recoveryAvailable() {
  const progress = state.progress;
  return Boolean(store && progress.balance < Config.rollCost && !progress.pendingPlate && !progress.collection.length
    && (!progress.lastRecoveryGrant || Date.now() - Date.parse(progress.lastRecoveryGrant) >= Config.recoveryCooldown * 1000));
}
function render() {
  state.progress = store?.progress ?? emptyProgress;
  const wait = Math.max(0, Config.recoveryCooldown * 1000
    - (Date.now() - Date.parse(state.progress.lastRecoveryGrant ?? '1970-01-01')));
  ui.update({ ...state, canRoll: canRoll(), canResolve: canResolve(), recoveryAvailable: recoveryAvailable(),
    recoveryText: wait ? `Резерв через ${Math.ceil(wait / 3600000)} ч` : 'Получить стартовый резерв',
    statusText: storageError ? storageError.message : {
      idle: state.progress.balance < Config.rollCost ? 'Продайте номер из коллекции или получите резерв' : 'Какой номер станет вашим?',
      rolling: 'Ищем следующий номер', selected: 'Номер найден. Начинаем оценку',
      revealing: 'Раскрываем особенности', valuating: 'Оцениваем коллекционную ценность',
      finishing: 'Финальная оценка', completed: 'Продать или сохранить в коллекции?',
    }[state.phase],
  });
}
function configureFeedback() { feedback.configure(state.progress.settings); }
function report(error) { ui.notify(error.message ?? 'Не удалось выполнить действие'); }
function sleep(seconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Interrupted', 'AbortError'));
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.max(0, seconds * 1000));
    function abort() { clearTimeout(timer); reject(new DOMException('Interrupted', 'AbortError')); }
    signal.addEventListener('abort', abort, { once: true });
  });
}
function changeRarity(next) {
  if (rarityInfo(next).rank <= rarityInfo(state.displayRarity).rank) return;
  state.displayRarity = next;
  feedback.play(`${next}Reveal`);
  feedback.haptic('reveal', next);
}
function countTo(target, targetRarity, duration, signal) {
  const start = state.displayPrice;
  target = Math.max(start, target);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Interrupted', 'AbortError'));
    const startTime = performance.now();
    let frame, lastRender = -Infinity, lastTick = -Infinity;
    const abort = () => { cancelAnimationFrame(frame); reject(new DOMException('Interrupted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    const tick = now => {
      const fraction = Math.min(1, (now - startTime) / Math.max(16, duration * 1000));
      if (now - lastRender >= 1000 / 30 || fraction === 1) {
        state.displayPrice = start + Math.round((target - start) * (1 - (1 - fraction) ** 3));
        const visible = presentationRarity(state.revealedTraits, state.displayPrice);
        changeRarity(rarityInfo(visible).rank <= rarityInfo(targetRarity).rank ? visible : targetRarity);
        render(); lastRender = now;
      }
      if (target > start && now - lastTick >= 140) { feedback.play('moneyCounter'); lastTick = now; }
      if (fraction < 1) { frame = requestAnimationFrame(tick); return; }
      signal.removeEventListener('abort', abort);
      state.displayPrice = target; changeRarity(targetRarity); render(); resolve();
    };
    frame = requestAnimationFrame(tick);
  });
}

async function reveal(result, signal) {
  state.displayPrice = result.basePrice;
  state.phase = 'revealing'; feedback.play('commonReveal'); render();
  const total = Math.max(0.04, revealDuration(result.traits.length, result.rarity)
    - Config.finishingDuration - (result.rarity === 'legendary' ? Config.legendaryPause : 0)) * timingScale;
  const interval = total / Math.max(1, result.valuationSteps.length);
  for (const step of result.valuationSteps) {
    await sleep(Math.min(0.35 * timingScale, interval * 0.28), signal);
    if (step.trait && !state.revealedTraits.some(trait => trait.id === step.trait.id)) {
      state.revealedTraits = [...state.revealedTraits, step.trait];
      feedback.play('newTrait'); feedback.haptic('trait'); render();
    }
    state.phase = 'valuating';
    await countTo(step.price, step.rarity, interval * 0.72, signal);
    state.phase = 'revealing';
  }
  state.phase = 'finishing';
  if (state.displayPrice !== result.finalPrice) await countTo(result.finalPrice, result.rarity, 0.5 * timingScale, signal);
  changeRarity(result.rarity);
  if (result.rarity === 'legendary') {
    state.legendaryPulse = true;
    feedback.play('legendaryReveal'); feedback.haptic('reveal', 'legendary'); render();
    await sleep(Config.legendaryPause * timingScale, signal);
    state.legendaryPulse = false; render();
  }
  await sleep(Config.finishingDuration * timingScale, signal);
  let newRecord;
  try { newRecord = store.completeRoll(); }
  catch (error) { state.phase = 'selected'; render(); report(error); return; }
  state.phase = 'completed'; render();
  if (newRecord) {
    feedback.play('record'); feedback.haptic('record');
    clearTimeout(recordTimer);
    ui.showRecord(result, () => openDetail(result));
    recordTimer = setTimeout(() => ui.hideRecord(), Config.recordToastDuration * 1000);
  }
}

function begin(result) {
  if (!canRoll()) return;
  try { store.beginRoll(result); } catch (error) { report(error); return; }
  // No await occurs before the durable transaction and phase lock.
  state.phase = 'rolling'; state.currentPlate = result; state.revealedTraits = [];
  state.displayPrice = 0; state.displayRarity = 'common'; state.legendaryPulse = false;
  configureFeedback(); void feedback.unlock(); feedback.play('buttonTap'); feedback.haptic('tap'); render();
  const run = new AbortController(); activeRun = run;
  const plates = [previousPlate];
  for (let index = 0; index < Math.max(4, Config.rollPlateCount); index++) plates.push(generatePlate());
  plates.push(result.plate);
  const reduced = state.progress.settings.reducedEffects || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = fast ? 0.15 : reduced ? 1.1 : Config.rollDuration;
  resumeTask = (async () => {
    try {
      await ui.roll(plates, duration, run.signal, () => { feedback.play('rollTick'); feedback.haptic('rollTick'); });
      state.phase = 'selected'; previousPlate = result.plate;
      feedback.play('rollStop'); feedback.haptic('rollStop'); render();
      await sleep(Config.selectionPause * timingScale, run.signal);
      await reveal(result, run.signal);
    } catch (error) { if (error.name !== 'AbortError') report(error); }
    finally { if (activeRun === run) { activeRun = null; resumeTask = null; } }
  })();
}
function roll() {
  if (!canRoll()) return;
  const variation = Config.variationRange[0] + Math.random() * (Config.variationRange[1] - Config.variationRange[0]);
  begin(evaluatePlate(generatePlate(), { variationFactor: variation }));
}
function resolvePending(keep) {
  if (!canResolve()) return;
  try {
    if (keep) store.keepPending(); else store.sellPending();
    state.phase = 'idle'; feedback.play('buttonTap'); feedback.haptic('tap'); render();
    ui.notify(keep ? 'Номер сохранён в коллекции' : `Продано за ${formatMoney(state.currentPlate.finalPrice)}`);
  } catch (error) { report(error); }
}
function suspend() {
  activeRun?.abort(); activeRun = null; resumeTask = null;
  feedback.stop(); clearTimeout(recordTimer); ui.hideRecord(); state.legendaryPulse = false;
  if (state.progress.pendingPlate) ui.setPlate(state.progress.pendingPlate.plate);
}
function resume() {
  if (!store || activeRun || resumeTask) return;
  configureFeedback(); state.progress = store.progress;
  const pending = state.progress.pendingPlate;
  if (!pending) { render(); return; }
  state.currentPlate = pending; previousPlate = pending.plate; ui.setPlate(pending.plate);
  if (!state.progress.rollInFlight) {
    state.phase = 'completed'; state.displayPrice = pending.finalPrice;
    state.displayRarity = pending.rarity; state.revealedTraits = pending.traits; render(); return;
  }
  state.phase = 'selected'; state.displayPrice = 0; state.displayRarity = 'common'; state.revealedTraits = []; render();
  const run = new AbortController(); activeRun = run;
  resumeTask = reveal(pending, run.signal).catch(error => { if (error.name !== 'AbortError') report(error); })
    .finally(() => { if (activeRun === run) { activeRun = null; resumeTask = null; } });
}
function openDetail(result) {
  clearTimeout(recordTimer); ui.hideRecord();
  const owned = state.progress.collection.some(item => item.id === result.id);
  const pending = state.progress.pendingPlate?.id === result.id && canResolve();
  ui.openDetail(result, { onSell: owned ? () => sellCollected(result.id) : pending ? () => resolvePending(false) : null });
}
function sellCollected(id) {
  try { store.sellCollected(id); render(); feedback.play('buttonTap'); feedback.haptic('tap'); }
  catch (error) { report(error); throw error; }
  return store.progress;
}
function openCollection() { ui.openCollection(state.progress, sellCollected); }
function reset() {
  suspend();
  try {
    store = store ? (store.reset(), store) : GameStore.resetStorage();
    storageError = null; state.phase = 'idle'; state.currentPlate = null;
    state.revealedTraits = []; state.displayPrice = 0; state.displayRarity = 'common';
    previousPlate = startingPlate(); ui.setPlate(previousPlate); render(); configureFeedback();
    ui.notify('Новая коллекция начинается здесь');
  } catch (error) { storageError = error; report(error); render(); }
}
function openSettings() {
  ui.openSettings(state.progress, settings => {
    try { if (!store) throw storageError; store.updateSettings(settings); render(); configureFeedback(); }
    catch (error) { report(error); }
  }, reset);
}
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (['generate', 'keep', 'sell', 'menu', 'country', 'recovery', 'collection', 'settings', 'retry'].includes(action)) void feedback.unlock();
  if (action === 'generate') roll();
  else if (action === 'keep') resolvePending(true);
  else if (action === 'sell') resolvePending(false);
  else if (action === 'menu') ui.openMenu({ collection: openCollection, settings: openSettings,
    record: () => state.progress.recordPlate ? openDetail(state.progress.recordPlate) : ui.notify('Рекорд появится после первой оценки') });
  else if (action === 'country') ui.openCountry();
  else if (action === 'collection') openCollection();
  else if (action === 'settings') openSettings();
  else if (action === 'retry') resume();
  else if (action === 'recovery') {
    try { if (recoveryAvailable()) { store.claimRecovery(); render(); ui.notify(`Резерв: ${formatMoney(Config.recoveryGrant)}`); } }
    catch (error) { report(error); }
  }
});
document.addEventListener('visibilitychange', () => document.hidden ? suspend() : resume());
window.addEventListener('pagehide', suspend);
window.addEventListener('pageshow', resume);
function startingPlate() { return { letters: 'АОО', digits: '001', region: Regions.find(region => region.code === '77'), type: 'standard' }; }
let previousPlate = store?.progress.pendingPlate?.plate ?? store?.progress.recordPlate?.plate ?? startingPlate();
ui.setPlate(previousPlate); configureFeedback(); render(); resume();
if (storageError) report(storageError);
else if (store.loadWarning) ui.notify(store.loadWarning);

if (localDebug) window.__game = {
  get state() { return { ...state, progress: store?.progress ?? emptyProgress }; }, config: Config,
  forceRarity: rarity => { if (canRoll()) begin(evaluatePlate(generatePlate(rarity))); },
  forceReference: second => { if (canRoll()) begin(evaluatePlate({ letters: second ? 'АОО' : 'ЕЕЕ', digits: second ? '770' : '222',
    region: Regions.find(region => region.code === (second ? '77' : '52')), type: 'standard' })); },
  addDebugMoney: () => { store.addDebugMoney(); render(); },
  reset, resume, suspend,
};
if ('serviceWorker' in navigator && !localDebug) navigator.serviceWorker.register('./sw.js').catch(() => {});

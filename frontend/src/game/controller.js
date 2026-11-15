/**
 * Contrôleur de partie : machine d'états du tour, indépendante de React et de Three.js
 * (donc testable en Node). Le moteur déterministe (engine.js) reste la seule source de vérité des règles.
 *
 * Phases : intro → briefing → plan → execute → accident → resolve → summary → fact → (plan | end)
 */
import { createRNG, createInitialState, validateActions, playTurn, drawEventForTurn, calculateScore } from "./engine.js";
import { ACTOR_FOR_ACTION, HAZARDS, SLOT_COUNT } from "./layout.js";
import { SITES } from "../kemet/facts.js";
import { forBody } from "../kemet/questions.js";
import { serverMethods } from "../kemet/serverMode.js";
import { getMissionForSol } from "../kemet/dailyMissions.js";

export const SAVE_KEY = "mm30_3d_save_v1";
const BONUS_AMOUNT = 4;
export const RULES = { life: 100, quizWrong: 15, riskyChoice: 10, quizRightCredits: 15, loadoutTotal: 320, loadoutMin: 30, loadoutMax: 100 };
const DEFAULT_SUIT = { skin: "#d9a066", suit: "#f1f3f8", visor: "#2a1d0a", patch: ":i-earth:", name: "" };

export function createBus() {
  const map = new Map();
  return {
    on(type, fn) { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); return () => map.get(type).delete(fn); },
    emit(type, payload) { const s = map.get(type); if (s) [...s].forEach((fn) => fn(payload)); return !!(s && s.size); },
  };
}

export function createStore(initial) {
  let state = initial; const subs = new Set();
  return {
    get: () => state,
    set(patch) { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; subs.forEach((f) => f()); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

const freshBuilt = () => ({ solar: [0], moxie: [], greenhouse: [], shield: [] });
const memoryStorage = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

export function createController({ data: baseData, storage = memoryStorage(), bus = createBus(), timing = {}, seed, backend = null, mission = null } = {}) {
  let data = baseData;
  const T = { executeMax: 9000, accidentIntro: 2400, daySweep: 3200, ...timing };
  const safe = (fn, d) => { try { return fn(); } catch (_) { return d; } };
  const readSave = () => safe(() => JSON.parse(storage.getItem(SAVE_KEY) || "{}"), {});
  const writeSave = (patch) => safe(() => storage.setItem(SAVE_KEY, JSON.stringify({ ...readSave(), ...patch })));
  const save0 = readSave();

  const store = createStore({
    phase: save0.user ? "intro" : "login", user: save0.user || null, authError: null, authBusy: false, suit: save0.suit || DEFAULT_SUIT, loadout: { o2: 80, energy: 80, food: 80, protection: 80 }, dest: null, site: null, life: RULES.life, quiz: null, quizStats: { right: 0, wrong: 0 }, lifeLog: [], env: "mars", lang: save0.lang || "fr", sound: save0.sound !== false, callsign: save0.callsign || "Aigle",
    game: createInitialState(data.config), plan: [], placing: null,
    pendingEvent: null, choicesReady: false, bonusReached: false, bonusRes: null,
    lastDelta: null, lastText: "", lastEventId: null, factId: null, score: null,
    best: save0.best || 0, hasSave: !!save0.game, firstTime: !save0.tutorialDone, tutorial: 0,
    dayCount: 1, toast: null, serverMode: !!mission, srv: null, srvBase: null, srvBriefing: null, srvBusy: false, srvError: null, cargo: [], srvAlerts: [], quality: save0.quality || "auto", built: save0.built || freshBuilt(), inspect: null,
    commDelayMin: 12, pendingTransmit: null, lastChoiceEffects: null,
    assistant: { kind: "welcome", visible: true, completed: false },
    shelterOpen: false, agriOpen: false,
    dailyMissionDone: false, nearMissionTarget: false,
  });

  let rng = createRNG(seed ?? ((Date.now() ^ 0x5eed) >>> 0));
  let timers = [];
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  let skipExecute = null;

  const g = () => store.get();
  const defOf = (id) => data.actions.find((a) => a.id === id);
  const persist = () => { const s = g(); writeSave({ user: s.user, suit: s.suit, built: s.built, game: s.game, rng: rng.getState(), callsign: s.callsign, lang: s.lang, sound: s.sound, best: s.best, quality: s.quality }); };

  function planCost(plan = g().plan) { return plan.reduce((n, p) => n + (defOf(p.id)?.cost || 0), 0); }

  /** Peut-on ajouter cette action au plan ? → { ok, reason } (reason = clé i18n) */
  function canAdd(actionId, plan = g().plan) {
    if (plan.length >= 2) return { ok: false, reason: "maxActions" };
    const v = validateActions(g().game, [...plan.map((p) => ({ id: p.id })), { id: actionId }], data.actions);
    if (v.valid) return { ok: true };
    if (/budget/.test(v.error)) return { ok: false, reason: "insufficientBudget" };
    if (/module limit/.test(v.error)) return { ok: false, reason: "maxModulesReached" };
    return { ok: false, reason: "invalid" };
  }

  /** Emplacements libres pour un type de module (index), en tenant compte du plan. */
  function freeSlots(moduleType) {
    const used = new Set();
    (g().built[moduleType] || []).forEach((i) => used.add(i));
    g().plan.forEach((p) => { const d = defOf(p.id); if (d?.moduleType === moduleType && p.slot != null) used.add(p.slot); });
    const out = []; for (let i = 0; i < SLOT_COUNT; i++) if (!used.has(i)) out.push(i);
    return out;
  }

  let quizBag = [];
  const nextQuestion = () => { const s = g(); if (!quizBag.length) { quizBag = forBody(s.dest || "mars").slice(); for (let i = quizBag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [quizBag[i], quizBag[j]] = [quizBag[j], quizBag[i]]; } } return quizBag.pop(); };
  const makeQuiz = () => { const q = nextQuestion(), L = q[g().lang] || q.fr; const opts = [L.right, ...L.wrong].map((t, i) => ({ t, ok: i === 0 })).sort(() => Math.random() - 0.5); return { id: q.id, src: q.src, q: L.q, options: opts.map((o) => o.t), correct: opts.findIndex((o) => o.ok), why: L.why, chosen: null }; };
  const api_launch = () => (mission ? api.launchServer() : api.launch());
  const api = {
    store, bus, backend, data, planCost, canAdd, freeSlots, defOf,
    getBest: () => g().best,

    setLang(lang) { store.set({ lang }); persist(); },
    toggleSound() { store.set({ sound: !g().sound }); persist(); },
    setQuality(quality) { store.set({ quality }); persist(); },
    setCallsign(callsign) { store.set({ callsign }); persist(); },
    goBriefing() { store.set({ phase: "briefing" }); },
    goIntro() { clearTimers(); store.set({ phase: "intro", hasSave: !!readSave().game }); },

    launch() {
      clearTimers();
      rng = createRNG((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
      const st = g(), dest = st.dest || "mars"; let g0 = createInitialState(data.config);
      data = { ...baseData, events: dest === "moon" ? baseData.events.filter((e) => e.id !== "dust_storm") : baseData.events }; // pas de tempêtes de poussière sans atmosphère (Lune)
      const res = { ...st.loadout }; const site = (SITES[dest] || []).find((x) => x.id === st.site);
      if (site?.gameBonus) res[site.gameBonus.res] = Math.min(100, res[site.gameBonus.res] + site.gameBonus.amount);
      g0 = { ...g0, resources: res }; quizBag = [];
      store.set({ env: dest, life: RULES.life, quiz: null, quizStats: { right: 0, wrong: 0 }, lifeLog: [], built: freshBuilt(), inspect: null, game: g0, phase: "plan", plan: [], placing: null, pendingEvent: null, choicesReady: false, lastDelta: null, score: null, factId: null, dayCount: 1, tutorial: g().firstTime ? 1 : 0, assistant: { kind: "welcome", visible: true, completed: false } });
      bus.emit("reset", {}); persist();
    },
    // ----- parcours KEMET-42 -----
    async auth(mode, name, password) {
      if (!name?.trim() || !password) return store.set({ authError: "empty" });
      store.set({ authBusy: true, authError: null });
      try { const r = await (mode === "register" ? backend.register(name, password) : backend.login(name, password)); store.set({ user: { ...r.user, token: r.token }, phase: "intro", authBusy: false }); persist(); }
      catch (e) { store.set({ authBusy: false, authError: ["exists", "invalid", "noroute"].includes(e.message) ? e.message : "network" }); }
    },
    logout() { store.set({ user: null, phase: "login" }); writeSave({ user: null }); },
    goHangar() { store.set({ phase: "hangar" }); },
    setSuit(p) { store.set({ suit: { ...g().suit, ...p } }); bus.emit("suit", g().suit); persist(); },
    goLoadout() { if (mission) { store.set({ phase: "cargo" }); if (!g().srvBriefing) api.loadBriefing(); } else store.set({ phase: "loadout" }); },
    adjustLoadout(k, d) {
      const lo = { ...g().loadout }, sum = Object.values(lo).reduce((a, b) => a + b, 0); const v = Math.max(RULES.loadoutMin, Math.min(RULES.loadoutMax, lo[k] + d));
      if (d > 0 && sum + (v - lo[k]) > RULES.loadoutTotal) return false; lo[k] = v; store.set({ loadout: lo }); return true;
    },
    goDestination() { store.set({ phase: "destination" }); },
    pickDestination(id) {
      // Real one-way light times are ~1.3 s (Moon) and ~3–22 min (Mars). We surface them as a clear gameplay constraint.
      const delay = id === "moon" ? 2 : 14;
      store.set({ dest: id, site: null, phase: "site", commDelayMin: delay, pendingTransmit: null });
    },
    pickSite(id) { store.set({ site: id }); },
    playAsGuest() {
      store.set({ user: { name: "Commandant", guest: true }, phase: "intro", authError: null });
    },
    startTransit() { if (!g().site) return; store.set({ phase: "transit" }); later(() => api_launch(), 14000); },
    skipTransit() { if (g().phase === "transit") { clearTimers(); api_launch(); } },
    // ----- questions & durée de vie -----
    answerQuiz(i) {
      const s = g(); if (!s.quiz || s.quiz.chosen != null) return;
      const right = i === s.quiz.correct; const stats = { ...s.quizStats, [right ? "right" : "wrong"]: s.quizStats[right ? "right" : "wrong"] + 1 };
      let life = s.life, game = s.game, log = s.lifeLog;
      if (right) game = { ...game, budget: game.budget + RULES.quizRightCredits };
      else { life = Math.max(0, life - RULES.quizWrong); log = [...log, { day: game.day, why: "quiz", amount: RULES.quizWrong }]; }
      store.set({ quiz: { ...s.quiz, chosen: i, right }, quizStats: stats, life, game, lifeLog: log });
      bus.emit(right ? "quizRight" : "quizWrong", {});
    },
    continueQuiz() {
      const s = g(); if (s.phase !== "quiz") return;
      if (s.life <= 0) return api._endByLife();
      store.set({ phase: "plan", quiz: null, plan: [] }); persist();
    },
    _endByLife() {
      const s = g(); const game = { ...s.game, gameOver: true, success: false, endReason: "life" };
      const score = calculateScore(game); const best = Math.max(s.best, score.total);
      store.set({ game, phase: "end", score, best }); writeSave({ game: null });
      safe(() => backend && s.user && backend.submitScore(s.user.token, { score: score.total, success: false, dest: s.dest, site: s.site, sol: game.day }), null);
    },
    resume() {
      const sv = readSave(); if (!sv.game) return api.launch();
      clearTimers(); rng = createRNG(1, sv.rng);
      store.set({ built: sv.built || freshBuilt(), game: sv.game, phase: "plan", plan: [], placing: null, pendingEvent: null, choicesReady: false, score: null, tutorial: 0 });
      bus.emit("reset", { resume: true });
    },
    nextTutorial() { const n = g().tutorial + 1; if (n > 3) api.endTutorial(); else store.set({ tutorial: n }); },
    endTutorial() { store.set({ tutorial: 0, firstTime: false }); writeSave({ tutorialDone: true }); },

    // ----- planification -----
    beginPlacing(actionId) {
      const d = defOf(actionId); if (!d || g().phase !== "plan") return;
      const c = canAdd(actionId); if (!c.ok) { store.set({ toast: { key: c.reason, t: Date.now() } }); return c; }
      if (d.type === "build") { store.set({ placing: actionId }); bus.emit("placing", { actionId, slots: freeSlots(d.moduleType), moduleType: d.moduleType }); }
      else { store.set({ plan: [...g().plan, { id: actionId }] }); }
      return c;
    },
    cancelPlacing() { store.set({ placing: null }); bus.emit("placing", null); },
    placeAt(slot) {
      const id = g().placing; if (!id) return false;
      const d = defOf(id); if (!freeSlots(d.moduleType).includes(slot)) return false;
      store.set({ plan: [...g().plan, { id, slot }], placing: null }); bus.emit("placing", null); return true;
    },
    autoPlace() { const id = g().placing; if (!id) return false; const f = freeSlots(defOf(id).moduleType); return f.length ? api.placeAt(f[0]) : false; },
    suggestGreenhouse() {
      if (g().phase !== "plan" || g().plan.length >= 2) return false;
      const result = api.beginPlacing("build_greenhouse");
      if (result?.ok) api.autoPlace();
      if (result?.ok) store.set({ assistant: { kind: "greenhouse", visible: true, completed: true } });
      return !!result?.ok;
    },
    removePlan(i) { const plan = g().plan.slice(); plan.splice(i, 1); store.set({ plan }); },

    // ----- exécution du jour -----
    endDay() {
      const s = g(); if (s.phase !== "plan") return;
      const check = validateActions(s.game, s.plan.map((p) => ({ id: p.id })), data.actions);
      if (!check.valid) { store.set({ plan: [], toast: { key: "invalid", t: Date.now() } }); return; }
      store.set({ phase: "execute", placing: null }); bus.emit("placing", null);
      const alive = Math.max(1, s.game.crew);
      let pending = s.plan.length; let finished = false;
      const next = () => { if (finished) return; finished = true; skipExecute = null; clearTimers(); api._afterExecute(); };
      skipExecute = next;
      if (!pending) return later(next, Math.min(350, T.executeMax));
      s.plan.forEach((p, i) => {
        const def = defOf(p.id);
        let crewIdx = ACTOR_FOR_ACTION[p.id] ?? i; if (crewIdx >= alive) crewIdx = i % alive;
        if (s.plan.length === 2 && ACTOR_FOR_ACTION[s.plan[0].id] === ACTOR_FOR_ACTION[s.plan[1].id] && i === 1) crewIdx = (crewIdx + 1) % alive;
        const handled = bus.emit("perform", { def, slot: p.slot, crewIdx, done: () => { if (--pending <= 0) later(next, 250); } });
        if (!handled) { if (--pending <= 0) later(next, 0); }
      });
      later(next, T.executeMax);
    },
    skip() { if (skipExecute) skipExecute(); },

    _afterExecute() {
      const s = g();
      const ev = drawEventForTurn(s.game, rng, data);
      if (!ev) return api._resolve(null, null);
      store.set({ phase: "accident", pendingEvent: ev, choicesReady: false, bonusReached: false, assistant: { kind: "incident", eventId: ev.id, visible: true, completed: false } });
      bus.emit("accident", { event: ev, hazard: HAZARDS[ev.id] || null });
      later(() => store.set({ choicesReady: true }), T.accidentIntro);
    },
    reachHazard() {
      const s = g(); if (s.phase !== "accident" || s.bonusReached) return false;
      const hz = HAZARDS[s.pendingEvent?.id]; if (!hz?.bonus) return false;
      store.set({ bonusReached: true }); bus.emit("bonus", { hazard: hz }); return true;
    },
    completeDailyMission() {
      const s = g();
      if (s.dailyMissionDone) return;
      const m = getMissionForSol(s.game.day || 1);
      if (!m) return;
      const rw = m.reward || {};
      const fr = s.lang === "fr";
      const curRes = s.game.resources || {};
      const updatedRes = {
        ...curRes,
        o2: Math.min(100, (curRes.o2 || 0) + (rw.o2 || 0)),
        energy: Math.min(100, (curRes.energy || 0) + (rw.energy || 0)),
        food: Math.min(100, (curRes.food || 0) + (rw.food || 0)),
        protection: Math.min(100, (curRes.protection || 0) + (rw.protection || 0)),
      };
      if (s.serverMode && s.srv) {
        const srv = { ...s.srv };
        if (rw.o2) srv.oxygenKg = Math.min(100, +(srv.oxygenKg + rw.o2).toFixed(1));
        if (rw.water) srv.waterLiters = Math.min(100, +(srv.waterLiters + rw.water).toFixed(1));
        if (rw.food) srv.foodKg = Math.min(100, +(srv.foodKg + rw.food).toFixed(1));
        if (rw.energy) srv.powerKwh = Math.min(100, Math.round(srv.powerKwh + rw.energy));
        if (rw.protection) srv.radiationShield = Math.min(100, Math.round(srv.radiationShield + rw.protection));
        store.set({ srv });
      }
      const budget = (s.game.budget || 0) + (rw.credits || 0);
      const game = { ...s.game, resources: updatedRes, budget };
      const rewardMsg = fr ? m.rewardText.fr : m.rewardText.en;
      store.set({
        game,
        dailyMissionDone: true,
        toast: { key: "missionSuccess", custom: rewardMsg, t: Date.now() },
      });
      bus.emit("dailyMissionDone", { mission: m });
    },
    /** Entrer dans l’abri (tempête / radiation) — chorée 3D + panneau lié aux ressources. */
    enterShelter() {
      const s = g();
      if (s.shelterOpen) return;
      store.set({ shelterOpen: true });
      bus.emit("shelter", { enter: true });
      if (s.serverMode && mission?.enterShelter) {
        safe(() => mission.enterShelter({ reason: s.pendingEvent?.id || "manual" }), null);
      }
    },
    exitShelter() {
      if (!g().shelterOpen) return;
      store.set({ shelterOpen: false });
      bus.emit("shelter", { enter: false });
      if (g().serverMode && mission?.exitShelter) safe(() => mission.exitShelter(), null);
    },
    chooseEvent(choiceId) {
      const s = g(); if (s.phase !== "accident" || !s.choicesReady) return;
      const ev = s.pendingEvent; const ch = ev.choices.find((c) => c.id === choiceId) || ev.choices[0];
      // Bloquer un double-clic pendant la réparation 3D
      store.set({ choicesReady: false, assistant: { kind: "repairing", eventId: ev.id, choiceId, visible: true, completed: false } });
      const hz = HAZARDS[ev.id] || null;
      const success = !ch || ch.risk !== "high";
      // Chorée : déplacement + pose work + étincelles, puis résolution des règles
      if (hz?.pos) {
        const animated = bus.emit("repair", {
          hazard: { id: ev.id, pos: hz.pos, bonus: hz.bonus, crewIdx: hz.crewIdx },
          success,
          onDone: () => api._resolve(ev, ch),
        });
        // En mode sans scène 3D (tests, WebGL indisponible), il n’y a pas
        // d’animation à attendre : on résout immédiatement l’événement.
        if (!animated) api._resolve(ev, ch);
        else later(() => { if (g().phase === "accident") api._resolve(ev, ch); }, 5500);
      } else {
        api._resolve(ev, ch);
      }
    },
    _resolve(ev, choice) {
      // Évite double résolution si onDone + timeout
      if (g().phase !== "accident" && g().phase !== "execute") {
        // allow resolve from accident only; if already resolving, skip
        if (g().phase === "resolve" || g().phase === "summary") return;
      }
      if (g().phase !== "accident") return;

      const s = g(); const before = s.game;
      let next = playTurn(before, { actions: s.plan.map((p) => ({ id: p.id })), forcedEvent: ev, eventChoice: choice ? { choiceId: choice.id } : null }, rng, data);
      let bonusRes = null;
      const hz = ev ? HAZARDS[ev.id] : null;
      if (s.bonusReached && hz?.bonus && !next.gameOver) {
        bonusRes = hz.bonus.res;
        next = { ...next, resources: { ...next.resources, [bonusRes]: Math.min(100, next.resources[bonusRes] + BONUS_AMOUNT) } };
      }
      // Communication delay: transmitting data only credits next Sol (Earth is far).
      let pendingTransmit = s.pendingTransmit;
      const didTransmit = s.plan.some((p) => p.id === "transmit");
      if (didTransmit) {
        pendingTransmit = { credits: 30, arrivesOn: before.day + 1 };
        // Do not grant credits immediately; engine may have, so strip them back if present.
        if (next.budget > before.budget) next = { ...next, budget: before.budget };
      }
      if (pendingTransmit && pendingTransmit.arrivesOn === next.day) {
        next = { ...next, budget: next.budget + pendingTransmit.credits };
        pendingTransmit = null;
      }
      const d = (k) => next.resources[k] - before.resources[k];
      const delta = { o2: d("o2"), energy: d("energy"), food: d("food"), protection: d("protection") };
      const built = { ...s.built };
      s.plan.forEach((p) => { const d = defOf(p.id); if (d?.type === "build" && p.slot != null) built[d.moduleType] = [...(built[d.moduleType] || []), p.slot]; });
      let life = s.life, lifeLog = s.lifeLog, risky = false;
      if (choice && choice.risk === "high") { risky = true; life = Math.max(0, life - RULES.riskyChoice); lifeLog = [...lifeLog, { day: before.day, why: "risky", amount: RULES.riskyChoice }]; }
      const lastChoiceEffects = choice ? { cost: choice.cost || 0, effects: choice.effects || {}, risk: choice.risk || "low" } : null;
      store.set({ life, lifeLog, riskyChoice: risky, phase: "resolve", built, game: next, lastDelta: delta, lastChoice: choice ? choice.label : null, lastChoiceEffects, lastEventId: ev?.id || null, factId: ev?.factId || null, bonusRes, crewLost: before.crew - next.crew, plan: [], pendingTransmit, toast: didTransmit ? "transmit" : null, shelterOpen: false });
      bus.emit("resolve", { before, after: next, event: ev, choice, crewLost: before.crew - next.crew });
      later(() => store.set({ phase: "summary", dayCount: next.day }), T.daySweep);
    },

    continueSummary() {
      const s = g(); if (s.phase !== "summary") return;
      if (s.factId) store.set({ phase: "fact" }); else api._afterDay();
    },
    continueFact() { if (g().phase === "fact") api._afterDay(); },
    _afterDay() {
      const s = g();
      if (s.game.gameOver) {
        const score = calculateScore(s.game); const best = Math.max(s.best, score.total);
        store.set({ phase: "end", score, best, pendingEvent: null }); persist(); writeSave({ game: null });
        safe(() => backend && s.user && backend.submitScore(s.user.token, { score: score.total, success: !!s.game.success, dest: s.dest, site: s.site, sol: s.game.day }), null); return;
      }
      if (g().life <= 0) return api._endByLife();
      store.set({ phase: "quiz", pendingEvent: null, factId: null, plan: [], quiz: makeQuiz() }); persist();
    },
    inspect(type) { store.set({ inspect: type }); },
    clearToast() { store.set({ toast: null }); },

    openAgriculture() { store.set({ agriOpen: true }); },
    closeAgriculture() { store.set({ agriOpen: false }); },
    harvestAgriculture(crop) {
      const s = g(); if (!crop) return;
      const foodBonus = Number(crop.bonusFood) || 10;
      const lifeBonus = Number(crop.bonusLife) || 0;
      const game = { ...s.game, resources: { ...s.game.resources, food: Math.min(100, (s.game.resources.food || 0) + Math.min(20, Math.round(foodBonus * 0.6))) } };
      const life = Math.min(RULES.life, s.life + lifeBonus);
      store.set({ game, life, agriOpen: false, toast: { key: "agriHarvest", t: Date.now() } });
      bus.emit("agriHarvest", { crop });
      if (s.serverMode && mission?.greenhouseAction) {
        safe(() => mission.greenhouseStart({ plantId: crop.id === "radish" ? "mizuna" : crop.id === "potato" ? "zinnia" : "lettuce" }), null);
        safe(() => mission.greenhouseAction({ action: "harvest" }), null);
      }
      persist();
    },
    destroy() { clearTimers(); },
  };
  if (mission) Object.assign(api, serverMethods({ store, bus, mission, later, RULES, writeSave, backend, makeQuiz, clearTimers, T }));
  api.mission = mission;
  return api;
}

// Mode « serveur » : le backend calcule les 4 impératifs ; le front ajoute 3D, questions, vie et accidents visuels.
import { toResources, evaluateEnd } from "./mission.js";
import { HAZARDS } from "../game/layout.js";
import { forBody } from "./questions.js";

export const MAX_DAY = 30;
export function serverScore({ day, life, right }) {
  const crewScore = life * 3, daysScore = Math.min(300, day * 10), resScore = 0, budgetScore = right * 20, total = crewScore + daysScore + budgetScore;
  const rank = total >= 600 ? "commander" : total >= 450 ? "pilot" : total >= 300 ? "explorer" : total >= 150 ? "cadet" : "rescue";
  return { total, crewScore, daysScore, resScore, budgetScore, rank };
}

export function serverMethods({ store, bus, mission, later, RULES, writeSave, backend, makeQuiz, clearTimers, T }) {
  const g = () => store.get();
  const mkGame = (st, base, day, history, extra = {}) => ({ day, budget: 0, crew: 4, resources: toResources(st, base), modules: { solar: 1, moxie: 0, greenhouse: 0, shield: 0 }, status: {}, history, gameOver: false, success: false, ...extra });
  const finish = (over, st, why) => {
    const s = g(); const game = { ...s.game, gameOver: true, success: over.success, endReason: why || over.reason };
    const score = serverScore({ day: game.day, life: s.life, right: s.quizStats.right }); const best = Math.max(s.best, score.total);
    store.set({ game, phase: "end", score, best, srvAlerts: [] }); writeSave({ best });
    try { backend && s.user && backend.submitScore && backend.submitScore(s.user.token, { score: score.total, success: over.success, dest: s.dest, site: s.site, sol: game.day }); } catch (_) {}
  };
  return {
    async loadBriefing() {
      store.set({ srvBusy: true, srvError: null });
      try { const b = await mission.briefing(); store.set({ srvBriefing: b, srvBusy: false }); }
      catch (e) { store.set({ srvBusy: false, srvError: "network" }); }
    },
    toggleCargo(id) { const c = g().cargo; store.set({ cargo: c.includes(id) ? c.filter((x) => x !== id) : [...c, id] }); },
    async launchServer() {
      const s = g(); store.set({ srvBusy: true, srvError: null });
      try {
        await mission.launch({ destinationId: (s.dest || "mars").toUpperCase(), crewCount: 4, selectedCargo: s.cargo });
        const st = await mission.status(); const day = st.day ?? 1;
        store.set({ srv: st, srvBase: st, srvBusy: false, life: RULES.life, quiz: null, quizStats: { right: 0, wrong: 0 }, lifeLog: [], env: s.dest || "mars", game: mkGame(st, st, day, []), built: { solar: [0], moxie: [], greenhouse: [], shield: [] }, phase: "plan", plan: [], srvAlerts: [], tutorial: s.firstTime ? 1 : 0, env: s.dest || "mars" });
        bus.emit("reset", {});
      } catch (e) { store.set({ srvBusy: false, srvError: "launch", phase: "site" }); }
    },
    /** « Sol suivant » : le serveur consomme les ressources et signale les alertes ; la scène les joue. */
    async nextDayServer() {
      const s = g(); if (s.phase !== "plan") return; store.set({ phase: "execute", srvError: null });
      try {
        const res = await mission.nextDay(); const st = await mission.status(); const day = st.day ?? s.game.day + 1;
        const hist = [...s.game.history, { day: s.game.day, resources: s.game.resources }];
        const game = mkGame(st, s.srvBase, day, hist);
        const alerts = res.alerts; const dust = alerts.some((a) => a.kind === "dust_storm");
        game.status = { dust: dust ? 1 : 0 };
        store.set({ srv: st, game, srvAlerts: alerts, bonusReached: false, srvError: null, dailyMissionDone: false, nearMissionTarget: false });
        if (alerts.length) {
          const a = alerts[0], hz = HAZARDS[a.kind] || null;
          store.set({ phase: "accident", pendingEvent: { id: a.kind, negative: true, text: { fr: a.text, en: a.text }, choices: [], factId: null }, choicesReady: false });
          bus.emit("accident", { event: { id: a.kind }, hazard: hz });
          later(() => store.set({ choicesReady: true }), T.accidentIntro);
        } else this._srvAfter();
      } catch (e) { store.set({ phase: "plan", srvError: "next" }); }
    },
    /** Fin de l'alerte : si l'élève n'est pas intervenu à temps (balise non atteinte) → −10 de vie. */
    ackAlert() {
      const s = g(); if (s.phase !== "accident" || !s.choicesReady) return;
      const hz = HAZARDS[s.pendingEvent?.id]; let life = s.life, log = s.lifeLog, risky = false;
      if (hz?.bonus && !s.bonusReached) { life = Math.max(0, life - RULES.riskyChoice); log = [...log, { day: s.game.day, why: "noIntervention", amount: RULES.riskyChoice }]; risky = true; }
      store.set({ life, lifeLog: log, riskyChoice: risky, lastDelta: null, bonusRes: null, crewLost: 0 });
      bus.emit("resolve", { before: s.game, after: s.game, event: s.pendingEvent, choice: null, crewLost: 0 });
      this._srvAfter();
    },
    _srvAfter() {
      const s = g(); const end = evaluateEnd(s.srv, s.game.day, MAX_DAY);
      if (s.life <= 0) return finish({ over: true, success: false }, s.srv, "life");
      if (end.over) return finish(end, s.srv);
      // Le quiz scientifique apparaît comme une étape bonus tous les 3 Sols (ou fin de mission)
      const isQuizDay = s.game.day % 3 === 0;
      if (isQuizDay) {
        store.set({ phase: "quiz", quiz: makeQuiz(), pendingEvent: null });
      } else {
        store.set({ phase: "plan", pendingEvent: null });
      }
    },
    async resetServer() { try { await mission.reset(); } catch (_) {} clearTimers(); store.set({ phase: "intro", srv: null, srvBase: null }); },
  };
}

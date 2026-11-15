import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useCtrl, useGame } from "../game/useStore.js";
import { RES, ACT_ICON, makeT, L } from "./strings.js";
import { rt } from "../world/sim.js";
import { CREW, CALLSIGN_COLORS, HAZARDS } from "../game/layout.js";
import { focusCrew } from "../world/interact.js";
import { audio } from "./audio.js";
import { novaSpeak } from "./novaSpeak.js";
import { getMissionForSol } from "../kemet/dailyMissions.js";

export const useT = () => { const lang = useGame((s) => s.lang); return useMemo(() => makeT(lang), [lang]); };

/** Prévision quotidienne : mêmes formules que le moteur (educatif : on voit POURQUOI une jauge baisse). */
export function forecast(game, cfg) {
  const m = game.modules, late = game.day >= (cfg.lateGameStartDay ?? 20) ? cfg.lateGameTensionCoefficient : 1, dust = (game.status?.dust || 0) > 0 ? 0.5 : 1, eff = game.resources.energy < 20 ? 0.5 : 1, cr = game.crew / 4, c = cfg.consumptions;
  return {
    energy: 5 * m.solar * dust - c.energy * late - 2 * m.moxie - m.greenhouse,
    o2: 5 * m.moxie * eff - c.o2 * cr * late,
    food: 4 * m.greenhouse * eff - c.food * cr * late,
    protection: 3 * m.shield - c.protection * late,
  };
}

function TopBar() {
  const c = useCtrl(), t = useT(); const game = useGame((s) => s.game), phase = useGame((s) => s.phase), plan = useGame((s) => s.plan);
  const spent = c.planCost(plan), life = useGame((s) => s.life), delay = useGame((s) => s.commDelayMin), pending = useGame((s) => s.pendingTransmit);
  return (
    <header className="topbar">
      <div className="brand"><img src="/logo.svg" alt="Logo" className="brand-logo" /><b>KEMET-42</b></div>
      <div className="solbox">
        <div className="sol"><small>{t("sol")}</small> <b>{Math.min(game.day, 30)}</b><span>/30</span></div>
        <div className="pips">{Array.from({ length: 30 }, (_, i) => <i key={i} className={i + 1 < game.day ? "done" : i + 1 === game.day ? "now" : ""} />)}</div>
      </div>
      <div className="topbar-right">
        <div className="stats">
          <div className="signal" title={t("signalEarth")}>
            :i-antenna: <span className="sig-txt">{t("signalDelay", { n: delay || 14 })}</span>
            {pending ? <small style={{ display: "block", color: "#ffd24a" }}>{t("signalWaiting")}</small> : null}
          </div>
          <div className="lifebox" title={t("lifeLbl")}><span>:i-heart:</span><div className="lifebar"><i style={{ width: life + "%" }} className={life < 30 ? "crit" : life < 60 ? "warn" : ""} /></div><b>{life}</b></div>
          <div className="credits" title={t("credits")}>:i-coin: <b>{game.budget - spent}</b> <small className="cred-lbl">{spent ? `(−${spent})` : ""}</small></div>
        </div>
        <div className="tools">
          <button className="icon" onClick={() => { audio.click(); document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.(); }} aria-label={t("fullscreen")} title={t("fullscreen")}>:i-expand:</button>
          <button className="icon" onClick={() => c.store.set({ settings: true })} aria-label={t("settings")}>:i-gear:</button>
        </div>
      </div>
    </header>
  );
}

function ServerGauges() {
  const srv = useGame((s) => s.srv), base = useGame((s) => s.srvBase), lang = useGame((s) => s.lang), day = useGame((s) => s.game.day);
  if (!srv) return null; const fr = lang === "fr";
  const cards = [
    [":i-lungs:", fr ? "Support de vie" : "Life support", `${srv.oxygenKg ?? "—"} kg · ${srv.waterLiters ?? "—"} L`, Math.min(100 * (srv.oxygenKg ?? 0) / (base?.oxygenKg || 1), 100 * (srv.waterLiters ?? 0) / (base?.waterLiters || 1)), "#5ad6ff"],
    [":i-shield:", fr ? "Protection" : "Radiation shield", `${srv.radiationShield ?? "—"} %`, srv.radiationShield ?? 0, "#b58cff"],
    [":i-bolt:", fr ? "Énergie" : "Power", `${srv.powerKwh ?? "—"} %`, srv.powerKwh ?? 0, "#ffd24a"],
    [":i-sprout:", fr ? "Nourriture" : "Food", `${srv.foodKg ?? "—"} kg`, 100 * (srv.foodKg ?? 0) / (base?.foodKg || 1), "#7bdc6a"],
  ];
  return (
    <aside className="gauges" aria-label="status">
      {cards.map(([ic, name, val, pct, col]) => {
        const v = Math.max(0, Math.min(100, Math.round(pct))), cls = v < 20 ? "crit" : v < 40 ? "warn" : "";
        return (
          <div key={name} className={"gauge " + cls} style={{ "--c": col }}>
            <div className="g-head">
              <span className="g-ic">{ic}</span>
              <span className="g-name">{name}</span>
              <b className="g-val">
                <span className="g-val-full">{val}</span>
                <span className="g-val-pct">{v}%</span>
              </b>
            </div>
            <div className="bar"><i style={{ width: v + "%" }} /></div>
          </div>
        );
      })}
      <div className="mut g-sol-sub" style={{ fontSize: 11 }}>{fr ? "Sol" : "Sol"} {day} · backend KEMET-42</div>
    </aside>
  );
}

function Gauges() {
  const c = useCtrl(), t = useT(); const game = useGame((s) => s.game), delta = useGame((s) => s.lastDelta), sm = useGame((s) => s.serverMode);
  if (sm) return <ServerGauges />;
  const f = forecast(game, c.data.config);
  return (
    <aside className="gauges" aria-label={t("hudRes")}>
      {Object.entries(RES).map(([k, r]) => {
        const v = game.resources[k], d = f[k], days = d < 0 ? Math.floor(v / -d) : null, cls = v < 20 ? "crit" : v < 40 ? "warn" : "";
        return (
          <div key={k} className={"gauge " + cls} style={{ "--c": r.color }}>
            <div className="g-head"><span className="g-ic">{r.icon}</span><span className="g-name">{t(r.key)}</span><b className="g-val">{v}<small>%</small></b></div>
            <div className="bar"><i style={{ width: v + "%" }} /><u style={{ left: Math.max(0, v + Math.round(d)) + "%" }} /></div>
            <div className="g-foot"><span className={d >= 0 ? "up" : "down"}>{d >= 0 ? "▲" : "▼"} {d > 0 ? "+" : ""}{Math.round(d)}/{L({ fr: "j", en: "d" }, c.store.get().lang)}</span>{days !== null && days < 9 && <span className="eta">≈ {days} {L({ fr: "jours", en: "days" }, c.store.get().lang)}</span>}</div>
          </div>
        );
      })}
    </aside>
  );
}

function Helmet({ i, size = 40, dead }) {
  const cr = i === 4 ? { skin: "#d9a066", pack: CALLSIGN_COLORS[useGame((s) => s.callsign)] || "#E2552B" } : CREW[i];
  return (
    <svg className={"helmet" + (dead ? " dead" : "")} width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="23" fill="#1c2236" /><path d="M6 44c2-9 9-13 18-13s16 4 18 13z" fill="#eef1f8" /><rect x="3" y="26" width="9" height="16" rx="3" fill={cr.pack} />
      <circle cx="24" cy="21" r="14" fill="#f4f6fb" /><ellipse cx="24" cy="22" rx="10.5" ry="9.5" fill="#241a0e" opacity=".85" /><ellipse cx="24" cy="22.5" rx="8" ry="7.2" fill={cr.skin} />
      <circle cx="21" cy="21.5" r="1.1" fill="#10131c" /><circle cx="27" cy="21.5" r="1.1" fill="#10131c" /><path d="M21.2 25.6q2.8 2 5.6 0" stroke="#10131c" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function CrewPanel() {
  const c = useCtrl(), t = useT(); const game = useGame((s) => s.game), sel = useGame((s) => s.crewSel), callsign = useGame((s) => s.callsign);
  return (
    <aside className="crew" aria-label={t("hudCrew")}>
      <div className="crew-card cmd" style={{ "--c": CALLSIGN_COLORS[callsign] }}><Helmet i={4} /><div><b>{t("commander")} {callsign}</b><small>{t("you")}</small></div></div>
      {CREW.map((m, i) => {
        const alive = i < game.crew, v = game.resources[m.role], st = !alive ? "crewStatusLost" : v >= 50 ? "crewStatusGood" : v >= 25 ? "crewStatusWarn" : "crewStatusCrit";
        return (
          <button key={m.name} className={"crew-card " + (sel === i ? "sel " : "") + (!alive ? "lost" : v < 25 ? "crit" : v < 50 ? "warn" : "")} style={{ "--c": RES[m.role].color }} onClick={() => { audio.click(); focusCrew(c, i); }} disabled={!alive}>
            <Helmet i={i} dead={!alive} /><div><b>{m.name}</b><small>{t("crewRole" + i)}</small></div><span className="st">{RES[m.role].icon} {t(st)}</span>
          </button>
        );
      })}
    </aside>
  );
}

function ServerDock() {
  const c = useCtrl();
  const phase = useGame((s) => s.phase);
  const lang = useGame((s) => s.lang);
  const err = useGame((s) => s.srvError);
  const day = useGame((s) => s.game.day || 1);
  const [timer, setTimer] = useState(19);

  // Compte à rebours automatique : un Sol dure 19s
  useEffect(() => {
    if (phase !== "plan") {
      setTimer(19);
      return;
    }
    setTimer(19);
    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          c.nextDayServer?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, day, c]);

  if (phase !== "plan") return null;

  return (
    <footer className="dock">
      <div className="plan" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        {err === "next" && <small style={{ color: "#ff8585" }}>:i-alert: {lang === "fr" ? "Serveur injoignable" : "Server unreachable"}</small>}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className={"go" + (timer <= 5 ? " urgent" : "")}
            disabled={phase !== "plan"}
            onClick={() => { audio.unlock(); audio.ok(); c.nextDayServer(); }}
            style={{ padding: "12px 28px", fontSize: "1.05rem", minHeight: 48, boxShadow: "0 4px 20px rgba(255, 106, 61, 0.4)", display: "flex", alignItems: "center", gap: 10 }}
          >
            <span>{lang === "fr" ? `Clôturer le Sol ${day}` : `Complete Sol ${day}`}</span>
            <span style={{ background: "rgba(0,0,0,0.28)", padding: "2px 8px", borderRadius: 999, fontSize: "0.88rem", fontWeight: 700, minWidth: "32px", textAlign: "center" }}>
              {timer}s
            </span>
            <span>:i-play:</span>
          </button>
        </div>
      </div>
    </footer>
  );
}

function Dock() {
  const c = useCtrl(), t = useT(); const sm = useGame((s) => s.serverMode);
  if (sm) return <ServerDock />; const lang = useGame((s) => s.lang), game = useGame((s) => s.game), plan = useGame((s) => s.plan), placing = useGame((s) => s.placing), phase = useGame((s) => s.phase), built = useGame((s) => s.built);
  const locked = phase !== "plan"; const groups = [["grpBuild", "build"], ["grpUrgent", "emergency"], ["grpOther", null]];
  const countIn = (id) => plan.filter((p) => p.id === id).length;
  const click = (a) => { audio.click(); const r = c.beginPlacing(a.id); if (r && !r.ok) audio.error(); };

  const [timer, setTimer] = useState(19);

  // Compte à rebours automatique : un Sol dure 19s
  useEffect(() => {
    if (phase !== "plan") {
      setTimer(19);
      return;
    }
    setTimer(19);
    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          c.endDay?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, game.day, c]);

  return (
    <footer className={"dock" + (locked ? " locked" : "")}>
      <div className="plan">
        <div className="plan-slots">{[0, 1].map((i) => { const p = plan[i], d = p && c.defOf(p.id); return (
          <div key={i} className={"slot" + (p ? " full" : "")}>{p ? (<><span>{ACT_ICON[p.id]}</span><b>{L(d.name, lang)}</b><em>{d.cost ? `−${d.cost}` : t("free0")}</em><button onClick={() => { audio.click(); c.removePlan(i); }} aria-label={t("cancel")}>✕</button></>) : <small>{t("planSlot", { n: i + 1 })} · {t("planEmpty")}</small>}</div>); })}</div>
        <button className={"go" + (timer <= 5 ? " urgent" : "")} disabled={locked} onClick={() => { audio.unlock(); audio.ok(); c.endDay(); }} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{plan.length ? t("launchDay") : t("endDay")}</span>
          <span style={{ background: "rgba(0,0,0,0.28)", padding: "2px 8px", borderRadius: 999, fontSize: "0.88rem", fontWeight: 700 }}>{timer}s</span>
          <span>:i-play:</span>
        </button>
      </div>
      <div className="cards" role="list">
        {groups.map(([lab, type]) => (
          <div className="grp" key={lab}><small>{t(lab)}</small><div className="row">
            {c.data.actions.filter((a) => (type ? a.type === type : a.type !== "build" && a.type !== "emergency")).map((a) => {
              const chk = c.canAdd(a.id), n = countIn(a.id), mod = a.moduleType ? (built[a.moduleType] || []).length : 0;
              return (
                <button key={a.id} role="listitem" className={"card" + (n ? " picked" : "") + (!chk.ok && !n ? " off" : "") + (placing === a.id ? " placing" : "")} onClick={() => click(a)} disabled={locked} title={L(a.description, lang)}>
                  <span className="ic">{ACT_ICON[a.id]}</span><b>{L(a.name, lang)}</b><em>{a.cost ? `:i-coin: ${a.cost}` : t("free0")}</em>
                  {a.moduleType && <i className="lvl">{mod}/4</i>}{n > 0 && <i className="badge">{n}</i>}
                  <span className="tip">{L(a.description, lang)}{!chk.ok && !n ? ` — ${t(chk.reason)}` : ""}</span>
                </button>);
            })}
          </div></div>))}
      </div>
    </footer>
  );
}

function PlaceBanner() {
  const c = useCtrl(), t = useT(); const placing = useGame((s) => s.placing), lang = useGame((s) => s.lang);
  if (!placing) return null; const d = c.defOf(placing);
  return <div className="banner place"><span>{ACT_ICON[placing]} <b>{L(d.name, lang)}</b> — {t("placeHint")}</span><button onClick={() => { audio.ok(); c.autoPlace(); }}>{t("placeAuto")}</button><button className="ghost" onClick={() => { audio.click(); c.cancelPlacing(); }}>{t("cancel")}</button></div>;
}

function MissionCoach() {
  const c = useCtrl(), phase = useGame((s) => s.phase), dest = useGame((s) => s.dest), plan = useGame((s) => s.plan), built = useGame((s) => s.built), lang = useGame((s) => s.lang);
  if (phase !== "plan" || dest !== "mars" || (built.greenhouse || []).length || plan.some((p) => p.id === "build_greenhouse")) return null;
  const fr = lang === "fr";
  return <aside className="mission-coach"><div className="coach-top"><span className="coach-bot">:i-robot:</span><div><b>{fr ? "NOVA, ton robot copain" : "NOVA, your robot friend"}</b><small>{fr ? "je t'aide" : "I help you"}</small></div><span className="coach-live">LIVE</span></div><p>{fr ? "Le savais-tu ? La NASA fait pousser des salades dans l'espace, dans une boîte spéciale. Sur Mars, il faut aussi une boîte fermée, avec de l'eau et de la lumière." : "Did you know? NASA grows salad in space in a special box. On Mars, you also need a closed box, with water and light."}</p><div className="coach-actions"><button type="button" onClick={() => novaSpeak(fr ? "Les plantes ont besoin d une boite fermee, d eau et de lumiere. Pas dehors !" : "Plants need a closed box, water and light. Not outside!", fr ? "fr" : "en")}>:i-speaker: {fr ? "Écouter NOVA" : "Listen to NOVA"}</button><button onClick={() => { c.openAgriculture?.() || c.suggestGreenhouse(); }}>:i-sprout: {fr ? "Essayer la serre maintenant" : "Try the greenhouse now"}</button><a href="https://science.nasa.gov/mission/veggie/" target="_blank" rel="noreferrer">NASA Veggie :i-external:</a></div></aside>;
}

function DailyMissionTracker() {
  const c = useCtrl();
  const day = useGame((s) => s.game.day || 1);
  const done = useGame((s) => s.dailyMissionDone);
  const near = useGame((s) => s.nearMissionTarget);
  const lang = useGame((s) => s.lang);
  const phase = useGame((s) => s.phase);
  const fr = lang === "fr";

  const [dist, setDist] = useState(20);

  useEffect(() => {
    const iv = setInterval(() => {
      setDist(rt.missionDist || 20);
    }, 250);
    return () => clearInterval(iv);
  }, []);

  if (phase !== "plan") return null;

  const mission = getMissionForSol(day);
  if (!mission) return null;

  return (
    <div
      className="mission-beacon-wrap"
      style={{
        position: "fixed",
        top: "calc(82px + var(--safe-t, 0px))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 15,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        pointerEvents: "auto",
        maxWidth: "min(480px, calc(100vw - 16px))",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 16px",
          borderRadius: 999,
          background: done ? "rgba(22, 101, 52, 0.9)" : "rgba(15, 23, 42, 0.88)",
          border: `1.5px solid ${done ? "#4ade80" : mission.color}`,
          boxShadow: `0 8px 24px ${done ? "rgba(34, 197, 94, 0.3)" : "rgba(0,0,0,0.6)"}`,
          backdropFilter: "blur(10px)",
          color: "#fff",
          fontSize: "0.86rem",
          transition: "all 0.3s ease",
        }}
      >
        <span style={{ fontSize: "1.2rem" }}>{done ? "✓" : mission.icon}</span>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <b style={{ color: done ? "#bbf7d0" : mission.color }}>
            {fr ? mission.title.fr : mission.title.en}
          </b>
          <span style={{ fontSize: "0.74rem", opacity: 0.85 }}>
            {done
              ? fr
                ? "Objectif accompli pour ce Sol !"
                : "Mission completed for this Sol!"
              : `${fr ? "Suis le faisceau lumineux" : "Follow the light beam"} · :i-pin: ${dist}m`}
          </span>
        </div>
        {!done && (
          <button
            type="button"
            onClick={() => novaSpeak(fr ? mission.voice.fr : mission.voice.en, lang)}
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "none",
              borderRadius: "50%",
              width: 28,
              height: 28,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: "0.8rem",
              marginLeft: 4,
            }}
            title={fr ? "Écouter NOVA" : "Listen to NOVA"}
          >
            :i-speaker:
          </button>
        )}
      </div>

      {near && !done && (
        <button
          onClick={() => {
            audio.bonus();
            c.completeDailyMission();
            c.bus?.emit?.("greenhouseGrow");
          }}
          style={{
            animation: "pulse 1.2s infinite",
            background: `linear-gradient(135deg, ${mission.color}, #ffffff)`,
            color: "#0f172a",
            fontWeight: 800,
            fontSize: "0.95rem",
            padding: "8px 20px",
            borderRadius: 999,
            border: "2px solid #fff",
            boxShadow: `0 0 20px ${mission.color}`,
            cursor: "pointer",
          }}
        >
          :i-sparkles: {mission.targetType === "greenhouse" ? (fr ? "Activer les cultures de la serre" : "Activate greenhouse crops") : (fr ? "Interagir avec l'objectif" : "Interact with objective")} :i-sparkles:
        </button>
      )}
    </div>
  );
}

function CamButtons() {
  const t = useT(); const [follow, setFollow] = useState(true);
  return (
    <div className="cambtns">
      <button onClick={() => { audio.click(); rt.cam.follow = !rt.cam.follow; setFollow(rt.cam.follow); }} className={follow ? "on" : ""} title={t("follow")}>:i-target:<small>{follow ? t("follow") : t("free")}</small></button>
      <button onClick={() => { rt.cam.follow = true; setFollow(true); rt.cam.dist = 19; rt.cam.pol = 1.02; }} title={t("recenter")}>⌖</button>
      <button onClick={() => (rt.cam.dist = Math.max(9, rt.cam.dist * 0.8))} title={t("zoomIn")}>＋</button>
      <button onClick={() => (rt.cam.dist = Math.min(60, rt.cam.dist * 1.25))} title={t("zoomOut")}>－</button>
    </div>
  );
}

function Joystick() {
  const base = useRef(), thumb = useRef(); const [coarse, setCoarse] = useState(false);
  useEffect(() => { setCoarse(window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window); }, []);
  useEffect(() => {
    if (!coarse || !base.current) return; const el = base.current; let id = null;
    const set = (e) => { const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } rt.cmd.x = Math.abs(dx) < 0.12 ? 0 : dx; rt.cmd.y = Math.abs(dy) < 0.12 ? 0 : dy; rt.cmd.run = m > 0.92; thumb.current.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`; };
    const down = (e) => { id = e.pointerId; el.setPointerCapture(id); rt.joy = true; rt.cam.intro = false; set(e); e.stopPropagation(); };
    const move = (e) => { if (e.pointerId === id) set(e); };
    const up = (e) => { if (e.pointerId !== id) return; id = null; rt.joy = false; rt.cmd.x = rt.cmd.y = 0; rt.cmd.run = false; thumb.current.style.transform = ""; };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
  }, [coarse]);
  if (!coarse) return null;
  return <div className="joy" ref={base}><div className="joy-thumb" ref={thumb} /></div>;
}

/** Étiquettes 3D → 2D : noms, bulles, balise d'intervention (avec flèche hors-écran). Mises à jour sans re-rendu React. */
function Labels() {
  const c = useCtrl(), t = useT(); const root = useRef();
  useEffect(() => {
    let raf; const v = new THREE.Vector3(); let last = "";
    const loop = () => {
      raf = requestAnimationFrame(loop); const cam = rt.camObj, el = root.current; if (!cam || !el) return; const W = innerWidth, H = innerHeight; cam.updateMatrixWorld();
      const phase = c.store.get().phase;
      for (let i = 0; i < 5; i++) {
        const e = rt.ents[i], tag = el.children[i]; if (!e || !tag) continue;
        v.set(e.x, e.y + 2.45, e.z).project(cam);
        const vis = e.alive && !e.hidden && e.fade > 0.5 && v.z < 1 && phase !== "intro" && phase !== "briefing" && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        if (!vis) { tag.style.display = "none"; continue; } tag.style.display = "";
        tag.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -100%)`;
        const say = tag.lastChild; if (say.textContent !== (e.say || "")) say.textContent = e.say || ""; say.style.display = e.say ? "block" : "none";
      }
      const hz = el.children[5], h = rt.hazard;
      if (h && h.pos && h.bonus && !h.reached && phase === "accident") {
        const c4 = rt.ents[4], dist = Math.hypot(c4.x - h.pos[0], c4.z - h.pos[1]);
        v.set(h.pos[0], 3.2, h.pos[1]).project(cam); let x = v.x, y = v.y; const behind = v.z > 1; if (behind) { x = -x; y = -y; }
        const off = behind || Math.abs(x) > 0.88 || Math.abs(y) > 0.8; if (off) { const m = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.8) || 1; x /= m; y /= m; }
        hz.style.display = ""; hz.style.transform = `translate(${((x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -50%)`;
        const key = h.id + Math.round(dist) + off + c.store.get().lang; if (key !== last) { last = key; hz.querySelector("span").textContent = `${t(HAZARDS[h.id].label)} · ${Math.round(dist)} ${t("meters")}`; }
        const arrow = hz.querySelector("i"); arrow.style.display = off ? "" : "none"; if (off) arrow.style.transform = `rotate(${Math.atan2(-y, x)}rad)`;
      } else hz.style.display = "none";
    };
    loop(); return () => cancelAnimationFrame(raf);
  }, [c, t]);
  const callsign = useGame((s) => s.callsign);
  return (
    <div className="labels" ref={root} aria-hidden>
      {CREW.map((m) => <div key={m.name} className="tag"><b style={{ color: "#fff" }}>{m.name}</b><div className="say" /></div>)}
      <div className="tag cmdtag" style={{ "--c": CALLSIGN_COLORS[callsign] }}><b>▼ {t("you")}</b><div className="say" /></div>
      <div className="hzlabel" style={{ display: "none" }}><i>➤</i><span /></div>
    </div>
  );
}

function Toast() {
  const c = useCtrl(), t = useT(); const toast = useGame((s) => s.toast);
  useEffect(() => { if (!toast) return; audio.ok(); const id = setTimeout(() => c.clearToast(), 3200); return () => clearTimeout(id); }, [toast, c]);
  return toast ? <div className="toast">{toast.custom || t(toast.key)}</div> : null;
}

/** Indicateur flottant MOXIE : eau extraite + O₂ produit */
function MoxieIndicator() {
  const built  = useGame((s) => s.built);
  const phase  = useGame((s) => s.phase);
  const game   = useGame((s) => s.game);
  const lang   = useGame((s) => s.lang);
  const [flash, setFlash] = useState(false);

  const moxieCount = (built?.moxie || []).length;
  const fr = lang === "fr";

  // Flash d'animation à chaque changement de Sol (phase "resolve")
  useEffect(() => {
    if (phase !== "resolve" || !moxieCount) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 2200);
    return () => clearTimeout(id);
  }, [phase, moxieCount]);

  if (!moxieCount || (phase !== "plan" && !flash)) return null;

  const o2perSol  = 5 * moxieCount;
  const lowEnergy = (game?.resources?.energy || 100) < 20;
  const eff = lowEnergy ? 0.5 : 1;

  return (
    <div
      className="moxie-indicator"
      style={{
        position: "fixed",
        left: 16,
        bottom: "calc(var(--safe-b, 0px) + 280px)",
        zIndex: 11,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        pointerEvents: "none",
        animation: flash ? "moxie-pulse 0.6s ease-out" : undefined,
      }}
    >
      {/* Eau extraite */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 999,
        background: flash ? "rgba(0, 100, 220, 0.75)" : "rgba(10, 20, 50, 0.65)",
        border: `1px solid ${flash ? "#60b8ff" : "rgba(100,180,255,0.3)"}`,
        backdropFilter: "blur(6px)",
        fontSize: "0.72rem", color: "#b0d8ff",
        transition: "all 0.4s ease",
      }}>
        <span style={{ fontSize: "0.9rem" }}>:i-ice:</span>
        <span>{fr ? "Eau extraite" : "Water extracted"}</span>
        {flash && <b style={{ color: "#60dfff", marginLeft: 4 }}>+{(moxieCount * 2).toFixed(0)} L/Sol</b>}
      </div>
      {/* O₂ produit */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 999,
        background: flash ? "rgba(0, 180, 100, 0.75)" : "rgba(10, 40, 25, 0.65)",
        border: `1px solid ${flash ? "#4dffb0" : "rgba(80,220,150,0.3)"}`,
        backdropFilter: "blur(6px)",
        fontSize: "0.72rem", color: "#a0ffcc",
        transition: "all 0.4s ease",
      }}>
        <span style={{ fontSize: "0.9rem" }}>:i-sparkles:</span>
        <span>{fr ? "O₂ produit" : "O₂ produced"}</span>
        {flash && <b style={{ color: "#4dffb0", marginLeft: 4 }}>+{Math.round(o2perSol * eff)}/Sol</b>}
      </div>
    </div>
  );
}

/** Indicateur flottant de croissance de la serre */
function GreenhouseGrowthIndicator() {
  const built = useGame((s) => s.built);
  const day   = useGame((s) => s.game?.day || 1);
  const phase = useGame((s) => s.phase);
  const lang  = useGame((s) => s.lang);

  const hasGreenhouse = (built?.greenhouse || []).length > 0;
  if (!hasGreenhouse || phase !== "plan") return null;

  const fr = lang === "fr";
  // Calcul de la croissance : 12% par Sol actif, plafonné à 100%
  const growthPct = Math.min(100, day * 12);
  const stage = growthPct < 25 ? (fr ? "Germination" : "Germinating")
              : growthPct < 55 ? (fr ? "Pousse" : "Sprouting")
              : growthPct < 80 ? (fr ? "Floraison" : "Flowering")
              : (fr ? "Récolte prête" : "Ready to harvest");

  return (
    <div style={{
      position: "fixed",
      left: 16,
      bottom: "calc(var(--safe-b, 0px) + 350px)",
      zIndex: 11,
      display: "flex",
      flexDirection: "column",
      gap: 3,
      pointerEvents: "none",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 999,
        background: "rgba(10, 35, 15, 0.7)",
        border: "1px solid rgba(100,220,120,0.4)",
        backdropFilter: "blur(6px)",
        fontSize: "0.72rem", color: "#a8f0b8",
      }}>
        <span style={{ fontSize: "0.9rem" }}>:i-sprout:</span>
        <span>{fr ? "Serre" : "Greenhouse"}</span>
        <b style={{ color: "#4dff80" }}>{growthPct}%</b>
        <span style={{ opacity: 0.75 }}>— {stage}</span>
      </div>
      {/* Barre de progression de croissance */}
      <div style={{
        height: 4, borderRadius: 2,
        background: "rgba(255,255,255,0.1)",
        overflow: "hidden", width: 150, marginLeft: 2,
      }}>
        <div style={{
          height: "100%", borderRadius: 2,
          width: `${growthPct}%`,
          background: "linear-gradient(90deg, #2ecc71, #7bdc6a)",
          transition: "width 1s ease",
        }} />
      </div>
    </div>
  );
}

export function HUD() {
  const phase = useGame((s) => s.phase); const t = useT();
  const live = ["plan", "execute", "accident", "resolve", "summary", "fact", "quiz"].includes(phase);
  if (!live) return null;
  return (
    <div className="hud">
      <TopBar />
      <DailyMissionTracker />
      <Gauges />
      <CrewPanel />
      <PlaceBanner />
      <CamButtons />
      <Joystick />
      <Labels />
      <Toast />
      <MoxieIndicator />
      <GreenhouseGrowthIndicator />
      <div className="controls">{t("controls")}</div>
      <Dock />
    </div>
  );
}
export { Helmet };
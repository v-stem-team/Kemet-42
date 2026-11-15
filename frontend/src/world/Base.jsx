import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { rt, fxSoft, fxGlow } from "./sim.js";
import { groundY } from "./terrain.js";
import { SLOTS, ANTENNA, AIRLOCK } from "../game/layout.js";
import { getMissionForSol } from "../kemet/dailyMissions.js";

const M = {
  hull: new THREE.MeshStandardMaterial({ color: "#e4e7ee", roughness: 0.78, metalness: 0.08 }),
  metal: new THREE.MeshStandardMaterial({ color: "#9aa3b5", roughness: 0.4, metalness: 0.7 }),
  dark: new THREE.MeshStandardMaterial({ color: "#3a3f50", roughness: 0.7, metalness: 0.3 }),
  pad: new THREE.MeshStandardMaterial({ color: "#5a4640", roughness: 0.95 }),
  solar: new THREE.MeshStandardMaterial({ color: "#12204a", roughness: 0.25, metalness: 0.8, emissive: "#0c2a6a", emissiveIntensity: 0.35 }),
};
const ease = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const COLORS = { solar: "#6aa0ff", moxie: "#4FD1C5", greenhouse: "#7BD389", shield: "#9F7AEA" };

/** Habitat central + sas, antenne : le cœur visuel de la base. */
export function Habitat() {
  const win = useRef(), lamp = useRef(), beacon = useRef(), airlock = useRef(), light = useRef(), shell = useRef();
  const winMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#bdf6ff", emissive: "#7de8ff", emissiveIntensity: 1.4, roughness: 0.2 }), []);
  const beaconMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff3b3b", emissive: "#ff2222", emissiveIntensity: 1 }), []);
  const doorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffd9a0", emissive: "#ffb050", emissiveIntensity: 1.1 }), []);
  useFrame((s) => {
    const w = rt.w, t = s.clock.elapsedTime, power = 1 - w.dark * 0.92 + (w.dark > 0.1 ? Math.sin(t * 24) * 0.2 * w.dark : 0);
    winMat.emissiveIntensity = Math.max(0.05, 1.5 * power); winMat.emissive.set(w.alert > 0.3 && Math.sin(t * 6) > 0 ? "#ff6a5a" : "#7de8ff");
    beaconMat.emissiveIntensity = w.alert > 0.1 ? (Math.sin(t * 8) > 0 ? 3 : 0.1) : 0.5 + Math.sin(t * 2) * 0.4;
    doorMat.emissiveIntensity = Math.max(0.1, 1.2 * power);
    if (light.current) light.current.intensity = 11 * power * (rt.quality === "low" ? 0.6 : 1);
    // En mode abri, masquer la coque extérieure pour révéler l'intérieur 3D
    if (shell.current) shell.current.visible = !rt.shelter;
  });
  return (
    <group>
      <mesh material={M.pad} position-y={0.04} receiveShadow><cylinderGeometry args={[11, 11.6, 0.18, 48]} /></mesh>
      <group ref={shell}>
      <mesh material={M.dark} position-y={0.14} receiveShadow><cylinderGeometry args={[5.1, 5.3, 0.3, 40]} /></mesh>
      <mesh material={M.hull} position-y={0.3} castShadow receiveShadow><sphereGeometry args={[4.5, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      <mesh material={winMat} position-y={1.6}><torusGeometry args={[4.26, 0.2, 8, 56]} /></mesh>
      {Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * 6.283; return <mesh key={i} material={M.metal} position={[Math.cos(a) * 4.2, 2.6, Math.sin(a) * 4.2]} rotation-y={-a}><boxGeometry args={[0.2, 1.4, 0.12]} /></mesh>; })}
      <mesh material={M.metal} position-y={4.95}><cylinderGeometry args={[0.1, 0.1, 1.4, 8]} /></mesh>
      <mesh material={beaconMat} position-y={5.7}><sphereGeometry args={[0.22, 12, 8]} /></mesh>
      <group position={[AIRLOCK[0], 0, 4.9]}>
        <mesh material={M.hull} position-y={1.2} castShadow><boxGeometry args={[2.4, 2.4, 2.2]} /></mesh>
        <mesh material={doorMat} position={[0, 1.0, 1.12]}><boxGeometry args={[1.2, 1.8, 0.05]} /></mesh>
      </group>
      <pointLight ref={light} position={[0, 3.2, 8.5]} color="#ffd9a8" distance={24} decay={1.8} />
      </group>
      <Antenna />
      {[[-5.5, 7.5], [5.5, 7.5], [-11, 0], [11, 0]].map(([x, z], i) => <Lamp key={i} x={x} z={z} />)}
    </group>
  );
}
function Lamp({ x, z }) {
  const m = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff2c8", emissive: "#ffd080", emissiveIntensity: 1.5 }), []);
  useFrame((s) => { m.emissiveIntensity = Math.max(0.05, (0.2 + (1 - THREE.MathUtils.smoothstep(Math.sin(Math.PI * rt.tod), 0.0, 0.4)) * 2.2) * (1 - rt.w.dark * 0.95)); });
  return <group position={[x, 0, z]}><mesh material={M.metal} position-y={0.8}><cylinderGeometry args={[0.05, 0.07, 1.6, 6]} /></mesh><mesh material={m} position-y={1.7}><sphereGeometry args={[0.16, 10, 8]} /></mesh></group>;
}
function Antenna() {
  const dish = useRef();
  useFrame((s, dt) => { rt.antennaSpin = Math.max(0, rt.antennaSpin - dt); const sp = rt.antennaSpin > 0 ? 5 : 0.25; dish.current.rotation.y += dt * sp; if (rt.w.static > 0.3 && Math.random() < dt * 14) fxGlow.emit({ x: ANTENNA[0], y: 3.4, z: ANTENNA[1], vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.5, s0: 0.25, s1: 0.03, grav: 10, r: 0.6, g: 0.8, b: 1 }); });
  return (
    <group position={[ANTENNA[0], groundY(ANTENNA[0], ANTENNA[1]), ANTENNA[1]]}>
      <mesh material={M.dark} position-y={0.15}><cylinderGeometry args={[1.1, 1.3, 0.3, 12]} /></mesh>
      <mesh material={M.metal} position-y={1.5} castShadow><cylinderGeometry args={[0.1, 0.16, 3, 8]} /></mesh>
      <group ref={dish} position-y={3.1}><group rotation-x={-0.7}><mesh material={M.hull} castShadow><sphereGeometry args={[1.0, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6]} /></mesh><mesh material={M.metal} position-y={0.55}><cylinderGeometry args={[0.04, 0.04, 0.9, 6]} /></mesh></group></group>
    </group>
  );
}

/** Enveloppe d'un module : capsule d'atterrissage → impact de poussière → apparition élastique. */
function Built({ x, z, animate, children }) {
  const g = useRef(), pod = useRef(), t0 = useRef(null), landed = useRef(!animate);
  const y = groundY(x, z);
  useFrame((s, dt) => {
    if (t0.current === null) t0.current = s.clock.elapsedTime; const t = s.clock.elapsedTime - t0.current;
    if (landed.current) { const k = animate ? ease(Math.min(1, (t - 0.9) / 0.8)) : 1; g.current.scale.setScalar(Math.max(0.001, k)); pod.current.visible = false; return; }
    if (t < 0.9) { g.current.scale.setScalar(0.001); pod.current.visible = true; pod.current.position.y = 30 * (1 - ease(Math.min(1, t / 0.9)) ** 0.5) ** 1.5 + 0.8; if (Math.random() < 0.9) fxSoft.emit({ x, y: y + pod.current.position.y, z, vx: (Math.random() - 0.5) * 2, vy: 1, vz: (Math.random() - 0.5) * 2, life: 0.8, s0: 0.5, s1: 1.4, a: 0.5, r: 0.9, g: 0.9, b: 0.95 }); }
    else { landed.current = true; pod.current.visible = false; for (let i = 0; i < 34; i++) { const a = Math.random() * 6.283, v = 3 + Math.random() * 6; fxSoft.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * v, vy: 0.5 + Math.random() * 2, vz: Math.sin(a) * v, life: 1.6, s0: 0.7, s1: 2.6, a: 0.55, r: 0.8, g: 0.5, b: 0.32, drag: 1.4 }); } rt.w.shake = Math.max(rt.w.shake, 0.18); }
  });
  return (
    <group position={[x, y, z]}>
      <mesh ref={pod} visible={false} castShadow><capsuleGeometry args={[0.7, 1.2, 4, 10]} /><meshStandardMaterial color="#d8dde8" metalness={0.5} roughness={0.3} emissive="#ff8040" emissiveIntensity={0.7} /></mesh>
      <group ref={g}>{children}</group>
    </group>
  );
}

function Solar() {
  const panel = useRef();
  useFrame(() => { panel.current.rotation.z = (0.5 - rt.tod) * 1.1; });
  return (
    <group>
      <mesh material={M.pad} position-y={0.1}><cylinderGeometry args={[1.9, 2.1, 0.2, 16]} /></mesh>
      <mesh material={M.metal} position-y={0.9} castShadow><cylinderGeometry args={[0.1, 0.14, 1.7, 8]} /></mesh>
      <group ref={panel} position-y={1.8}>
        <mesh material={M.solar} castShadow rotation-x={0}><boxGeometry args={[3.6, 0.09, 2.2]} /></mesh>
        <mesh material={M.metal} position-y={0.06}><boxGeometry args={[3.7, 0.03, 0.05]} /></mesh>
        <mesh material={M.metal} position-y={0.06}><boxGeometry args={[0.05, 0.03, 2.3]} /></mesh>
      </group>
    </group>
  );
}
function Moxie({ x, z }) {
  const rings = useRef(), acc = useRef(0), accWater = useRef(0);
  const ringMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#4FD1C5", emissive: "#4FD1C5", emissiveIntensity: 1.2 }), []);
  useFrame((s, dt) => {
    ringMat.emissiveIntensity = (0.5 + Math.sin(s.clock.elapsedTime * 3) * 0.4) * (1 - rt.w.dark * 0.9) + 0.2;
    // Bulles O₂ qui montent (blanc/vert clair)
    acc.current += dt;
    if (acc.current > 0.22 && rt.w.dust < 0.8) {
      acc.current = 0;
      fxSoft.emit({ x: x + 0.45, y: groundY(x, z) + 4.1, z, vx: 0.2, vy: 1.4, vz: 0.1, life: 2.6, s0: 0.25, s1: 1.2, a: 0.35, r: 0.95, g: 0.97, b: 1, drag: 0.3 });
    }
    // Particules d'eau extraite (bleu électrique, tombent du bas du module)
    accWater.current += dt;
    if (accWater.current > 0.55 && rt.w.dust < 0.8) {
      accWater.current = 0;
      fxSoft.emit({ x: x + (Math.random() - 0.5) * 0.6, y: groundY(x, z) + 0.5, z: z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.4, vy: -0.3, vz: (Math.random() - 0.5) * 0.4, life: 1.1, s0: 0.12, s1: 0.0, a: 0.7, r: 0.1, g: 0.5, b: 1.0, drag: 0.6, grav: 2 });
      // 2e bulle O₂ de taille différente pour variation
      fxSoft.emit({ x: x + (Math.random() - 0.5) * 0.3, y: groundY(x, z) + 4.4, z: z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.3, vy: 2.0 + Math.random(), vz: (Math.random() - 0.5) * 0.3, life: 1.8, s0: 0.14, s1: 0.5, a: 0.5, r: 0.7, g: 1.0, b: 0.7, drag: 0.4, grav: -0.5 });
    }
  });
  return (
    <group>
      <mesh material={M.pad} position-y={0.1}><cylinderGeometry args={[1.7, 1.9, 0.2, 16]} /></mesh>
      <mesh material={M.hull} position-y={1.9} castShadow><cylinderGeometry args={[0.85, 1.0, 3.6, 20]} /></mesh>
      {[1.0, 2.0, 3.0].map((h) => <mesh key={h} material={ringMat} position-y={h}><torusGeometry args={[0.93, 0.07, 8, 28]} /></mesh>)}
      <mesh material={M.metal} position={[0.45, 3.9, 0]} rotation-z={0.2}><cylinderGeometry args={[0.12, 0.12, 0.9, 8]} /></mesh>
      <mesh material={M.dark} position={[1.3, 0.6, 0.5]} castShadow><boxGeometry args={[0.9, 1, 0.9]} /></mesh>
      {/* Tuyau d'extraction d'eau visible */}
      <mesh material={M.metal} position={[-0.9, 0.4, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.07, 0.07, 1.6, 8]} /></mesh>
      <mesh material={M.dark} position={[-1.65, 0.4, 0]}><sphereGeometry args={[0.14, 8, 8]} /></mesh>
    </group>
  );
}
function Greenhouse() {
  const plants = useRef(), glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#bfffd0", transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }), []);
  const leaf = useMemo(() => new THREE.MeshStandardMaterial({ color: "#46c25a", emissive: "#2cff6a", emissiveIntensity: 0.4, roughness: 0.8 }), []);
  const lg = useRef(); const pos = useMemo(() => Array.from({ length: 11 }, (_, i) => { const a = i * 2.4, r = 0.3 + (i % 4) * 0.45; return [Math.cos(a) * r, Math.sin(a) * r, 0.5 + (i % 3) * 0.25]; }), []);
  useFrame((s) => { const b = rt.w.blight; leaf.color.set("#46c25a").lerp(new THREE.Color("#8a6a2e"), b); leaf.emissiveIntensity = (0.45 - b * 0.4) * (1 - rt.w.dark * 0.8) + 0.05; plants.current.scale.y = 1 - b * 0.55; if (lg.current) lg.current.intensity = (6 - b * 5) * (1 - rt.w.dark * 0.9); });
  return (
    <group>
      <mesh material={M.dark} position-y={0.15}><cylinderGeometry args={[2.5, 2.6, 0.3, 24]} /></mesh>
      <group ref={plants} position-y={0.3}>{pos.map(([x, z, h], i) => <mesh key={i} material={leaf} position={[x, h / 2, z]} castShadow><coneGeometry args={[0.2, h, 6]} /></mesh>)}</group>
      <mesh material={glass} position-y={0.3}><sphereGeometry args={[2.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      <pointLight ref={lg} position-y={1.4} color="#8dff9c" distance={9} decay={1.6} intensity={6} />
    </group>
  );
}
function Shield() {
  const ring = useRef(), field = useRef(), core = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9F7AEA", emissive: "#9F7AEA", emissiveIntensity: 1.2 }), []);
  const fm = useMemo(() => new THREE.MeshBasicMaterial({ color: "#a98cff", transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }), []);
  useFrame((s, dt) => { ring.current.rotation.y += dt * 1.1; const f = rt.w.flare, t = s.clock.elapsedTime; fm.opacity = 0.08 + Math.sin(t * 2) * 0.03 + f * 0.35 + rt.w.aurora * 0.12; core.emissiveIntensity = 0.9 + f * 2 + Math.sin(t * 3) * 0.3; });
  return (
    <group>
      <mesh material={M.pad} position-y={0.1}><cylinderGeometry args={[1.6, 1.8, 0.2, 6]} /></mesh>
      <mesh material={M.metal} position-y={1.4} castShadow><cylinderGeometry args={[0.35, 0.6, 2.6, 6]} /></mesh>
      <mesh material={core} position-y={3.0}><octahedronGeometry args={[0.5]} /></mesh>
      <mesh ref={ring} material={core} position-y={2.3} rotation-x={Math.PI / 2}><torusGeometry args={[1.1, 0.06, 8, 36]} /></mesh>
      <mesh ref={field} material={fm} position-y={0.2}><sphereGeometry args={[3.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
    </group>
  );
}
const MODEL = { solar: Solar, moxie: Moxie, greenhouse: Greenhouse, shield: Shield };

/** Tous les modules construits + emplacements à choisir + balise d'intervention + glace. */
export function Modules({ ctrl }) {
  const [vis, setVis] = useState(() => ({}));
  const [placing, setPlacing] = useState(null);
  const [hover, setHover] = useState(null);
  const built = useBuilt(ctrl);
  useEffect(() => {
    setVis((v) => { const n = { ...v }; for (const [t, arr] of Object.entries(built)) arr.forEach((s) => { if (!(t + s in n)) n[t + s] = { type: t, slot: s, animate: false }; }); for (const k of Object.keys(n)) if (!built[n[k].type].includes(n[k].slot) && !n[k].early) delete n[k]; return n; });
  }, [built]);
  useEffect(() => {
    const a = ctrl.bus.on("buildDone", ({ type, slot }) => setVis((v) => ({ ...v, [type + slot]: { type, slot, animate: true, early: true } })));
    const b = ctrl.bus.on("placing", (p) => { setPlacing(p); if (p && p.slots.length) { const pts = p.slots.map((i) => SLOTS[p.moduleType][i]); rt.cam.cine = { x: pts.reduce((a, q) => a + q[0], 0) / pts.length, z: pts.reduce((a, q) => a + q[1], 0) / pts.length, until: rt.time + 60, dist: 24, pol: 0.85 }; } else if (rt.cam.cine && rt.cam.cine.until > rt.time + 30) rt.cam.cine = null; });
    const c = ctrl.bus.on("reset", () => setVis({}));
    return () => { a(); b(); c(); };
  }, [ctrl]);
  // les modules « early » rentrent dans l'état du jeu à la résolution
  useEffect(() => { setVis((v) => { let ch = false; const n = { ...v }; for (const k of Object.keys(n)) if (n[k].early && built[n[k].type].includes(n[k].slot)) { n[k] = { ...n[k], early: false }; ch = true; } return ch ? n : v; }); }, [built]);
  return (
    <>
      {Object.values(vis).map((m) => { const [x, z] = SLOTS[m.type][m.slot], C = MODEL[m.type]; return (
        <group key={m.type + m.slot} onClick={(e) => { if (e.delta > 6) return; e.stopPropagation(); ctrl.inspect(m.type); }} onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
          <Built x={x} z={z} animate={m.animate}><C x={x} z={z} /></Built>
        </group>); })}
      {placing && placing.slots.map((s) => { const [x, z] = SLOTS[placing.moduleType][s]; return <SlotMarker key={s} x={x} z={z} color={COLORS[placing.moduleType]} hot={hover === s} onOver={() => setHover(s)} onOut={() => setHover(null)} onPick={() => ctrl.placeAt(s)} type={placing.moduleType} />; })}
      <Beacon />
      <DailyMissionBeacon ctrl={ctrl} />
      <IceField />
      <Rover />
    </>
  );
}
function useBuilt(ctrl) {
  const [b, setB] = useState(ctrl.store.get().built);
  useEffect(() => ctrl.store.subscribe(() => { const n = ctrl.store.get().built; setB((o) => (o === n ? o : n)); }), [ctrl]);
  return b;
}
function SlotMarker({ x, z, color, hot, onOver, onOut, onPick, type }) {
  const g = useRef(), m = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }), [color]);
  const y = groundY(x, z);
  useFrame((s) => { const t = s.clock.elapsedTime; g.current.scale.setScalar(1 + Math.sin(t * 4) * 0.06 + (hot ? 0.18 : 0)); m.opacity = hot ? 1 : 0.55 + Math.sin(t * 4) * 0.2; });
  return (
    <group position={[x, y + 0.12, z]} ref={g} onClick={(e) => { if (e.delta > 6) return; e.stopPropagation(); onPick(); }} onPointerOver={(e) => { e.stopPropagation(); onOver(); document.body.style.cursor = "pointer"; }} onPointerOut={() => { onOut(); document.body.style.cursor = ""; }}>
      <mesh material={m} rotation-x={-Math.PI / 2}><ringGeometry args={[1.5, 2.1, 40]} /></mesh>
      <mesh material={m} rotation-x={-Math.PI / 2}><circleGeometry args={[1.5, 32]} /></mesh>
      <mesh position-y={1.6}><cylinderGeometry args={[0.02, 0.02, 3, 4]} /><meshBasicMaterial color={color} /></mesh>
      <mesh position-y={hot ? 1.2 : 0.8} rotation-x={Math.PI}><coneGeometry args={[0.4, 0.8, 4]} /><meshBasicMaterial color={color} transparent opacity={0.9} /></mesh>
    </group>
  );
}
function Beacon() {
  const g = useRef(), ring = useRef(), beam = useRef(); const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffd24a", transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }), []);
  useFrame((s) => { const h = rt.hazard; const on = !!(h && h.pos && h.bonus && !h.reached); g.current.visible = on; if (!on) return; const y = groundY(h.pos[0], h.pos[1]); g.current.position.set(h.pos[0], y + 0.1, h.pos[1]); const t = s.clock.elapsedTime; ring.current.scale.setScalar(1 + ((t * 1.2) % 1) * 0.8); mat.opacity = 0.18 + Math.sin(t * 6) * 0.1; });
  return <group ref={g} visible={false}><mesh ref={ring} material={mat} rotation-x={-Math.PI / 2}><ringGeometry args={[1.6, 2.2, 40]} /></mesh><mesh ref={beam} material={mat} position-y={9}><cylinderGeometry args={[0.9, 0.9, 16, 20, 1, true]} /></mesh></group>;
}

/** Balise 3D pour la mission quotidienne de guidage STEM */
function DailyMissionBeacon({ ctrl }) {
  const g = useRef(), ring = useRef(), beam = useRef();
  const day = ctrl.store.get().game.day || 1;
  const done = ctrl.store.get().dailyMissionDone;
  const mission = getMissionForSol(day);
  const color = mission?.color || "#ffd24a";

  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    [color]
  );

  useFrame((s, dt) => {
    if (!g.current || !mission || done) {
      if (g.current) g.current.visible = false;
      return;
    }
    const [tx, tz] = mission.targetPos;
    const y = groundY(tx, tz);
    g.current.visible = true;
    g.current.position.set(tx, y + 0.1, tz);

    const t = s.clock.elapsedTime;
    if (ring.current) ring.current.scale.setScalar(1 + ((t * 1.4) % 1) * 1.2);
    mat.opacity = 0.22 + Math.sin(t * 5) * 0.12;

    // Particules étincelantes au sol
    if (Math.random() < dt * 6) {
      fxGlow.emit({
        x: tx + (Math.random() - 0.5) * 2,
        y: y + 0.3,
        z: tz + (Math.random() - 0.5) * 2,
        vx: 0,
        vy: 1.5,
        vz: 0,
        life: 1.2,
        s0: 0.25,
        s1: 0.02,
        r: 0.9,
        g: 0.8,
        b: 0.4,
      });
    }

    // Détecte la proximité du commandant (joueur = rt.ents[4])
    const cmd = rt.ents[4];
    if (cmd) {
      const dist = Math.hypot(cmd.x - tx, cmd.z - tz);
      rt.missionDist = Math.round(dist);
      const isNear = dist < 3.8;
      if (rt.nearMission !== isNear) {
        rt.nearMission = isNear;
        ctrl.store.set({ nearMissionTarget: isNear });
      }
    }
  });

  return (
    <group ref={g} visible={false}>
      <mesh ref={ring} material={mat} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.5, 2.5, 40]} />
      </mesh>
      <mesh ref={beam} material={mat} position-y={10}>
        <cylinderGeometry args={[0.8, 1.2, 20, 20, 1, true]} />
      </mesh>
      <pointLight color={color} intensity={8} distance={14} />
    </group>
  );
}
function IceField() {
  const g = useRef(), m = useMemo(() => new THREE.MeshStandardMaterial({ color: "#bfe8ff", emissive: "#5fb8ff", emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 }), []);
  useFrame((s, dt) => { const target = rt.hazard?.id === "ice_discovery" ? 1 : 0; rt.ice += (target - rt.ice) * Math.min(1, dt * 1.5); g.current.visible = rt.ice > 0.02; g.current.scale.setScalar(Math.max(0.01, rt.ice)); if (rt.ice > 0.5 && Math.random() < dt * 20) fxGlow.emit({ x: 12 + (Math.random() - 0.5) * 3, y: groundY(12, 14) + 0.3, z: 14 + (Math.random() - 0.5) * 3, vx: 0, vy: 1.2, vz: 0, life: 1.2, s0: 0.2, s1: 0.02, r: 0.6, g: 0.9, b: 1, drag: 0.2 }); });
  const y = groundY(12, 14);
  return <group ref={g} position={[12, y, 14]} visible={false}>{[[0, 0, 1.6], [1.4, 0.6, 1], [-1.3, 0.8, 0.9], [0.4, -1.4, 0.8]].map(([x, z, s], i) => <mesh key={i} material={m} position={[x, s * 0.5, z]} rotation={[0.2, i, 0.3]} castShadow><octahedronGeometry args={[s * 0.8, 0]} /></mesh>)}<pointLight color="#7fcfff" intensity={8} distance={10} /></group>;
}
/** Petit rover autonome qui patrouille autour de la base. */
function Rover() {
  const g = useRef(), wheels = useRef([]);
  const st = useRef({ a: 0.4 });
  useFrame((s, dt) => {
    const o = st.current; const dust = rt.w.dust; o.a += dt * 0.055 * (1 - dust * 0.6); const R = 24 + Math.sin(o.a * 2.3) * 3, x = Math.cos(o.a) * R, z = Math.sin(o.a) * R;
    const nx = Math.cos(o.a + 0.01) * (24 + Math.sin((o.a + 0.01) * 2.3) * 3), nz = Math.sin(o.a + 0.01) * (24 + Math.sin((o.a + 0.01) * 2.3) * 3);
    g.current.position.set(x, groundY(x, z) + 0.05, z); g.current.rotation.y = Math.atan2(nx - x, nz - z) + Math.PI; wheels.current.forEach((w) => w && (w.rotation.x += dt * 3));
    if (Math.random() < dt * 4) fxSoft.emit({ x, y: groundY(x, z) + 0.1, z, vx: 0, vy: 0.4, vz: 0, life: 1.2, s0: 0.3, s1: 1.1, a: 0.3, r: 0.8, g: 0.5, b: 0.32, drag: 1 });
  });
  return (
    <group ref={g}>
      <mesh material={M.hull} position-y={0.75} castShadow><boxGeometry args={[1.3, 0.45, 2.1]} /></mesh>
      <mesh material={M.solar} position-y={1.02}><boxGeometry args={[1.2, 0.05, 1.5]} /></mesh>
      <mesh material={M.metal} position={[0, 1.4, -0.7]}><cylinderGeometry args={[0.04, 0.04, 0.8, 6]} /></mesh>
      <mesh material={M.dark} position={[0, 1.25, -0.7]}><boxGeometry args={[0.25, 0.2, 0.25]} /></mesh>
      {[-0.8, 0, 0.8].map((z, i) => [-0.78, 0.78].map((x, j) => <mesh key={i + "" + j} ref={(r) => (wheels.current[i * 2 + j] = r)} material={M.dark} position={[x, 0.36, z]} rotation-z={Math.PI / 2} castShadow><cylinderGeometry args={[0.36, 0.36, 0.3, 14]} /></mesh>))}
    </group>
  );
}

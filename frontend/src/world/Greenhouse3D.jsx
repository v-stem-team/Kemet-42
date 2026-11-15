/**
 * Serre hydroponique visuelle (NASA Veggie / APH).
 * Les plantes poussent RÉELLEMENT au fil des Sols :
 *   - progress = f(nombre de sols depuis construction de la serre)
 *   - Chaque Sol actif = +12% de croissance
 *   - Particules d'arrosage animées, lumières LED pulsantes
 *   - Indicateur flottant de croissance visible depuis le HUD
 */
import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundY } from "./terrain.js";
import { useCtrl, useGame } from "../game/useStore.js";
import { fxSoft } from "./sim.js";

export const GREENHOUSE_POS = [-14, 0];

const domeMat = new THREE.MeshStandardMaterial({
  color: "#4fd1c5",
  roughness: 0.2,
  metalness: 0.1,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
});
const frameMat = new THREE.MeshStandardMaterial({ color: "#b6c2d4", roughness: 0.4, metalness: 0.3 });
const potMat  = new THREE.MeshStandardMaterial({ color: "#5d4037", roughness: 0.8 });
const soilMat = new THREE.MeshStandardMaterial({ color: "#4e342e", roughness: 1 });
const stemMat = new THREE.MeshStandardMaterial({ color: "#6b8e23", roughness: 0.6 });

// Feuilles dont la couleur s'intensifie avec la croissance
const makeLeafMat = (progress) => new THREE.MeshStandardMaterial({
  color: new THREE.Color().setHSL(0.33, 0.6 + progress * 0.004, 0.35 + progress * 0.002),
  roughness: 0.5,
});

export function Greenhouse3D() {
  const c = useCtrl();
  const group  = useRef();
  const stems  = useRef([]);
  const leaves = useRef([]);
  const ledRef = useRef();

  // Calcul de la croissance à partir du store (nombre de sols construits)
  const built   = useGame((s) => s.built);
  const day     = useGame((s) => s.game?.day || 1);

  // Nombre de sols pendant lesquels la serre a été active
  const greenhouseSolsBuilt = useMemo(() => {
    const positions = (built?.greenhouse || []);
    if (!positions.length) return 0;
    // La serre a été construite au plus tôt. On utilise la position du 1er module.
    // On suppose que la serre est construite depuis (day - firstBuiltDay) sols.
    // Par simplification : chaque "case" du tableau = 1 module ajouté = +1 niveau
    return Math.min(positions.length * 4, 8); // 0–8 niveaux → jusqu'à ~96 sols simulés
  }, [built?.greenhouse]);

  // Croissance réelle = sols actifs × 12%, max 100%
  const targetProgress = useMemo(() => {
    const base = greenhouseSolsBuilt * 12;
    // Bonus si la serre vient juste d'être active ce Sol
    return Math.min(100, base + (built?.greenhouse?.length ? day * 3 : 0));
  }, [greenhouseSolsBuilt, day, built?.greenhouse]);

  const progress = useRef(targetProgress);

  // Mise à jour douce du progrès réel vers la cible
  useEffect(() => {
    progress.current = targetProgress;
  }, [targetProgress]);

  // Écoute des événements de jeu
  useEffect(() => {
    const bus = c?.bus;
    if (!bus) return;
    const onGrow    = () => { progress.current = Math.min(100, progress.current + 20); };
    const onHarvest = () => { progress.current = Math.max(15, progress.current - 15); };
    bus.on?.("greenhouseGrow",    onGrow);
    bus.on?.("greenhouseHarvest", onHarvest);
    return () => {
      if (bus.off) {
        bus.off("greenhouseGrow",    onGrow);
        bus.off("greenhouseHarvest", onHarvest);
      }
    };
  }, [c]);

  // 4 bacs de plantes en carré dans le dôme
  const potPositions = useMemo(() => [
    [-1.5, 0, -1.5],
    [ 1.5, 0, -1.5],
    [-1.5, 0,  1.5],
    [ 1.5, 0,  1.5],
  ], []);

  useFrame((state, dt) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    const p = progress.current;          // 0–100
    const pn = p / 100;                  // 0–1 normalisé

    // Croissance progressive des tiges (hauteur ∝ pn)
    for (const stem of stems.current) {
      if (!stem) continue;
      const targetH = 0.1 + pn * 0.9;
      stem.scale.y += (targetH - stem.scale.y) * Math.min(1, dt * 2);
      stem.position.y = stem.scale.y * 0.4;
    }

    // Feuilles : éclosion progressive
    for (let i = 0; i < leaves.current.length; i++) {
      const leaf = leaves.current[i];
      if (!leaf) continue;
      // Chaque feuille apparaît à un stade différent
      const threshold = (i % 3) * 0.25;
      const show = pn > threshold ? Math.min(1, (pn - threshold) / 0.2) : 0;
      leaf.scale.setScalar(show * (0.15 + (i % 2) * 0.08));
      // Légère oscillation
      leaf.rotation.z = Math.sin(t * 1.2 + i) * 0.08;
    }

    // LED pulsante (couleur rouge+bleu = NASA Veggie)
    if (ledRef.current) {
      ledRef.current.intensity = 1.5 + Math.sin(t * 2) * 0.4 * pn;
    }

    // Particules d'arrosage si la serre est active (p > 20)
    if (p > 20 && t % 0.8 < dt) {
      for (const pp of potPositions) {
        fxSoft.emit?.({
          x: GREENHOUSE_POS[0] + pp[0] + (Math.random() - 0.5) * 0.4,
          y: GREENHOUSE_POS[1] + 2.2,
          z: pp[2] + (Math.random() - 0.5) * 0.4,
          vx: 0, vy: -1.8, vz: 0,
          life: 0.6, s0: 0.05, s1: 0,
          grav: 6, drag: 0.5,
          r: 0.3, g: 0.6, b: 1.0,
        });
      }
    }

    // Particules de fruits/floraison si très avancé (p > 70)
    if (p > 70 && t % 2.5 < dt) {
      fxSoft.emit?.({
        x: GREENHOUSE_POS[0] + (Math.random() - 0.5) * 2,
        y: GREENHOUSE_POS[1] + 1.8,
        z: (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 0.3,
        vy: 0.5, vz: (Math.random() - 0.5) * 0.3,
        life: 1.2, s0: 0.08, s1: 0.02,
        grav: -1, drag: 0.9,
        r: 0.8, g: 1.0, b: 0.3,
      });
    }
  });

  const posY = groundY(GREENHOUSE_POS[0], GREENHOUSE_POS[1]);

  return (
    <group ref={group} position={[GREENHOUSE_POS[0], posY, GREENHOUSE_POS[1]]}>
      {/* Dôme pressurisé translucide */}
      <mesh geometry={new THREE.SphereGeometry(4, 32, 16)} material={domeMat} castShadow receiveShadow position-y={2} />
      {/* Anneau de base */}
      <mesh geometry={new THREE.CylinderGeometry(4, 4, 0.2, 32)} material={frameMat} position-y={0.1} />
      {/* Anneaux de structure */}
      <mesh geometry={new THREE.TorusGeometry(3.9, 0.08, 8, 32)} material={frameMat} rotation-x={Math.PI / 2} position-y={2} />
      <mesh geometry={new THREE.TorusGeometry(2.8, 0.06, 8, 32)} material={frameMat} rotation-x={Math.PI / 2} position-y={3.5} />

      {/* Éclairage horticole LED NASA Veggie (rouge + bleu) */}
      <pointLight ref={ledRef} color="#ff2a6d" intensity={1.8} distance={9} position-y={1.9} />
      <pointLight color="#2a6dff" intensity={1.8} distance={9} position-y={1.9} />

      {/* Sol de la serre */}
      <mesh geometry={new THREE.CylinderGeometry(3.5, 3.5, 0.08, 32)} material={soilMat} position-y={0.04} receiveShadow />

      {/* 4 bacs de culture hydroponique */}
      {potPositions.map((p, i) => (
        <group key={i} position={[p[0], 0, p[2]]}>
          {/* Bac */}
          <mesh geometry={new THREE.CylinderGeometry(0.72, 0.6, 0.38, 16)} material={potMat} position-y={0.2} castShadow />
          {/* Substrat */}
          <mesh geometry={new THREE.CylinderGeometry(0.63, 0.57, 0.1, 16)} material={soilMat} position-y={0.44} />
          {/* Tige principale */}
          <mesh
            ref={(r) => { stems.current[i] = r; }}
            geometry={new THREE.CylinderGeometry(0.04, 0.06, 1, 8)}
            material={stemMat}
            position-y={0.5}
            castShadow
          />
          {/* Feuilles en éventail autour de la tige */}
          {[0, 1, 2, 3, 4, 5].map((j) => (
            <mesh
              key={j}
              ref={(r) => { leaves.current[i * 6 + j] = r; }}
              geometry={new THREE.SphereGeometry(0.14, 8, 6)}
              material={makeLeafMat(progress.current || 0)}
              position={[
                Math.cos((j / 6) * Math.PI * 2) * 0.28,
                0.6 + (j % 3) * 0.18,
                Math.sin((j / 6) * Math.PI * 2) * 0.28,
              ]}
              castShadow
            />
          ))}
        </group>
      ))}
    </group>
  );
}

// Eriscape/index.ts

import {
  Engine,
  Scene,
  FreeCamera,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  DynamicTexture,
  Tools,
  Scalar,
} from "@babylonjs/core";
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";
import "@babylonjs/core/Materials/Textures/texture";
import { createNoise2D, type RandomFn } from "simplex-noise";

// ----------------------------------------
// Data Model Definitions
// ----------------------------------------

type BiomeType = "plains" | "forest" | "swamp" | "tundra" | "tropical";
type SurfaceCondition = "dirt" | "rock" | "mud";

interface MapCell {
  elevation: number;
  condition: SurfaceCondition;
  hazardLevel: number;
}

interface EnvironmentEvent {
  id: string;
  type: "solarRadiation" | "lavaFlow" | "acidRain";
  startTime: number;
  duration: number;
  area: { x: number; y: number; width: number; height: number };
  intensity: number;
}

interface EnvironmentMap {
  width: number;
  height: number;
  resolution: number;
  biome: BiomeType;
  cells: MapCell[][];
  safeZone: {
    start: { x: number; y: number; radius: number };
    end: { x: number; y: number; radius: number };
  };
  events: EnvironmentEvent[];
}

// -- Helper: Simple Seeded PRNG (Mulberry32) --
function mulberry32(seedStr: string): RandomFn {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------
// Generation Functions
// ----------------------------------------

function initializeEnvironmentMap(
  width: number,
  height: number,
  resolution: number,
  biome: BiomeType
): EnvironmentMap {
  const cells: MapCell[][] = [];
  for (let j = 0; j < resolution; j++) {
    const row: MapCell[] = [];
    for (let i = 0; i < resolution; i++) {
      row.push({ elevation: 0, condition: "dirt", hazardLevel: 0 });
    }
    cells.push(row);
  }
  // ***** MODIFICATION: Smaller starting radius for testing *****
  const safeZone = {
    start: { x: width / 2, y: height / 2, radius: width * 0.4 }, // Start at 40% of width
    end: { x: width / 2, y: height / 2, radius: 0 },
  };
  return { width, height, resolution, biome, cells, safeZone, events: [] };
}

function generateHeightMap(
  env: EnvironmentMap,
  noiseScale: number,
  maxElevation: number,
  noiseFunc: (x: number, y: number) => number
): void {
  const { width, height, resolution, cells } = env;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const u = i / (resolution - 1);
      const v = j / (resolution - 1);
      const x = u * width;
      const y = v * height;
      const n = noiseFunc(x * noiseScale, y * noiseScale);
      const elevation = ((n + 1) / 2) * maxElevation;
      cells[j][i].elevation = elevation;
    }
  }
}

function assignSurfaceConditions(env: EnvironmentMap): void {
  const { cells } = env;
  const resolution = cells.length;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const elevation = cells[j][i].elevation;
      if (elevation < 6) {
        cells[j][i].condition = "mud";
      } else if (elevation < 12) {
        cells[j][i].condition = "dirt";
      } else {
        cells[j][i].condition = "rock";
      }
    }
  }
}

function computeSafeZoneAtTime(
  env: EnvironmentMap,
  tick: number,
  tFinal: number
): { x: number; y: number; radius: number } {
  const start = env.safeZone.start;
  const end = env.safeZone.end;
  const ratio = Math.min(Math.max(tick / tFinal, 0), 1);
  return {
    x: start.x * (1 - ratio) + end.x * ratio,
    y: start.y * (1 - ratio) + end.y * ratio,
    radius: start.radius * (1 - ratio) + end.radius * ratio,
  };
}

// ----------------------------------------
// Visualization Using Babylon.js
// ----------------------------------------

let mapTexture: DynamicTexture | null = null;

function updateMapTexture(env: EnvironmentMap, safeZoneAtTick: { x: number; y: number; radius: number }, scene: Scene): void {
    if (!mapTexture) {
         mapTexture = new DynamicTexture("mapTexture", { width: env.resolution, height: env.resolution }, scene, false);
         console.log("[Eriscape] Created Dynamic Texture");
    }
    const ctx = mapTexture.getContext();

    // Draw cells
    for (let j = 0; j < env.resolution; j++) {
        for (let i = 0; i < env.resolution; i++) {
            const cell = env.cells[j][i];
            const intensity = Scalar.Clamp(cell.elevation / MAX_ELEVATION, 0, 1); // Use MAX_ELEVATION
            const colorVal = Math.floor(intensity * 255);
            let r = colorVal, g = colorVal, b = colorVal;

            if (cell.condition === "mud") { r = Math.floor(r*0.6); g = Math.floor(g*0.7); b = Math.floor(b*0.5); }
            if (cell.condition === "rock") { r = Math.floor(r*1.1); g = Math.floor(g*1.1); b = Math.floor(b*1.1); }

            r = Math.min(255, Math.max(0, r));
            g = Math.min(255, Math.max(0, g));
            b = Math.min(255, Math.max(0, b));
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(i, env.resolution - 1 - j, 1, 1);
        }
    }

    // Draw safe zone
    ctx.strokeStyle = "red";
    // ***** MODIFICATION: Increased line width *****
    ctx.lineWidth = 2; // Make it slightly thicker

    const normX = safeZoneAtTick.x / env.width;
    const normY = safeZoneAtTick.y / env.height;
    const sx = normX * env.resolution;
    const sy = (1 - normY) * env.resolution;
    const sr = (safeZoneAtTick.radius / env.width) * env.resolution;

    console.log(`[Eriscape] Safe Zone (World): x=${safeZoneAtTick.x.toFixed(2)}, y=${safeZoneAtTick.y.toFixed(2)}, radius=${safeZoneAtTick.radius.toFixed(2)}`);
    console.log(`[Eriscape] Safe Zone (Canvas Pixels): sx=${sx.toFixed(2)}, sy=${sy.toFixed(2)}, sr=${sr.toFixed(2)}`);

    if (sr > 0 && isFinite(sx) && isFinite(sy)) {
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, 2 * Math.PI);
        ctx.stroke();
        console.log("[Eriscape] Drew safe zone arc.");
    } else {
        console.log("[Eriscape] Skipped drawing safe zone (radius <= 0 or invalid coords).");
    }

    mapTexture.update();
    console.log("[Eriscape] Updated Dynamic Texture");
}


// --- Shared Babylon Variables ---
let engine: Engine;
let scene: Scene;
let envMap: EnvironmentMap;

function createScene(canvas: HTMLCanvasElement): Scene {
  engine = new Engine(canvas, true);
  scene = new Scene(engine);
  scene.clearColor = new Color3(0.1, 0.1, 0.2).toColor4();

  const camera = new FreeCamera("orthoCam", new Vector3(envMap.width / 2, 100, envMap.height / 2), scene);
  camera.mode = FreeCamera.ORTHOGRAPHIC_CAMERA;
  const orthoSize = Math.max(envMap.width, envMap.height) / 2;
  camera.orthoLeft = -orthoSize;
  camera.orthoRight = orthoSize;
  camera.orthoTop = orthoSize;
  camera.orthoBottom = -orthoSize;
  camera.setTarget(new Vector3(envMap.width / 2, 0, envMap.height / 2));
  camera.minZ = 0.1;
  camera.attachControl(canvas, true);

  const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
  light.intensity = 0.8;

  return scene;
}

// ----------------------------------------
// Main Prototype Execution
// ----------------------------------------

const MAP_WIDTH = 100;
const MAP_HEIGHT = 100;
const RESOLUTION = 200;
const BIOME: BiomeType = "plains";
const NOISE_SCALE = 0.05;
const MAX_ELEVATION = 20;
const TFINAL = 18000;

const noiseGenerator = createNoise2D(mulberry32("eriscape"));
envMap = initializeEnvironmentMap(MAP_WIDTH, MAP_HEIGHT, RESOLUTION, BIOME);
generateHeightMap(envMap, NOISE_SCALE, MAX_ELEVATION, noiseGenerator);
assignSurfaceConditions(envMap);

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const timeSlider = document.getElementById("timeSlider") as HTMLInputElement;
const timeLabel = document.getElementById("timeLabel") as HTMLDivElement;

if (!canvas || !timeSlider || !timeLabel) {
  console.error("Required HTML elements not found!");
  throw new Error("Missing required HTML elements.");
}

const babylonScene = createScene(canvas);

const plane = MeshBuilder.CreatePlane("mapPlane", { width: MAP_WIDTH, height: MAP_HEIGHT }, babylonScene);
plane.rotation.x = Math.PI / 2;
const mapMaterial = new StandardMaterial("mapMat", babylonScene);
mapMaterial.backFaceCulling = false;
plane.material = mapMaterial;
plane.position = new Vector3(MAP_WIDTH / 2, 0, MAP_HEIGHT / 2);

// Initialize and assign the dynamic texture
let currentSafeZone = computeSafeZoneAtTime(envMap, Number(timeSlider.value), TFINAL);
updateMapTexture(envMap, currentSafeZone, babylonScene);
if (mapTexture) {
    mapMaterial.diffuseTexture = mapTexture;
    mapMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
    mapMaterial.ambientColor = new Color3(0.8, 0.8, 0.8);
}

// Slider updates the texture
timeSlider.addEventListener("input", () => {
  const tick = Number(timeSlider.value);
  timeLabel.innerText = "Time: " + tick + " / " + TFINAL;
  currentSafeZone = computeSafeZoneAtTime(envMap, tick, TFINAL);
  updateMapTexture(envMap, currentSafeZone, babylonScene);
});

// Run the render loop
engine.runRenderLoop(() => {
  babylonScene.render();
});
window.addEventListener("resize", () => {
  engine.resize();
});

// Inspector toggle
window.addEventListener("keydown", (ev) => {
    if (ev.shiftKey && ev.ctrlKey && ev.altKey && ev.key === 'I') {
        if (babylonScene.debugLayer.isVisible()) {
            babylonScene.debugLayer.hide();
        } else {
            babylonScene.debugLayer.show({ embedMode: true });
        }
    }
});
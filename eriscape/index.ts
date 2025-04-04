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
} from "@babylonjs/core";
import "@babylonjs/core/Materials/Textures/texture"; // Ensure textures are loaded
import SimplexNoise from "simplex-noise";

// ----------------------------------------
// Data Model Definitions
// ----------------------------------------

// The overall map (or "biome") type – e.g. "plains".
type BiomeType = "plains" | "forest" | "swamp" | "tundra" | "tropical";

// Each grid cell stores its surface condition and elevation.
type SurfaceCondition = "dirt" | "rock" | "mud";

interface MapCell {
  elevation: number;          // Base elevation (in game units)
  condition: SurfaceCondition;// For now, set by a simple rule
  hazardLevel: number;        // For later: 0 (safe) to 1 (deadly)
}

interface EnvironmentEvent {
  // Placeholder: later events like lava flows, acid rain, etc.
  id: string;
  type: "solarRadiation" | "lavaFlow" | "acidRain";
  startTime: number;
  duration: number;
  area: { x: number; y: number; width: number; height: number };
  intensity: number;
}

interface EnvironmentMap {
  width: number;              // Total width (game units)
  height: number;             // Total height (game units)
  resolution: number;         // Number of cells per side (grid resolution)
  biome: BiomeType;           // Dominant biome for the map
  cells: MapCell[][];         // 2D array of grid cells
  safeZone: {
    start: { x: number; y: number; radius: number };  // Safe zone at t=0 (covers map)
    end: { x: number; y: number; radius: number };    // Safe zone at final tick (zero radius)
  };
  events: EnvironmentEvent[]; // Dynamic events (for later)
}

// ----------------------------------------
// Generation Functions
// ----------------------------------------

// Create an empty grid of cells.
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
  // Define the safe zone as a circle: at time 0 it covers the whole map; at tFinal it shrinks to the center.
  const safeZone = {
    start: { x: width / 2, y: height / 2, radius: Math.max(width, height) },
    end: { x: width / 2, y: height / 2, radius: 0 },
  };

  return { width, height, resolution, biome, cells, safeZone, events: [] };
}

// Generate base elevation values using simplex noise.
function generateHeightMap(
  env: EnvironmentMap,
  noiseScale: number,
  maxElevation: number,
  simplex: SimplexNoise
): void {
  const { width, height, resolution, cells } = env;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      // Normalize cell indices to [0, 1]
      const u = i / (resolution - 1);
      const v = j / (resolution - 1);
      // Map to world coordinates
      const x = u * width;
      const y = v * height;
      // Get a noise value in [-1, 1]
      const n = simplex.noise2D(x * noiseScale, y * noiseScale);
      // Normalize to [0, 1] and scale to maxElevation
      const elevation = ((n + 1) / 2) * maxElevation;
      cells[j][i].elevation = elevation;
    }
  }
}

// Assign surface conditions based on elevation. For example, low areas may be "mud" and high areas "rock".
function assignSurfaceConditions(env: EnvironmentMap): void {
  const { cells } = env;
  const resolution = cells.length;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const elevation = cells[j][i].elevation;
      // Simple rule: if elevation < 6 -> mud, 6-12 -> dirt, >12 -> rock.
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

// Compute safe zone radius at a given time tick (0 to tFinal)
function computeSafeZoneAtTime(
  env: EnvironmentMap,
  tick: number,
  tFinal: number
): { x: number; y: number; radius: number } {
  // Linear interpolation between start and end.
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
// Visualization Using Babylon.js in 3D Orthographic Mode
// ----------------------------------------

// Create a 2D visualization of the environment map as a DynamicTexture.
function createMapTexture(env: EnvironmentMap, safeZoneAtTick: { x: number; y: number; radius: number }): DynamicTexture {
  // Create a canvas texture whose size matches the grid resolution.
  const dt = new DynamicTexture("mapTexture", { width: env.resolution, height: env.resolution }, scene, false);
  const ctx = dt.getContext();

  // Draw each cell: use a color scale based on elevation.
  for (let j = 0; j < env.resolution; j++) {
    for (let i = 0; i < env.resolution; i++) {
      const cell = env.cells[j][i];
      // Map elevation to a grayscale value
      const intensity = Tools.Clamp(cell.elevation / 20, 0, 1);
      const colorVal = Math.floor(intensity * 255);
      // Optionally, tint by condition
      let fillStyle = `rgb(${colorVal},${colorVal},${colorVal})`;
      if (cell.condition === "mud") fillStyle = `rgb(${colorVal / 2},${colorVal / 2},${colorVal / 2})`;
      if (cell.condition === "rock") fillStyle = `rgb(${colorVal + 50},${colorVal + 50},${colorVal + 50})`;

      ctx.fillStyle = fillStyle;
      ctx.fillRect(i, env.resolution - 1 - j, 1, 1); // Flip vertically
    }
  }

  // Draw the safe zone (as a circle) in a contrasting color.
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;
  // Convert safeZone center and radius from world coordinates to grid indices.
  const sx = (safeZoneAtTick.x / env.width) * env.resolution;
  const sy = (safeZoneAtTick.y / env.height) * env.resolution;
  const sr = (safeZoneAtTick.radius / env.width) * env.resolution;
  ctx.beginPath();
  ctx.arc(sx, env.resolution - sy, sr, 0, 2 * Math.PI);
  ctx.stroke();

  dt.update(); // Refresh the dynamic texture

  return dt;
}

// Create an orthographic Babylon scene.
let engine: Engine;
let scene: Scene;

function createScene(canvas: HTMLCanvasElement): Scene {
  scene = new Scene(engine);
  // Set up an orthographic camera (top-down)
  const camera = new FreeCamera("orthoCam", new Vector3(envMap.width / 2, 100, envMap.height / 2), scene);
  camera.mode = FreeCamera.ORTHOGRAPHIC_CAMERA;
  const orthoLeft = -envMap.width / 2;
  const orthoRight = envMap.width / 2;
  const orthoTop = envMap.height / 2;
  const orthoBottom = -envMap.height / 2;
  camera.orthoLeft = orthoLeft;
  camera.orthoRight = orthoRight;
  camera.orthoTop = orthoTop;
  camera.orthoBottom = orthoBottom;
  camera.setTarget(new Vector3(envMap.width / 2, 0, envMap.height / 2));
  camera.attachControl(canvas, true);

  // Add a light.
  const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
  light.intensity = 0.8;
  return scene;
}

// ----------------------------------------
// Main Prototype Execution
// ----------------------------------------

// Parameters
const MAP_WIDTH = 100;
const MAP_HEIGHT = 100;
const RESOLUTION = 200;         // 200 x 200 grid cells
const BIOME: BiomeType = "plains";
const NOISE_SCALE = 0.05;
const MAX_ELEVATION = 20;
const TFINAL = 18000;           // 5 minutes at 60 Hz

// Create a SimplexNoise generator.
const simplex = new SimplexNoise("eriscape");

// Initialize environment map.
const envMap = initializeEnvironmentMap(MAP_WIDTH, MAP_HEIGHT, RESOLUTION, BIOME);

// Generate heightmap and assign surface conditions.
generateHeightMap(envMap, NOISE_SCALE, MAX_ELEVATION, simplex);
assignSurfaceConditions(envMap);

// Set up HTML UI elements.
const canvas = document.createElement("canvas");
canvas.id = "renderCanvas";
canvas.style.width = "800px";
canvas.style.height = "800px";
document.body.appendChild(canvas);

const timeSlider = document.createElement("input");
timeSlider.type = "range";
timeSlider.min = "0";
timeSlider.max = TFINAL.toString();
timeSlider.value = "0";
timeSlider.style.width = "800px";
document.body.appendChild(timeSlider);

const timeLabel = document.createElement("div");
timeLabel.innerText = "Time: 0 / " + TFINAL;
document.body.appendChild(timeLabel);

// Create Babylon engine and scene.
engine = new Engine(canvas, true);
const babylonScene = createScene(canvas);

// Create a plane to display our dynamic map texture.
const plane = MeshBuilder.CreatePlane("mapPlane", { width: MAP_WIDTH, height: MAP_HEIGHT }, babylonScene);
const mapMaterial = new StandardMaterial("mapMat", babylonScene);
let currentSafeZone = computeSafeZoneAtTime(envMap, Number(timeSlider.value), TFINAL);
const mapTexture = createMapTexture(envMap, currentSafeZone);
mapMaterial.diffuseTexture = mapTexture;
plane.material = mapMaterial;
plane.position = new Vector3(MAP_WIDTH / 2, 0, MAP_HEIGHT / 2);

// Update loop: re-render texture when time slider changes.
timeSlider.addEventListener("input", () => {
  const tick = Number(timeSlider.value);
  timeLabel.innerText = "Time: " + tick + " / " + TFINAL;
  // Compute current safe zone.
  currentSafeZone = computeSafeZoneAtTime(envMap, tick, TFINAL);
  // Recreate the texture with updated safe zone.
  createMapTexture(envMap, currentSafeZone);
});

// Run the render loop.
engine.runRenderLoop(() => {
  babylonScene.render();
});
window.addEventListener("resize", () => {
  engine.resize();
});

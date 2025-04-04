// Eriscape/index.ts - Interactive Configurator

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
  ArcRotateCamera, // Using ArcRotateCamera might be easier for viewing
} from "@babylonjs/core";
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";
import "@babylonjs/core/Materials/Textures/texture";
import { createNoise2D, type RandomFn } from "simplex-noise";

// --- Interfaces ---

type BiomeType = "plains" | "forest" | "swamp" | "tundra" | "tropical";
type SurfaceCondition = "dirt" | "rock" | "mud";

interface MapCell {
  elevation: number;
  condition: SurfaceCondition;
  hazardLevel: number;
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
  events: any[]; // Placeholder
}

// Configuration structure matching UI inputs
interface EriscapeConfig {
    seed: string;
    width: number;
    height: number;
    resolution: number;
    noiseScale: number;
    maxElevation: number;
    tFinal: number; // Total simulation time ticks (for slider)
}

// --- Constants & Global State ---

const LOCAL_STORAGE_KEY = 'eriscapeConfig';
const DEFAULT_CONFIG: EriscapeConfig = {
    seed: "eriscape_default",
    width: 100,
    height: 100,
    resolution: 200,
    noiseScale: 0.05,
    maxElevation: 20,
    tFinal: 18000,
};

let currentConfig: EriscapeConfig = { ...DEFAULT_CONFIG };
let engine: Engine;
let scene: Scene;
let envMap: EnvironmentMap;
let mapTexture: DynamicTexture | null = null;
let plane: MeshBuilder.CreatePlane | null = null;
let camera: ArcRotateCamera; // Using ArcRotateCamera for better control

// --- DOM Element References ---
let canvas: HTMLCanvasElement;
let inputSeed: HTMLInputElement;
let inputWidth: HTMLInputElement;
let inputHeight: HTMLInputElement;
let inputResolution: HTMLInputElement;
let inputNoiseScale: HTMLInputElement;
let inputMaxElevation: HTMLInputElement;
let btnRegenerate: HTMLButtonElement;
let btnSave: HTMLButtonElement;
let statusMessage: HTMLDivElement;
let timeSlider: HTMLInputElement;
let timeLabel: HTMLDivElement;


// --- Helper Functions ---

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

function showStatus(message: string, isError = false) {
    if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.style.color = isError ? '#e06c75' : '#98c379'; // Error red / Success green
        setTimeout(() => {
             if (statusMessage.textContent === message) statusMessage.textContent = '';
        }, 3000); // Clear after 3 seconds
    }
    if (isError) {
        console.error("[Eriscape Status]", message);
    } else {
        console.log("[Eriscape Status]", message);
    }
}

// --- Config Load/Save ---

function loadConfig() {
    console.log("[Eriscape] Attempting to load config from Local Storage...");
    try {
        const savedConfigJson = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (savedConfigJson) {
            const savedConfig = JSON.parse(savedConfigJson);
            // Basic validation (add more checks if needed)
            if (savedConfig && typeof savedConfig.seed === 'string') {
                currentConfig = { ...DEFAULT_CONFIG, ...savedConfig }; // Merge defaults with saved
                console.log("[Eriscape] Loaded config:", currentConfig);
                showStatus("Loaded saved configuration.");
            } else {
                 console.log("[Eriscape] Invalid data in Local Storage, using defaults.");
                 currentConfig = { ...DEFAULT_CONFIG };
            }
        } else {
            console.log("[Eriscape] No saved config found, using defaults.");
            currentConfig = { ...DEFAULT_CONFIG };
        }
    } catch (error) {
        showStatus(`Error loading config: ${error}`, true);
        currentConfig = { ...DEFAULT_CONFIG };
    }

    // Update UI elements with loaded/default values
    inputSeed.value = currentConfig.seed;
    inputWidth.value = currentConfig.width.toString();
    inputHeight.value = currentConfig.height.toString();
    inputResolution.value = currentConfig.resolution.toString();
    inputNoiseScale.value = currentConfig.noiseScale.toString();
    inputMaxElevation.value = currentConfig.maxElevation.toString();
    timeSlider.max = currentConfig.tFinal.toString();
    timeLabel.textContent = `Time: ${timeSlider.value} / ${currentConfig.tFinal}`;

}

function saveConfig() {
    console.log("[Eriscape] Saving current config to Local Storage...");
    // Read current values from UI to ensure they are captured
    readConfigFromUI();
    try {
        const configJson = JSON.stringify(currentConfig);
        localStorage.setItem(LOCAL_STORAGE_KEY, configJson);
        showStatus("Configuration saved successfully.");
    } catch (error) {
        showStatus(`Error saving config: ${error}`, true);
    }
}

function readConfigFromUI(): boolean {
    const width = parseInt(inputWidth.value, 10);
    const height = parseInt(inputHeight.value, 10);
    const resolution = parseInt(inputResolution.value, 10);
    const noiseScale = parseFloat(inputNoiseScale.value);
    const maxElevation = parseInt(inputMaxElevation.value, 10);
    const seed = inputSeed.value.trim();

    let isValid = true;
    if (isNaN(width) || width < 10) { showStatus("Invalid Width (min 10).", true); isValid = false; }
    if (isNaN(height) || height < 10) { showStatus("Invalid Height (min 10).", true); isValid = false; }
    if (isNaN(resolution) || resolution < 10) { showStatus("Invalid Resolution (min 10).", true); isValid = false; }
    if (isNaN(noiseScale) || noiseScale <= 0) { showStatus("Invalid Noise Scale (> 0).", true); isValid = false; }
    if (isNaN(maxElevation) || maxElevation < 1) { showStatus("Invalid Max Elevation (min 1).", true); isValid = false; }
    if (!seed) { showStatus("Seed cannot be empty.", true); isValid = false; }

    if (isValid) {
        currentConfig.seed = seed;
        currentConfig.width = width;
        currentConfig.height = height;
        currentConfig.resolution = resolution;
        currentConfig.noiseScale = noiseScale;
        currentConfig.maxElevation = maxElevation;
        // Note: tFinal is not directly editable in this UI example
        console.log("[Eriscape] Read config from UI:", currentConfig);
    }
    return isValid;
}


// --- Map Generation and Visualization ---

function initializeEnvironmentMap(config: EriscapeConfig): EnvironmentMap {
  const { width, height, resolution } = config;
  const cells: MapCell[][] = [];
  for (let j = 0; j < resolution; j++) {
    const row: MapCell[] = [];
    for (let i = 0; i < resolution; i++) {
      row.push({ elevation: 0, condition: "dirt", hazardLevel: 0 });
    }
    cells.push(row);
  }
  const safeZone = {
    start: { x: width / 2, y: height / 2, radius: width * 0.4 }, // Keep smaller radius
    end: { x: width / 2, y: height / 2, radius: 0 },
  };
  return { width, height, resolution, biome: "plains", cells, safeZone, events: [] };
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
      const worldX = u * width;   // Use world coords for noise input
      const worldY = v * height;
      const n = noiseFunc(worldX * noiseScale, worldY * noiseScale);
      const elevation = ((n + 1) / 2) * maxElevation;
      cells[j][i].elevation = elevation;
    }
  }
}

function assignSurfaceConditions(env: EnvironmentMap, maxElevation: number): void {
  const { cells } = env;
  const resolution = cells.length;
   // Define thresholds relative to maxElevation
  const mudThreshold = maxElevation * 0.3;
  const rockThreshold = maxElevation * 0.6;

  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const elevation = cells[j][i].elevation;
      if (elevation < mudThreshold) {
        cells[j][i].condition = "mud";
      } else if (elevation < rockThreshold) {
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


function updateMapTexture(env: EnvironmentMap, safeZoneAtTick: { x: number; y: number; radius: number }): void {
    if (!scene) return; // Ensure scene exists

    if (!mapTexture || mapTexture.getSize().width !== env.resolution) {
        // Dispose old texture if resolution changed
        if (mapTexture) {
            mapTexture.dispose();
            console.log("[Eriscape] Disposed old Dynamic Texture");
        }
        mapTexture = new DynamicTexture("mapTexture", { width: env.resolution, height: env.resolution }, scene, false);
        console.log("[Eriscape] Created Dynamic Texture, Res:", env.resolution);
         // Reassign texture to material if it was created after initial assignment
         if(plane && plane.material instanceof StandardMaterial) {
             plane.material.diffuseTexture = mapTexture;
         }
    }

    const ctx = mapTexture.getContext();
    ctx.clearRect(0, 0, env.resolution, env.resolution); // Clear previous content

    // Draw cells
    for (let j = 0; j < env.resolution; j++) {
        for (let i = 0; i < env.resolution; i++) {
            const cell = env.cells[j][i];
            const intensity = Scalar.Clamp(cell.elevation / envMap.height, 0, 1); // Normalize based on actual max elevation
            let r = Math.floor(intensity * 255);
            let g = r;
            let b = r;

            // Apply tints
            if (cell.condition === "mud") { r = Math.floor(r*0.6); g = Math.floor(g*0.7); b = Math.floor(b*0.5); }
            if (cell.condition === "rock") { r = Math.floor(r*1.1); g = Math.floor(g*1.1); b = Math.floor(b*1.1); }

            r = Math.min(255, Math.max(0, r));
            g = Math.min(255, Math.max(0, g));
            b = Math.min(255, Math.max(0, b));

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(i, env.resolution - 1 - j, 1, 1); // Invert Y
        }
    }

    // Draw safe zone
    ctx.strokeStyle = "red";
    ctx.lineWidth = Math.max(1, Math.floor(env.resolution / 200)); // Scale line width slightly

    const normX = safeZoneAtTick.x / env.width;
    const normY = safeZoneAtTick.y / env.height;
    const sx = normX * env.resolution;
    const sy = (1 - normY) * env.resolution; // Invert Y
    const sr = (safeZoneAtTick.radius / env.width) * env.resolution;

    if (sr > 0 && isFinite(sx) && isFinite(sy)) {
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, 2 * Math.PI);
        ctx.stroke();
    }
    mapTexture.update();
}

function updateCameraAndPlane(config: EriscapeConfig) {
     if (!camera || !plane || !scene) return;

     // Update Plane size
     // For simplicity, let's dispose and recreate the plane if size changes
     // More advanced: update vertices or use scaling (but scaling might distort texture)
     if (plane.scaling.x !== config.width || plane.scaling.y !== config.height) {
         console.log("[Eriscape] Recreating plane due to size change.");
         const oldMaterial = plane.material;
         plane.dispose();
         plane = MeshBuilder.CreatePlane("mapPlane", { width: config.width, height: config.height }, scene);
         plane.rotation.x = Math.PI / 2;
         plane.material = oldMaterial; // Reassign material
         plane.position = new Vector3(config.width / 2, 0, config.height / 2);
     }
      // Center plane
     plane.position.set(config.width / 2, 0, config.height / 2);


    // Update Camera target and position based on new dimensions
    const center = new Vector3(config.width / 2, 0, config.height / 2);
    camera.setTarget(center);
    // Adjust camera distance based on map size to keep it roughly in view
    camera.radius = Math.max(config.width, config.height) * 1.2; // Adjust multiplier as needed
    camera.alpha = -Math.PI / 2; // Look from top-down initially
    camera.beta = Math.PI / 4;   // Angle down slightly
}

// --- Initialization and Main Logic ---

function initializeApp() {
    // Get DOM elements
    canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    inputSeed = document.getElementById("config-seed") as HTMLInputElement;
    inputWidth = document.getElementById("config-width") as HTMLInputElement;
    inputHeight = document.getElementById("config-height") as HTMLInputElement;
    inputResolution = document.getElementById("config-resolution") as HTMLInputElement;
    inputNoiseScale = document.getElementById("config-noiseScale") as HTMLInputElement;
    inputMaxElevation = document.getElementById("config-maxElevation") as HTMLInputElement;
    btnRegenerate = document.getElementById("btn-regenerate") as HTMLButtonElement;
    btnSave = document.getElementById("btn-save") as HTMLButtonElement;
    statusMessage = document.getElementById("status-message") as HTMLDivElement;
    timeSlider = document.getElementById("timeSlider") as HTMLInputElement;
    timeLabel = document.getElementById("timeLabel") as HTMLDivElement;

     if (!canvas || !inputSeed || !inputWidth || !inputHeight || !inputResolution ||
         !inputNoiseScale || !inputMaxElevation || !btnRegenerate || !btnSave || !statusMessage || !timeSlider || !timeLabel) {
        console.error("One or more UI elements not found!");
        alert("Initialization Error: Could not find all required UI elements.");
        return;
    }

    // Load config and update UI
    loadConfig();

    // Setup Babylon Engine and Scene
    engine = new Engine(canvas, true);
    scene = new Scene(engine);
    scene.clearColor = new Color3(0.1, 0.1, 0.2).toColor4();

    // Create ArcRotateCamera (allows user control)
    camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 4, 150, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.minZ = 0.1;
    camera.wheelPrecision = 10; // Adjust zoom speed
    camera.lowerRadiusLimit = 20;
    camera.upperRadiusLimit = 500;


    const light = new HemisphericLight("light", new Vector3(0.1, 1, 0.2), scene);
    light.intensity = 0.9;

    // Create initial plane and material
    plane = MeshBuilder.CreatePlane("mapPlane", { width: currentConfig.width, height: currentConfig.height }, scene);
    plane.rotation.x = Math.PI / 2;
    const mapMaterial = new StandardMaterial("mapMat", scene);
    mapMaterial.backFaceCulling = false;
    mapMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
    mapMaterial.ambientColor = new Color3(0.8, 0.8, 0.8);
    plane.material = mapMaterial;

    // Initial generation and rendering
    regenerateMap(); // Call regenerate which now handles initial setup

    // Add Event Listeners
    btnRegenerate.addEventListener("click", regenerateMap);
    btnSave.addEventListener("click", saveConfig);
    timeSlider.addEventListener("input", () => {
        const tick = Number(timeSlider.value);
        timeLabel.textContent = `Time: ${tick} / ${currentConfig.tFinal}`;
        const currentSafeZone = computeSafeZoneAtTime(envMap, tick, currentConfig.tFinal);
        updateMapTexture(envMap, currentSafeZone); // Update texture on slider change
    });

    // Run Render Loop
    engine.runRenderLoop(() => {
        scene.render();
    });
    window.addEventListener("resize", () => {
        engine.resize();
    });

    // Inspector Toggle
    window.addEventListener("keydown", (ev) => {
        if (ev.shiftKey && ev.ctrlKey && ev.altKey && ev.key === 'I') {
            if (scene.debugLayer.isVisible()) {
                scene.debugLayer.hide();
            } else {
                scene.debugLayer.show({ embedMode: true });
            }
        }
    });

     showStatus("Eriscape Configurator Initialized.");
}

// The main function to regenerate the map based on UI/currentConfig
function regenerateMap() {
    console.log("[Eriscape] Regenerating map...");
    if (!readConfigFromUI()) {
         showStatus("Regeneration cancelled due to invalid input.", true);
        return; // Don't regenerate if input is invalid
    }

    // 1. Create Noise Generator based on current seed
    const noiseGenerator = createNoise2D(mulberry32(currentConfig.seed));

    // 2. Initialize Map Data Structure
    envMap = initializeEnvironmentMap(currentConfig);

    // 3. Generate Heightmap & Conditions
    generateHeightMap(envMap, currentConfig.noiseScale, currentConfig.maxElevation, noiseGenerator);
    assignSurfaceConditions(envMap, currentConfig.maxElevation);

    // 4. Update Camera & Plane (size and position)
    updateCameraAndPlane(currentConfig); // Adjust camera based on new dimensions

    // 5. Update Texture
    const currentSafeZone = computeSafeZoneAtTime(envMap, Number(timeSlider.value), currentConfig.tFinal);
    updateMapTexture(envMap, currentSafeZone); // Create/Update the texture

    // 6. Update Time Slider max if needed (though tFinal isn't editable here yet)
    timeSlider.max = currentConfig.tFinal.toString();
    timeLabel.textContent = `Time: ${timeSlider.value} / ${currentConfig.tFinal}`;

    showStatus("Map regenerated successfully.");
}


// --- Start the Application ---
document.addEventListener('DOMContentLoaded', initializeApp);
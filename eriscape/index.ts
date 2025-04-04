// Eriscape/index.ts - Interactive Configurator V2 (Typo Corrected Again)

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, MeshBuilder,
  StandardMaterial, Color3, Vector3, DynamicTexture, Scalar, Mesh
} from "@babylonjs/core";
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";
import "@babylonjs/core/Materials/Textures/texture";
import { createNoise2D, type RandomFn } from "simplex-noise";

// --- Interfaces ---

type BiomeType = "plains" | "forest" | "swamp" | "tundra" | "tropical"; // Example
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

// Structure for storing parameter ranges
interface Range { min: number; max: number; }

// Configuration structure matching UI inputs, now with ranges
interface EriscapeConfig {
    name: string; // Name of the preset
    seed: string;
    width: number;
    height: number;
    resolution: number;
    noiseScale: Range;
    maxElevation: Range;
    // Add other parameters as needed (e.g., surface condition thresholds)
    tFinal: number; // Total simulation time ticks (for slider) - Keep single value for now
}

// --- Constants & Global State ---

const LOCAL_STORAGE_PRESETS_KEY = 'eriscapePresets';
const LOCAL_STORAGE_LAST_PRESET_KEY = 'eriscapeLastPreset';

const DEFAULT_PRESETS: { [key: string]: EriscapeConfig } = {
    "Default": {
        name: "Default",
        seed: "eriscape_default_seed",
        width: 100, height: 100, resolution: 200,
        noiseScale: { min: 0.04, max: 0.06 },
        maxElevation: { min: 15, max: 25 },
        tFinal: 18000,
    },
    "Hilly Plains": {
        name: "Hilly Plains",
        seed: "plains_more_hills",
        width: 120, height: 120, resolution: 250,
        noiseScale: { min: 0.07, max: 0.09 },
        maxElevation: { min: 30, max: 50 },
        tFinal: 18000,
    },
    "Custom": { // A slot for user modifications
        name: "Custom",
        seed: "my_custom_map",
        width: 80, height: 80, resolution: 150,
        noiseScale: { min: 0.05, max: 0.05 },
        maxElevation: { min: 10, max: 15 },
        tFinal: 18000,
    }
};

let allPresets: { [key: string]: EriscapeConfig } = {}; // Loaded presets
let currentPresetName: string = "Default"; // Name of the active preset
let currentActualConfig: EriscapeConfig; // The specific config used for the *last* generation (with randomized values)

let engine: Engine;
let scene: Scene;
let envMap: EnvironmentMap;
let mapTexture: DynamicTexture | null = null;
let plane: Mesh | null = null;
let camera: ArcRotateCamera;

// --- DOM Element References ---
let canvas: HTMLCanvasElement;
let presetSelect: HTMLSelectElement;
let inputSeed: HTMLInputElement;
let inputWidth: HTMLInputElement;
let inputHeight: HTMLInputElement;
let inputResolution: HTMLInputElement;
let inputNoiseScaleMin: HTMLInputElement;
let inputNoiseScaleMax: HTMLInputElement;
let inputMaxElevationMin: HTMLInputElement;
let inputMaxElevationMax: HTMLInputElement;
let btnRegenerate: HTMLButtonElement;
let btnSavePreset: HTMLButtonElement;
let btnCopyJson: HTMLButtonElement;
let btnRandomSeed: HTMLButtonElement;
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

function computeSafeZoneAtTime(
  env: EnvironmentMap,
  t: number,
  tFinal: number
): { x: number; y: number; radius: number } {
  // If you want a simple linear interpolation:
  const fraction = tFinal === 0 ? 0 : t / tFinal; // avoid divide-by-zero
  const { start, end } = env.safeZone;

  // Interpolate X
  const x = start.x + fraction * (end.x - start.x);
  // Interpolate Y
  const y = start.y + fraction * (end.y - start.y);
  // Interpolate Radius
  const radius = start.radius + fraction * (end.radius - start.radius);

  return { x, y, radius };
}


function showStatus(message: string, isError = false) {
    if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.style.color = isError ? 'var(--error-color)' : 'var(--success-color)';
        setTimeout(() => {
             if (statusMessage.textContent === message) statusMessage.textContent = '';
        }, 3000);
    }
    if (isError) { console.error("[Eriscape Status]", message); }
    else { console.log("[Eriscape Status]", message); }
}

function getRandomInRange(range: Range): number {
    if (range.min === range.max) return range.min;
    const min = Math.min(range.min, range.max);
    const max = Math.max(range.min, range.max);
    return min + Math.random() * (max - min);
}


function generateRandomSeed(): string {
    return "seed_" + Math.random().toString(36).substring(2, 10);
}

// --- Config Load/Save/UI ---

function loadPresets() {
    console.log("[Eriscape] Loading presets from Local Storage...");
    try {
        const savedPresetsJson = localStorage.getItem(LOCAL_STORAGE_PRESETS_KEY);
        if (savedPresetsJson) {
            const savedPresets = JSON.parse(savedPresetsJson);
            if (typeof savedPresets === 'object' && savedPresets !== null) {
                 allPresets = { ...DEFAULT_PRESETS, ...savedPresets };
                 for (const key in DEFAULT_PRESETS) {
                     if (!allPresets[key]) allPresets[key] = DEFAULT_PRESETS[key];
                 }
                 console.log("[Eriscape] Loaded presets:", Object.keys(allPresets));
                 showStatus("Loaded presets.");
            } else { throw new Error("Invalid data format."); }
        } else {
            console.log("[Eriscape] No saved presets found, using defaults.");
            allPresets = { ...DEFAULT_PRESETS };
        }
    } catch (error) {
        showStatus(`Error loading presets: ${error}. Using defaults.`, true);
        allPresets = { ...DEFAULT_PRESETS };
    }

    currentPresetName = localStorage.getItem(LOCAL_STORAGE_LAST_PRESET_KEY) || "Default";
    if (!allPresets[currentPresetName]) {
        currentPresetName = "Default";
    }

    populatePresetDropdown();
    loadPresetIntoUI(currentPresetName);
}

function saveAllPresets() {
    console.log("[Eriscape] Saving all presets to Local Storage...");
    try {
        if (currentPresetName === "Custom") {
             updatePresetFromUI("Custom");
        }
        const presetsJson = JSON.stringify(allPresets);
        localStorage.setItem(LOCAL_STORAGE_PRESETS_KEY, presetsJson);
        localStorage.setItem(LOCAL_STORAGE_LAST_PRESET_KEY, currentPresetName);
        showStatus("All presets saved.");
    } catch (error) {
        showStatus(`Error saving presets: ${error}`, true);
    }
}

function updatePresetFromUI(presetName: string): boolean {
     console.log(`[Eriscape] Reading UI values into preset: ${presetName}`);
     let targetPreset = allPresets[presetName];
      if (!targetPreset && presetName !== "TemporaryCopyToClipboard") {
          showStatus(`Preset "${presetName}" not found for saving.`, true);
          return false;
      }
      if (!targetPreset && presetName === "TemporaryCopyToClipboard") {
          targetPreset = {} as EriscapeConfig; // Create temporary object
      }


    const width = parseInt(inputWidth.value, 10);
    const height = parseInt(inputHeight.value, 10);
    const resolution = parseInt(inputResolution.value, 10);
    const noiseScaleMin = parseFloat(inputNoiseScaleMin.value);
    const noiseScaleMax = parseFloat(inputNoiseScaleMax.value);
    const maxElevationMin = parseInt(inputMaxElevationMin.value, 10);
    const maxElevationMax = parseInt(inputMaxElevationMax.value, 10);
    const seed = inputSeed.value.trim();

    let isValid = true;
    let errorMsg = "";
    if (isNaN(width) || width < 10) { isValid = false; errorMsg = "Invalid Width (min 10)."; }
    else if (isNaN(height) || height < 10) { isValid = false; errorMsg = "Invalid Height (min 10)."; }
    else if (isNaN(resolution) || resolution < 10) { isValid = false; errorMsg = "Invalid Resolution (min 10)."; }
    else if (isNaN(noiseScaleMin) || noiseScaleMin <= 0) { isValid = false; errorMsg = "Invalid Noise Scale Min (> 0)."; }
    else if (isNaN(noiseScaleMax) || noiseScaleMax < noiseScaleMin) { isValid = false; errorMsg = "Noise Scale Max < Min."; }
    else if (isNaN(maxElevationMin) || maxElevationMin < 1) { isValid = false; errorMsg = "Invalid Max Elevation Min (>= 1)."; }
    else if (isNaN(maxElevationMax) || maxElevationMax < maxElevationMin) { isValid = false; errorMsg = "Max Elevation Max < Min."; }
    else if (!seed) { isValid = false; errorMsg = "Seed cannot be empty."; }

    if (isValid) {
        targetPreset.seed = seed;
        targetPreset.width = width;
        targetPreset.height = height;
        targetPreset.resolution = resolution;
        targetPreset.noiseScale = { min: noiseScaleMin, max: noiseScaleMax };
        targetPreset.maxElevation = { min: maxElevationMin, max: maxElevationMax };
        if (!targetPreset.tFinal) targetPreset.tFinal = DEFAULT_PRESETS.Default.tFinal; // Ensure tFinal exists
        if (!targetPreset.name) targetPreset.name = presetName; // Ensure name exists

        if (presetName === "TemporaryCopyToClipboard") {
            allPresets["TemporaryCopyToClipboard"] = targetPreset; // Store temporary for copy function
        }
        console.log(`[Eriscape] Updated preset data for "${presetName}".`);
        return true;
    } else {
        showStatus(errorMsg || "Invalid input values. Preset not updated.", true);
        return false;
    }
}


function populatePresetDropdown() {
    presetSelect.innerHTML = '';
    Object.keys(allPresets).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name; option.textContent = name; presetSelect.appendChild(option);
    });
    presetSelect.value = currentPresetName;
}

function loadPresetIntoUI(presetName: string) {
    let config = allPresets[presetName];
    if (!config) {
        showStatus(`Preset "${presetName}" not found. Loading defaults.`, true);
        config = DEFAULT_PRESETS["Default"]; presetName = "Default";
    }
    console.log(`[Eriscape] Loading preset "${presetName}" into UI.`);

    inputSeed.value = config.seed;
    inputWidth.value = config.width.toString();
    inputHeight.value = config.height.toString();
    inputResolution.value = config.resolution.toString();
    inputNoiseScaleMin.value = config.noiseScale.min.toString();
    inputNoiseScaleMax.value = config.noiseScale.max.toString();
    inputMaxElevationMin.value = config.maxElevation.min.toString();
    inputMaxElevationMax.value = config.maxElevation.max.toString();
    timeSlider.max = config.tFinal.toString();
    timeLabel.textContent = `Time: ${timeSlider.value} / ${config.tFinal}`;

    currentPresetName = presetName;
    presetSelect.value = presetName;

    localStorage.setItem(LOCAL_STORAGE_LAST_PRESET_KEY, currentPresetName);
}

function handlePresetChange() {
    const selectedName = presetSelect.value;
    if (currentPresetName === "Custom") {
        updatePresetFromUI("Custom");
    }
    loadPresetIntoUI(selectedName);
}

function handleRandomizeSeed() {
    inputSeed.value = generateRandomSeed();
    handleInputChange(); // Mark as custom change
}

function handleCopyJson() {
    if (!updatePresetFromUI("TemporaryCopyToClipboard")) {
         showStatus("Cannot copy invalid config.", true);
         return;
    }
    const rangesConfig = allPresets["TemporaryCopyToClipboard"];
    delete allPresets["TemporaryCopyToClipboard"];

     const jsonString = JSON.stringify(rangesConfig, null, 2);

    navigator.clipboard.writeText(jsonString)
      .then(() => { showStatus("Preset JSON copied to clipboard!"); })
      .catch(err => { showStatus(`Failed to copy: ${err}`, true); });
}

function handleInputChange() {
    if (currentPresetName !== "Custom") {
        currentPresetName = "Custom";
        presetSelect.value = "Custom";
         showStatus("Switched to Custom preset due to modification.");
         if (!allPresets["Custom"]) {
             allPresets["Custom"] = { ...DEFAULT_PRESETS["Default"], name: "Custom" };
         }
    }
}

// --- Map Generation and Visualization ---

function initializeEnvironmentMap(config: EriscapeConfig): EnvironmentMap {
    console.groupCollapsed("[Eriscape] Initializing Environment Map");
    console.log("Config:", config);
    const { width, height, resolution } = config;
    const cells: MapCell[][] = Array.from({ length: resolution }, () =>
        Array.from({ length: resolution }, () => ({
            elevation: 0, condition: "dirt", hazardLevel: 0
        }))
    );
    const safeZone = {
        start: { x: width / 2, y: height / 2, radius: width * 0.4 },
        end: { x: width / 2, y: height / 2, radius: 0 },
    };
    envMap = { width, height, resolution, biome: "plains", cells, safeZone, events: [] };
    console.log("Map Initialized");
    console.groupEnd();
    return envMap;
}

function generateHeightMap(
  env: EnvironmentMap,
  noiseScale: number,
  maxElevation: number,
  noiseFunc: (x: number, y: number) => number
): void {
    console.groupCollapsed("[Eriscape] Generating Heightmap");
    console.log(`Using noiseScale: ${noiseScale.toFixed(4)}, maxElevation: ${maxElevation.toFixed(2)}`);
    const { width, height, resolution, cells } = env;
    for (let j = 0; j < resolution; j++) {
        for (let i = 0; i < resolution; i++) {
            const u = i / (resolution > 1 ? resolution - 1 : 1);
            const v = j / (resolution > 1 ? resolution - 1 : 1);
            const worldX = u * width;
            const worldY = v * height;
            const n = noiseFunc(worldX * noiseScale, worldY * noiseScale);
            cells[j][i].elevation = ((n + 1) / 2) * maxElevation;
        }
    }
    console.groupEnd();
}

function assignSurfaceConditions(env: EnvironmentMap, maxElevation: number): void {
    console.groupCollapsed("[Eriscape] Assigning Surface Conditions");
    console.log(`Based on maxElevation: ${maxElevation.toFixed(2)}`);
    const { cells } = env;
    const resolution = cells.length;
    const mudThreshold = maxElevation * 0.3;
    const rockThreshold = maxElevation * 0.6;
    for (let j = 0; j < resolution; j++) {
        for (let i = 0; i < resolution; i++) {
            const elev = cells[j][i].elevation;
            cells[j][i].condition = elev < mudThreshold ? "mud" : elev < rockThreshold ? "dirt" : "rock";
        }
    }
     console.groupEnd();
}

function updateMapTexture(env: EnvironmentMap, safeZoneAtTick: { x: number; y: number; radius: number }): void {
    console.groupCollapsed("[Eriscape] Updating Map Texture");
    if (!scene || !envMap || !currentActualConfig) { // Added envMap/currentActualConfig check
        console.log("Scene, envMap, or currentActualConfig not ready.");
        console.groupEnd();
        return;
    }

    const neededSize = env.resolution;
    if (!mapTexture || mapTexture.getSize().width !== neededSize) {
        if (mapTexture) mapTexture.dispose();
        mapTexture = new DynamicTexture("mapTexture", { width: neededSize, height: neededSize }, scene, false);
        console.log("Created/Resized Dynamic Texture to:", neededSize);
         if(plane?.material instanceof StandardMaterial) {
             plane.material.diffuseTexture = mapTexture;
         } else if (plane) { console.warn("Plane exists but material is not StandardMaterial?"); }
    }

    const ctx = mapTexture.getContext();
    ctx.clearRect(0, 0, neededSize, neededSize);

    const currentMaxElev = currentActualConfig.maxElevation.max; // Use actual max elev for scaling
    for (let j = 0; j < neededSize; j++) {
        for (let i = 0; i < neededSize; i++) {
            const cell = env.cells[j]?.[i];
            if (!cell) continue;

            const intensity = Scalar.Clamp(cell.elevation / currentMaxElev, 0, 1); // Normalize with actual max
            let r = Math.floor(intensity * 255), g = r, b = r;
            if (cell.condition === "mud") { r = Math.floor(r*0.6); g = Math.floor(g*0.7); b = Math.floor(b*0.5); }
            if (cell.condition === "rock") { r = Math.floor(r*1.1); g = Math.floor(g*1.1); b = Math.floor(b*1.1); }
            r = Math.min(255, Math.max(0, r)); g = Math.min(255, Math.max(0, g)); b = Math.min(255, Math.max(0, b));
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(i, neededSize - 1 - j, 1, 1);
        }
     }

    ctx.strokeStyle = "red";
    ctx.lineWidth = Math.max(1, Math.floor(neededSize / 150));
    const normX = safeZoneAtTick.x / env.width;
    const normY = safeZoneAtTick.y / env.height;
    const sx = normX * neededSize;
    const sy = (1 - normY) * neededSize;
    const sr = (safeZoneAtTick.radius / env.width) * neededSize;

    if (sr > 0 && isFinite(sx) && isFinite(sy)) {
        ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 2 * Math.PI); ctx.stroke();
    }
    mapTexture.update();
    console.groupEnd();
}

function updateCameraAndPlane(config: EriscapeConfig) {
     console.groupCollapsed("[Eriscape] Updating Camera and Plane");
     console.log("Target Config:", config);
     if (!camera || !scene) { console.log("Scene/Camera not ready."); console.groupEnd(); return; }

     const planeExists = !!plane;
     const currentWidth = planeExists ? (plane.metadata?.width ?? config.width) : 0;
     const currentHeight = planeExists ? (plane.metadata?.height ?? config.height) : 0;

     if (!planeExists || currentWidth !== config.width || currentHeight !== config.height) {
         console.log(`Recreating plane. Existed: ${planeExists}, Old: ${currentWidth}x${currentHeight}, New: ${config.width}x${config.height}`);
         const oldMaterial = plane?.material;
         if (plane) plane.dispose();

         plane = MeshBuilder.CreatePlane("mapPlane", { width: config.width, height: config.height }, scene);
         plane.rotation.x = Math.PI / 2;
         plane.metadata = { width: config.width, height: config.height };

         if (oldMaterial) { plane.material = oldMaterial; }
         else {
             const mapMaterial = new StandardMaterial("mapMat", scene);
             mapMaterial.backFaceCulling = false; mapMaterial.specularColor = new Color3(0.1, 0.1, 0.1); mapMaterial.ambientColor = new Color3(0.8, 0.8, 0.8);
             plane.material = mapMaterial; console.log("Created new material for plane.");
         }
         if (mapTexture && plane.material instanceof StandardMaterial) { plane.material.diffuseTexture = mapTexture; }

     } else { console.log("Plane size unchanged."); }
     plane.position.set(config.width / 2, 0, config.height / 2);
     console.log("Plane Position:", plane.position);

    const center = new Vector3(config.width / 2, 0, config.height / 2);
    if (!camera.target.equalsWithEpsilon(center, 0.1)) {
         console.log("Updating Camera Target:", center); camera.setTarget(center);
    }
    const targetRadius = Math.max(config.width, config.height) * 1.2;
     if (Math.abs(camera.radius - targetRadius) > 0.1) {
         console.log("Updating Camera Radius:", targetRadius); camera.radius = targetRadius;
     }
     console.groupEnd();
}

// --- Initialization ---

function initializeApp() {
    console.log("[Eriscape] Initializing Application...");
    // Get DOM elements
    canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    presetSelect = document.getElementById("preset-select") as HTMLSelectElement;
    inputSeed = document.getElementById("config-seed") as HTMLInputElement;
    inputWidth = document.getElementById("config-width") as HTMLInputElement;
    inputHeight = document.getElementById("config-height") as HTMLInputElement;
    inputResolution = document.getElementById("config-resolution") as HTMLInputElement;
    inputNoiseScaleMin = document.getElementById("config-noiseScale-min") as HTMLInputElement;
    inputNoiseScaleMax = document.getElementById("config-noiseScale-max") as HTMLInputElement;
    inputMaxElevationMin = document.getElementById("config-maxElevation-min") as HTMLInputElement;
    inputMaxElevationMax = document.getElementById("config-maxElevation-max") as HTMLInputElement;
    btnRegenerate = document.getElementById("btn-regenerate") as HTMLButtonElement;
    btnSavePreset = document.getElementById("btn-save-preset") as HTMLButtonElement;
    btnCopyJson = document.getElementById("btn-copy-json") as HTMLButtonElement;
    btnRandomSeed = document.getElementById("btn-random-seed") as HTMLButtonElement;
    statusMessage = document.getElementById("status-message") as HTMLDivElement;
    timeSlider = document.getElementById("timeSlider") as HTMLInputElement;
    timeLabel = document.getElementById("timeLabel") as HTMLDivElement;

     if (!canvas || !presetSelect || !inputSeed || !inputWidth || !inputHeight || !inputResolution ||
         !inputNoiseScaleMin || !inputNoiseScaleMax || !inputMaxElevationMin || !inputMaxElevationMax ||
         !btnRegenerate || !btnSavePreset || !btnCopyJson || !btnRandomSeed || !statusMessage || !timeSlider || !timeLabel) {
        alert("Initialization Error: Could not find all required UI elements. Check HTML IDs.");
        return;
    }

    loadPresets();

    engine = new Engine(canvas, true);
    scene = new Scene(engine);
    scene.clearColor = new Color3(0.1, 0.1, 0.2).toColor4();

    camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 4, 150, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.minZ = 0.1; camera.wheelPrecision = 20; camera.lowerRadiusLimit = 10; camera.upperRadiusLimit = 1000;

    const light = new HemisphericLight("light", new Vector3(0.1, 1, 0.2), scene); light.intensity = 0.9;

    // Initial generation will create the plane and material
    regenerateMap(); // This will now use the loaded preset config

    // Add Event Listeners
    presetSelect.addEventListener("change", handlePresetChange);
    btnRegenerate.addEventListener("click", regenerateMap);
    btnSavePreset.addEventListener("click", () => {
        if (updatePresetFromUI(currentPresetName)) { saveAllPresets(); }
    });
    btnCopyJson.addEventListener("click", handleCopyJson);
    btnRandomSeed.addEventListener("click", handleRandomizeSeed);
    timeSlider.addEventListener("input", () => {
        if (!envMap || !currentActualConfig) return;
        const tick = Number(timeSlider.value);
        timeLabel.textContent = `Time: ${tick} / ${currentActualConfig.tFinal}`;
        // *** CORRECTED FUNCTION CALL in Listener ***
        const currentSafeZone = computeSafeZoneAtTime(envMap, tick, currentActualConfig.tFinal);
        updateMapTexture(envMap, currentSafeZone);
    });

    [inputSeed, inputWidth, inputHeight, inputResolution, inputNoiseScaleMin, inputNoiseScaleMax, inputMaxElevationMin, inputMaxElevationMax].forEach(input => {
        input.addEventListener('input', handleInputChange);
    });

    engine.runRenderLoop(() => { scene.render(); });
    window.addEventListener("resize", () => { engine.resize(); });
    window.addEventListener("keydown", (ev) => {
        if (ev.shiftKey && ev.ctrlKey && ev.altKey && ev.key === 'I') {
            if (scene.debugLayer.isVisible()) { scene.debugLayer.hide(); }
            else { scene.debugLayer.show({ embedMode: true }); }
        }
     });

     showStatus("Eriscape Configurator Initialized.");
     console.log("[Eriscape] Initialization Complete.");
}

// --- Main Regeneration Function ---
function regenerateMap() {
    console.group("[Eriscape] ==== Regenerating Map ====");
    showStatus("Generating...");
    btnRegenerate.disabled = true;

    const baseConfig = allPresets[currentPresetName];
    if (!baseConfig) {
        showStatus(`Error: Preset "${currentPresetName}" not found!`, true);
        btnRegenerate.disabled = false; console.groupEnd(); return;
    }

    // *** Ensure timeSlider exists before accessing its value ***
    const currentTickValue = timeSlider ? Number(timeSlider.value) : 0;

    // 1. Determine Actual Parameters
    const actualSeed = baseConfig.seed; // Use the explicit seed from the preset/UI
    const actualWidth = baseConfig.width;
    const actualHeight = baseConfig.height;
    const actualResolution = baseConfig.resolution;
    const actualNoiseScale = getRandomInRange(baseConfig.noiseScale);
    const actualMaxElevation = getRandomInRange(baseConfig.maxElevation);
    const actualTFinal = baseConfig.tFinal;

    currentActualConfig = {
        name: `${baseConfig.name} (Generated)`, seed: actualSeed, width: actualWidth, height: actualHeight, resolution: actualResolution,
        noiseScale: {min: actualNoiseScale, max: actualNoiseScale },
        maxElevation: {min: actualMaxElevation, max: actualMaxElevation },
        tFinal: actualTFinal
    };
     console.log("Using actual parameters:", currentActualConfig);

    // 2. Create Noise Generator
    const noiseGenerator = createNoise2D(mulberry32(actualSeed)); // Use the actual seed

    // 3. Initialize Map Data Structure
    const newEnvMap = initializeEnvironmentMap(currentActualConfig);

    // 4. Generate Heightmap & Conditions
    generateHeightMap(newEnvMap, actualNoiseScale, actualMaxElevation, noiseGenerator);
    assignSurfaceConditions(newEnvMap, actualMaxElevation);
    envMap = newEnvMap; // Update the global envMap

    // 5. Update Camera & Plane
    updateCameraAndPlane(currentActualConfig);

    // 6. Update Texture
    if (timeSlider) timeSlider.max = actualTFinal.toString(); // Check if slider exists
    if (timeLabel) timeLabel.textContent = `Time: ${currentTickValue} / ${actualTFinal}`; // Check if label exists
    // *** CORRECTED FUNCTION CALL ***
    const currentSafeZone = computeSafeZoneAtTime(envMap, currentTickValue, actualTFinal);
    updateMapTexture(envMap, currentSafeZone);

    showStatus("Map regenerated successfully.");
    btnRegenerate.disabled = false;
    console.groupEnd();
}


// --- Start the Application ---
document.addEventListener('DOMContentLoaded', initializeApp);
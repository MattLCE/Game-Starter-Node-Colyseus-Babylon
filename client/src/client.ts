import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader";
import "@babylonjs/core/Meshes/Builders/groundBuilder";

import * as Colyseus from "colyseus.js";
import { MyRoomState, PlayerState } from "../../server/src/myroom";
import { createNoise2D, RandomFn } from "simplex-noise";

// --- Helper: Simple Seeded PRNG (Mulberry32) ---
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

// --- Global Variables ---
let engine: Engine;
let scene: Scene;
let camera: FreeCamera;
let client: Colyseus.Client;
let room: Colyseus.Room<MyRoomState> | null = null;
const playerMeshMap = new Map<string, Mesh>();
let terrainMesh: Mesh | null = null;
let placeholderPlayerMesh: Mesh | null = null;
const inputState = {
  left: false,
  right: false,
  forward: false,
  backward: false,
};
const noiseScaleFactor = 0.1;

// --- Initialization ---
function initializeApp() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) {
    console.error("Canvas not found!");
    return;
  }
  engine = new Engine(canvas, true);
  scene = new Scene(engine);
  scene.clearColor = new Color4(0.2, 0.3, 0.4, 1.0);
  camera = new FreeCamera("camera1", new Vector3(0, 10, -15), scene);
  camera.setTarget(new Vector3(0, 0, 0));
  camera.attachControl(canvas, true);
  camera.speed = 0.5;
  camera.upperBetaLimit = Math.PI / 2 - 0.1;
  const light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
  light.intensity = 0.8;
  engine.runRenderLoop(() => {
    if (scene) {
      scene.render();
    }
  });
  window.addEventListener("resize", () => {
    engine.resize();
  });
  setupInputListeners();
  void loadPlaceholderAsset();
  initializeColyseus();
}

// --- Asset Loading ---
async function loadPlaceholderAsset() {
  try {
    console.log("Loading placeholder player asset (rubberDuck.glb)...");
    const r = await SceneLoader.ImportMeshAsync(
      "",
      "/assets/models/",
      "rubberDuck.glb",
      scene
    );
    if (r.meshes.length > 0) {
      const m = r.meshes[0] as Mesh;
      m.name = "placeholderPlayerTemplate";
      m.setEnabled(false);
      placeholderPlayerMesh = m;
      console.log("Placeholder loaded.");
    } else {
      console.warn("Placeholder GLB empty.");
    }
  } catch (error) {
    console.error("Failed loading placeholder:", error);
    displayConnectionError("Failed to load player model.");
  }
}

// --- Procedural Terrain Generation ---
function createOrUpdateTerrain(state: MyRoomState, scene: Scene) {
  if (terrainMesh) {
    console.log("[Client WG] Disposing old terrain.");
    terrainMesh.dispose();
    terrainMesh = null;
  }

  console.log("[Client WG] Received state for terrain:", {
    seed: state.worldSeed,
    width: state.terrainWidth,
    height: state.terrainHeight,
    subdivisions: state.terrainSubdivisions,
    scale: state.heightScale,
  });
  const seed = state.worldSeed;
  const terrainWidth = Number(state.terrainWidth);
  const terrainHeight = Number(state.terrainHeight);
  let terrainSubdivisions = Math.floor(Number(state.terrainSubdivisions));
  const heightScale = Number(state.heightScale);

  // --- Input Validation ---
  if (
    !seed ||
    !terrainWidth ||
    !terrainHeight ||
    !terrainSubdivisions ||
    !heightScale ||
    isNaN(terrainWidth) ||
    isNaN(terrainHeight) ||
    isNaN(terrainSubdivisions) ||
    isNaN(heightScale) ||
    terrainWidth <= 0 ||
    terrainHeight <= 0 ||
    terrainSubdivisions <= 0 ||
    heightScale <= 0
  ) {
    console.error(
      "[Client WG] Invalid terrain parameters received. Aborting.",
      { seed, terrainWidth, terrainHeight, terrainSubdivisions, heightScale }
    );
    if (terrainSubdivisions <= 0) {
      console.warn("[Client WG] Subdivisions <= 0, defaulting to 1.");
      terrainSubdivisions = 1;
      if (
        !seed ||
        !terrainWidth ||
        !terrainHeight ||
        !heightScale ||
        isNaN(terrainWidth) ||
        isNaN(terrainHeight) ||
        isNaN(heightScale) ||
        terrainWidth <= 0 ||
        terrainHeight <= 0 ||
        heightScale <= 0
      ) {
        return;
      }
    } else {
      return;
    }
  }
  // --- End Input Validation ---

  console.log(`[Client WG] Generating terrain mesh using seed: ${seed}`);
  const noise2D = createNoise2D(mulberry32(seed));
  const points = terrainSubdivisions + 1;
  const heightMapJsArray: number[] = []; // Generate as standard JS array first

  for (let j = 0; j < points; j++) {
    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * terrainWidth - terrainWidth / 2;
      const z = (j / (points - 1)) * terrainHeight - terrainHeight / 2;
      const nVal = noise2D(x * noiseScaleFactor, z * noiseScaleFactor);
      const h = ((nVal + 1) / 2) * heightScale;
      heightMapJsArray.push(h);
    }
  }

  // --- Data Validation ---
  const expectedLength = points * points;
  let dataIsValid = true;
  if (heightMapJsArray.length !== expectedLength) {
    console.error(
      `[Client WG] Heightmap length mismatch! Expected ${expectedLength}, Got ${heightMapJsArray.length}.`
    );
    dataIsValid = false;
  } else {
    for (let k = 0; k < heightMapJsArray.length; k++) {
      if (!Number.isFinite(heightMapJsArray[k])) {
        console.error(
          `[Client WG] Invalid value in heightMap at index ${k}: ${heightMapJsArray[k]}.`
        );
        dataIsValid = false;
        break;
      }
    }
  }
  if (!dataIsValid) {
    console.error("[Client WG] Heightmap validation failed.");
    return;
  }
  // --- End Data Validation ---

  // ***** Convert to Float32Array *****
  const heightMapFloat32 = new Float32Array(heightMapJsArray);
  console.log(
    `[Client WG] Converted heightmap to Float32Array (length: ${heightMapFloat32.length})`
  );
  // ***** End Conversion *****

  // --- Create Mesh ---
  const groundOptions = {
    width: terrainWidth,
    height: terrainHeight,
    subdivisions: terrainSubdivisions,
    minHeight: 0,
    maxHeight: heightScale,
    updatable: false,
  };
  console.log(
    "[Client WG] Calling CreateGroundFromHeightMap with options:",
    groundOptions
  );
  try {
    // ***** Use the Float32Array *****
    console.log("[Client WG] heightMapFloat32:", heightMapFloat32);
    console.log("[Client WG] heightMapFloat32 length:", heightMapFloat32.length);
    console.log("[Client WG] heightMapFloat32 type:", heightMapFloat32.constructor.name);
    terrainMesh = MeshBuilder.CreateGroundFromHeightMap(
      "terrain",
      heightMapFloat32,
      groundOptions,
      scene
    );
  } catch (meshError) {
    console.error(
      "[Client WG] Error during CreateGroundFromHeightMap:",
      meshError
    );
    return;
  }
  // --- End Create Mesh ---

  // --- Apply Material ---
  const mat = new StandardMaterial("terrainMat", scene);
  try {
    const tex = new Texture("/assets/textures/grass.jpg", scene);
    tex.uScale = terrainWidth / 4;
    tex.vScale = terrainHeight / 4;
    mat.diffuseTexture = tex;
  } catch (e) {
    console.error("Failed loading grass texture:", e);
    mat.diffuseColor = new Color3(0.3, 0.6, 0.3);
  }
  terrainMesh.material = mat;
  terrainMesh.receiveShadows = true;
  console.log("[Client WG] Terrain mesh created successfully.");
  // --- End Apply Material ---
}

// --- Colyseus Connection ---
function initializeColyseus() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const endpoint = `${proto}://${host}`;
  console.log(`[Colyseus] Connecting to: ${endpoint}`);
  client = new Colyseus.Client(endpoint);
  void connectToRoom();
}
async function connectToRoom() {
  try {
    console.log("[Colyseus] Joining 'my_room'...");
    room = await client.joinOrCreate<MyRoomState>("my_room");
    console.log(`[Colyseus] Joined! Session ID: ${room.sessionId}`);
    console.log("[Colyseus] Initial state:", room.state.toJSON());
    setupRoomListeners();
  } catch (e) {
    console.error("[Colyseus] Join failed:", e);
    displayConnectionError(e);
  }
}
function setupRoomListeners() {
  if (!room) return;
  console.log("[Colyseus] Setting up listeners...");
  let isFirstState = true;
  room.onStateChange((state: MyRoomState) => {
    if (isFirstState) {
      createOrUpdateTerrain(state, scene);
      isFirstState = false;
    }
    const serverIds = new Set(state.players.keys());
    state.players.forEach((playerState: PlayerState, sessionId) => {
      let mesh = playerMeshMap.get(sessionId);
      if (!mesh) {
        if (placeholderPlayerMesh) {
          mesh =
            placeholderPlayerMesh.clone(`player_${sessionId}`, null, true) ??
            undefined;
          if (mesh) {
            mesh.setEnabled(true);
            mesh.position = new Vector3(
              playerState.x,
              playerState.y,
              playerState.z
            );
            playerMeshMap.set(sessionId, mesh);
            if (sessionId === room?.sessionId) {
              console.log(`[Camera] Attaching to ${sessionId}`);
              camera.position = new Vector3(0, 1.5, -5);
              camera.parent = mesh;
            }
          } else {
            console.error(`[Sync] Clone fail ${sessionId}`);
          }
        } else {
          return;
        }
      }
      if (mesh && sessionId !== room?.sessionId) {
        mesh.position.set(playerState.x, playerState.y, playerState.z);
      }
    });
    playerMeshMap.forEach((mesh, sessionId) => {
      if (!serverIds.has(sessionId)) {
        console.log(`[Sync] Removing ${sessionId}`);
        if (camera.parent === mesh) {
          camera.parent = null;
          console.log(`[Camera] Detached`);
        }
        mesh.dispose();
        playerMeshMap.delete(sessionId);
      }
    });
  });
  room.onError((code, message) => {
    console.error(`[Colyseus] Error (${code}): ${message}`);
  });
  room.onLeave((code) => {
    console.log(`[Colyseus] Left (code: ${code})`);
    room = null;
    playerMeshMap.forEach((mesh) => mesh.dispose());
    playerMeshMap.clear();
    if (terrainMesh) terrainMesh.dispose();
    terrainMesh = null;
    if (camera) camera.parent = null;
    displayConnectionError(`Disconnected (code: ${code})`);
  });
  setInterval(sendInput, 50);
  console.log("[Colyseus] Listeners attached.");
}

// --- Input Handling ---
function setupInputListeners() {
  window.addEventListener("keydown", (e) => {
    switch (e.key.toLowerCase()) {
      case "w":
        inputState.forward = true;
        break;
      case "a":
        inputState.left = true;
        break;
      case "s":
        inputState.backward = true;
        break;
      case "d":
        inputState.right = true;
        break;
    }
  });
  window.addEventListener("keyup", (e) => {
    switch (e.key.toLowerCase()) {
      case "w":
        inputState.forward = false;
        break;
      case "a":
        inputState.left = false;
        break;
      case "s":
        inputState.backward = false;
        break;
      case "d":
        inputState.right = false;
        break;
    }
  });
}
function sendInput() {
  if (room?.connection.isOpen) {
    room.send("input", inputState);
  }
}

// --- Error Display ---
function displayConnectionError(error: any) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("Conn Error:", msg);
  let d = document.getElementById("connectionError");
  if (!d) {
    d = document.createElement("div");
    d.id = "connectionError";
    d.style.position = "absolute";
    d.style.top = "10px";
    d.style.left = "10px";
    d.style.padding = "10px";
    d.style.backgroundColor = "rgba(200,0,0,0.8)";
    d.style.color = "white";
    d.style.zIndex = "1000";
    d.style.border = "1px solid darkred";
    d.style.borderRadius = "5px";
    document.body.appendChild(d);
  }
  d.textContent = `Connection Issue: ${msg}`;
  d.style.display = "block";
}

// --- Start ---
document.addEventListener("DOMContentLoaded", initializeApp);

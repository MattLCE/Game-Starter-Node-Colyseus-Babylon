// client/src/client.ts

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GroundMesh } from "@babylonjs/core/Meshes/groundMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Nullable } from "@babylonjs/core/types";

import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";

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
const playerMeshMap = new Map<string, Mesh | TransformNode>();
let terrainMesh: Nullable<GroundMesh> = null;
let placeholderPlayerMesh: TransformNode | null = null;
const inputState = { left: false, right: false, forward: false, backward: false };
const noiseScaleFactor = 0.1;
const dummyUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

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

  // --- Debug Layer ---
  scene.debugLayer
    .show({ embedMode: true })
    .then(() => {
      console.log("[Debug] Babylon.js Debug Layer initialized.");
    })
    .catch((err) => {
      console.error("[Debug] Error initializing Debug Layer:", err);
    });

  // --- Camera Setup ---
  camera = new FreeCamera("camera1", new Vector3(0, 25, -40), scene);
  camera.setTarget(new Vector3(0, 0, 0));
  camera.minZ = 0.1;
  camera.attachControl(canvas, true);
  camera.speed = 0.5;
  camera.upperBetaLimit = Math.PI / 2 - 0.1;

  // --- Lighting ---
  const light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
  light.intensity = 0.8;

  // --- Render Loop & Resize ---
  engine.runRenderLoop(() => {
    if (scene) {
      scene.render();
    }
  });
  window.addEventListener("resize", () => {
    engine.resize();
  });

  // --- Debug Button ---
  const debugButton = document.getElementById("debugCamButton");
  if (debugButton) {
    debugButton.onclick = () => {
      if (scene.debugLayer.isVisible()) {
        scene.debugLayer.hide();
      } else {
        scene.debugLayer.show({ embedMode: true });
      }
    };
  } else {
    console.warn("[Debug] Could not find debug button element!");
  }

  // --- Input & Assets & Networking ---
  setupInputListeners();
  void loadPlaceholderAsset();
  initializeColyseus();
}

// --- Asset Loading ---
async function loadPlaceholderAsset() {
  try {
    console.log(
      "[Assets] Loading placeholder player asset (rubberDuck.glb)..."
    );
    const result = await SceneLoader.ImportMeshAsync(
      "",
      "/assets/models/",
      "rubberDuck.glb",
      scene
    );
    if (result.meshes.length === 0) {
      console.warn("[Assets] Placeholder GLB loaded but contains 0 meshes.");
      return;
    }
    console.log("[Assets] --- Inspecting Loaded Meshes ---");
    result.meshes.forEach((m, i) => {
      const vertexCount =
        m instanceof Mesh ? m.getTotalVertices() : "N/A (TransformNode)";
      console.log(
        `  Mesh[${i}]: Name='${m.name}', Type='${m.getClassName()}', Vertices=${vertexCount}`
      );
    });
    console.log("[Assets] -------------------------------");

    const rootNode = new TransformNode("placeholderPlayerTemplate", scene);

    // Handle potential __root__ node from SceneLoader
    for (const loadedMesh of result.meshes) {
      if (loadedMesh.name === "__root__" && loadedMesh.parent === null) {
        console.log(
          "[Assets] Found SceneLoader __root__, parenting its children instead."
        );
        const childrenMeshes = loadedMesh.getChildMeshes(false);
        childrenMeshes.forEach((child) => child.setParent(rootNode));
        const childrenNodes = loadedMesh.getChildTransformNodes(false);
        childrenNodes.forEach((childNode) => childNode.setParent(rootNode));
        loadedMesh.dispose();
      } else if (loadedMesh.parent === null) {
        loadedMesh.setParent(rootNode);
      }
    }

    rootNode.setEnabled(false);
    placeholderPlayerMesh = rootNode;
    console.log(
      "[Assets] Placeholder root node created and meshes parented."
    );
  } catch (error) {
    console.error("[Assets] Failed loading placeholder:", error);
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

  console.log("[Client WG] Received state for terrain generation:", {
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

  if (
    !seed ||
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
      "[Client WG] Invalid terrain parameters received. Aborting terrain creation.",
      { seed, terrainWidth, terrainHeight, terrainSubdivisions, heightScale }
    );
    if (isNaN(terrainSubdivisions) || terrainSubdivisions <= 0) {
      console.warn("[Client WG] Subdivisions invalid, defaulting to 1.");
      terrainSubdivisions = 1;
      if (
        !seed ||
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

  const points = terrainSubdivisions + 1;
  console.log(
    `[Client WG] Generating terrain mesh using seed: ${seed} (Points per side: ${points})`
  );

  // Generate NORMALIZED height data (0.0 to 1.0)
  const noise2D = createNoise2D(mulberry32(seed));
  const heightMapJsArray: number[] = [];
  for (let j = 0; j < points; j++) {
    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * terrainWidth - terrainWidth / 2;
      const z = (j / (points - 1)) * terrainHeight - terrainHeight / 2;
      const nVal = noise2D(x * noiseScaleFactor, z * noiseScaleFactor);
      const h_normalized = (nVal + 1) / 2;
      heightMapJsArray.push(h_normalized);
    }
  }

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
          `[Client WG] Invalid value in normalized heightMap at index ${k}: ${heightMapJsArray[k]}.`
        );
        dataIsValid = false;
        break;
      }
      if (heightMapJsArray[k] < -0.01 || heightMapJsArray[k] > 1.01) {
        console.warn(
          `[Client WG] Normalized height value ${heightMapJsArray[k]} at index ${k} is outside expected 0-1 range.`
        );
      }
    }
  }
  if (!dataIsValid) {
    console.error("[Client WG] Heightmap validation failed. Aborting terrain creation.");
    return;
  }

  const heightMapFloat32 = new Float32Array(heightMapJsArray);
  console.log(
    `[Client WG] Converted NORMALIZED heightmap to Float32Array (length: ${heightMapFloat32.length})`
  );

  // Use Babylon's built-in heightmap displacement (let Babylon handle vertex updates)
  const groundOptions = {
    width: terrainWidth,
    height: terrainHeight,
    subdivisions: terrainSubdivisions,
    minHeight: 0,
    maxHeight: heightScale,
    updatable: true,
    buffer: heightMapFloat32,
    bufferWidth: points,
    bufferHeight: points,
    onReady: (mesh: Mesh) => {
      console.log("[Client WG - onReady] Terrain mesh is ready!");
      terrainMesh = mesh as GroundMesh;
      // Assign material using the built-in texture loading
      const mat = new StandardMaterial("terrainMat", scene);
      try {
        const tex = new Texture("/assets/textures/grass.jpg", scene);
        tex.uScale = terrainWidth / 4;
        tex.vScale = terrainHeight / 4;
        mat.diffuseTexture = tex;
        console.log("[Client WG - onReady] Grass texture loaded and applied.");
      } catch (e) {
        console.error("[Client WG - onReady] Failed loading grass texture:", e);
        mat.diffuseColor = new Color3(0.3, 0.6, 0.3);
      }
      terrainMesh.material = mat;
      terrainMesh.receiveShadows = true;
      console.log("[Client WG - onReady] Material assigned.");
      console.log("[Client WG - onReady] Terrain mesh final position:", terrainMesh.position);
    },
    onError: (message?: string, exception?: any) => {
      console.error(
        `[Client WG - onError] Terrain creation failed asynchronously: ${message}`,
        exception
      );
    },
  };

  console.log(
    "[Client WG] Calling CreateGroundFromHeightMap with onReady callback:",
    groundOptions
  );

  try {
    MeshBuilder.CreateGroundFromHeightMap("terrain", dummyUrl, groundOptions, scene);
    console.log("[Client WG] CreateGroundFromHeightMap function call initiated (onReady callback is pending).");
  } catch (meshError) {
    console.error("[Client WG] Immediate Error during CreateGroundFromHeightMap function call:", meshError);
    return;
  }
}

// --- Colyseus Connection ---
function initializeColyseus() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const port = "";
  let endpoint = `${proto}://${host}${port}`;
  if (host.endsWith(".replit.dev")) {
    console.log("[Colyseus] Detected Replit environment, using standard ports for connection.");
  } else {
    console.log("[Colyseus] Not a replit.dev host, using calculated endpoint:", endpoint);
  }
  console.log(`[Colyseus] Calculated Endpoint: ${endpoint}`);
  try {
    client = new Colyseus.Client(endpoint);
    console.log("[Colyseus] Client created.");
    void connectToRoom();
  } catch (e) {
    console.error("[Colyseus] Client initialization failed:", e);
    displayConnectionError("Failed to initialize connection client.");
  }
}

async function connectToRoom() {
  try {
    console.log("[Colyseus] Attempting to join or create 'my_room'...");
    const joinOptions = {};
    room = await client.joinOrCreate<MyRoomState>("my_room", joinOptions);
    console.log(`[Colyseus] Successfully joined! Session ID: ${room.sessionId}`);
    console.log("[Colyseus] Initial state received:", room.state.toJSON());
    setupRoomListeners();
  } catch (e: any) {
    console.error("[Colyseus] Join or Create failed:", e);
    if (e instanceof Error) {
      console.error("  Error Name:", e.name);
      console.error("  Error Message:", e.message);
      console.error("  Error Stack:", e.stack);
    }
    displayConnectionError(`Join failed: ${e.message || e}`);
  }
}

function setupRoomListeners() {
  if (!room) {
    console.error("[Colyseus] SetupRoomListeners called but room is not valid!");
    return;
  }
  console.log("[Colyseus] Setting up room listeners...");
  let isFirstState = true;

  room.onStateChange((state: MyRoomState) => {
    console.log(`[Colyseus] State update received. Player count: ${state.players.size}`);
    if (isFirstState && state.worldSeed && state.worldSeed !== "default") {
      console.log("[Client WG] First valid state received, attempting terrain creation...");
      try {
        createOrUpdateTerrain(state, scene);
        isFirstState = false;
      } catch (terrainError) {
        console.error("[Client WG] Error processing initial state for terrain:", terrainError);
      }
    } else if (isFirstState) {
      console.log("[Client WG] Waiting for first state with valid world seed...");
    }

    const serverIds = new Set(state.players.keys());
    state.players.forEach((playerState: PlayerState, sessionId) => {
      let playerNode = playerMeshMap.get(sessionId);
      if (!playerNode) {
        if (placeholderPlayerMesh) {
          try {
            const clonedRoot = placeholderPlayerMesh.clone(`player_${sessionId}`, null, false);
            if (clonedRoot && clonedRoot instanceof TransformNode) {
              playerNode = clonedRoot;
              playerNode.setEnabled(true);
              playerNode.position = new Vector3(playerState.x, playerState.y, playerState.z);
              playerNode.scaling = new Vector3(1, 1, 1);
              console.log(`[Sync] Cloned ROOT NODE for ${sessionId} at state pos:`, playerNode.position.toString());
              playerMeshMap.set(sessionId, playerNode);
              console.log(`[Sync] Added node for ${sessionId}`);
              if (sessionId === room?.sessionId) {
                console.log(`[Camera] Attaching camera to self (${sessionId}).`);
                camera.position = new Vector3(0, 1.5, -5);
                camera.parent = playerNode;
              }
            } else {
              console.error(`[Sync] Failed to clone placeholder root node for ${sessionId}. Clone result:`, clonedRoot);
            }
          } catch (cloneError) {
            console.error(`[Sync] Error during cloning for ${sessionId}:`, cloneError);
          }
        } else {
          console.warn(`[Sync] Cannot create node for ${sessionId}, placeholder not loaded yet.`);
          return;
        }
      }
      if (playerNode && playerNode instanceof TransformNode && sessionId !== room?.sessionId) {
        playerNode.position.set(playerState.x, playerState.y, playerState.z);
      }
    });

    playerMeshMap.forEach((node, sessionId) => {
      if (!serverIds.has(sessionId)) {
        console.log(`[Sync] Removing node for disconnected player ${sessionId}`);
        if (camera.parent === node) {
          camera.parent = null;
          console.log(`[Camera] Detached from leaving player ${sessionId}`);
          camera.position = new Vector3(0, 25, -40);
          camera.setTarget(Vector3.Zero());
        }
        node.dispose(false, true);
        playerMeshMap.delete(sessionId);
      }
    });
  });

  room.onError((code, message) => {
    console.error(`[Colyseus] Room error (Code ${code}): ${message}`);
    displayConnectionError(`Room Error: ${message || 'Unknown error'}`);
  });

  room.onLeave((code) => {
    console.log(`[Colyseus] Left room (Code: ${code})`);
    terrainMesh?.dispose();
    terrainMesh = null;
    playerMeshMap.forEach(node => node.dispose(false, true));
    playerMeshMap.clear();
    if (camera.parent) camera.parent = null;
    camera.position = new Vector3(0, 25, -40);
    camera.setTarget(Vector3.Zero());
    room = null;
    if (code > 1000) {
      displayConnectionError(`Disconnected (Code: ${code}). Attempting to reconnect...`);
      setTimeout(connectToRoom, 5000);
    } else {
      displayConnectionError("Disconnected from server.");
    }
  });

  setInterval(sendInput, 50);
  console.log("[Colyseus] Room listeners attached.");
}

// --- Input Handling ---
function setupInputListeners() {
  window.addEventListener("keydown", (event) => {
    switch (event.key.toLowerCase()) {
      case "w":
      case "arrowup":
        inputState.forward = true;
        break;
      case "s":
      case "arrowdown":
        inputState.backward = true;
        break;
      case "a":
      case "arrowleft":
        inputState.left = true;
        break;
      case "d":
      case "arrowright":
        inputState.right = true;
        break;
    }
  });

  window.addEventListener("keyup", (event) => {
    switch (event.key.toLowerCase()) {
      case "w":
      case "arrowup":
        inputState.forward = false;
        break;
      case "s":
      case "arrowdown":
        inputState.backward = false;
        break;
      case "a":
      case "arrowleft":
        inputState.left = false;
        break;
      case "d":
      case "arrowright":
        inputState.right = false;
        break;
    }
  });
  console.log("[Input] Keyboard listeners set up.");
}

function sendInput() {
  if (room && room.connection.isOpen) {
    room.send("input", inputState);
  }
}

// --- Error Display ---
function displayConnectionError(error: any) {
  console.error("[Error Display]", error);
  const message = error instanceof Error ? error.message : String(error);
  alert(`Connection Error: ${message}\nPlease refresh the page.`);
}

document.addEventListener("DOMContentLoaded", initializeApp);

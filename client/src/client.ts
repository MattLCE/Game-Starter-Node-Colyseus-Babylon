// client/src/client.ts
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode"; // Import TransformNode
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
// Import the Debug Layer & Inspector
import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";

import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader";
import "@babylonjs/core/Meshes/Builders/groundBuilder"; // Make sure this is imported for heightmap

import * as Colyseus from "colyseus.js";
import { MyRoomState, PlayerState } from "../../server/src/myroom";
import { createNoise2D, RandomFn } from "simplex-noise";

// --- Helper: Simple Seeded PRNG (Mulberry32) ---
function mulberry32(seedStr: string): RandomFn {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Global Variables ---
let engine: Engine; let scene: Scene; let camera: FreeCamera; let client: Colyseus.Client;
let room: Colyseus.Room<MyRoomState> | null = null; const playerMeshMap = new Map<string, Mesh | TransformNode>();
let terrainMesh: Mesh | null = null; let placeholderPlayerMesh: TransformNode | null = null; // Keep as TransformNode
const inputState = { left: false, right: false, forward: false, backward: false };
const noiseScaleFactor = 0.1; // Needed again for heightmap terrain

// --- Initialization ---
function initializeApp() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) { console.error("Canvas not found!"); return; }
  engine = new Engine(canvas, true); scene = new Scene(engine); scene.clearColor = new Color4(0.2, 0.3, 0.4, 1.0);
  scene.debugLayer.show({ embedMode: true }).then(() => { console.log("[Debug] Babylon.js Debug Layer initialized."); })
      .catch((err) => { console.error("[Debug] Error initializing Debug Layer:", err); });
  camera = new FreeCamera("camera1", new Vector3(0, 25, -40), scene); // Keep adjusted start
  camera.setTarget(new Vector3(0, 0, 0)); camera.minZ = 0.1; camera.attachControl(canvas, true);
  camera.speed = 0.5; camera.upperBetaLimit = Math.PI / 2 - 0.1;
  const light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene); light.intensity = 0.8;
  engine.runRenderLoop(() => { if (scene) { scene.render(); } });
  window.addEventListener("resize", () => { engine.resize(); });
  const debugButton = document.getElementById("debugCamButton");
  if (debugButton) { /* ... button logic ... */ } else { console.error("[Debug] Could not find debug button element!"); }
  setupInputListeners();
  void loadPlaceholderAsset();
  initializeColyseus(); // Ensure this is called
}

// --- Asset Loading ---
async function loadPlaceholderAsset() {
    try {
        console.log("Loading placeholder player asset (rubberDuck.glb)...");
        const result = await SceneLoader.ImportMeshAsync("", "/assets/models/", "rubberDuck.glb", scene);
        if (result.meshes.length === 0) { console.warn("Placeholder GLB loaded but contains 0 meshes."); return; }
        console.log("--- Inspecting Loaded Meshes ---");
        result.meshes.forEach((m, i) => { const vertexCount = (m instanceof Mesh) ? m.getTotalVertices() : 'N/A (TransformNode)'; console.log(`Mesh[${i}]: Name='${m.name}', Type='${m.getClassName()}', Vertices=${vertexCount}`); });
        console.log("-------------------------------");
        const rootNode = new TransformNode("placeholderPlayerTemplate", scene);
        for (const loadedMesh of result.meshes) { if (loadedMesh.name === "__root__" && loadedMesh.parent === null) { console.log("Found SceneLoader __root__, parenting its children instead."); const children = loadedMesh.getChildMeshes(false); children.forEach(child => child.setParent(rootNode)); loadedMesh.getChildTransformNodes(false).forEach(childNode => childNode.setParent(rootNode)); loadedMesh.dispose(); } else if (loadedMesh.parent === null) { loadedMesh.setParent(rootNode); } }
        rootNode.setEnabled(false); placeholderPlayerMesh = rootNode; console.log("Placeholder root node created and meshes parented.");
    } catch (error) { console.error("Failed loading placeholder:", error); displayConnectionError("Failed to load player model."); }
}

// --- Procedural Terrain Generation (RESTORED ORIGINAL) ---
function createOrUpdateTerrain(state: MyRoomState, scene: Scene) {
  if (terrainMesh) { console.log("[Client WG] Disposing old terrain."); terrainMesh.dispose(); terrainMesh = null; }
  console.log("[Client WG] Received state for terrain:", { seed: state.worldSeed, width: state.terrainWidth, height: state.terrainHeight, subdivisions: state.terrainSubdivisions, scale: state.heightScale });
  const seed = state.worldSeed; const terrainWidth = Number(state.terrainWidth); const terrainHeight = Number(state.terrainHeight);
  let terrainSubdivisions = Math.floor(Number(state.terrainSubdivisions)); const heightScale = Number(state.heightScale);
  if ( !seed || !terrainWidth || !terrainHeight || !terrainSubdivisions || !heightScale || isNaN(terrainWidth) || isNaN(terrainHeight) || isNaN(terrainSubdivisions) || isNaN(heightScale) || terrainWidth <= 0 || terrainHeight <= 0 || terrainSubdivisions <= 0 || heightScale <= 0 ) { console.error("[Client WG] Invalid terrain parameters received. Aborting.", { seed, terrainWidth, terrainHeight, terrainSubdivisions, heightScale }); if (terrainSubdivisions <= 0) { console.warn("[Client WG] Subdivisions <= 0, defaulting to 1."); terrainSubdivisions = 1; if (!seed || !terrainWidth || !terrainHeight || !heightScale || isNaN(terrainWidth) || isNaN(terrainHeight) || isNaN(heightScale) || terrainWidth <= 0 || terrainHeight <= 0 || heightScale <= 0) { return; } } else { return; } }
  const points = terrainSubdivisions + 1; console.log(`[Client WG] Generating terrain mesh using seed: ${seed}`);
  const noise2D = createNoise2D(mulberry32(seed)); const heightMapJsArray: number[] = [];
  for (let j = 0; j < points; j++) { for (let i = 0; i < points; i++) { const x = (i / (points - 1)) * terrainWidth - terrainWidth / 2; const z = (j / (points - 1)) * terrainHeight - terrainHeight / 2; const nVal = noise2D(x * noiseScaleFactor, z * noiseScaleFactor); const h = ((nVal + 1) / 2) * heightScale; heightMapJsArray.push(h); } }
  const expectedLength = points * points; let dataIsValid = true; if (heightMapJsArray.length !== expectedLength) { console.error(`[Client WG] Heightmap length mismatch! Expected ${expectedLength}, Got ${heightMapJsArray.length}.`); dataIsValid = false; } else { for (let k = 0; k < heightMapJsArray.length; k++) { if (!Number.isFinite(heightMapJsArray[k])) { console.error(`[Client WG] Invalid value in heightMap at index ${k}: ${heightMapJsArray[k]}.`); dataIsValid = false; break; } } } if (!dataIsValid) { console.error("[Client WG] Heightmap validation failed. Aborting terrain creation."); return; }
  const heightMapFloat32 = new Float32Array(heightMapJsArray); console.log(`[Client WG] Converted heightmap to Float32Array (length: ${heightMapFloat32.length})`);
  const groundOptions = { width: terrainWidth, height: terrainHeight, subdivisions: terrainSubdivisions, minHeight: 0, maxHeight: heightScale, updatable: false, buffer: heightMapFloat32, bufferWidth: points, bufferHeight: points };
  console.log("[Client WG] Calling CreateGroundFromHeightMap with options:", groundOptions);
  try { console.log("[Client WG] heightMapFloat32 length:", heightMapFloat32.length); console.log("[Client WG] heightMapFloat32 type:", heightMapFloat32.constructor.name); console.log("[Client WG] Expected buffer size based on points:", points * points); terrainMesh = MeshBuilder.CreateGroundFromHeightMap("terrain", "", groundOptions, scene); } catch (meshError) { console.error("[Client WG] Error during CreateGroundFromHeightMap:", meshError); return; }
  const mat = new StandardMaterial("terrainMat", scene); try { const tex = new Texture("/assets/textures/grass.jpg", scene); tex.uScale = terrainWidth / 4; tex.vScale = terrainHeight / 4; mat.diffuseTexture = tex; } catch (e) { console.error("Failed loading grass texture:", e); mat.diffuseColor = new Color3(0.3, 0.6, 0.3); }
  terrainMesh.material = mat; terrainMesh.receiveShadows = true; console.log("[Client WG] Terrain mesh created successfully.");
  console.log("[Client WG] Terrain mesh position:", terrainMesh.position);
  try { const vertexCount = terrainMesh.getVerticesData(VertexBuffer.PositionKind)?.length / 3; console.log("[Client WG] Terrain mesh vertex count:", vertexCount); } catch (e) { console.error("[Client WG] Error getting terrain vertex count:", e); }
}

// --- Colyseus Connection ---
function initializeColyseus() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : (proto === 'wss' ? ':443' : ':80');
  const endpoint = `${proto}://${host}${port}`;

  // Added Log
  console.log(`[Colyseus] Calculated Endpoint: ${endpoint}`);

  console.log(`[Colyseus] Connecting to: ${endpoint}`);
  try {
    client = new Colyseus.Client(endpoint);
    void connectToRoom(); // Ensure this is called
  } catch(e) {
    console.error("[Colyseus] Client initialization failed:", e);
    displayConnectionError("Failed to initialize connection client.");
  }
}

async function connectToRoom() {
  try {
    console.log("[Colyseus] Attempting to join 'my_room'..."); // Modified Log

    const joinOptions = { /* Add any needed options */ };
    room = await client.joinOrCreate<MyRoomState>("my_room", joinOptions);

    // Added Log
    console.log(`[Colyseus] Successfully joined! Session ID: ${room.sessionId}`);

    console.log("[Colyseus] Initial state:", room.state.toJSON());
    setupRoomListeners(); // This should be called ONLY after successful join
  } catch (e) {
    // Added More Detail
    console.error("[Colyseus] Join or Create failed:", e);
    if (e instanceof Error) {
        console.error("Error Name:", e.name);
        console.error("Error Message:", e.message);
        console.error("Error Stack:", e.stack);
    }
    displayConnectionError(e);
  }
}

function setupRoomListeners() {
    if (!room) {
        console.error("[Colyseus] setupRoomListeners called but room is not valid!");
        return;
    }
    console.log("[Colyseus] Setting up listeners...");
    let isFirstState = true;

    room.onStateChange((state: MyRoomState) => {
        console.log("[Colyseus] State update received. Player count:", state.players.size);
        if (isFirstState && state.worldSeed !== "default") {
            console.log("[Client WG] First state change, attempting terrain creation..."); // Prefix back
            try { createOrUpdateTerrain(state, scene); isFirstState = false; } // Call original
            catch (terrainError) { console.error("[Client WG] Error processing initial state for terrain:", terrainError); } // Prefix back
        }
        const serverIds = new Set(state.players.keys());
        console.log("[Sync] Server Player IDs:", Array.from(serverIds));
        console.log("[Sync] Local Player IDs in Map:", Array.from(playerMeshMap.keys()));

        state.players.forEach((playerState: PlayerState, sessionId) => {
            console.log(`[Sync] Processing player: ${sessionId}`);
            let playerNode = playerMeshMap.get(sessionId);
            if (!playerNode) {
                console.log(`[Sync] No node found for ${sessionId}. Placeholder Root loaded:`, !!placeholderPlayerMesh);
                if (placeholderPlayerMesh) {
                    const clonedRoot = placeholderPlayerMesh.clone(`player_${sessionId}`, null, false);
                    if (clonedRoot && clonedRoot instanceof TransformNode) {
                        playerNode = clonedRoot;
                        playerNode.setEnabled(true);
                        playerNode.position = new Vector3(playerState.x, playerState.y, playerState.z);
                        playerNode.scaling = new Vector3(1, 1, 1);
                        // playerNode.getChildMeshes(true).forEach(childMesh => { childMesh.showBoundingBox = true; }); // Optional: bounding box
                        console.log(`[Sync] Cloned ROOT NODE for ${sessionId} at state pos:`, playerNode.position);
                        console.log(`[Sync] Root Node ${sessionId} scaling:`, playerNode.scaling);
                        playerMeshMap.set(sessionId, playerNode);
                        console.log(`[Sync] Added root node for ${sessionId}`);
                        if (sessionId === room?.sessionId) {
                             console.log(`[Camera] Attaching camera to self (${sessionId}).`);
                             camera.position = new Vector3(0, 1.5, -5);
                             camera.parent = playerNode; // Re-enable parenting
                        }
                    } else { console.error(`[Sync] Failed to clone placeholder root node for ${sessionId}`); }
                } else { return; }
            }
            if (playerNode && playerNode instanceof TransformNode && sessionId !== room?.sessionId) {
               playerNode.position.set(playerState.x, playerState.y, playerState.z);
            }
        });

        playerMeshMap.forEach((node, sessionId) => {
          if (!serverIds.has(sessionId)) {
            console.log(`[Sync] Removing node for ${sessionId}`);
             if (camera.parent === node) {
               camera.parent = null; console.log(`[Camera] Detached from leaving player ${sessionId}`);
               camera.position = new Vector3(0, 25, -40); camera.setTarget(Vector3.Zero());
             }
            node.dispose(false, true);
            playerMeshMap.delete(sessionId);
          }
        });
    });

    room.onError((code, message) => { /* ... onError logic ... */ });
    room.onLeave((code) => { /* ... onLeave logic ... */ });
    setInterval(sendInput, 50);
    console.log("[Colyseus] Listeners attached.");
}

// --- Input Handling ---
function setupInputListeners() { /* ... same as before ... */ }
function sendInput() { /* ... same as before ... */ }

// --- Error Display ---
function displayConnectionError(error: any) { /* ... same as before ... */ }

// --- Start ---
document.addEventListener("DOMContentLoaded", initializeApp);
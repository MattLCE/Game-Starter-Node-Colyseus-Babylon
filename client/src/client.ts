// client/src/client.ts
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
import "@babylonjs/core/Meshes/Builders/groundBuilder"; // Ensure groundBuilder is imported

import * as Colyseus from "colyseus.js";
import { MyRoomState, PlayerState } from "../../server/src/myroom"; // Adjust path if needed
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
const noiseScaleFactor = 0.1; // Adjust noise scale as needed

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
  camera.upperBetaLimit = Math.PI / 2 - 0.1; // Prevent looking straight down/up too much
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
      "/assets/models/", // Ensure path is correct relative to 'public'
      "rubberDuck.glb",
      scene
    );
    if (r.meshes.length > 0) {
      const m = r.meshes[0] as Mesh;
      m.name = "placeholderPlayerTemplate";
      m.setEnabled(false); // Keep it disabled until cloned
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
    !terrainSubdivisions || // Check subdivisions here initially
    !heightScale ||
    isNaN(terrainWidth) ||
    isNaN(terrainHeight) ||
    isNaN(terrainSubdivisions) ||
    isNaN(heightScale) ||
    terrainWidth <= 0 ||
    terrainHeight <= 0 ||
    terrainSubdivisions <= 0 || // <= 0 is invalid
    heightScale <= 0
  ) {
    console.error(
      "[Client WG] Invalid terrain parameters received. Aborting.",
      { seed, terrainWidth, terrainHeight, terrainSubdivisions, heightScale }
    );
    // Optional: Defaulting subdivisions to 1 only if it was the sole issue
    if (terrainSubdivisions <= 0) {
      console.warn("[Client WG] Subdivisions <= 0, defaulting to 1.");
      terrainSubdivisions = 1; // Attempt recovery
      // Re-validate *other* parameters after defaulting subdivision
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
        return; // Abort if other parameters are still invalid
      }
      // Continue if only subdivisions was bad and now fixed
    } else {
      return; // Abort if any *other* parameter was invalid
    }
  }
  // --- End Input Validation ---

  const points = terrainSubdivisions + 1; // Calculate points *once* here

  console.log(`[Client WG] Generating terrain mesh using seed: ${seed}`);
  const noise2D = createNoise2D(mulberry32(seed));
  const heightMapJsArray: number[] = []; // Generate as standard JS array first

  for (let j = 0; j < points; j++) {
    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * terrainWidth - terrainWidth / 2;
      const z = (j / (points - 1)) * terrainHeight - terrainHeight / 2;
      const nVal = noise2D(x * noiseScaleFactor, z * noiseScaleFactor);
      // Normalize noise to 0-1 range, then scale
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
        break; // No need to check further
      }
    }
  }
  if (!dataIsValid) {
    console.error(
      "[Client WG] Heightmap validation failed. Aborting terrain creation."
    );
    return; // Stop if data is bad
  }
  // --- End Data Validation ---

  // Convert to Float32Array *after* validation
  const heightMapFloat32 = new Float32Array(heightMapJsArray);
  console.log(
    `[Client WG] Converted heightmap to Float32Array (length: ${heightMapFloat32.length})`
  );

  // --- Create Mesh ---
  // ***** MODIFIED: Add buffer, bufferWidth, bufferHeight to options *****
  const groundOptions = {
    width: terrainWidth,
    height: terrainHeight,
    subdivisions: terrainSubdivisions,
    minHeight: 0, // Minimum height from your generated data (can be adjusted)
    maxHeight: heightScale, // Maximum height from your generated data
    updatable: false, // Set to true if you plan to update the heightmap later
    // --- These three tell Babylon to use your Float32Array ---
    buffer: heightMapFloat32, // The raw height data
    bufferWidth: points, // Width of the data grid (subdivisions + 1)
    bufferHeight: points, // Height of the data grid (subdivisions + 1)
  };
  console.log(
    "[Client WG] Calling CreateGroundFromHeightMap with options:",
    groundOptions // Log the complete options object being passed
  );
  try {
    // Log data just before the call for easier debugging
    console.log(
      "[Client WG] heightMapFloat32 length:",
      heightMapFloat32.length
    );
    console.log(
      "[Client WG] heightMapFloat32 type:",
      heightMapFloat32.constructor.name
    );
    console.log(
      "[Client WG] Expected buffer size based on points:",
      points * points
    );

    // ***** MODIFIED: Pass empty string for URL, options contain buffer *****
    terrainMesh = MeshBuilder.CreateGroundFromHeightMap(
      "terrain",
      "", // Pass an empty string as the URL when using buffer
      groundOptions, // Pass the options object containing the buffer info
      scene
    );
  } catch (meshError) {
    console.error(
      "[Client WG] Error during CreateGroundFromHeightMap:",
      meshError // Log the specific error
    );
    // Log arguments again if error persists, helps confirm what was passed
    // console.error("Arguments passed:", "terrain", "", groundOptions, scene);
    // console.error("Buffer details:", heightMapFloat32.length, points);
    return; // Stop execution if mesh creation fails
  }
  // --- End Create Mesh ---

  // --- Apply Material ---
  const mat = new StandardMaterial("terrainMat", scene);
  try {
    // Ensure texture path is correct relative to 'public' folder
    const tex = new Texture("/assets/textures/grass.jpg", scene);
    tex.uScale = terrainWidth / 4; // Adjust texture tiling as needed
    tex.vScale = terrainHeight / 4;
    mat.diffuseTexture = tex;
  } catch (e) {
    console.error("Failed loading grass texture:", e);
    mat.diffuseColor = new Color3(0.3, 0.6, 0.3); // Fallback green color
  }
  terrainMesh.material = mat;
  terrainMesh.receiveShadows = true; // Enable shadow receiving if needed
  console.log("[Client WG] Terrain mesh created successfully.");
  // --- End Apply Material ---
}

// --- Colyseus Connection ---
function initializeColyseus() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  // Use the correct port if running locally and Vite uses a different one
  // const port = window.location.port ? `:${window.location.port}` : ""; // Use this if connecting to Vite proxy
  const port = window.location.port
    ? `:${window.location.port}`
    : proto === "wss"
      ? ":443"
      : ":80"; // Use standard ports or current if specified (likely Replit uses std ports)
  // Construct the endpoint - Adjust if your server path is different
  const endpoint = `${proto}://${host}${port}`; // Replit usually maps external port 80/443 to internal 2567
  // const endpoint = `${proto}://${host}:2567`; // Explicit port for local dev if NOT using Vite proxy

  console.log(`[Colyseus] Connecting to: ${endpoint}`);
  try {
    client = new Colyseus.Client(endpoint);
    void connectToRoom(); // Start connection attempt
  } catch (e) {
    console.error("[Colyseus] Client initialization failed:", e);
    displayConnectionError("Failed to initialize connection client.");
  }
}

async function connectToRoom() {
  try {
    console.log("[Colyseus] Joining 'my_room'...");
    // Add any options needed for joinOrCreate if your room uses them
    room = await client.joinOrCreate<MyRoomState>("my_room", {
      /* options */
    });
    console.log(`[Colyseus] Joined! Session ID: ${room.sessionId}`);
    console.log("[Colyseus] Initial state:", room.state.toJSON()); // Log initial state from server
    setupRoomListeners();
  } catch (e) {
    console.error("[Colyseus] Join failed:", e);
    displayConnectionError(e); // Show error to user
  }
}

function setupRoomListeners() {
  if (!room) return;
  console.log("[Colyseus] Setting up listeners...");

  let isFirstState = true; // Flag to generate terrain only on first state received

  // Listen for state changes
  room.onStateChange((state: MyRoomState) => {
    // console.log("[Colyseus] State update received:", state.toJSON()); // Debug log

    // Generate terrain only on the first valid state change
    if (isFirstState && state.worldSeed !== "default") {
      // Check for valid seed
      try {
        createOrUpdateTerrain(state, scene);
        isFirstState = false; // Terrain created, don't run again
      } catch (terrainError) {
        console.error(
          "[Client] Error processing initial state for terrain:",
          terrainError
        );
        // Potentially disconnect or show an error if terrain fails
      }
    }

    // Sync player positions
    const serverIds = new Set(state.players.keys());

    state.players.forEach((playerState: PlayerState, sessionId) => {
      let mesh = playerMeshMap.get(sessionId);

      // Add new player meshes
      if (!mesh) {
        if (placeholderPlayerMesh) {
          // Check if the placeholder is loaded
          mesh =
            placeholderPlayerMesh.clone(`player_${sessionId}`, null, true) ??
            undefined;
          if (mesh) {
            mesh.setEnabled(true); // Make the clone visible
            mesh.position = new Vector3(
              playerState.x,
              playerState.y,
              playerState.z
            );
            playerMeshMap.set(sessionId, mesh);
            console.log(`[Sync] Added mesh for ${sessionId}`);

            // Attach camera to the local player's mesh
            if (sessionId === room?.sessionId) {
              console.log(`[Camera] Attaching to self: ${sessionId}`);
              // Adjust camera relative position if needed
              camera.position = new Vector3(0, 1.5, -5); // Example offset
              camera.parent = mesh;
            }
          } else {
            console.error(
              `[Sync] Failed to clone placeholder mesh for ${sessionId}`
            );
          }
        } else {
          // console.warn(`[Sync] Placeholder not loaded yet, cannot create mesh for ${sessionId}`); // Placeholder might not be ready
          return; // Skip if placeholder isn't loaded
        }
      }

      // Update existing player meshes (except the local player, whose position is driven by physics/camera parent)
      if (mesh && sessionId !== room?.sessionId) {
        // Optional: Add smoothing/interpolation here later
        mesh.position.set(playerState.x, playerState.y, playerState.z);
      }
    });

    // Remove meshes for players who left
    playerMeshMap.forEach((mesh, sessionId) => {
      if (!serverIds.has(sessionId)) {
        console.log(`[Sync] Removing mesh for ${sessionId}`);
        if (camera.parent === mesh) {
          // Detach camera if parent is leaving
          camera.parent = null;
          console.log(`[Camera] Detached from leaving player ${sessionId}`);
          // Consider resetting camera position/target here if needed
          camera.position = new Vector3(0, 10, -15); // Reset to default
          camera.setTarget(Vector3.Zero());
        }
        mesh.dispose();
        playerMeshMap.delete(sessionId);
      }
    });
  });

  // Listen for errors
  room.onError((code, message) => {
    console.error(`[Colyseus] Error (${code}): ${message}`);
    displayConnectionError(`Server error: ${message || code}`);
  });

  // Listen for leave events
  room.onLeave((code) => {
    console.log(`[Colyseus] Left the room (code: ${code})`);
    room = null; // Clear the room reference
    // Clean up scene resources
    playerMeshMap.forEach((mesh) => mesh.dispose());
    playerMeshMap.clear();
    if (terrainMesh) terrainMesh.dispose();
    terrainMesh = null;
    if (camera) camera.parent = null; // Detach camera
    // Consider resetting camera position
    camera.position = new Vector3(0, 10, -15);
    camera.setTarget(Vector3.Zero());

    displayConnectionError(`Disconnected (code: ${code}). Please refresh.`);
    // Potentially attempt reconnection or prompt user
  });

  // Start sending input periodically
  setInterval(sendInput, 50); // Send input roughly 20 times/sec

  console.log("[Colyseus] Listeners attached.");
}

// --- Input Handling ---
function setupInputListeners() {
  window.addEventListener("keydown", (e) => {
    // Use switch for clarity and potential future keys
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
  // Only send if connected to a room
  if (room?.connection.isOpen) {
    room.send("input", inputState);
  }
}

// --- Error Display ---
function displayConnectionError(error: any) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("Connection Error:", msg); // Log the raw error

  let errorDiv = document.getElementById("connectionError");
  if (!errorDiv) {
    errorDiv = document.createElement("div");
    errorDiv.id = "connectionError";
    // Basic styling
    errorDiv.style.position = "absolute";
    errorDiv.style.top = "10px";
    errorDiv.style.left = "10px";
    errorDiv.style.padding = "15px";
    errorDiv.style.backgroundColor = "rgba(200, 0, 0, 0.85)";
    errorDiv.style.color = "white";
    errorDiv.style.zIndex = "1000";
    errorDiv.style.border = "1px solid darkred";
    errorDiv.style.borderRadius = "5px";
    errorDiv.style.fontFamily = "sans-serif";
    errorDiv.style.fontSize = "14px";
    document.body.appendChild(errorDiv);
  }
  // Display a user-friendly message
  errorDiv.textContent = `Connection Issue: ${msg}. Try refreshing the page.`;
  errorDiv.style.display = "block"; // Make sure it's visible
}

// --- Start ---
// Wait for the DOM to be fully loaded before initializing
document.addEventListener("DOMContentLoaded", initializeApp);

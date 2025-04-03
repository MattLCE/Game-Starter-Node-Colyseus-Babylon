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
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer"; // Keep for logging
import "@babylonjs/loaders/glTF"; // Keep even if duck not used now
import "@babylonjs/core/Loading/Plugins/babylonFileLoader"; // Keep
import "@babylonjs/core/Meshes/Builders/groundBuilder"; // Keep groundBuilder
import "@babylonjs/core/Meshes/Builders/boxBuilder"; // Need boxBuilder

import * as Colyseus from "colyseus.js";
import { MyRoomState, PlayerState } from "../../server/src/myroom"; // Adjust path if needed
import { createNoise2D, RandomFn } from "simplex-noise"; // Keep simplex

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
let placeholderPlayerMesh: Mesh | null = null; // Keep reference even if not used now
const inputState = {
  left: false,
  right: false,
  forward: false,
  backward: false,
};

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

  camera = new FreeCamera("camera1", new Vector3(0, 25, -40), scene);
  camera.setTarget(new Vector3(0, 0, 0));
  camera.minZ = 0.1; // Keep near clip adjustment
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

  // Debug Button Logic
  const debugButton = document.getElementById("debugCamButton");
  if (debugButton) {
    console.log("[Debug] Found debug button element.");
    debugButton.onclick = () => {
      console.log("--- Debug button clicked! ---");
      if (!engine) {
        console.error("Debug: Engine is invalid!");
        return;
      }
      if (!scene) {
        console.error("Debug: Scene is invalid!");
        return;
      }
      if (camera) {
        console.log("--- Camera Debug Info ---");
        console.log("Position (World):", camera.globalPosition);
        console.log("Target (Approx World):", camera.getTarget());
        console.log("Parent:", camera.parent ? camera.parent.name : "None");
        if (camera.parent && camera.parent instanceof Mesh) {
          console.log("Parent Position:", camera.parent.position);
          console.log("Parent Visibility:", camera.parent.isVisible);
          console.log("Parent Scaling:", camera.parent.scaling);
        }
        console.log("Up Vector:", camera.upVector);
        console.log("Min Z (Near Clip):", camera.minZ);
        console.log("Max Z (Far Clip):", camera.maxZ);
        console.log("-------------------------");
      } else {
        console.log("Debug Button: Camera object is null/undefined.");
      }
    };
    console.log("[Debug] Attached onclick handler to debug button.");
  } else {
    console.error("[Debug] Could not find debug button element!");
  }

  setupInputListeners();
  void loadPlaceholderAsset(); // Still load it, just don't use it for now
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

// --- Procedural Terrain Generation (SIMPLIFIED FOR DEBUGGING) ---
function createOrUpdateTerrain(state: MyRoomState, scene: Scene) {
  if (terrainMesh) {
    console.log("[Client Debug] Disposing old terrain.");
    terrainMesh.dispose();
    terrainMesh = null;
  }
  console.log("[Client Debug] Creating simple flat ground...");
  try {
    terrainMesh = MeshBuilder.CreateGround(
      "debugGround",
      {
        width: state.terrainWidth || 50,
        height: state.terrainHeight || 50,
        subdivisions: 4,
      },
      scene
    );
    if (!terrainMesh) {
      console.error(
        "[Client Debug] MeshBuilder.CreateGround returned null/undefined!"
      );
      return;
    }
    terrainMesh.position = new Vector3(0, 0, 0);
    const mat = new StandardMaterial("debugGroundMat", scene);
    mat.diffuseColor = new Color3(0.5, 0.7, 0.5);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    terrainMesh.material = mat;
    terrainMesh.receiveShadows = true;
    console.log("[Client Debug] Simple flat ground created successfully.");
    console.log("[Client Debug] Ground position:", terrainMesh.position);
    try {
      const vertexCount =
        terrainMesh.getVerticesData(VertexBuffer.PositionKind)?.length / 3;
      console.log("[Client Debug] Ground vertex count:", vertexCount);
    } catch (e) {
      console.error("[Client Debug] Error getting ground vertex count:", e);
    }
  } catch (error) {
    console.error("[Client Debug] Error creating simple ground:", error);
  }
}

// --- Colyseus Connection ---
function initializeColyseus() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const port = window.location.port
    ? `:${window.location.port}`
    : proto === "wss"
      ? ":443"
      : ":80";
  const endpoint = `${proto}://${host}${port}`;
  console.log(`[Colyseus] Connecting to: ${endpoint}`);
  try {
    client = new Colyseus.Client(endpoint);
    void connectToRoom();
  } catch (e) {
    console.error("[Colyseus] Client initialization failed:", e);
    displayConnectionError("Failed to initialize connection client.");
  }
}

async function connectToRoom() {
  try {
    console.log("[Colyseus] Joining 'my_room'...");
    room = await client.joinOrCreate<MyRoomState>("my_room", {});
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
    console.log(
      "[Colyseus] State update received. Player count:",
      state.players.size
    );

    if (isFirstState && state.worldSeed !== "default") {
      console.log(
        "[Client Debug] First state change, attempting terrain creation..."
      );
      try {
        createOrUpdateTerrain(state, scene);
        isFirstState = false;
      } catch (terrainError) {
        console.error(
          "[Client Debug] Error processing initial state for terrain:",
          terrainError
        );
      }
    }

    const serverIds = new Set(state.players.keys());
    console.log("[Sync] Server Player IDs:", Array.from(serverIds));
    console.log(
      "[Sync] Local Player IDs in Map:",
      Array.from(playerMeshMap.keys())
    );

    state.players.forEach((playerState: PlayerState, sessionId) => {
      console.log(`[Sync] Processing player: ${sessionId}`);
      let mesh = playerMeshMap.get(sessionId);

      if (!mesh) {
        console.log(
          `[Sync] No mesh found for ${sessionId}. Creating debug box instead.`
        );

        // ***** REPLACE DUCK CLONE WITH DEBUG BOX *****
        try {
          // Create a simple box instead
          mesh = MeshBuilder.CreateBox(
            `player_${sessionId}_box`,
            { size: 1.0 },
            scene
          ); // Use size 1 for visibility

          if (mesh) {
            const boxMat = new StandardMaterial(
              `player_${sessionId}_mat`,
              scene
            );
            boxMat.diffuseColor = Color3.Yellow(); // Bright color
            mesh.material = boxMat;

            mesh.setEnabled(true);
            mesh.position = new Vector3(0, 5, 0); // Keep forced position
            mesh.scaling = new Vector3(1, 1, 1); // Ensure correct scaling

            console.log(
              `[Sync] Created DEBUG BOX for ${sessionId} at forced pos:`,
              mesh.position
            );
            console.log(`[Sync] Box ${sessionId} visibility:`, mesh.isVisible);
            console.log(`[Sync] Box ${sessionId} scaling:`, mesh.scaling);
            playerMeshMap.set(sessionId, mesh);
            console.log(`[Sync] Added debug box mesh for ${sessionId}`);

            // Keep camera parenting disabled for now
            if (sessionId === room?.sessionId) {
              console.log(
                `[Camera] NOT attaching camera to self (${sessionId}) for debug.`
              );
            }
          } else {
            console.error(`[Sync] Failed to create debug box for ${sessionId}`);
          }
        } catch (boxError) {
          console.error(
            `[Sync] Error creating debug box for ${sessionId}:`,
            boxError
          );
          return; // Stop processing this player if box creation fails
        }
        // ***** END REPLACEMENT *****
      } // End of !mesh block

      // Keep updating remote players if needed (less relevant now)
      if (mesh && sessionId !== room?.sessionId) {
        // Update position based on state if required
        // mesh.position.set(playerState.x, playerState.y, playerState.z);
      }
    });

    // Player removal logic remains the same
    playerMeshMap.forEach((mesh, sessionId) => {
      if (!serverIds.has(sessionId)) {
        console.log(`[Sync] Removing mesh for ${sessionId}`);
        mesh.dispose();
        playerMeshMap.delete(sessionId);
      }
    });
  });

  room.onError((code, message) => {
    console.error(`[Colyseus] Error (${code}): ${message}`);
    displayConnectionError(`Server error: ${message || code}`);
  });
  room.onLeave((code) => {
    console.log(`[Colyseus] Left the room (code: ${code})`);
    room = null;
    playerMeshMap.forEach((mesh) => mesh.dispose());
    playerMeshMap.clear();
    if (terrainMesh) terrainMesh.dispose();
    terrainMesh = null;
    if (camera) camera.parent = null; // Ensure camera parent is cleared on leave
    camera.position = new Vector3(0, 25, -40);
    camera.setTarget(Vector3.Zero()); // Reset camera
    displayConnectionError(`Disconnected (code: ${code}). Please refresh.`);
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
  console.error("Connection Error:", msg);
  let errorDiv = document.getElementById("connectionError");
  if (!errorDiv) {
    errorDiv = document.createElement("div");
    errorDiv.id = "connectionError";
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
  errorDiv.textContent = `Connection Issue: ${msg}. Try refreshing the page.`;
  errorDiv.style.display = "block";
}

// --- Start ---
document.addEventListener("DOMContentLoaded", initializeApp);

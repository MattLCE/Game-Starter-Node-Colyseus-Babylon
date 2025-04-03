// client/src/client.ts
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GroundMesh } from "@babylonjs/core/Meshes/groundMesh"; // Import GroundMesh specifically
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Nullable } from "@babylonjs/core/types"; // Import Nullable

// Import the Debug Layer & Inspector
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
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
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
let terrainMesh: Nullable<GroundMesh> = null; // Use GroundMesh type and allow null
let placeholderPlayerMesh: TransformNode | null = null; // Keep as TransformNode
const inputState = { left: false, right: false, forward: false, backward: false };
const noiseScaleFactor = 0.1; // Needed for heightmap terrain
const dummyUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // 1x1 transparent PNG

// --- Initialization ---
function initializeApp() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) { console.error("Canvas not found!"); return; }
  engine = new Engine(canvas, true);
  scene = new Scene(engine);
  scene.clearColor = new Color4(0.2, 0.3, 0.4, 1.0);

  // --- Debug Layer ---
  scene.debugLayer.show({ embedMode: true }).then(() => {
    console.log("[Debug] Babylon.js Debug Layer initialized.");
  }).catch((err) => {
    console.error("[Debug] Error initializing Debug Layer:", err);
  });

  // --- Camera Setup ---
  camera = new FreeCamera("camera1", new Vector3(0, 25, -40), scene);
  camera.setTarget(new Vector3(0, 0, 0));
  camera.minZ = 0.1;
  camera.attachControl(canvas, true);
  camera.speed = 0.5;
  camera.upperBetaLimit = Math.PI / 2 - 0.1; // Prevent looking straight down/up

  // --- Lighting ---
  const light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
  light.intensity = 0.8;

  // --- Render Loop & Resize ---
  engine.runRenderLoop(() => { if (scene) { scene.render(); } });
  window.addEventListener("resize", () => { engine.resize(); });

  // --- Debug Button (optional) ---
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
  void loadPlaceholderAsset(); // Start loading placeholder model
  initializeColyseus(); // Start connection process
}

// --- Asset Loading ---
async function loadPlaceholderAsset() {
    try {
        console.log("[Assets] Loading placeholder player asset (rubberDuck.glb)...");
        const result = await SceneLoader.ImportMeshAsync("", "/assets/models/", "rubberDuck.glb", scene);
        if (result.meshes.length === 0) { console.warn("[Assets] Placeholder GLB loaded but contains 0 meshes."); return; }
        console.log("[Assets] --- Inspecting Loaded Meshes ---");
        result.meshes.forEach((m, i) => { const vertexCount = (m instanceof Mesh) ? m.getTotalVertices() : 'N/A (TransformNode)'; console.log(`  Mesh[${i}]: Name='${m.name}', Type='${m.getClassName()}', Vertices=${vertexCount}`); });
        console.log("[Assets] -------------------------------");

        const rootNode = new TransformNode("placeholderPlayerTemplate", scene);

        // Handle potential __root__ node from SceneLoader
        for (const loadedMesh of result.meshes) {
            if (loadedMesh.name === "__root__" && loadedMesh.parent === null) {
                console.log("[Assets] Found SceneLoader __root__, parenting its children instead.");
                const childrenMeshes = loadedMesh.getChildMeshes(false); // Don't get descendants
                childrenMeshes.forEach(child => child.setParent(rootNode));
                const childrenNodes = loadedMesh.getChildTransformNodes(false);
                childrenNodes.forEach(childNode => childNode.setParent(rootNode));
                loadedMesh.dispose(); // Dispose the empty __root__
            } else if (loadedMesh.parent === null) { // Parent other root-level meshes/nodes
                loadedMesh.setParent(rootNode);
            }
        }

        rootNode.setEnabled(false); // Keep template hidden
        placeholderPlayerMesh = rootNode;
        console.log("[Assets] Placeholder root node created and meshes parented.");
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
      scale: state.heightScale
  });

  // Validate parameters
  const seed = state.worldSeed;
  const terrainWidth = Number(state.terrainWidth);
  const terrainHeight = Number(state.terrainHeight); // This is XZ size
  let terrainSubdivisions = Math.floor(Number(state.terrainSubdivisions));
  const heightScale = Number(state.heightScale); // This is the Y scaling factor

  if (!seed || isNaN(terrainWidth) || isNaN(terrainHeight) || isNaN(terrainSubdivisions) || isNaN(heightScale) ||
      terrainWidth <= 0 || terrainHeight <= 0 || terrainSubdivisions <= 0 || heightScale <= 0) {
    console.error("[Client WG] Invalid terrain parameters received. Aborting terrain creation.", { seed, terrainWidth, terrainHeight, terrainSubdivisions, heightScale });
    // Default subdivisions if invalid, but still check others
    if (isNaN(terrainSubdivisions) || terrainSubdivisions <= 0) {
        console.warn("[Client WG] Subdivisions invalid, defaulting to 1.");
        terrainSubdivisions = 1;
        // Re-check if other params are still invalid after defaulting subdivisions
        if (!seed || isNaN(terrainWidth) || isNaN(terrainHeight) || isNaN(heightScale) || terrainWidth <= 0 || terrainHeight <= 0 || heightScale <= 0) {
             return; // Abort if other critical params are bad
        }
    } else {
        return; // Abort if subdivisions were valid but others weren't
    }
  }

  const points = terrainSubdivisions + 1; // Number of vertices along each side
  console.log(`[Client WG] Generating terrain mesh using seed: ${seed} (Points per side: ${points})`);

  // 1. Generate NORMALIZED Height Data (0.0 to 1.0)
  const noise2D = createNoise2D(mulberry32(seed));
  const heightMapJsArray: number[] = [];
  for (let j = 0; j < points; j++) {
    for (let i = 0; i < points; i++) {
      // Map grid point to world coordinates for noise sampling
      const x = (i / (points - 1)) * terrainWidth - terrainWidth / 2;
      const z = (j / (points - 1)) * terrainHeight - terrainHeight / 2;
      const nVal = noise2D(x * noiseScaleFactor, z * noiseScaleFactor); // Noise value approx -1 to 1

      // Normalize the noise value to the 0.0 to 1.0 range
      const h_normalized = (nVal + 1) / 2;
      heightMapJsArray.push(h_normalized);
    }
  }

  // Validate generated height data array
  const expectedLength = points * points;
  let dataIsValid = true;
  if (heightMapJsArray.length !== expectedLength) {
      console.error(`[Client WG] Heightmap length mismatch! Expected ${expectedLength}, Got ${heightMapJsArray.length}.`);
      dataIsValid = false;
  } else {
      for (let k = 0; k < heightMapJsArray.length; k++) {
          if (!Number.isFinite(heightMapJsArray[k])) {
              console.error(`[Client WG] Invalid value in normalized heightMap at index ${k}: ${heightMapJsArray[k]}.`);
              dataIsValid = false;
              break;
          }
          // Optional: Check if values are roughly within 0-1
          if (heightMapJsArray[k] < -0.01 || heightMapJsArray[k] > 1.01) {
               console.warn(`[Client WG] Normalized height value ${heightMapJsArray[k]} at index ${k} is outside expected 0-1 range.`);
          }
      }
  }
  if (!dataIsValid) {
      console.error("[Client WG] Heightmap validation failed. Aborting terrain creation.");
      return;
  }

  const heightMapFloat32 = new Float32Array(heightMapJsArray);
  console.log(`[Client WG] Converted NORMALIZED heightmap to Float32Array (length: ${heightMapFloat32.length})`);

  // 2. Prepare Ground Options with onReady Callback
  const groundOptions = {
      width: terrainWidth,            // X size
      height: terrainHeight,          // Z size
      subdivisions: terrainSubdivisions,
      minHeight: 0,                   // Minimum Y value after scaling
      maxHeight: heightScale,         // Maximum Y value after scaling
      updatable: false,               // Set true if you need to update geometry later
      buffer: heightMapFloat32,       // The normalized 0-1 height data
      bufferWidth: points,            // Width of the buffer grid
      bufferHeight: points,           // Height of the buffer grid

      // --- onReady Callback ---
      onReady: (mesh: Mesh) => {
          console.log("[Client WG - onReady] Terrain mesh is ready!");
          terrainMesh = mesh as GroundMesh; // Assign to the global variable

          // --- BEGIN MANUAL VERTEX UPDATE ---
          try {
              console.log("[Client WG - ManualUpdate] Attempting manual vertex Y update...");
              const positions = terrainMesh.getVerticesData(VertexBuffer.PositionKind);
              const normalizedBuffer = heightMapFloat32; // Use the buffer we already have (0-1 values)
              const scale = heightScale; // The desired final height scale (e.g., 5)

              if (positions && normalizedBuffer.length === positions.length / 3) {
                  // Iterate through each vertex
                  for (let i = 0; i < normalizedBuffer.length; i++) {
                      // The Y coordinate is at index i * 3 + 1 in the positions array
                      positions[i * 3 + 1] = normalizedBuffer[i] * scale; // Apply scaling manually
                  }

                  // Apply the modified positions back to the mesh geometry
                  terrainMesh.updateVerticesData(VertexBuffer.PositionKind, positions, false, false);
                  console.log("[Client WG - ManualUpdate] Manual vertex Y update applied.");

                  // Optional: Re-log vertex data after manual update to verify
                  const updatedPositions = terrainMesh.getVerticesData(VertexBuffer.PositionKind);
                   if (updatedPositions) {
                      console.log("[Client WG - ManualUpdate] Post-Update: First 10 Y-coords:", updatedPositions.slice(1, 30, 3));
                      let minY = Infinity, maxY = -Infinity;
                      for (let i = 1; i < updatedPositions.length; i += 3) {
                           if (!isNaN(updatedPositions[i])) {
                              if (updatedPositions[i] < minY) minY = updatedPositions[i];
                              if (updatedPositions[i] > maxY) maxY = updatedPositions[i];
                           }
                      }
                      console.log(`[Client WG - ManualUpdate] Post-Update: Actual Mesh MinY: ${minY}, MaxY: ${maxY}`);
                   } else {
                       console.error("[Client WG - ManualUpdate] Failed to get positions after update!");
                   }

              } else {
                  if (!positions) {
                       console.error("[Client WG - ManualUpdate] Failed to get initial positions array.");
                  } else {
                       console.error(`[Client WG - ManualUpdate] Buffer length (${normalizedBuffer.length}) does not match vertex count (${positions.length / 3}). Cannot update.`);
                  }
              }
          } catch(e) {
               console.error("[Client WG - ManualUpdate] Error during manual vertex update:", e);
          }
          // --- END MANUAL VERTEX UPDATE ---


          // Log vertex data (Original log, may show 0s before manual update finishes if console is fast)
          // ... (kept the original logging block below the manual update for comparison if needed)
          try {
              const positions = terrainMesh.getVerticesData(VertexBuffer.PositionKind); // Re-get in case update was fast
              if (positions) {
                  // This might still show 0s if logged immediately, the Post-Update log above is more reliable
                  // console.log("[Client WG - onReady] Initial First 10 Y-coords:", positions.slice(1, 30, 3));
                  // ... (rest of original min/max logging) ...
                  const vertexCount = positions.length / 3;
                  console.log("[Client WG - onReady] Terrain mesh vertex count:", vertexCount); // Should be 441
              } else {
                  console.error("[Client WG - onReady] getVerticesData returned null or undefined!");
              }
          } catch(e) {
               console.error("[Client WG - onReady] Error getting/processing vertex data:", e);
          }

          // Assign material INSIDE onReady (Remains the same)
          const mat = new StandardMaterial("terrainMat", scene);
          try {
              const tex = new Texture("/assets/textures/grass.jpg", scene);
              tex.uScale = terrainWidth / 4; // Adjust texture scaling as needed
              tex.vScale = terrainHeight / 4;
              mat.diffuseTexture = tex;
              console.log("[Client WG - onReady] Grass texture loaded and applied.");
          } catch (e) {
              console.error("[Client WG - onReady] Failed loading grass texture:", e);
              mat.diffuseColor = new Color3(0.3, 0.6, 0.3); // Fallback color
          }
          terrainMesh.material = mat;
          terrainMesh.receiveShadows = true; // Allow terrain to receive shadows
          console.log("[Client WG - onReady] Material assigned.");
          console.log("[Client WG - onReady] Terrain mesh final position:", terrainMesh.position);

      }, // --- END onReady ---

      // --- onError Callback ---
      onError: (message?: string, exception?: any) => {
          console.error(`[Client WG - onError] Terrain creation failed asynchronously: ${message}`, exception);
      }
  };

  console.log("[Client WG] Calling CreateGroundFromHeightMap with onReady callback:", groundOptions);

  // 3. Call MeshBuilder (asynchronously)
  try {
    // We call the function, but the actual mesh setup happens in onReady.
    // We don't assign the result here.
    MeshBuilder.CreateGroundFromHeightMap("terrain", dummyUrl, groundOptions, scene);
    console.log("[Client WG] CreateGroundFromHeightMap function call initiated (onReady callback is pending).");

  } catch (meshError) {
      // This catch might not fire if the error happens asynchronously in onReady/onError
      console.error("[Client WG] Immediate Error during CreateGroundFromHeightMap function call:", meshError);
      return;
  }
}


// --- Colyseus Connection ---
function initializeColyseus() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  // Replit typically proxies port 80/443 externally to your internal port (like 2567)
  // So, we usually don't need to specify the port for the client connection URL
  // const port = window.location.port ? `:${window.location.port}` : (proto === 'wss' ? ':443' : ':80'); // Original logic
  const port = ""; // Let the browser use default ports (80/443)

  // Construct endpoint (adjust if using a custom domain or different setup)
  let endpoint = `${proto}://${host}${port}`;

  // Special handling for Replit development environment preview URL
  if (host.endsWith(".replit.dev")) {
       console.log("[Colyseus] Detected Replit environment, using standard ports for connection.");
       // Endpoint is likely correct without port for replit.dev previews
   } else {
       // For local development or other deployments, you might need the port
       // If running locally and server is on 2567, client connects to 2567
       // endpoint = `${proto}://localhost:2567`; // Example for local dev
       console.log("[Colyseus] Not a replit.dev host, using calculated endpoint:", endpoint);
   }


  console.log(`[Colyseus] Calculated Endpoint: ${endpoint}`); // Log final endpoint

  try {
    client = new Colyseus.Client(endpoint);
    console.log("[Colyseus] Client created.");
    void connectToRoom(); // Start connection attempt
  } catch(e) {
    console.error("[Colyseus] Client initialization failed:", e);
    displayConnectionError("Failed to initialize connection client.");
  }
}

async function connectToRoom() {
  try {
    console.log("[Colyseus] Attempting to join or create 'my_room'...");
    const joinOptions = { /* Add any needed join options */ };
    room = await client.joinOrCreate<MyRoomState>("my_room", joinOptions);

    console.log(`[Colyseus] Successfully joined! Session ID: ${room.sessionId}`);
    console.log("[Colyseus] Initial state received:", room.state.toJSON());

    setupRoomListeners(); // Setup listeners *after* successful join

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

    // --- State Change Listener ---
    room.onStateChange((state: MyRoomState) => {
        console.log(`[Colyseus] State update received. Player count: ${state.players.size}`);

        // Create terrain on first valid state containing world data
        if (isFirstState && state.worldSeed && state.worldSeed !== "default") {
            console.log("[Client WG] First valid state received, attempting terrain creation...");
            try {
                 createOrUpdateTerrain(state, scene); // Generate the terrain
                 isFirstState = false; // Ensure terrain is created only once
            } catch (terrainError) {
                 console.error("[Client WG] Error processing initial state for terrain:", terrainError);
            }
        } else if (isFirstState) {
             console.log("[Client WG] Waiting for first state with valid world seed...");
        }

        // --- Player Sync Logic ---
        const serverIds = new Set(state.players.keys());
        // console.log("[Sync] Server Player IDs:", Array.from(serverIds));
        // console.log("[Sync] Local Player IDs in Map:", Array.from(playerMeshMap.keys()));

        // Add/Update players based on server state
        state.players.forEach((playerState: PlayerState, sessionId) => {
            // console.log(`[Sync] Processing player: ${sessionId}`);
            let playerNode = playerMeshMap.get(sessionId);

            if (!playerNode) { // Player doesn't exist locally, create them
                // console.log(`[Sync] No node found for ${sessionId}. Placeholder Root loaded:`, !!placeholderPlayerMesh);
                if (placeholderPlayerMesh) {
                    try {
                        const clonedRoot = placeholderPlayerMesh.clone(`player_${sessionId}`, null, false); // Clone the template
                        if (clonedRoot && clonedRoot instanceof TransformNode) {
                            playerNode = clonedRoot;
                            playerNode.setEnabled(true); // Make it visible
                            // Set initial position/rotation/scale from server state
                            playerNode.position = new Vector3(playerState.x, playerState.y, playerState.z);
                            playerNode.scaling = new Vector3(1, 1, 1); // Ensure correct scale
                            // playerNode.rotation = new Vector3(0, 0, 0); // Add rotation if synced

                            // playerNode.getChildMeshes(true).forEach(childMesh => { childMesh.showBoundingBox = true; }); // Optional: show bounding box for debug

                            console.log(`[Sync] Cloned ROOT NODE for ${sessionId} at state pos:`, playerNode.position.toString());
                            // console.log(`[Sync] Root Node ${sessionId} scaling:`, playerNode.scaling.toString());

                            playerMeshMap.set(sessionId, playerNode); // Add to our map
                            console.log(`[Sync] Added node for ${sessionId}`);

                            // Attach camera if this is the local player
                            if (sessionId === room?.sessionId) {
                                console.log(`[Camera] Attaching camera to self (${sessionId}).`);
                                // Adjust camera position relative to the player node
                                camera.position = new Vector3(0, 1.5, -5); // Example offset
                                camera.parent = playerNode; // Parent the camera
                            }
                        } else {
                            console.error(`[Sync] Failed to clone placeholder root node for ${sessionId}. Clone result:`, clonedRoot);
                        }
                    } catch (cloneError) {
                         console.error(`[Sync] Error during cloning for ${sessionId}:`, cloneError);
                    }
                } else {
                    console.warn(`[Sync] Cannot create node for ${sessionId}, placeholder not loaded yet.`);
                    return; // Skip if placeholder isn't ready
                }
            }

            // Update position for existing remote players (local player position is driven by camera parent)
            if (playerNode && playerNode instanceof TransformNode && sessionId !== room?.sessionId) {
               // TODO: Implement smoothing/interpolation here later
               playerNode.position.set(playerState.x, playerState.y, playerState.z);
               // Update rotation if needed: playerNode.rotation.set(...)
            }
        });

        // Remove players that left
        playerMeshMap.forEach((node, sessionId) => {
          if (!serverIds.has(sessionId)) {
            console.log(`[Sync] Removing node for disconnected player ${sessionId}`);
            // Detach camera if it was attached to the leaving player
            if (camera.parent === node) {
               camera.parent = null;
               console.log(`[Camera] Detached from leaving player ${sessionId}`);
               // Reset camera position/target if needed
               camera.position = new Vector3(0, 25, -40);
               camera.setTarget(Vector3.Zero());
            }
            node.dispose(false, true); // Dispose node and its hierarchy
            playerMeshMap.delete(sessionId); // Remove from map
          }
        });
    });

    // --- Error Listener ---
    room.onError((code, message) => {
        console.error(`[Colyseus] Room error (Code ${code}): ${message}`);
        displayConnectionError(`Room Error: ${message || 'Unknown error'}`);
        // Optionally attempt to reconnect or show a specific UI message
    });

    // --- Leave Listener ---
    room.onLeave((code) => {
        console.log(`[Colyseus] Left room (Code: ${code})`);
        terrainMesh?.dispose(); // Clean up terrain
        terrainMesh = null;
        playerMeshMap.forEach(node => node.dispose(false, true)); // Dispose all player nodes
        playerMeshMap.clear();
        if (camera.parent) camera.parent = null; // Ensure camera is detached
        camera.position = new Vector3(0, 25, -40); // Reset camera
        camera.setTarget(Vector3.Zero());
        room = null; // Clear room reference
        // Display a message or attempt reconnection
        if (code > 1000) { // Non-standard close codes often indicate issues
           displayConnectionError(`Disconnected (Code: ${code}). Attempting to reconnect...`);
           setTimeout(connectToRoom, 5000); // Simple retry after 5 seconds
        } else {
           displayConnectionError("Disconnected from server.");
        }
    });

    // Start sending input periodically
    setInterval(sendInput, 50); // Approx 20 times per second
    console.log("[Colyseus] Room listeners attached.");
}

// --- Input Handling ---
function setupInputListeners() {
  window.addEventListener("keydown", (event) => {
    switch (event.key.toLowerCase()) {
      case "w": case "arrowup": inputState.forward = true; break;
      case "s": case "arrowdown": inputState.backward = true; break;
      case "a": case "arrowleft": inputState.left = true; break;
      case "d": case "arrowright": inputState.right = true; break;
    }
  });

  window.addEventListener("keyup", (event) => {
    switch (event.key.toLowerCase()) {
      case "w": case "arrowup": inputState.forward = false; break;
      case "s": case "arrowdown": inputState.backward = false; break;
      case "a": case "arrowleft": inputState.left = false; break;
      case "d": case "arrowright": ionreadynputState.right = false; break;
    }
  });
   console.log("[Input] Keyboard listeners set up.");
}

function sendInput() {
  if (room && room.connection.isOpen) {
    // Only send if input state has changed? (Optimization - requires more state tracking)
    // console.log("[Input] Sending:", inputState); // Debug log
    room.send("input", inputState);
  }
}

// --- Error Display ---
function displayConnectionError(error: any) {
    console.error("[Error Display]", error);
    // Simple alert for now, replace with better UI later
    const message = (error instanceof Error) ? error.message : String(error);
    alert(`Connection Error: ${message}\nPlease refresh the page.`);
    // You could add a div to the HTML and display the error there
    // const errorDiv = document.getElementById("errorDisplay");
    // if (errorDiv) {
    //     errorDiv.textContent = `Error: ${message}`;
    //     errorDiv.style.display = 'block';
    // }
}

// --- Start Application ---
document.addEventListener("DOMContentLoaded", initializeApp);
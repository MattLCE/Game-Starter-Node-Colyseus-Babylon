import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
// OR alternatively, sometimes it's directly in core, but math.color is safer:
// import { Color3 } from "@babylonjs/core"; // Less likely needed if math.color works
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial"; // For the ground
import "@babylonjs/core/Meshes/meshBuilder"; // Ensure MeshBuilder methods are available

// Import Colyseus Client SDK
import * as Colyseus from "colyseus.js";

// Get the canvas element
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

// Create Babylon.js engine
const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
});

// Create scene
const scene = new Scene(engine);

// Create a camera
const camera = new FreeCamera("camera1", new Vector3(0, 5, -10), scene);
camera.setTarget(Vector3.Zero()); // Look at the center
camera.attachControl(canvas, true); // Allow camera control with mouse/touch

// Create a light
const light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
light.intensity = 0.7;

// Create ground material
const groundMaterial = new GridMaterial("groundMaterial", scene);
groundMaterial.majorUnitFrequency = 5;
groundMaterial.minorUnitVisibility = 0.45;
groundMaterial.gridRatio = 1;
groundMaterial.mainColor = new Color3(1, 1, 1); // Use BABYLON namespace or import Color3
groundMaterial.lineColor = new Color3(1.0, 1.0, 1.0);
groundMaterial.opacity = 0.98;

// Create ground plane
const ground = MeshBuilder.CreateGround(
  "ground1",
  { width: 50, height: 50 },
  scene
);
ground.material = groundMaterial;

// --- Colyseus Client Setup ---

// In client/src/client.ts

// Construct URL based on current location protocol and hostname
const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const hostname = window.location.hostname;
// Assume Replit proxies WSS/WS on the default ports (443/80) for the main hostname
const wsEndpoint = `${protocol}://${hostname}`;

console.log(`Attempting to connect to Colyseus at: ${wsEndpoint}`);

const client = new Colyseus.Client(wsEndpoint);

let room: Colyseus.Room | null = null; // Variable to hold the room instance

async function connect() {
  try {
    // Join or create a room instance
    // Replace 'MyRoomState' with your actual state schema type if needed later
    room = await client.joinOrCreate<any>("my_room"); // Using <any> for state initially

    console.log("[Colyseus] Joined room successfully!");
    console.log("[Colyseus] Session ID:", room.sessionId);
    console.log("[Colyseus] Initial room state:", room.state);

    // Listen for state changes
    room.onStateChange((state) => {
      console.log("[Colyseus] State update received:", state);
      // --- TODO: Update Babylon scene based on state ---
      // Example: Iterate through state.players and create/update meshes
    });

    // Listen for errors
    room.onError((code, message) => {
      console.error(`[Colyseus] Error (${code}): ${message}`);
    });

    // Listen for leave event
    room.onLeave((code) => {
      console.log(`[Colyseus] Left room with code: ${code}`);
      room = null; // Clear room reference
    });
  } catch (e) {
    console.error("[Colyseus] Join Error:", e);
    // Handle connection error (e.g., show message to user)
  }
}

// Attempt connection when the script loads
connect();

// --- Babylon Render Loop ---
engine.runRenderLoop(() => {
  scene.render();
});

// --- Babylon Resize Handling ---
window.addEventListener("resize", () => {
  engine.resize();
});

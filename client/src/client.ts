import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import "@babylonjs/core/Meshes/meshBuilder"; // Ensure MeshBuilder methods

// Import Colyseus Client SDK
import * as Colyseus from "colyseus.js";
// Import your specific state if defined, otherwise use any for now
// import { MyRoomState } from "../../server/src/myroom"; // Example if state is shared

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
camera.setTarget(Vector3.Zero());
camera.attachControl(canvas, true);

// Create a light
const light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
light.intensity = 0.7;

// Create ground material
const groundMaterial = new GridMaterial("groundMaterial", scene);
groundMaterial.majorUnitFrequency = 5;
groundMaterial.minorUnitVisibility = 0.45;
groundMaterial.gridRatio = 1;
groundMaterial.mainColor = new Color3(1, 1, 1);
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
const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const hostname = window.location.hostname;
// Replit proxy handles port mapping, connect to root hostname
const wsEndpoint = `${protocol}://${hostname}`;

console.log(`Attempting to connect to Colyseus at: ${wsEndpoint}`);

const client = new Colyseus.Client(wsEndpoint);

let room: Colyseus.Room | null = null; // Variable to hold the room instance

async function connect() {
  // No try/catch here, let the caller handle it
  console.log("[Colyseus] Attempting to join or create room...");
  room = await client.joinOrCreate<any>("my_room"); // Using <any> for state initially

  console.log("[Colyseus] Joined room successfully!");
  console.log("[Colyseus] Session ID:", room.sessionId);
  console.log("[Colyseus] Initial room state:", room.state);

  // Listen for state changes
  room.onStateChange((state) => {
    console.log("[Colyseus] State update received:", state);
    // --- TODO: Update Babylon scene based on state ---
  });

  // Listen for errors
  room.onError((code, message) => {
    console.error(`[Colyseus] Error in room (${code}): ${message}`);
    // Maybe try to reconnect or show user message
  });

  // Listen for leave event
  room.onLeave((code) => {
    console.log(`[Colyseus] Left room with code: ${code}`);
    room = null; // Clear room reference
    // Maybe show user message or attempt reconnect
  });
}

// --- Babylon Render Loop ---
engine.runRenderLoop(() => {
  scene.render();
});

// --- Babylon Resize Handling ---
window.addEventListener("resize", () => {
  engine.resize();
});

// --- Initiate Connection (with error handling) ---
// Use an Immediately Invoked Async Function Expression (IIAFE)
void (async () => {
  try {
    await connect(); // Call the async connect function and wait for it
    console.log("[Colyseus] Initial connection successful.");
  } catch (e) {
    // This catches errors specifically from the joinOrCreate call
    console.error("[Colyseus] Failed initial connection:", e);
    // Display an error message to the user on the page?
    const body = document.querySelector("body");
    if (body) {
      const errorDiv = document.createElement("div");
      errorDiv.textContent = `Failed to connect to server: ${e instanceof Error ? e.message : String(e)}`;
      // Style the error message (optional but helpful)
      errorDiv.style.color = "red";
      errorDiv.style.position = "absolute";
      errorDiv.style.top = "10px";
      errorDiv.style.left = "10px";
      errorDiv.style.zIndex = "1000"; // Ensure it's visible
      errorDiv.style.backgroundColor = "black";
      errorDiv.style.padding = "10px";
      errorDiv.style.border = "1px solid red";
      body.appendChild(errorDiv);
    }
  }
})(); // <-- Invoke the function immediately

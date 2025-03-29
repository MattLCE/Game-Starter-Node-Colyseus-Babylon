# Game Architecture Overview

This document outlines the core technical architecture of the game project, focusing on the foundational choices made for the initial prototype and beyond.

## Core Philosophy

*   **Authoritative Server:** The server is the single source of truth for all gameplay-critical state and logic validation to ensure consistency and prevent cheating.
*   **Dumb Client:** The client primarily focuses on rendering the state received from the server, running local cosmetic effects, and sending user input/intent to the server. Client-side prediction may be added later for smoother local movement but will always be reconciled with server state.
*   **Web Native:** Built using web technologies (TypeScript, Node.js, WebGL) for broad accessibility via browsers.
*   **Iterative Development:** Start with a minimal viable foundation and layer complexity incrementally, supported by robust tooling and processes.

## Technology Stack (Foundation)

1.  **Client-Side Rendering:**
    *   **Engine:** **Babylon.js** (`@babylonjs/core`, `@babylonjs/materials`, etc.)
    *   **Purpose:** Handles all 3D rendering (scene, meshes, materials, lighting, effects), asset loading (glTF/glb), and provides the main render loop (`requestAnimationFrame`).
    *   **Language:** TypeScript

2.  **Server-Side Networking & State Synchronization:**
    *   **Framework:** **Colyseus** (`@colyseus/core`, `@colyseus/schema`)
    *   **Purpose:** Manages WebSocket connections, room instances/lifecycles, player sessions, and provides an efficient schema-based state synchronization mechanism (sending deltas). Orchestrates the server-side game loop.
    *   **Runtime:** Node.js
    *   **Language:** TypeScript

3.  **Server-Side Core Game Simulation:**
    *   **Implementation:** Custom TypeScript code running within the Colyseus Room's simulation interval (`setSimulationInterval`).
    *   **Pattern:** **Entity Component System (ECS)** (using `geotic` - *Planned*) will be used to structure game entities (players, NPCs, items), their data (components like Position, Health, Inventory), and the logic that operates on them (systems like MovementSystem, CollectionSystem, CombatSystem).
    *   **Purpose:** Contains all authoritative game rules, processes inputs, updates state based on simulation logic, interacts with physics. Modifies the Colyseus state schema which is then broadcast to clients.

4.  **Server-Side Physics:**
    *   **Engine:** **Rapier.js** (via `@dimforge/rapier3d-compat`) - *Planned*
    *   **Purpose:** Handles authoritative collision detection, rigid body dynamics, triggers, and potentially basic character control constraints on the server. The results (updated positions, rotations, collision events) will be reflected in the Colyseus state.
    *   **Note:** Client may run a cosmetic-only version or rely purely on server state for physics results.

5.  **Client UI:**
    *   **Primary:** Vanilla **HTML / CSS / JS (TS)** overlays managed via standard DOM manipulation, positioned absolutely over the Babylon canvas. Used for menus (Station Screen), complex HUDs, buttons. Show/hide based on client-side game state machine.
    *   **Secondary (Optional):** **Babylon.js GUI** for simple in-world UI elements directly tied to 3D objects if needed.

6.  **Build Tools:**
    *   **Client:** **Vite** (Bundling TypeScript, assets, development server).
    *   **Server:** **tsc** (TypeScript Compiler).

7.  **Development Tooling:**
    *   **Version Control:** Git / GitHub
    *   **Linting:** ESLint (with TypeScript plugin)
    *   **Formatting:** Prettier
    *   **Unit Testing:** Vitest

## Communication Flow (Simplified Example: Player Move)

1.  **Client:** Captures keyboard/touch input.
2.  **Client:** Throttles input and sends a message like `room.send("moveInput", { direction: ... })` via Colyseus Client SDK.
3.  **Server (Network Layer):** Colyseus receives the WebSocket message.
4.  **Server (Colyseus Room):** The `onMessage("moveInput", ...)` handler receives the message and stores the player's *intent*.
5.  **Server (Game Loop Tick):**
    *   The main simulation function runs.
    *   An `InputProcessingSystem` (ECS) reads the stored intent.
    *   A `StatusEffectSystem` checks if the player is stunned/rooted.
    *   A `PhysicsSystem` (interacting with Rapier.js) calculates potential movement based on intent, current velocity, forces (gravity, explosions), and collision checks.
    *   The system determines the final authoritative position for this tick.
    *   The authoritative position is written to the `PositionComponent` associated with the player entity, which updates the corresponding fields in the Colyseus `Player` state schema.
6.  **Server (Colyseus State Sync):** Colyseus detects the change in the `Player` state (position updated).
7.  **Server (Network Layer):** Colyseus generates a delta patch and broadcasts it to all clients in the room.
8.  **Client (Network Layer):** Colyseus Client SDK receives the patch.
9.  **Client:** SDK applies the patch to the local replica of the room state.
10. **Client (Render Loop / State Listener):** Code detects the change in the local player state replica.
11. **Client:** Updates the position of the corresponding Babylon.js mesh (potentially interpolating smoothly towards the new authoritative position).

## State Management

*   **Authoritative State:** Resides on the Server within the Colyseus Room's state object, defined by `@colyseus/schema`. This includes player positions, inventories, item states, NPC states, environment states, etc. Managed via ECS on the server.
*   **Client State Replica:** The Colyseus Client SDK maintains a local, automatically updated copy of the server's shared state.
*   **Client UI State:** Managed separately using simple variables or a state machine (e.g., `currentGameState`) to control UI visibility (HTML overlays) and potentially aspects of the Babylon scene (e.g., pausing rendering).
*   **Persistence:** Initially `localStorage` on the client *after server confirmation* (e.g., for deposited items). **Planned:** Server-side database (PostgreSQL/MongoDB via BaaS like Supabase/Firebase or self-managed) integrated with the Colyseus server, linked to user accounts for true persistence.

## Future Considerations

*   Authentication & User Accounts
*   Server-side Persistence (Database)
*   Scalable Hosting (e.g., Colyseus Arena Cloud, Render, Cloud VMs)
*   CDN (Cloudflare)
*   Monitoring & Analytics
*   Advanced Physics Interactions
*   Complex Environmental Simulation Rules

This document provides a snapshot of the intended architecture. Details will be refined, and components added as development progresses.
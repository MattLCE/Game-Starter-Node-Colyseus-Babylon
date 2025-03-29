# Game Design & Mechanics

This document describes the specific gameplay mechanics, rules, entities, and state required for the game, built upon the technical platform defined in `DESIGN-PLATFORM.md`.

See also:
*   [`ARCHITECTURE.md`](./ARCHITECTURE.md) (Higher-level overview)
*   [`DESIGN-PLATFORM.md`](./DESIGN-PLATFORM.md) (Technical foundation)
*   [`CONTRIBUTING.md`](./CONTRIBUTING.md) (Development processes)

## 1. Game Concept

This is a 3D, session-based, multiplayer looter-survivor game with a humorous cyberpunk-lite sci-fi setting. Players drop onto a dangerous, procedurally generated alien world to collect valuable resources and deposit them at an extraction point (dropship) within a short time limit, competing implicitly (and potentially explicitly later) with other players and hazardous environments/creatures. The core tension revolves around risk vs. reward.

## 2. Core Gameplay Loop

1.  **Station:** Player starts at a simple UI screen showing persistent scores/currency. Clicks "Start Drop".
2.  **Drop:** Client connects to server room, player entity spawns near the Dropship in the 3D world. Session timer starts.
3.  **Explore & Collect:** Player moves around the environment, avoiding hazards, finding and collecting resource items. Items add to a *session* inventory.
4.  **Deposit:** Player moves near the Dropship. Items in session inventory are automatically transferred, adding to a persistent score/currency (initially stored in `localStorage`, later server DB). Session inventory is cleared.
5.  **Session End:** A server-side timer (e.g., 5-10 minutes, 1 minute for testing) runs out.
6.  **Return:** Client is notified, gameplay stops, client disconnects, returns to the Station screen showing updated persistent score. Server resets the room state for the next session.
7.  **(Future):** Player death mechanics return the player to the Station immediately, potentially losing session inventory.

## 3. Key Mechanics (Foundation & Phase 1)

*   **Player Movement:**
    *   Client captures WASD/touch joystick input.
    *   Client sends throttled `moveInput` intent messages to server.
    *   Server receives intent, applies physics (gravity, collisions via Rapier.js - *Planned*), checks status effects (stunned etc.), calculates final position.
    *   Server updates player `PositionComponent` / Colyseus state.
    *   Clients receive updated position and render/interpolate the player mesh.
*   **Item Spawning:**
    *   Server periodically spawns `Item` entities at valid locations within the world bounds.
    *   Item state (ID, type, position) synced via Colyseus schema.
    *   Client renders item meshes based on received state.
*   **Item Collection:**
    *   Client checks distance between local player and nearby item meshes.
    *   If close, client sends `requestCollect` message with `itemId`.
    *   Server receives message, validates:
        *   Does item `itemId` exist in server state?
        *   Is player (`client.sessionId`) reasonably close to the item's authoritative position?
        *   Is the player allowed to collect (e.g., not inventory full later)?
    *   If valid, server removes item from state, potentially adds item type/count to player's *server-side* session inventory representation (in ECS component / Colyseus state), and broadcasts `itemRemoved` / `collectionSuccess`.
    *   Client receives confirmation/state update, plays feedback, updates session inventory UI.
*   **Item Deposit (Automatic Proximity):**
    *   Client checks distance between local player and fixed `DROPSHIP_POS`.
    *   If close AND player has items in session inventory AND not on deposit cooldown:
        *   Client sends `requestDeposit` message (potentially with session inventory content).
        *   Server receives message, validates proximity (optional but good).
        *   Server calculates persistent score increase based on deposited items.
        *   Server updates player's persistent score (in DB later; for now, just confirms).
        *   Server clears player's server-side session inventory representation.
        *   Server sends `depositConfirmed` message back to client.
    *   Client receives `depositConfirmed`.
        *   Updates `localStorage` with new total score.
        *   Clears local `sessionInventory` object & UI.
        *   Starts local deposit cooldown timer.
        *   Displays confirmation feedback.
*   **Session Timer:**
    *   Server manages timer. Starts when first player joins an empty room.
    *   Server broadcasts `sessionTimeUpdate` periodically.
    *   Client displays time remaining in HUD.
    *   When timer ends, server broadcasts `sessionEnd`, disconnects clients after delay, resets room state.
    *   Client handles `sessionEnd` by showing message, freezing input, returning to Station Screen.

## 4. Entities & Components (Initial ECS Plan)

*(This will expand significantly)*

*   **Entities:** `Player`, `Item`, `NPC_Collector` (for validation feature), `DropshipMarker` (static).
*   **Components (Examples):**
    *   `PositionComponent { x, y, z }` (Synced via Colyseus Schema)
    *   `RotationComponent { y }` (or Quaternion) (Synced via Colyseus Schema)
    *   `VelocityComponent { x, y, z }` (Server-side for physics)
    *   `PlayerInputComponent { desiredMoveX, desiredMoveZ }` (Server-side, temporary per tick)
    *   `ColliderComponent { shape, physicsHandle }` (Server-side for Rapier.js)
    *   `RenderableComponent { meshId/type, materialId }` (Client-side mapping state to Babylon mesh)
    *   `ItemComponent { type, value }` (Server/Synced)
    *   `CollectibleComponent {}` (Marker component for items)
    *   `InventoryComponent { items: Map<itemType, count> }` (Server-side session inventory)
    *   `PersistentScoreComponent { score }` (Server-side, loaded/saved to DB later)
    *   `NpcBehaviorComponent { state: 'wandering' | 'seeking_item' | 'returning', targetId? }` (Server-side)
    *   `StealableComponent {}` (Marker for entities that can steal/be stolen from)

## 5. State Schema (`MyRoomState` - Initial)

```typescript
// Located potentially in /shared or /server/src/rooms/schema
import { Schema, MapSchema, type } from "@colyseus/schema";

export class Position extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 0;
}

export class Player extends Schema {
  @type(Position) position = new Position();
  // @type("number") rotationY: number = 0; // Add later
  @type("number") itemCount: number = 0; // Simple session count for now
  // @type("string") name: string = ""; // Add later
}

export class Item extends Schema {
  @type("string") itemType: string = "default";
  @type(Position) position = new Position();
}

// Placeholder for validation feature NPC
export class NpcCollector extends Schema {
   @type(Position) position = new Position();
   @type("number") itemCount: number = 0; 
}

export class MyRoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Item }) items = new MapSchema<Item>();
  @type({ map: NpcCollector }) npcCollectors = new MapSchema<NpcCollector>();
  @type("number") remainingTime: number = 300000; // Milliseconds (e.g., 5 mins)
}
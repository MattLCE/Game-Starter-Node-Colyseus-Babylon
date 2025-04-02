// server/src/myroom.ts
import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import {
  IWorld,
  defineComponent,
  addComponent,
  removeComponent,
  defineQuery,
  enterQuery,
  exitQuery,
  hasComponent,
  Types,
  addEntity,
  Query,
  createWorld,
} from "bitecs";
import RAPIER from "@dimforge/rapier3d-compat";

// -- ECS Components --
export const Vector3Schema = { x: Types.f32, y: Types.f32, z: Types.f32 };
export const Position = defineComponent(Vector3Schema);
export const Velocity = defineComponent(Vector3Schema); // Keep Velocity component
export const PlayerInput = defineComponent({
  left: Types.ui8,
  right: Types.ui8,
  forward: Types.ui8,
  backward: Types.ui8,
});

// -- Colyseus State --
export class PlayerState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 0;
}

export class MyRoomState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

// -- Interfaces --
// Exporting InputPayload to fix TS2742 in test file
export interface InputPayload {
  left: boolean;
  right: boolean;
  forward: boolean;
  backward: boolean;
}

// -- Room Logic --
export class MyRoom extends Room<MyRoomState> {
  // Make properties definite assignment asserted (!) or initialize directly
  // if confident they are set in onCreate before use.
  private ecsWorld!: IWorld;
  private rapierWorld!: RAPIER.World;
  private playerQuery!: Query;
  private playerQueryEnter!: Query;
  private playerQueryExit!: Query;

  private clientEntityMap: Map<string, number> = new Map();
  private eidToRapierBodyMap: Map<number, RAPIER.RigidBody> = new Map();

  private readonly fixedTimeStep = 1 / 60;
  private readonly speed = 5.0;
  private readonly impulseFactor = 0.2; // Factor for applying impulse difference

  async onCreate(_options: unknown) {
    // Use unknown for unused options
    try {
      console.log("[MyRoom] Room creating! Initializing...");
      this.ecsWorld = createWorld();
      // Define components used in queries explicitly for clarity
      const playerComponents = [Position, PlayerInput];
      this.playerQuery = defineQuery(playerComponents);
      // Create enter/exit queries based on the same component set
      const baseQuery = defineQuery(playerComponents);
      this.playerQueryEnter = enterQuery(baseQuery);
      this.playerQueryExit = exitQuery(baseQuery);
      console.log("[MyRoom] ECS World & Queries Initialized.");

      // Initialize Rapier (ensure this is awaited)
      await RAPIER.init();
      console.log("[MyRoom] Rapier WASM Initialized.");

      const gravity = { x: 0.0, y: -9.81, z: 0.0 };
      this.rapierWorld = new RAPIER.World(gravity);
      console.log("[MyRoom] Rapier World Created.");

      // Create Ground
      const groundSize = 25.0;
      const groundHeight = 0.1;
      const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
        groundSize,
        groundHeight,
        groundSize
      );
      this.rapierWorld.createCollider(groundColliderDesc);
      console.log("[MyRoom] Rapier Ground Created.");

      this.setState(new MyRoomState());
      console.log("[MyRoom] Initial Colyseus State Set.");

      // Register the message handler METHOD
      this.onMessage<InputPayload>("input", this.handleInputMessage);
      console.log("[MyRoom] Message Handlers Set.");

      // Start simulation loop
      this.setSimulationInterval((deltaTime) => {
        try {
          // Add checks for world initialization robustness
          if (!this.ecsWorld || !this.rapierWorld) {
            console.warn(
              "[MyRoom Update] Skipping update, world not initialized."
            );
            return;
          }
          this.update(deltaTime / 1000); // Convert ms to seconds
        } catch (e) {
          console.error("[MyRoom Update Loop Error]", e);
          // Attempt graceful shutdown on loop error
          this.clock.clear(); // Stop simulation interval
          this.disconnect().catch((err) =>
            console.error(
              "Error disconnecting room after update loop failure:",
              err
            )
          );
        }
      }, this.fixedTimeStep * 1000); // Interval in milliseconds

      console.log("[MyRoom] Simulation Loop Started. Initialization Complete.");
    } catch (initError) {
      console.error("!!! CRITICAL ERROR DURING onCreate !!!", initError);
      // Ensure disconnect is attempted even if init fails
      this.disconnect().catch((e) =>
        console.error("Error disconnecting room after onCreate failure:", e)
      );
      // Re-throw or handle appropriately if needed outside
      // throw initError;
    }
  }

  // Public method to handle input messages (moved from inline)
  public handleInputMessage(client: Client, message: InputPayload): void {
    const eid = this.clientEntityMap.get(client.sessionId);
    // Check if entity exists and has the necessary component
    if (eid !== undefined && hasComponent(this.ecsWorld, PlayerInput, eid)) {
      PlayerInput.left[eid] = message.left ? 1 : 0;
      PlayerInput.right[eid] = message.right ? 1 : 0;
      PlayerInput.forward[eid] = message.forward ? 1 : 0;
      PlayerInput.backward[eid] = message.backward ? 1 : 0;
    } else {
      console.warn(
        `[MyRoom] Received input from client ${client.sessionId} (eid: ${eid}), but entity/component not found.`
      );
    }
  }

  onJoin(client: Client, _options: unknown) {
    // Use unknown for unused options
    // Check world initialization *before* proceeding
    if (!this.ecsWorld || !this.rapierWorld) {
      console.error(
        `!!! ERROR during onJoin for client ${client.sessionId}: World not initialized! Disconnecting client.`
      );
      client.leave(); // Attempt to disconnect the client
      return; // Stop further processing
    }

    try {
      console.log(
        `[MyRoom] Client ${client.sessionId} joined! Creating entity...`
      );

      // Create ECS Entity and add components
      const eid = addEntity(this.ecsWorld);
      addComponent(this.ecsWorld, Position, eid);
      addComponent(this.ecsWorld, PlayerInput, eid);
      // Initialize Velocity component if kept
      addComponent(this.ecsWorld, Velocity, eid);

      // Initialize Component Values
      Position.x[eid] = Math.random() * 10 - 5; // Random start position
      Position.y[eid] = 1.0; // Start slightly above ground
      Position.z[eid] = Math.random() * 10 - 5;
      PlayerInput.left[eid] = 0;
      PlayerInput.right[eid] = 0;
      PlayerInput.forward[eid] = 0;
      PlayerInput.backward[eid] = 0;
      Velocity.x[eid] = 0; // Initialize Velocity
      Velocity.y[eid] = 0;
      Velocity.z[eid] = 0;

      // Create Rapier Body and Collider
      const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(Position.x[eid], Position.y[eid], Position.z[eid])
        .setLinvel(0, 0, 0) // Start with zero linear velocity
        .setCcdEnabled(false); // CCD not needed for simple movement usually
      const rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);

      const playerSize = 0.5; // Half-size for cuboid collider
      const colliderDesc = RAPIER.ColliderDesc.cuboid(
        playerSize,
        playerSize,
        playerSize
      )
        .setRestitution(0.1)
        .setFriction(0.5);
      // Associate collider with the rigid body
      this.rapierWorld.createCollider(colliderDesc, rigidBody);

      // Store mappings
      this.eidToRapierBodyMap.set(eid, rigidBody);
      this.clientEntityMap.set(client.sessionId, eid);

      console.log(
        `[MyRoom] Created ECS entity ${eid} and Rapier body for client ${client.sessionId}.`
      );
    } catch (joinError) {
      console.error(
        `!!! ERROR during onJoin processing for client ${client.sessionId} !!!`,
        joinError
      );
      // Attempt to leave the client if an error occurs during setup
      try {
        client.leave();
      } catch (leaveError) {
        console.error(
          "Error trying to force leave client after join error:",
          leaveError
        );
      }
      // Clean up potentially partially created resources if possible (tricky)
      const eid = this.clientEntityMap.get(client.sessionId);
      if (eid !== undefined) {
        this.cleanupEntityResources(eid, client.sessionId); // Call cleanup helper
      }
    }
  }

  update(deltaTime: number): void {
    // Use deltaTime if needed for physics/logic
    // Essential checks at the start of the update loop
    if (
      !this.state ||
      !this.ecsWorld ||
      !this.rapierWorld ||
      !this.playerQuery ||
      !this.playerQueryEnter ||
      !this.playerQueryExit
    ) {
      console.warn(
        "[MyRoom Update] Skipping update due to uninitialized state or queries."
      );
      return;
    }

    // --- Process Input and Apply Forces ---
    try {
      const movingEntities = this.playerQuery(this.ecsWorld);
      for (const eid of movingEntities) {
        const rigidBody = this.eidToRapierBodyMap.get(eid);
        // Skip if rigid body doesn't exist for this entity
        if (!rigidBody) continue;

        // Calculate desired velocity based on input
        const impulse = { x: 0, y: 0, z: 0 };
        let isMoving = false;
        if (PlayerInput.forward[eid]) {
          impulse.z += 1;
          isMoving = true;
        }
        if (PlayerInput.backward[eid]) {
          impulse.z -= 1;
          isMoving = true;
        }
        if (PlayerInput.left[eid]) {
          impulse.x -= 1;
          isMoving = true;
        }
        if (PlayerInput.right[eid]) {
          impulse.x += 1;
          isMoving = true;
        }

        if (isMoving) {
          // Normalize diagonal movement and apply speed
          const magnitude = Math.sqrt(
            impulse.x * impulse.x + impulse.z * impulse.z
          );
          if (magnitude > 0) {
            impulse.x = (impulse.x / magnitude) * this.speed;
            impulse.z = (impulse.z / magnitude) * this.speed;
          }
          // Apply impulse to reach target velocity smoothly
          const currentVel = rigidBody.linvel();
          // Calculate the difference needed, scaled by a factor for smooth acceleration
          const impulseDiff = {
            x: (impulse.x - currentVel.x) * this.impulseFactor,
            y: 0, // Don't apply vertical impulse based on horizontal input
            z: (impulse.z - currentVel.z) * this.impulseFactor,
          };
          // Apply impulse (mass is implicitly 1 here)
          rigidBody.applyImpulse(impulseDiff, true);
        } else {
          // Optional: Apply damping when no input to stop faster
          // const currentVel = rigidBody.linvel();
          // rigidBody.setLinvel({ x: currentVel.x * 0.8, y: currentVel.y, z: currentVel.z * 0.8 }, true);
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during input processing:", e);
      return; // Stop update if input processing fails
    }

    // --- Step Physics Simulation ---
    try {
      this.rapierWorld.step();
    } catch (e) {
      console.error("[MyRoom Update] Error during Rapier step:", e);
      return; // Stop update if physics fails
    }

    // --- Sync State (ECS & Colyseus) from Physics ---
    try {
      const allPlayers = this.playerQuery(this.ecsWorld);
      for (const eid of allPlayers) {
        const rigidBody = this.eidToRapierBodyMap.get(eid);
        // Skip if entity doesn't have a rigid body mapped
        if (!rigidBody) continue;

        const pos = rigidBody.translation();
        const vel = rigidBody.linvel(); // Get linear velocity too

        // Update ECS Position component if it exists
        if (hasComponent(this.ecsWorld, Position, eid)) {
          Position.x[eid] = pos.x;
          Position.y[eid] = pos.y;
          Position.z[eid] = pos.z;
        } else {
          // Log warning if Position component is missing unexpectedly
          console.warn(
            `[MyRoom Update] Entity ${eid} has RigidBody but missing Position component.`
          );
          continue; // Skip to next entity if essential component missing
        }
        // Update ECS Velocity component if it exists
        if (hasComponent(this.ecsWorld, Velocity, eid)) {
          Velocity.x[eid] = vel.x;
          Velocity.y[eid] = vel.y;
          Velocity.z[eid] = vel.z;
        }

        // Update Colyseus state if player exists
        const clientId = this.findClientIdByEid(eid);
        if (clientId) {
          const playerState = this.state.players.get(clientId);
          if (playerState) {
            // Use nullish coalescing for safety when reading from ECS
            playerState.x = Position.x[eid] ?? 0;
            playerState.y = Position.y[eid] ?? 0;
            playerState.z = Position.z[eid] ?? 0;
          } else {
            // This case (entity exists but no player state) might indicate a race condition
            // or logic error where player state wasn't created/synced properly earlier.
            console.warn(
              `[MyRoom Update] Found ECS entity ${eid} for client ${clientId}, but no matching Colyseus player state.`
            );
          }
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during state sync from physics:", e);
      return; // Stop update on sync error
    }

    // --- Handle Player State Additions (Colyseus State side using enterQuery) ---
    try {
      const enteredEntities = this.playerQueryEnter(this.ecsWorld);
      for (const eid of enteredEntities) {
        const clientId = this.findClientIdByEid(eid);
        // Ensure client is mapped, state doesn't already exist, and Position exists
        if (
          clientId &&
          !this.state.players.has(clientId) &&
          hasComponent(this.ecsWorld, Position, eid)
        ) {
          console.log(
            `[Colyseus State] Syncing ADD for player ${clientId} (eid: ${eid})`
          );
          const playerState = new PlayerState();
          // Initialize state from current ECS data (use default if missing)
          playerState.x = Position.x[eid] ?? 0;
          playerState.y = Position.y[eid] ?? 0;
          playerState.z = Position.z[eid] ?? 0;
          this.state.players.set(clientId, playerState);
        } else if (clientId && this.state.players.has(clientId)) {
          console.warn(
            `[MyRoom Update] Enter query triggered for eid ${eid} (client: ${clientId}), but player state already exists.`
          );
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during player join sync:", e);
      return; // Stop update on error
    }

    // --- Handle Player State Removals (Colyseus State side using exitQuery) ---
    try {
      const exitedEntities = this.playerQueryExit(this.ecsWorld);
      // Collect client IDs first to avoid issues if findClientIdByEid relies on maps being modified
      const exitedClientIds: string[] = [];
      for (const eid of exitedEntities) {
        const clientId = this.findClientIdByEid(eid); // Find client ID based on exited eid
        if (clientId) {
          exitedClientIds.push(clientId);
        } else {
          // This indicates an entity was removed from ECS player query
          // but we couldn't map it back to a client ID. Might happen if cleanup was partial.
          console.warn(
            `[MyRoom Update] Exit query triggered for eid ${eid}, but could not find matching client ID.`
          );
        }
      }

      // Now remove the state for the collected client IDs
      for (const clientId of exitedClientIds) {
        if (this.state.players.has(clientId)) {
          console.log(
            `[Colyseus State] Syncing REMOVE for player state ${clientId}`
          );
          this.state.players.delete(clientId);
        } else {
          // This might happen if onLeave already removed the state, which is okay.
          // console.log(`[MyRoom Update] Exit query indicated removal for client ${clientId}, but player state was already gone.`);
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during player leave sync:", e);
      // Don't necessarily stop the whole update loop here, but log the error.
    }
  }

  // Helper function for cleaning up entity resources
  private cleanupEntityResources(eid: number, clientId?: string) {
    const clientDesc = clientId
      ? `client ${clientId} (eid ${eid})`
      : `eid ${eid}`;
    console.log(`[MyRoom] Cleaning up resources for ${clientDesc}...`);

    try {
      // --- Remove Rapier Objects ---
      const rigidBody = this.eidToRapierBodyMap.get(eid);
      if (rigidBody) {
        // Collect colliders associated with the rigid body
        const collidersToRemove: RAPIER.Collider[] = [];
        const numColliders = rigidBody.numColliders();
        for (let i = 0; i < numColliders; i++) {
          // Rapier's rigidBody.collider(i) returns the handle
          const colliderHandle = rigidBody.collider(i);
          // Use the handle to get the Collider object from the world
          // *** FIX TS2345: Pass the numeric handle ***
          const collider = this.rapierWorld.getCollider(colliderHandle.handle);
          if (collider) {
            collidersToRemove.push(collider);
          } else {
            console.warn(
              `[MyRoom Cleanup] Could not find collider object for handle ${colliderHandle.handle} associated with rigid body of ${clientDesc}`
            );
          }
        }
        // Remove collected colliders (pass false to avoid immediate world update if batching)
        for (const collider of collidersToRemove) {
          this.rapierWorld.removeCollider(collider, false); // Remove collider itself
        }
        // Remove the rigid body itself
        this.rapierWorld.removeRigidBody(rigidBody);
        console.log(
          `[MyRoom Cleanup] Removed Rapier body and ${collidersToRemove.length} colliders for ${clientDesc}.`
        );
      } else {
        console.warn(
          `[MyRoom Cleanup] Could not find Rapier body to remove for ${clientDesc}.`
        );
      }
      // Clean up map regardless of whether body was found
      this.eidToRapierBodyMap.delete(eid);

      // --- Remove ECS Components ---
      // Check existence before removing to avoid potential bitecs warnings/errors
      if (hasComponent(this.ecsWorld, Position, eid))
        removeComponent(this.ecsWorld, Position, eid);
      if (hasComponent(this.ecsWorld, PlayerInput, eid))
        removeComponent(this.ecsWorld, PlayerInput, eid);
      if (hasComponent(this.ecsWorld, Velocity, eid))
        removeComponent(this.ecsWorld, Velocity, eid); // Remove Velocity too
      // Note: bitecs doesn't have removeEntity directly, removing components effectively orphans the eid

      console.log(`[MyRoom Cleanup] Removed ECS components for ${clientDesc}.`);
    } catch (cleanupError) {
      console.error(
        `!!! ERROR during resource cleanup for ${clientDesc} !!!`,
        cleanupError
      );
    }
  }

  onLeave(client: Client, _consented: boolean): void {
    // Use unknown for unused parameter
    const entityId = this.clientEntityMap.get(client.sessionId);
    const clientId = client.sessionId; // Store for logging consistency

    console.log(
      `[MyRoom] Client ${clientId} left (eid: ${entityId}). Initiating cleanup...`
    );

    if (entityId === undefined) {
      console.warn(
        `[MyRoom] Client ${clientId} left, but no matching entity found in clientEntityMap.`
      );
      // Attempt to remove Colyseus state just in case it exists
      if (this.state?.players.has(clientId)) {
        console.warn(
          `[MyRoom] Removing potentially orphaned player state for ${clientId}.`
        );
        this.state.players.delete(clientId);
      }
      return; // No entity to clean up further
    }

    // Remove mapping immediately
    this.clientEntityMap.delete(clientId);

    // Call the cleanup helper function
    this.cleanupEntityResources(entityId, clientId);

    // Explicitly remove Colyseus state here as well (exitQuery might run later)
    if (this.state?.players.has(clientId)) {
      console.log(
        `[Colyseus State] Removing player state for ${clientId} during onLeave.`
      );
      this.state.players.delete(clientId);
    }
  }

  onDispose(): void {
    console.log("[MyRoom] Room disposing. Cleaning up world resources...");
    // Clear maps
    this.clientEntityMap.clear();
    this.eidToRapierBodyMap.clear();

    // Optional: Free Rapier world resources if necessary/available
    // if (this.rapierWorld && typeof (this.rapierWorld as any).free === 'function') {
    //     (this.rapierWorld as any).free();
    //     console.log("[MyRoom] Freed Rapier world resources.");
    // }
    // Clear references
    (this.ecsWorld as any) = null; // Help GC by clearing references
    (this.rapierWorld as any) = null;
    (this.playerQuery as any) = null;
    (this.playerQueryEnter as any) = null;
    (this.playerQueryExit as any) = null;

    console.log("[MyRoom] Room disposed.");
  }

  // Helper to find clientId from entity ID
  private findClientIdByEid(eid: number): string | undefined {
    for (const [clientId, entityId] of this.clientEntityMap.entries()) {
      if (entityId === eid) {
        return clientId;
      }
    }
    return undefined;
  }
}

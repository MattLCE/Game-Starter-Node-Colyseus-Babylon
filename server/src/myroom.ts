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
export const Velocity = defineComponent(Vector3Schema); // Keep if needed later
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
// Define the expected structure of the input message payload
interface InputPayload {
  left: boolean;
  right: boolean;
  forward: boolean;
  backward: boolean;
}

// -- Room Logic --
export class MyRoom extends Room<MyRoomState> {
  // Make properties definite assignment assertion (!) as they are initialized in onCreate
  private ecsWorld!: IWorld;
  private rapierWorld!: RAPIER.World;
  private playerQuery!: Query;
  private playerQueryEnter!: Query;
  private playerQueryExit!: Query;

  private clientEntityMap: Map<string, number> = new Map();
  // Map: eid -> Rapier Body Object
  private eidToRapierBodyMap: Map<number, RAPIER.RigidBody> = new Map();

  private readonly fixedTimeStep = 1 / 60;
  private readonly speed = 5.0;

  async onCreate(_options: any) {
    // Prefix unused 'options' with _
    try {
      console.log("[MyRoom] Room created! Initializing...");
      this.ecsWorld = createWorld();
      const playerComponents = [Position, PlayerInput];
      this.playerQuery = defineQuery(playerComponents);
      this.playerQueryEnter = enterQuery(defineQuery(playerComponents)); // Use the defined query
      this.playerQueryExit = exitQuery(defineQuery(playerComponents)); // Use the defined query
      console.log("[MyRoom] ECS World & Queries Initialized.");

      // Ensure RAPIER is initialized before use
      await RAPIER.init();
      console.log("[MyRoom] Rapier WASM Initialized.");

      const gravity = { x: 0.0, y: -9.81, z: 0.0 };
      this.rapierWorld = new RAPIER.World(gravity);
      console.log("[MyRoom] Rapier World Created.");

      const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0);
      this.rapierWorld.createCollider(groundColliderDesc);
      console.log("[MyRoom] Rapier Ground Created.");

      this.setState(new MyRoomState());
      console.log("[MyRoom] Initial Colyseus State Set.");

      // Use the specific InputPayload interface for the message type
      this.onMessage("input", (client, message: InputPayload) => {
        const eid = this.clientEntityMap.get(client.sessionId);
        if (
          eid !== undefined &&
          hasComponent(this.ecsWorld, PlayerInput, eid)
        ) {
          PlayerInput.left[eid] = message.left ? 1 : 0;
          PlayerInput.right[eid] = message.right ? 1 : 0;
          PlayerInput.forward[eid] = message.forward ? 1 : 0;
          PlayerInput.backward[eid] = message.backward ? 1 : 0;
        }
      });
      console.log("[MyRoom] Message Handlers Set.");

      this.setSimulationInterval((_deltaTime) => {
        try {
          // Added null check for safety, though definite assignment assertion helps
          if (!this.ecsWorld || !this.rapierWorld) {
            console.warn(
              "[MyRoom Update] Skipping update, world is not initialized yet."
            );
            return;
          }
          // Pass deltaTime from interval to the update function
          this.update(_deltaTime / 1000);
        } catch (e) {
          console.error("[MyRoom Update Loop Error]", e);
          // Consider more robust error handling, maybe try to recover?
          this.clock.clear();
          this.disconnect().catch((err) =>
            console.error(
              "Error disconnecting room after update loop failure:",
              err
            )
          );
        }
      }, this.fixedTimeStep * 1000);
      console.log("[MyRoom] Simulation Loop Started. Initialization Complete.");
    } catch (initError) {
      console.error("!!! CRITICAL ERROR DURING onCreate !!!", initError);
      // Attempt to disconnect if initialization fails critically
      this.disconnect().catch((e) =>
        console.error("Error disconnecting room after onCreate failure:", e)
      );
    }
  }

  onJoin(client: Client, _options: any) {
    // Prefix unused 'options' with _
    try {
      // Added null check for safety
      if (!this.ecsWorld || !this.rapierWorld) {
        console.error(
          `!!! ERROR during onJoin for client ${client.sessionId}: World not initialized!`
        );
        client.leave();
        return;
      }
      console.log(`[MyRoom] Client ${client.sessionId} joined!`);

      const eid = addEntity(this.ecsWorld);
      addComponent(this.ecsWorld, Position, eid);
      addComponent(this.ecsWorld, PlayerInput, eid);

      // Initialize position and input
      Position.x[eid] = Math.random() * 10 - 5;
      Position.y[eid] = 1.0;
      Position.z[eid] = Math.random() * 10 - 5;
      PlayerInput.left[eid] = 0;
      PlayerInput.right[eid] = 0;
      PlayerInput.forward[eid] = 0;
      PlayerInput.backward[eid] = 0;

      const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(Position.x[eid], Position.y[eid], Position.z[eid])
        .setLinvel(0, 0, 0)
        .setCcdEnabled(false); // CCD might be overkill unless objects are very fast
      const rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);

      // Define collider shape and properties
      const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5) // Example size
        .setRestitution(0.1) // Low bounciness
        .setFriction(0.5); // Some friction
      this.rapierWorld.createCollider(colliderDesc, rigidBody); // Attach collider to body

      // Store mappings
      this.eidToRapierBodyMap.set(eid, rigidBody);
      this.clientEntityMap.set(client.sessionId, eid);

      console.log(
        `[MyRoom] Created ECS entity ${eid} and associated Rapier body object for client ${client.sessionId}`
      );
    } catch (joinError) {
      console.error(
        `!!! ERROR during onJoin for client ${client.sessionId} !!!`,
        joinError
      );
      try {
        client.leave();
      } catch (e) {
        console.error(
          "Error trying to force leave client after join error:",
          e
        );
      }
    }
  }

  // Use deltaTime if needed for frame-rate independent logic, otherwise prefix with _
  update(_deltaTime: number): void {
    // Explicitly void return type
    // Early exit if worlds/state aren't ready
    if (
      !this.state ||
      !this.ecsWorld ||
      !this.rapierWorld ||
      !this.playerQuery
    ) {
      return;
    }

    // --- Process Input and Apply Forces ---
    try {
      const movingEntities = this.playerQuery(this.ecsWorld);
      for (const eid of movingEntities) {
        const rigidBody = this.eidToRapierBodyMap.get(eid);
        // Skip if physics body doesn't exist for this entity
        if (!rigidBody) {
          // console.warn(`[MyRoom Update] No Rapier body found for eid ${eid}`);
          continue;
        }
        const impulse = { x: 0, y: 0, z: 0 };
        let moving = false;
        // Calculate intended direction based on input
        if (PlayerInput.forward[eid]) {
          impulse.z += 1;
          moving = true;
        }
        if (PlayerInput.backward[eid]) {
          impulse.z -= 1;
          moving = true;
        }
        if (PlayerInput.left[eid]) {
          impulse.x -= 1;
          moving = true;
        }
        if (PlayerInput.right[eid]) {
          impulse.x += 1;
          moving = true;
        }

        if (moving) {
          // Normalize diagonal movement
          const magnitude = Math.sqrt(
            impulse.x * impulse.x + impulse.z * impulse.z
          );
          if (magnitude > 0) {
            impulse.x = (impulse.x / magnitude) * this.speed;
            impulse.z = (impulse.z / magnitude) * this.speed;
          }

          // Apply force/impulse (adjust multipliers for desired feel)
          // Using impulse here for simplicity, could use addForce for smoother acceleration
          const currentVel = rigidBody.linvel();
          const impulseDiff = {
            x: (impulse.x - currentVel.x) * 0.2,
            y: 0,
            z: (impulse.z - currentVel.z) * 0.2,
          };
          rigidBody.applyImpulse(impulseDiff, true);
        }
        // Optional: Add damping if objects don't slow down enough naturally
        // else { rigidBody.setLinvel({ x: currentVel.x * 0.95, y: currentVel.y, z: currentVel.z * 0.95 }, true); }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during input processing:", e);
      return; // Stop update on error
    }

    // --- Step Physics Simulation ---
    try {
      this.rapierWorld.step();
    } catch (e) {
      console.error("[MyRoom Update] Error during Rapier step:", e);
      return; // Stop update on error
    }

    // --- Sync State (ECS & Colyseus) from Physics ---
    try {
      const allPlayers = this.playerQuery(this.ecsWorld); // Re-query in case entities changed
      for (const eid of allPlayers) {
        const rigidBody = this.eidToRapierBodyMap.get(eid);
        if (!rigidBody) continue; // Skip if body was removed

        // Update ECS Position from Physics
        const pos = rigidBody.translation();
        if (hasComponent(this.ecsWorld, Position, eid)) {
          Position.x[eid] = pos.x;
          Position.y[eid] = pos.y;
          Position.z[eid] = pos.z;
        } else {
          // This shouldn't happen if component management is correct
          // console.warn(`[MyRoom Update] Entity ${eid} has Rapier body but no Position component.`);
          continue;
        }

        // Update Colyseus State from ECS Position
        const clientId = this.findClientIdByEid(eid);
        if (clientId) {
          const playerState = this.state.players.get(clientId);
          // Ensure playerState exists before updating
          if (playerState) {
            playerState.x = Position.x[eid];
            playerState.y = Position.y[eid];
            playerState.z = Position.z[eid];
          } else {
            // Player state might not exist if join processing is pending
            // console.warn(`[MyRoom Update] Colyseus state for client ${clientId} (eid: ${eid}) not found during sync.`);
          }
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during state sync:", e);
      return; // Stop update on error
    }

    // --- Handle Player State Additions/Removals (Colyseus State side) ---
    // Note: Using enter/exit queries helps manage Colyseus state based on component presence
    try {
      const entered = this.playerQueryEnter(this.ecsWorld);
      for (const eid of entered) {
        const clientId = this.findClientIdByEid(eid);
        // Ensure client ID exists, state doesn't already exist, and required component is present
        if (
          clientId &&
          !this.state.players.has(clientId) &&
          hasComponent(this.ecsWorld, Position, eid)
        ) {
          console.log(
            `[Colyseus State] Adding player ${clientId} (eid: ${eid})`
          );
          const playerState = new PlayerState();
          // Initialize from current ECS position
          playerState.x = Position.x[eid];
          playerState.y = Position.y[eid];
          playerState.z = Position.z[eid];
          this.state.players.set(clientId, playerState);
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during player join sync:", e);
      return;
    }

    try {
      const exited = this.playerQueryExit(this.ecsWorld);
      // Collect IDs first to avoid modifying map while iterating if needed
      const exitedClientIds: string[] = [];
      for (const eid of exited) {
        const clientId = this.findClientIdByEid(eid);
        if (clientId) {
          exitedClientIds.push(clientId);
          // Note: Rapier/ECS cleanup happens in onLeave, this query handles Colyseus state sync
        }
      }
      // Remove from Colyseus state
      for (const clientId of exitedClientIds) {
        if (this.state.players.has(clientId)) {
          console.log(`[Colyseus State] Removing player state for ${clientId}`);
          this.state.players.delete(clientId);
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during player leave sync:", e);
      return;
    }
  }

  // Prefix unused '_consented' with _
  onLeave(client: Client, _consented: boolean): void {
    // Explicitly void return type
    const eid = this.clientEntityMap.get(client.sessionId);
    console.log(`[MyRoom] Client ${client.sessionId} left (eid: ${eid}).`);

    // Early exit if no entity mapping found
    if (eid === undefined) {
      console.warn(
        `[MyRoom] Client ${client.sessionId} left, but no matching entity found in clientEntityMap.`
      );
      return;
    }

    // Remove mapping first
    this.clientEntityMap.delete(client.sessionId);

    try {
      const rigidBody = this.eidToRapierBodyMap.get(eid);

      // --- Remove Rapier Physics Body ---
      if (rigidBody) {
        console.log(
          `[MyRoom] Found Rapier body object via eid ${eid}. Removing...`
        );

        // Remove associated colliders FIRST
        const collidersToRemove: RAPIER.Collider[] = [];
        const numColliders = rigidBody.numColliders();
        for (let i = 0; i < numColliders; i++) {
          const colliderHandle = rigidBody.collider(i); // This returns a handle (number)
          const collider = this.rapierWorld.getCollider(colliderHandle); // Get Collider object from handle
          if (collider) {
            collidersToRemove.push(collider);
          }
        }
        // Remove colliders using the Collider object
        for (const collider of collidersToRemove) {
          this.rapierWorld.removeCollider(collider, false); // false = don't wake parent yet
        }

        // Now remove the rigid body
        this.rapierWorld.removeRigidBody(rigidBody);
        console.log(
          `[MyRoom] Successfully removed Rapier body object for eid ${eid}.`
        );

        // Clean up the map tracking Rapier bodies
        this.eidToRapierBodyMap.delete(eid);
      } else {
        // This might happen if onJoin failed after creating the entity but before creating the body
        console.warn(
          `[MyRoom] Could not find Rapier body in eidToRapierBodyMap for eid ${eid}. Cannot remove physics body.`
        );
      }

      // --- Remove ECS Components ---
      // This triggers the exitQuery in the next update() call for Colyseus state sync
      console.log(
        `[MyRoom] Marking ECS components for removal for eid ${eid}.`
      );
      if (hasComponent(this.ecsWorld, Position, eid))
        removeComponent(this.ecsWorld, Position, eid);
      if (hasComponent(this.ecsWorld, PlayerInput, eid))
        removeComponent(this.ecsWorld, PlayerInput, eid);
      if (hasComponent(this.ecsWorld, Velocity, eid))
        removeComponent(this.ecsWorld, Velocity, eid); // Remove Velocity too

      // Note: bitecs v1 removes entity+components immediately. No need to removeEntity explicitly usually.
    } catch (leaveError) {
      console.error(
        `!!! ERROR during onLeave processing for eid: ${eid} !!!`,
        leaveError
      );
      // Log the error but don't prevent other cleanup if possible
    }
  }

  onDispose(): void {
    // Explicitly void return type
    console.log("[MyRoom] Room disposed.");
    // Clear maps
    this.clientEntityMap.clear();
    this.eidToRapierBodyMap.clear();

    // Consider freeing Rapier world resources if available/necessary
    // if (this.rapierWorld && typeof (this.rapierWorld as any).free === 'function') {
    //     (this.rapierWorld as any).free();
    //     console.log("[MyRoom] Rapier world resources freed.");
    // }
  }

  // Helper to find clientId from eid
  private findClientIdByEid(eid: number): string | undefined {
    for (const [clientId, entityId] of this.clientEntityMap.entries()) {
      if (entityId === eoptiond) {
        return clientId;
      }
    }
    return undefined; // Explicitly return undefined if not found
  }
} // End of MyRoom class definition

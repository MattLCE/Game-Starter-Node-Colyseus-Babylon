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
export const Velocity = defineComponent(Vector3Schema); // Can be kept if needed for non-physics velocity
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

// -- Room Logic --
export class MyRoom extends Room<MyRoomState> {
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
    try {
      console.log("[MyRoom] Room created! Initializing...");
      this.ecsWorld = createWorld();
      const playerComponents = [Position, PlayerInput];
      this.playerQuery = defineQuery(playerComponents);
      this.playerQueryEnter = enterQuery(defineQuery(playerComponents));
      this.playerQueryExit = exitQuery(defineQuery(playerComponents));
      console.log("[MyRoom] ECS World & Queries Initialized.");

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

      this.onMessage(
        "input",
        (
          client,
          message: {
            left: boolean;
            right: boolean;
            forward: boolean;
            backward: boolean;
          }
        ) => {
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
        }
      );
      console.log("[MyRoom] Message Handlers Set.");

      this.setSimulationInterval((deltaTime) => {
        try {
          if (!this.ecsWorld) {
            // Keep this warning for safety
            console.warn(
              "[MyRoom Update] Skipping update, ecsWorld is not initialized yet."
            );
            return;
          }
          this.update(deltaTime / 1000);
        } catch (e) {
          console.error("[MyRoom Update Loop Error]", e);
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
      this.disconnect().catch((e) =>
        console.error("Error disconnecting room after onCreate failure:", e)
      );
    }
  }

  onJoin(client: Client, _options: any) {
    try {
      if (!this.ecsWorld) {
        console.error(
          `!!! ERROR during onJoin for client ${client.sessionId}: ecsWorld is not initialized!`
        );
        client.leave();
        return;
      }
      console.log(`[MyRoom] Client ${client.sessionId} joined!`);

      const eid = addEntity(this.ecsWorld);
      addComponent(this.ecsWorld, Position, eid);
      addComponent(this.ecsWorld, PlayerInput, eid);

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
        .setCcdEnabled(false);
      const rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
        .setRestitution(0.1)
        .setFriction(0.5);
      this.rapierWorld.createCollider(colliderDesc, rigidBody);

      this.eidToRapierBodyMap.set(eid, rigidBody);
      this.clientEntityMap.set(client.sessionId, eid);

      // Removed Debug log about handle
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

  update(deltaTime: number) {
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
        if (!rigidBody) {
          // Keep this infrequent warning potentially
          // console.warn(`[MyRoom Update] No Rapier body found in map for eid ${eid}`);
          continue;
        }
        const impulse = { x: 0, y: 0, z: 0 };
        let moving = false;
        if (PlayerInput.forward[eid]) {
          impulse.z += this.speed;
          moving = true;
        }
        if (PlayerInput.backward[eid]) {
          impulse.z -= this.speed;
          moving = true;
        }
        if (PlayerInput.left[eid]) {
          impulse.x -= this.speed;
          moving = true;
        }
        if (PlayerInput.right[eid]) {
          impulse.x += this.speed;
          moving = true;
        }
        if (moving) {
          const currentVel = rigidBody.linvel();
          const impulseScaled = {
            x: (impulse.x - currentVel.x) * 0.2,
            y: 0,
            z: (impulse.z - currentVel.z) * 0.2,
          };
          rigidBody.applyImpulse(impulseScaled, true);
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during input processing:", e);
      return;
    }

    // --- Step Physics Simulation ---
    try {
      this.rapierWorld.step();
    } catch (e) {
      console.error("[MyRoom Update] Error during Rapier step:", e);
      return;
    }

    // --- Sync State (ECS & Colyseus) from Physics ---
    try {
      const allPlayers = this.playerQuery(this.ecsWorld);
      for (const eid of allPlayers) {
        const rigidBody = this.eidToRapierBodyMap.get(eid);
        if (!rigidBody) continue;
        const pos = rigidBody.translation();
        if (hasComponent(this.ecsWorld, Position, eid)) {
          Position.x[eid] = pos.x;
          Position.y[eid] = pos.y;
          Position.z[eid] = pos.z;
        }
        const clientId = this.findClientIdByEid(eid);
        if (clientId) {
          const playerState = this.state.players.get(clientId);
          if (playerState && hasComponent(this.ecsWorld, Position, eid)) {
            const posX = Position.x[eid];
            const posY = Position.y[eid];
            const posZ = Position.z[eid];
            if (
              posX !== undefined &&
              posY !== undefined &&
              posZ !== undefined
            ) {
              playerState.x = posX;
              playerState.y = posY;
              playerState.z = posZ;
            }
          }
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during state sync:", e);
      return;
    }

    // --- Handle Player State Additions/Removals (Colyseus State side) ---
    try {
      const entered = this.playerQueryEnter(this.ecsWorld);
      for (const eid of entered) {
        const clientId = this.findClientIdByEid(eid);
        if (
          clientId &&
          !this.state.players.has(clientId) &&
          hasComponent(this.ecsWorld, Position, eid)
        ) {
          console.log(
            `[Colyseus State] Adding player ${clientId} (eid: ${eid})`
          );
          const playerState = new PlayerState();
          const posX = Position.x[eid];
          const posY = Position.y[eid];
          const posZ = Position.z[eid];
          if (posX !== undefined && posY !== undefined && posZ !== undefined) {
            playerState.x = posX;
            playerState.y = posY;
            playerState.z = posZ;
          }
          this.state.players.set(clientId, playerState);
        }
      }
    } catch (e) {
      console.error("[MyRoom Update] Error during player join sync:", e);
      return;
    }

    try {
      const exited = this.playerQueryExit(this.ecsWorld);
      const exitedClientIds: string[] = [];
      for (const eid of exited) {
        const clientId = this.findClientIdByEid(eid);
        if (clientId) exitedClientIds.push(clientId);
      }
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

  onLeave(client: Client, _consented: boolean) {
    const eid = this.clientEntityMap.get(client.sessionId);
    console.log(`[MyRoom] Client ${client.sessionId} left (eid: ${eid}).`);

    if (eid !== undefined) {
      this.clientEntityMap.delete(client.sessionId);
    } else {
      console.warn(
        `[MyRoom] Client ${client.sessionId} left, but no matching entity found in clientEntityMap.`
      );
      return;
    }

    try {
      const rigidBody = this.eidToRapierBodyMap.get(eid);

      if (rigidBody) {
        console.log(
          `[MyRoom] Found Rapier body object via eid ${eid}. Removing...`
        );

        const collidersToRemove: RAPIER.Collider[] = [];
        const numColliders = rigidBody.numColliders();
        for (let i = 0; i < numColliders; i++) {
          const collider = rigidBody.collider(i);
          if (collider) {
            collidersToRemove.push(collider);
          }
        }
        // Removed Debug log about collider count
        for (const collider of collidersToRemove) {
          this.rapierWorld.removeCollider(collider, false);
        }

        this.rapierWorld.removeRigidBody(rigidBody);
        console.log(
          `[MyRoom] Successfully removed Rapier body object for eid ${eid}.`
        );

        this.eidToRapierBodyMap.delete(eid);
        // Removed Debug log about map cleanup
      } else {
        // Keep this warning
        console.warn(
          `[MyRoom] Could not find Rapier body in eidToRapierBodyMap for eid ${eid}. Cannot remove physics body.`
        );
      }

      // --- Remove ECS Components ---
      console.log(
        `[MyRoom] Marking ECS components for removal for eid ${eid}.`
      );
      if (hasComponent(this.ecsWorld, Position, eid))
        removeComponent(this.ecsWorld, Position, eid);
      if (hasComponent(this.ecsWorld, PlayerInput, eid))
        removeComponent(this.ecsWorld, PlayerInput, eid);
      if (hasComponent(this.ecsWorld, Velocity, eid))
        removeComponent(this.ecsWorld, Velocity, eid);
    } catch (leaveError) {
      console.error(
        `!!! ERROR during onLeave processing for eid: ${eid} !!!`,
        leaveError
      );
    }
  }

  onDispose() {
    console.log("[MyRoom] Room disposed.");
    this.clientEntityMap.clear();
    this.eidToRapierBodyMap.clear();
  }

  private findClientIdByEid(eid: number): string | undefined {
    for (const [clientId, entityId] of this.clientEntityMap.entries()) {
      if (entityId === eid) {
        return clientId;
      }
    }
    return undefined;
  }
} // End of MyRoom class definition

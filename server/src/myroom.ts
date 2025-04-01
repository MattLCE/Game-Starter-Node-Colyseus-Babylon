// server/src/myroom.ts
import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
// Correct bitecs imports for v1 style
import {
    IWorld, // Use IWorld interface for type annotation
    defineComponent,
    addComponent,
    removeComponent,
    defineQuery,
    enterQuery,
    exitQuery,
    hasComponent,
    Types,
    addEntity, // Import addEntity
    Query, // Import Query type
    EnterQuery, // Import EnterQuery type
    ExitQuery, // Import ExitQuery type
} from "bitecs";
import RAPIER from "@dimforge/rapier3d-compat";

// -- ECS Components --
const Vector3Schema = {
    x: Types.f32,
    y: Types.f32,
    z: Types.f32,
};
const Position = defineComponent(Vector3Schema);
const Velocity = defineComponent(Vector3Schema);
const PlayerInput = defineComponent({
    left: Types.ui8,
    right: Types.ui8,
    forward: Types.ui8,
    backward: Types.ui8,
});
const RapierRigidBodyHandle = defineComponent({ handle: Types.ui32 });

// -- Colyseus State -- (Keep as is)
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
    // Use IWorld and definite assignment assertion (!)
    private ecsWorld!: IWorld;
    private rapierWorld!: RAPIER.World;

    // Add types and definite assignment assertions (!)
    private playerQuery!: Query;
    private playerQueryEnter!: EnterQuery;
    private playerQueryExit!: ExitQuery;

    private clientEntityMap: Map<string, number> = new Map();
    private rigidBodyEntityMap: Map<number, number> = new Map();

    private readonly fixedTimeStep = 1 / 60;
    private readonly speed = 5.0;


    async onCreate(_options: any) {
        console.log("[MyRoom] Room created!");

        // -- ECS Setup --
        // Initialize world as an empty object conforming to IWorld
        this.ecsWorld = {};
        this.playerQuery = defineQuery([Position, PlayerInput, RapierRigidBodyHandle]);
        this.playerQueryEnter = enterQuery(this.playerQuery);
        this.playerQueryExit = exitQuery(this.playerQuery);

        // -- Physics Setup --
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.rapierWorld = new RAPIER.World(gravity);

        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0);
        this.rapierWorld.createCollider(groundColliderDesc);

        // -- Initial State --
        this.setState(new MyRoomState());

        // -- Message Handlers -- (Keep as is)
        this.onMessage("input", (client, message) => {
            const eid = this.clientEntityMap.get(client.sessionId);
            if (eid !== undefined && hasComponent(this.ecsWorld, PlayerInput, eid)) {
                PlayerInput.left[eid] = message.left ? 1 : 0;
                PlayerInput.right[eid] = message.right ? 1 : 0;
                PlayerInput.forward[eid] = message.forward ? 1 : 0;
                PlayerInput.backward[eid] = message.backward ? 1 : 0;
            }
        });

        // -- Game Loop -- (Keep as is)
        this.setSimulationInterval((deltaTime) => {
            this.update(deltaTime / 1000);
        }, this.fixedTimeStep * 1000);

        console.log("[MyRoom] ECS and Rapier initialized.");
    }

    onJoin(client: Client, _options: any) {
        console.log(`[MyRoom] Client ${client.sessionId} joined!`);

        // -- Create ECS Entity --
        const eid = addEntity(this.ecsWorld); // Use addEntity first
        addComponent(this.ecsWorld, Position, eid); // Then add components to the eid
        // addComponent(this.ecsWorld, Velocity, eid); // Velocity is implicitly handled by Rapier, maybe remove
        addComponent(this.ecsWorld, PlayerInput, eid);
        addComponent(this.ecsWorld, RapierRigidBodyHandle, eid);

        // Initial position
        Position.x[eid] = Math.random() * 10 - 5;
        Position.y[eid] = 1.0;
        Position.z[eid] = Math.random() * 10 - 5;
        PlayerInput.left[eid] = 0;
        PlayerInput.right[eid] = 0;
        PlayerInput.forward[eid] = 0;
        PlayerInput.backward[eid] = 0;
        // RapierRigidBodyHandle will be set below


        // -- Create Rapier Body -- (Keep as is)
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(Position.x[eid], Position.y[eid], Position.z[eid])
            .setLinvel(0, 0, 0)
            .setCcdEnabled(false);
        const rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
            .setRestitution(0.1)
            .setFriction(0.5);
        this.rapierWorld.createCollider(colliderDesc, rigidBody);

        // -- Link ECS and Rapier --
        const rigidBodyHandle = rigidBody.handle;
        // Set the handle value in the ECS component store
        RapierRigidBodyHandle.handle[eid] = rigidBodyHandle;
        this.rigidBodyEntityMap.set(rigidBodyHandle, eid);

        // -- Link Client and ECS --
        this.clientEntityMap.set(client.sessionId, eid);

        console.log(`[MyRoom] Created ECS entity ${eid} and Rapier body ${rigidBodyHandle} for client ${client.sessionId}`);
    }

    // --- update function remains the same ---
    update(deltaTime: number) {
        // --- Handle Player Input ---
        const movingEntities = this.playerQuery(this.ecsWorld);
        for (const eid of movingEntities) {
            const rigidBodyHandle = RapierRigidBodyHandle.handle[eid];
            const rigidBody = this.rapierWorld.getRigidBody(rigidBodyHandle);
            if (!rigidBody) continue;

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

        // --- Step Physics World ---
        this.rapierWorld.step();

        // --- Sync ECS State from Rapier & Update Colyseus State ---
        const allPlayers = this.playerQuery(this.ecsWorld); // Re-query in case entities changed during physics step? Maybe not needed.
        for (const eid of allPlayers) { // Use allPlayers query result
            const rigidBodyHandle = RapierRigidBodyHandle.handle[eid];
            const rigidBody = this.rapierWorld.getRigidBody(rigidBodyHandle);
            if (!rigidBody) continue;

            const pos = rigidBody.translation();
            // Update ECS (optional if only Colyseus needs it, but good practice)
            Position.x[eid] = pos.x;
            Position.y[eid] = pos.y;
            Position.z[eid] = pos.z;

            // Update Colyseus state directly
            const clientId = this.findClientIdByEid(eid); // Find client ID associated with this entity
            if(clientId) {
                const playerState = this.state.players.get(clientId);
                if (playerState) {
                    playerState.x = pos.x;
                    playerState.y = pos.y;
                    playerState.z = pos.z;
                }
            } else {
                // This might happen briefly if a player leaves during the update loop
                // console.warn(`[MyRoom Update] No client ID found for eid ${eid} during state sync.`);
            }
        }

        // --- Sync Colyseus Player Additions ---
        const entered = this.playerQueryEnter(this.ecsWorld);
        for (const eid of entered) {
            const clientId = this.findClientIdByEid(eid);
            if (clientId && !this.state.players.has(clientId)) {
                 console.log(`[Colyseus State] Adding player ${clientId} (eid: ${eid})`);
                 const playerState = new PlayerState();
                 // Initialize from current ECS position which should be recently updated from Rapier
                 playerState.x = Position.x[eid];
                 playerState.y = Position.y[eid];
                 playerState.z = Position.z[eid];
                 this.state.players.set(clientId, playerState);
            }
        }

         // --- Sync Colyseus Player Removals ---
        const exited = this.playerQueryExit(this.ecsWorld);
        // Store client IDs before maps are cleaned up in onLeave
        const exitedClientIds: string[] = [];
        for(const eid of exited) {
            const clientId = this.findClientIdByEid(eid);
            if (clientId) {
                exitedClientIds.push(clientId);
            }
        }
        // Now process removals based on stored client IDs
        for (const clientId of exitedClientIds) {
             if (this.state.players.has(clientId)) {
                console.log(`[Colyseus State] Removing player ${clientId}`);
                this.state.players.delete(clientId);
            }
        }
    }


    // --- onLeave function remains mostly the same, ensure component removals are correct ---
     onLeave(client: Client, _consented: boolean) {
        const eid = this.clientEntityMap.get(client.sessionId);
        console.log(`[MyRoom] Client ${client.sessionId} left (eid: ${eid}).`);

        if (eid !== undefined) {
            // -- Remove Rapier Body --
            // Retrieve handle *before* removing the ECS component
             const rigidBodyHandle = hasComponent(this.ecsWorld, RapierRigidBodyHandle, eid)
                ? RapierRigidBodyHandle.handle[eid]
                : undefined;

            if (rigidBodyHandle !== undefined) {
                 const rigidBody = this.rapierWorld.getRigidBody(rigidBodyHandle);
                 if (rigidBody) {
                      // Remove colliders BEFORE removing the body
                      const numColliders = rigidBody.numColliders();
                      const collidersToRemove = [];
                      for (let i = 0; i < numColliders; i++) {
                          collidersToRemove.push(rigidBody.collider(i));
                      }
                      for(const colliderHandle of collidersToRemove) {
                          const collider = this.rapierWorld.getCollider(colliderHandle);
                           if (collider) {
                                this.rapierWorld.removeCollider(collider, false);
                           }
                      }

                      this.rapierWorld.removeRigidBody(rigidBody);
                      console.log(`[MyRoom] Removed Rapier body ${rigidBodyHandle}`);
                 } else {
                      console.warn(`[MyRoom] Could not find Rapier body ${rigidBodyHandle} to remove for eid ${eid}`);
                 }
                 this.rigidBodyEntityMap.delete(rigidBodyHandle);
            } else {
                 console.warn(`[MyRoom] No Rapier handle found for eid ${eid} on leave.`);
            }

            // -- Remove ECS Entity Components --
            // This marks the entity for the exitQuery in the next `update`
            if (hasComponent(this.ecsWorld, Position, eid)) removeComponent(this.ecsWorld, Position, eid);
            // if (hasComponent(this.ecsWorld, Velocity, eid)) removeComponent(this.ecsWorld, Velocity, eid); // Remove if component exists
            if (hasComponent(this.ecsWorld, PlayerInput, eid)) removeComponent(this.ecsWorld, PlayerInput, eid);
            if (hasComponent(this.ecsWorld, RapierRigidBodyHandle, eid)) removeComponent(this.ecsWorld, RapierRigidBodyHandle, eid);

             // -- Clean up client mapping immediately --
             this.clientEntityMap.delete(client.sessionId);

            // Colyseus state removal is now handled by the exit query in the *next* update loop
             console.log(`[MyRoom] Marked ECS entity ${eid} components for removal.`);

        } else {
             console.warn(`[MyRoom] Client ${client.sessionId} left, but no matching entity found.`);
        }
    }


    // --- onDispose function remains the same ---
    onDispose() {
        console.log("[MyRoom] Room disposed.");
    }

    // --- findClientIdByEid function remains the same ---
    private findClientIdByEid(eid: number): string | undefined {
        for (const [clientId, entityId] of this.clientEntityMap.entries()) {
            if (entityId === eid) {
                return clientId;
            }
        }
        return undefined;
    }
}
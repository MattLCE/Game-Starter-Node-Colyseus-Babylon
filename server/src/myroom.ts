// server/src/myroom.ts
import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { World as EcsWorld, defineComponent, addComponent, removeComponent, defineQuery, enterQuery, exitQuery, hasComponent, Types } from "bitecs";
import RAPIER from "@dimforge/rapier3d-compat";

// -- ECS Components --
// Using simple objects for components initially for easier state sync.
// For performance, you might use TypedArrays later, but that complicates state sync.

const Vector3Schema = {
    x: Types.f32,
    y: Types.f32,
    z: Types.f32,
};
const Position = defineComponent(Vector3Schema);
const Velocity = defineComponent(Vector3Schema); // Rapier handles velocity internally, maybe not needed in ECS directly yet
const PlayerInput = defineComponent({
    left: Types.ui8, // 0 or 1
    right: Types.ui8,
    forward: Types.ui8,
    backward: Types.ui8,
});
// We need a way to store the Rapier handle associated with the ECS entity
const RapierRigidBodyHandle = defineComponent({ handle: Types.ui32 });

// -- Colyseus State --
export class PlayerState extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0; // Add Y if you have vertical movement/gravity
    @type("number") z: number = 0;
}

export class MyRoomState extends Schema {
    @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

// -- Room Logic --
export class MyRoom extends Room<MyRoomState> {
    private ecsWorld: EcsWorld;
    private rapierWorld: RAPIER.World;
    private playerQuery; // Query for all players
    private playerQueryEnter; // Query for new players
    private playerQueryExit; // Query for players that left

    // Map Colyseus client ID to ECS entity ID
    private clientEntityMap: Map<string, number> = new Map();

    // Map Rapier rigid body handle to ECS entity ID
    private rigidBodyEntityMap: Map<number, number> = new Map();

    private readonly fixedTimeStep = 1 / 60; // 60 FPS physics simulation
    private readonly speed = 5.0; // Movement speed factor


    async onCreate(_options: any) {
        console.log("[MyRoom] Room created!");

        // -- ECS Setup --
        this.ecsWorld = {} as EcsWorld; // Create world in bitecs v1 style (object is fine)
        this.playerQuery = defineQuery([Position, PlayerInput, RapierRigidBodyHandle]);
        this.playerQueryEnter = enterQuery(this.playerQuery);
        this.playerQueryExit = exitQuery(this.playerQuery);

        // -- Physics Setup --
        // No need to dynamically import Rapier when using compat package
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.rapierWorld = new RAPIER.World(gravity);

        // Create Ground
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0);
        this.rapierWorld.createCollider(groundColliderDesc);


        // -- Initial State --
        this.setState(new MyRoomState());

        // -- Message Handlers --
        this.onMessage("input", (client, message) => {
            const eid = this.clientEntityMap.get(client.sessionId);
            if (eid !== undefined && hasComponent(this.ecsWorld, PlayerInput, eid)) {
                PlayerInput.left[eid] = message.left ? 1 : 0;
                PlayerInput.right[eid] = message.right ? 1 : 0;
                PlayerInput.forward[eid] = message.forward ? 1 : 0;
                PlayerInput.backward[eid] = message.backward ? 1 : 0;
            }
        });

        // -- Game Loop --
        this.setSimulationInterval((deltaTime) => {
            this.update(deltaTime / 1000); // Convert ms to seconds
        }, this.fixedTimeStep * 1000); // Interval in milliseconds

        console.log("[MyRoom] ECS and Rapier initialized.");
    }

    onJoin(client: Client, _options: any) {
        console.log(`[MyRoom] Client ${client.sessionId} joined!`);

        // -- Create ECS Entity --
        const eid = addComponent(this.ecsWorld, Position, 0); // Use 0 as placeholder, bitecs manages IDs
        addComponent(this.ecsWorld, Velocity, eid); // Might not need velocity if Rapier handles it
        addComponent(this.ecsWorld, PlayerInput, eid);
        addComponent(this.ecsWorld, RapierRigidBodyHandle, eid);

        // Initial position (spawn point slightly above ground)
        Position.x[eid] = Math.random() * 10 - 5; // Random spawn X
        Position.y[eid] = 1.0;
        Position.z[eid] = Math.random() * 10 - 5; // Random spawn Z
        PlayerInput.left[eid] = 0;
        PlayerInput.right[eid] = 0;
        PlayerInput.forward[eid] = 0;
        PlayerInput.backward[eid] = 0;


        // -- Create Rapier Body --
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(Position.x[eid], Position.y[eid], Position.z[eid])
            .setLinvel(0, 0, 0) // Start with zero velocity
            .setCcdEnabled(false); // Optional: Continuous Collision Detection
        const rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5) // 1x1x1 cube
            .setRestitution(0.1) // Bounciness
            .setFriction(0.5);
        this.rapierWorld.createCollider(colliderDesc, rigidBody);

        // -- Link ECS and Rapier --
        const rigidBodyHandle = rigidBody.handle;
        RapierRigidBodyHandle.handle[eid] = rigidBodyHandle;
        this.rigidBodyEntityMap.set(rigidBodyHandle, eid);

        // -- Link Client and ECS --
        this.clientEntityMap.set(client.sessionId, eid);

        // -- Add to Colyseus State --
        // (This will be handled automatically by the enterQuery in the update loop)

        console.log(`[MyRoom] Created ECS entity ${eid} and Rapier body ${rigidBodyHandle} for client ${client.sessionId}`);
    }

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

            // Apply impulse only if there's input to avoid constant small forces fighting friction
            if (moving) {
                // Apply impulse relative to current velocity - trying to reach target speed quickly
                const currentVel = rigidBody.linvel();
                const impulseScaled = {
                    x: (impulse.x - currentVel.x) * 0.2, // Adjust multiplier for responsiveness
                    y: 0, // Let gravity handle Y
                    z: (impulse.z - currentVel.z) * 0.2,
                };
                rigidBody.applyImpulse(impulseScaled, true);

                // Optional: Clamp velocity to prevent excessive speeds
                // const clampedVel = { ...rigidBody.linvel() };
                // const maxSpeed = 5;
                // if (Math.abs(clampedVel.x) > maxSpeed) clampedVel.x = Math.sign(clampedVel.x) * maxSpeed;
                // if (Math.abs(clampedVel.z) > maxSpeed) clampedVel.z = Math.sign(clampedVel.z) * maxSpeed;
                // rigidBody.setLinvel(clampedVel, true);

            } else {
                 // If no input, maybe apply slight damping or let friction handle it
                 // Rapier's friction should slow it down. Ensure sufficient friction on collider/ground.
            }
        }

        // --- Step Physics World ---
        this.rapierWorld.step();

        // --- Sync ECS State from Rapier ---
        for (const eid of movingEntities) {
            const rigidBodyHandle = RapierRigidBodyHandle.handle[eid];
            const rigidBody = this.rapierWorld.getRigidBody(rigidBodyHandle);
            if (!rigidBody) continue;

            const pos = rigidBody.translation();
            Position.x[eid] = pos.x;
            Position.y[eid] = pos.y;
            Position.z[eid] = pos.z;

            // Update Colyseus state directly (more efficient for simple cases)
            const playerState = this.state.players.get(this.findClientIdByEid(eid));
            if (playerState) {
                playerState.x = pos.x;
                playerState.y = pos.y;
                playerState.z = pos.z;
            }
        }

        // --- Sync Colyseus State from ECS Queries ---
        const entered = this.playerQueryEnter(this.ecsWorld);
        for (const eid of entered) {
            const clientId = this.findClientIdByEid(eid);
            if (clientId && !this.state.players.has(clientId)) {
                 console.log(`[Colyseus State] Adding player ${clientId} (eid: ${eid})`);
                 const playerState = new PlayerState();
                 playerState.x = Position.x[eid];
                 playerState.y = Position.y[eid];
                 playerState.z = Position.z[eid];
                 this.state.players.set(clientId, playerState);
            }
        }

        const exited = this.playerQueryExit(this.ecsWorld);
        for (const eid of exited) {
            // This query triggers *after* the component is removed, so we need the clientId from the map
            const clientId = this.findClientIdByEid(eid); // Find it before removing from map
             if (clientId && this.state.players.has(clientId)) {
                console.log(`[Colyseus State] Removing player ${clientId} (eid: ${eid})`);
                this.state.players.delete(clientId);
            }
            // Clean up maps for the exited entity
            if (clientId) this.clientEntityMap.delete(clientId);
            const rigidBodyHandle = RapierRigidBodyHandle.handle[eid]; // Get handle before component removal if possible, might need temporary storage
             if(rigidBodyHandle) this.rigidBodyEntityMap.delete(rigidBodyHandle); // Clean up body map
        }
    }


    onLeave(client: Client, _consented: boolean) {
        const eid = this.clientEntityMap.get(client.sessionId);
        console.log(`[MyRoom] Client ${client.sessionId} left (eid: ${eid}).`);

        if (eid !== undefined) {
            // -- Remove Rapier Body --
            const rigidBodyHandle = RapierRigidBodyHandle.handle[eid];
            if (rigidBodyHandle !== undefined) {
                 const rigidBody = this.rapierWorld.getRigidBody(rigidBodyHandle);
                 if (rigidBody) {
                      // Need to remove associated colliders first
                      for (let i = 0; i < rigidBody.numColliders(); i++) {
                           const colliderHandle = rigidBody.collider(i);
                           const collider = this.rapierWorld.getCollider(colliderHandle);
                           if (collider) {
                                this.rapierWorld.removeCollider(collider, false); // false = don't wake interacting bodies yet
                           }
                      }
                      this.rapierWorld.removeRigidBody(rigidBody);
                      console.log(`[MyRoom] Removed Rapier body ${rigidBodyHandle}`);
                 } else {
                      console.warn(`[MyRoom] Could not find Rapier body ${rigidBodyHandle} to remove for eid ${eid}`);
                 }
                 this.rigidBodyEntityMap.delete(rigidBodyHandle); // Clean up map
            } else {
                 console.warn(`[MyRoom] No Rapier handle found for eid ${eid} on leave.`);
            }

            // -- Remove ECS Entity --
            // Removing components triggers exit queries in the *next* update loop
            if (hasComponent(this.ecsWorld, Position, eid)) removeComponent(this.ecsWorld, Position, eid);
            if (hasComponent(this.ecsWorld, Velocity, eid)) removeComponent(this.ecsWorld, Velocity, eid);
            if (hasComponent(this.ecsWorld, PlayerInput, eid)) removeComponent(this.ecsWorld, PlayerInput, eid);
            if (hasComponent(this.ecsWorld, RapierRigidBodyHandle, eid)) removeComponent(this.ecsWorld, RapierRigidBodyHandle, eid);
            // Note: bitecs doesn't have explicit entity deletion in v1; removing all components effectively does it.

             // -- Clean up client mapping immediately --
             this.clientEntityMap.delete(client.sessionId);

            // Colyseus state removal is handled by the exit query in the update loop
             console.log(`[MyRoom] Marked ECS entity ${eid} for removal.`);

        } else {
             console.warn(`[MyRoom] Client ${client.sessionId} left, but no matching entity found.`);
        }
    }

    onDispose() {
        console.log("[MyRoom] Room disposed.");
        // Optional: Clean up Rapier world? Rapier doesn't have an explicit dispose AFAIK.
    }

    // Helper to find clientId from eid
    private findClientIdByEid(eid: number): string | undefined {
        for (const [clientId, entityId] of this.clientEntityMap.entries()) {
            if (entityId === eid) {
                return clientId;
            }
        }
        return undefined;
    }
}
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
    Query, // Use this type for all query variables
} from "bitecs";
import RAPIER from "@dimforge/rapier3d-compat";

// -- ECS Components --
// Export components so they can potentially be used elsewhere (like tests)
export const Vector3Schema = {
    x: Types.f32,
    y: Types.f32,
    z: Types.f32,
};
export const Position = defineComponent(Vector3Schema);
export const Velocity = defineComponent(Vector3Schema); // Often Rapier handles velocity implicitly
export const PlayerInput = defineComponent({
    left: Types.ui8,
    right: Types.ui8,
    forward: Types.ui8,
    backward: Types.ui8,
});
export const RapierRigidBodyHandle = defineComponent({ handle: Types.ui32 });

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
    // Use definite assignment assertion (!) since they are initialized in onCreate
    private ecsWorld!: IWorld;
    private rapierWorld!: RAPIER.World;
    private playerQuery!: Query;
    private playerQueryEnter!: Query;
    private playerQueryExit!: Query;

    private clientEntityMap: Map<string, number> = new Map();
    private rigidBodyEntityMap: Map<number, number> = new Map(); // Map Rapier Handle -> eid

    private readonly fixedTimeStep = 1 / 60; // Physics simulation rate
    private readonly speed = 5.0;          // Player movement speed factor


    async onCreate(_options: any) {
        // Wrap initialization in try-catch for better error handling
        try {
            console.log("[MyRoom] Room created! Initializing...");

            // 1. Initialize Rapier (needs to be awaited)
            await RAPIER.init();
            console.log("[MyRoom] Rapier WASM Initialized.");

            // 2. Initialize ECS World and Queries
            this.ecsWorld = {}; // Simple object is fine for bitecs v1 world
            this.playerQuery = defineQuery([Position, PlayerInput, RapierRigidBodyHandle]);
            this.playerQueryEnter = enterQuery(this.playerQuery);
            this.playerQueryExit = exitQuery(this.playerQuery);
            console.log("[MyRoom] ECS World & Queries Initialized.");

            // 3. Initialize Rapier World
            const gravity = { x: 0.0, y: -9.81, z: 0.0 };
            this.rapierWorld = new RAPIER.World(gravity);
            console.log("[MyRoom] Rapier World Created.");

            // 4. Create Static Geometry (Ground)
            const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25.0, 0.1, 25.0);
            this.rapierWorld.createCollider(groundColliderDesc);
            console.log("[MyRoom] Rapier Ground Created.");

            // 5. Set Initial Colyseus State
            this.setState(new MyRoomState());
            console.log("[MyRoom] Initial Colyseus State Set.");

            // 6. Set up Message Handlers
            this.onMessage("input", (client, message: { left: boolean, right: boolean, forward: boolean, backward: boolean }) => {
                const eid = this.clientEntityMap.get(client.sessionId);
                if (eid !== undefined && hasComponent(this.ecsWorld, PlayerInput, eid)) {
                    PlayerInput.left[eid] = message.left ? 1 : 0;
                    PlayerInput.right[eid] = message.right ? 1 : 0;
                    PlayerInput.forward[eid] = message.forward ? 1 : 0;
                    PlayerInput.backward[eid] = message.backward ? 1 : 0;
                }
            });
            console.log("[MyRoom] Message Handlers Set.");

            // 7. Start the Simulation Loop (LAST STEP in setup)
            this.setSimulationInterval((deltaTime) => {
                 try {
                     this.update(deltaTime / 1000); // Convert ms to seconds
                 } catch (e) {
                     console.error("[MyRoom Update Loop Error]", e);
                     // Decide how to handle loop errors (e.g., stop clock, disconnect room)
                     this.clock.clear();
                     this.disconnect().catch(err => console.error("Error disconnecting room after update loop failure:", err));
                 }
            }, this.fixedTimeStep * 1000); // Interval in milliseconds
            console.log("[MyRoom] Simulation Loop Started. Initialization Complete.");

        } catch (initError) {
            console.error("!!! CRITICAL ERROR DURING onCreate !!!", initError);
            // Disconnect room if initialization fails critically
            this.disconnect().catch(e => console.error("Error disconnecting room after onCreate failure:", e));
        }
    }

    onJoin(client: Client, _options: any) {
        try { // Add try-catch for safety during join
            console.log(`[MyRoom] Client ${client.sessionId} joined!`);

            // Create ECS Entity
            const eid = addEntity(this.ecsWorld);
            addComponent(this.ecsWorld, Position, eid);
            addComponent(this.ecsWorld, PlayerInput, eid);
            addComponent(this.ecsWorld, RapierRigidBodyHandle, eid);
            // addComponent(this.ecsWorld, Velocity, eid); // Only if needed

            // Set initial component values
            Position.x[eid] = Math.random() * 10 - 5;
            Position.y[eid] = 1.0; // Start slightly above ground
            Position.z[eid] = Math.random() * 10 - 5;
            PlayerInput.left[eid] = 0; PlayerInput.right[eid] = 0; PlayerInput.forward[eid] = 0; PlayerInput.backward[eid] = 0;

            // Create Rapier Body & Collider
            const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(Position.x[eid], Position.y[eid], Position.z[eid])
                .setLinvel(0, 0, 0)
                .setCcdEnabled(false); // CCD avoids tunneling but is more expensive
            const rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5) // 1x1x1 cube
                .setRestitution(0.1)
                .setFriction(0.5);
            this.rapierWorld.createCollider(colliderDesc, rigidBody);

            // Link ECS, Rapier, and Client
            const rigidBodyHandle = rigidBody.handle;
            RapierRigidBodyHandle.handle[eid] = rigidBodyHandle;
            this.rigidBodyEntityMap.set(rigidBodyHandle, eid);
            this.clientEntityMap.set(client.sessionId, eid);

            console.log(`[MyRoom] Created ECS entity ${eid} and Rapier body ${rigidBodyHandle} for client ${client.sessionId}`);
            // Colyseus state addition is handled by enterQuery in the update loop

        } catch(joinError) {
            console.error(`!!! ERROR during onJoin for client ${client.sessionId} !!!`, joinError);
            // Attempt to disconnect the client that failed to join properly
            try { client.leave(); } catch (e) { console.error("Error trying to force leave client after join error:", e); }
        }
    }

    update(deltaTime: number) {
        // --- Guard Clause ---
        if (!this.state || !this.ecsWorld || !this.rapierWorld || !this.playerQuery) {
            // Avoid running if room is disposing or initialization failed
            // console.warn("[MyRoom Update] Skipping update, room not ready."); // Can be noisy, enable if needed
            return;
        }

        // --- Process Input and Apply Forces ---
        try {
            const movingEntities = this.playerQuery(this.ecsWorld);
            for (const eid of movingEntities) {
                const rigidBodyHandle = RapierRigidBodyHandle.handle[eid];
                if (rigidBodyHandle === undefined) continue; // Safety check
                const rigidBody = this.rapierWorld.getRigidBody(rigidBodyHandle);
                if (!rigidBody) continue; // Safety check

                const impulse = { x: 0, y: 0, z: 0 };
                let moving = false;
                if (PlayerInput.forward[eid]) { impulse.z += this.speed; moving = true; }
                if (PlayerInput.backward[eid]) { impulse.z -= this.speed; moving = true; }
                if (PlayerInput.left[eid]) { impulse.x -= this.speed; moving = true; }
                if (PlayerInput.right[eid]) { impulse.x += this.speed; moving = true; }

                if (moving) {
                    const currentVel = rigidBody.linvel();
                    // Apply impulse to counteract current velocity and reach target speed
                    const impulseScaled = { x: (impulse.x - currentVel.x) * 0.2, y: 0, z: (impulse.z - currentVel.z) * 0.2 };
                    rigidBody.applyImpulse(impulseScaled, true); // true = wake body if sleeping
                }
                // Note: Letting Rapier's friction/damping handle stopping when no input is applied
            }
        } catch (e) {
             console.error("[MyRoom Update] Error during input processing:", e);
             // Decide if error is fatal, maybe return to skip rest of update
             return;
        }

        // --- Step Physics Simulation ---
        try {
            this.rapierWorld.step();
        } catch (e) {
             console.error("[MyRoom Update] Error during Rapier step:", e);
             // Decide if error is fatal
             return;
        }


        // --- Sync State (ECS & Colyseus) from Physics ---
        try {
            const allPlayers = this.playerQuery(this.ecsWorld);
            for (const eid of allPlayers) {
                const rigidBodyHandle = RapierRigidBodyHandle.handle[eid];
                if (rigidBodyHandle === undefined) continue;
                const rigidBody = this.rapierWorld.getRigidBody(rigidBodyHandle);
                if (!rigidBody) continue;

                const pos = rigidBody.translation();
                // Update ECS Position component (good practice, might be used by other systems)
                if (hasComponent(this.ecsWorld, Position, eid)) {
                    Position.x[eid] = pos.x;
                    Position.y[eid] = pos.y;
                    Position.z[eid] = pos.z;
                }

                // Find corresponding Colyseus PlayerState and update it
                const clientId = this.findClientIdByEid(eid);
                if (clientId) {
                    const playerState = this.state.players.get(clientId);
                    // Ensure both playerState and Position component exist before accessing
                    if (playerState && hasComponent(this.ecsWorld, Position, eid)) {
                        const posX = Position.x[eid];
                        const posY = Position.y[eid];
                        const posZ = Position.z[eid];
                        // Assign only if values are valid numbers (paranoid check, but safe)
                        if (posX !== undefined && posY !== undefined && posZ !== undefined) {
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

        // --- Handle Player State Additions (for Colyseus) ---
        try {
            const entered = this.playerQueryEnter(this.ecsWorld);
            for (const eid of entered) {
                const clientId = this.findClientIdByEid(eid);
                // Check if player state doesn't exist yet and ECS position is available
                if (clientId && !this.state.players.has(clientId) && hasComponent(this.ecsWorld, Position, eid)) {
                    console.log(`[Colyseus State] Adding player ${clientId} (eid: ${eid})`);
                    const playerState = new PlayerState();
                    const posX = Position.x[eid];
                    const posY = Position.y[eid];
                    const posZ = Position.z[eid];
                    // Initialize with current position if valid
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

        // --- Handle Player State Removals (for Colyseus) ---
        try {
            const exited = this.playerQueryExit(this.ecsWorld);
            // Collect client IDs *before* removing from the map in onLeave
            const exitedClientIds: string[] = [];
            for (const eid of exited) {
                const clientId = this.findClientIdByEid(eid);
                if (clientId) exitedClientIds.push(clientId);
            }
            // Process removals using the collected IDs
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
            try { // Add try-catch for safety during leave
                // --- Remove Rapier Body and Colliders ---
                const rigidBodyHandle = hasComponent(this.ecsWorld, RapierRigidBodyHandle, eid)
                    ? RapierRigidBodyHandle.handle[eid]
                    : undefined;

                if (rigidBodyHandle !== undefined) {
                    const rigidBody = this.rapierWorld.getRigidBody(rigidBodyHandle);
                    if (rigidBody) {
                        const numColliders = rigidBody.numColliders();
                        const collidersToRemove: RAPIER.Collider[] = []; // Store Collider objects
                        for (let i = 0; i < numColliders; i++) {
                            const collider: RAPIER.Collider | null = rigidBody.collider(i); // Get Collider object
                            if (collider) { collidersToRemove.push(collider); }
                        }
                        for (const collider of collidersToRemove) {
                            this.rapierWorld.removeCollider(collider, false); // Pass Collider object
                        }
                        this.rapierWorld.removeRigidBody(rigidBody);
                        console.log(`[MyRoom] Removed Rapier body ${rigidBodyHandle}`);
                    } else { console.warn(`[MyRoom] Could not find Rapier body ${rigidBodyHandle} to remove for eid ${eid}`); }
                    this.rigidBodyEntityMap.delete(rigidBodyHandle);
                } else { console.warn(`[MyRoom] No Rapier handle found for eid ${eid} on leave.`); }

                // --- Remove ECS Components ---
                // This marks the entity for the exitQuery in the *next* update loop
                if (hasComponent(this.ecsWorld, Position, eid)) removeComponent(this.ecsWorld, Position, eid);
                if (hasComponent(this.ecsWorld, PlayerInput, eid)) removeComponent(this.ecsWorld, PlayerInput, eid);
                if (hasComponent(this.ecsWorld, RapierRigidBodyHandle, eid)) removeComponent(this.ecsWorld, RapierRigidBodyHandle, eid);
                if (hasComponent(this.ecsWorld, Velocity, eid)) removeComponent(this.ecsWorld, Velocity, eid); // If using Velocity

                // --- Clean up client mapping immediately ---
                this.clientEntityMap.delete(client.sessionId);
                console.log(`[MyRoom] Marked ECS entity ${eid} components for removal.`);

                // Note: Colyseus state removal is handled by the exitQuery in the *next* update loop

            } catch(leaveError) {
                 console.error(`!!! ERROR during onLeave for client ${client.sessionId} (eid: ${eid}) !!!`, leaveError);
                 // Consider what to do if cleanup fails. The room might be in an inconsistent state.
            }

        } else {
            console.warn(`[MyRoom] Client ${client.sessionId} left, but no matching entity found.`);
        }
    }

    onDispose() {
        console.log("[MyRoom] Room disposed.");
        // Optional: Explicitly clear maps/references if needed, though JS garbage collection should handle it.
        this.clientEntityMap.clear();
        this.rigidBodyEntityMap.clear();
        // Note: Rapier doesn't have an explicit world dispose/free method in JS bindings AFAIK.
    }

    // Helper method to find clientId from eid
    private findClientIdByEid(eid: number): string | undefined {
        // Iterate through the map entries
        for (const [clientId, entityId] of this.clientEntityMap.entries()) {
            // If the entityId matches the eid we're looking for, return the clientId
            if (entityId === eid) {
                return clientId;
            }
        }
        // If no match is found, return undefined
        return undefined;
    }
} // End of MyRoom class definition
// server/src/simulation.ts
import { World, Entity, System, Component, Query } from 'geotic'; // USE NAMED IMPORTS

import * as RAPIER from "@dimforge/rapier3d-compat";

// Add this new diagnostic log:
console.log(">>> Simulation File: Attempting named import. System is:", System);

// --- Reusable constants ---
const PHYSICS_TIMESTEP = 1 / 60; // Run physics at 60Hz

// --- Core Simulation Class ---
// This class encapsulates the ECS world and the Physics world
export class Simulation {
    public ecsWorld: World;
    public physicsWorld: RAPIER.World;
    private eventQueue: RAPIER.EventQueue; // To handle collision events later

    // --- Geotic Components ---
    // Define components using Geotic's Component class or simple objects
    Position = class extends Component {
        x = 0;
        y = 0;
        z = 0;
        static properties = { x: 0, y: 0, z: 0 };
    };

    Velocity = class extends Component {
        x = 0;
        y = 0;
        z = 0;
        static properties = { x: 0, y: 0, z: 0 };
    };

    PhysicsBody = class extends Component {
        bodyHandle: number = -1;
        colliderHandle: number = -1;
        static properties = { bodyHandle: -1, colliderHandle: -1 };
    };

    // --- Tag Components ---
    PlayerTag = class extends Component {};
    ItemTag = class extends Component {};
    NpcTag = class extends Component {}; // For the validation feature later
    CollectibleTag = class extends Component {}; // Marks items that can be picked up

    // --- State/Gameplay Components ---
    Inventory = class extends Component {
        itemCount: number = 0;
        static properties = { itemCount: 0 };
    };

    WantsToCollect = class extends Component {
        targetItemId: number = -1; // ECS Entity ID of the item to collect
        static properties = { targetItemId: -1 };
    };

    // --- Geotic Systems ---
    // Access simulation via this.world.simulation if needed
    // Systems have `this.world` automatically

    PhysicsIntegrationSystem = class extends System {
        // Get simulation instance from the world object where it's attached
        private get simulation(): Simulation {
            return (this.world as any).simulation;
        }
        private query = this.query((e: Entity) => e.has(this.simulation.Velocity) && e.has(this.simulation.PhysicsBody));

        execute(deltaTime: number): void {
            this.query.get().forEach((entity) => {
                const vel = entity.get(this.simulation.Velocity);
                const phys = entity.get(this.simulation.PhysicsBody);
                // Access physicsWorld via the simulation instance stored on the world
                const rigidBody = this.simulation.physicsWorld.getRigidBody(phys.bodyHandle);
                if (rigidBody && rigidBody.isDynamic()) {
                    rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
                }
            });
        }
    };

    PhysicsSyncSystem = class extends System {
         private get simulation(): Simulation {
            return (this.world as any).simulation;
        }
        private query = this.query((e: Entity) => e.has(this.simulation.Position) && e.has(this.simulation.PhysicsBody));

        execute(deltaTime: number): void {
            this.query.get().forEach((entity) => {
                const pos = entity.get(this.simulation.Position);
                const phys = entity.get(this.simulation.PhysicsBody);
                const rigidBody = this.simulation.physicsWorld.getRigidBody(phys.bodyHandle);
                if (rigidBody) {
                    const rapierPos = rigidBody.translation();
                    pos.x = rapierPos.x; pos.y = rapierPos.y; pos.z = rapierPos.z;
                }
            });
        }
    };

    MovementSystem = class extends System {
         private get simulation(): Simulation {
            return (this.world as any).simulation;
        }
        private query = this.query((e: Entity) => e.has(this.simulation.PlayerTag) && e.has(this.simulation.Velocity));
        execute(deltaTime: number): void { /* Placeholder */ }
    };

    CollectionSystem = class extends System {
        private get simulation(): Simulation {
            return (this.world as any).simulation;
        }
        private collectorQuery = this.query((e: Entity) => e.has(this.simulation.WantsToCollect) && e.has(this.simulation.Position) && e.has(this.simulation.Inventory));
        private collectibleQuery = this.query((e: Entity) => e.has(this.simulation.CollectibleTag) && e.has(this.simulation.Position));

        execute(deltaTime: number): void {
            const entitiesToProcess = this.collectorQuery.get();
             // console.log(`[Sim] CollectionSystem: Processing ${entitiesToProcess.length} entities with WantsToCollect`); // Keep logs for now
             if (entitiesToProcess.length === 0) return;


            entitiesToProcess.forEach((collector) => {
                if (!collector.has(this.simulation.WantsToCollect)) return;


                const collectorPos = collector.get(this.simulation.Position);
                const collectorInv = collector.get(this.simulation.Inventory);
                const request = collector.get(this.simulation.WantsToCollect);
                const targetItemId = request.targetItemId;

                // Use this.world to get entity, consistent with system context
                const targetItem = this.world.getEntity(targetItemId);

                let collected = false;

                if (targetItem && targetItem.has(this.simulation.CollectibleTag) && !targetItem.isDestroyed) {
                    const itemPos = targetItem.get(this.simulation.Position);
                    const dx = collectorPos.x - itemPos.x;
                    const dy = collectorPos.y - itemPos.y;
                    const dz = collectorPos.z - itemPos.z;
                    const distanceSq = dx*dx + dy*dy + dz*dz;
                    const COLLECTION_DISTANCE = 1.5;
                    const COLLECTION_DISTANCE_SQ = COLLECTION_DISTANCE * COLLECTION_DISTANCE;
                    // console.log(`[Sim] Distance check: dx=${dx}, dy=${dy}, dz=${dz}, distanceSq=${distanceSq}, threshold=${COLLECTION_DISTANCE_SQ}`);

                    if (distanceSq < COLLECTION_DISTANCE_SQ) {
                        // console.log(`[Sim] Entity ${collector.id} collecting item ${targetItemId}`);
                        collectorInv.itemCount += 1;
                        // console.log(`[Sim] Inventory updated to ${collectorInv.itemCount}`);
                        // Use the simulation instance helper method to remove item correctly
                        this.simulation.removeItem(targetItem);
                        // console.log(`[Sim] Item ${targetItemId} destroyed: ${targetItem.isDestroyed}`);
                        collected = true;
                    } else {
                        // console.log(`[Sim] Entity ${collector.id} failed to collect item ${targetItemId} (too far)`);
                    }
                } else {
                   // console.log(`[Sim] Entity ${collector.id} failed to collect item ${targetItemId} (invalid target)`);
                }

                collector.remove(this.simulation.WantsToCollect);
                // if (collector.has(this.simulation.WantsToCollect)) {
                //     console.error(`[Sim] Failed to remove WantsToCollect from entity ${collector.id}`);
                // } else {
                //     console.log(`[Sim] Successfully removed WantsToCollect from entity ${collector.id}`);
                // }
            });
        }
    };

    constructor() {
        this.ecsWorld = new World();
        this.eventQueue = new RAPIER.EventQueue(true);
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.physicsWorld = new RAPIER.World(gravity);

        // Attach the simulation instance to the world object itself
        // so systems can access it via `this.world.simulation`
        (this.ecsWorld as any).simulation = this;

        // Register Components
        this.ecsWorld.register(this.Position);
        this.ecsWorld.register(this.Velocity);
        this.ecsWorld.register(this.PhysicsBody);
        this.ecsWorld.register(this.PlayerTag);
        this.ecsWorld.register(this.ItemTag);
        this.ecsWorld.register(this.NpcTag);
        this.ecsWorld.register(this.CollectibleTag);
        this.ecsWorld.register(this.Inventory);
        this.ecsWorld.register(this.WantsToCollect);

        // Register Systems (No extra arguments needed here)
        this.ecsWorld.register(this.PhysicsIntegrationSystem);
        this.ecsWorld.register(this.MovementSystem);
        this.ecsWorld.register(this.CollectionSystem);
        this.ecsWorld.register(this.PhysicsSyncSystem);
    }

    update(deltaTime: number): void {
        // Execute systems in a specific order relative to physics step

        // Pre-physics systems
        this.ecsWorld.getSystem(this.PhysicsIntegrationSystem).execute(deltaTime);
        this.ecsWorld.getSystem(this.MovementSystem).execute(deltaTime);
        // ... other pre-physics systems

        // Physics step
        this.physicsWorld.step(this.eventQueue);

        // Process physics events (optional)
        // this.eventQueue.drainCollisionEvents(...)

        // Post-physics systems
        this.ecsWorld.getSystem(this.PhysicsSyncSystem).execute(deltaTime);
        this.ecsWorld.getSystem(this.CollectionSystem).execute(deltaTime);
        // ... other post-physics systems

        // Geotic internal cleanup (if needed, often automatic)
        // this.ecsWorld.maintain();
    }

    // --- Entity Management Methods ---
    addPlayer(clientId: string): Entity {
        const entity = this.ecsWorld.create();
        entity.add(this.PlayerTag);
        entity.add(this.Position, { x: 0, y: 1, z: 0 });
        entity.add(this.Velocity);
        entity.add(this.Inventory);

        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0).setLinvel(0, 0, 0);
        const rigidBody = this.physicsWorld.createRigidBody(rigidBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.5).setRestitution(0.1).setFriction(0.5);
        const collider = this.physicsWorld.createCollider(colliderDesc, rigidBody);

        entity.add(this.PhysicsBody, { bodyHandle: rigidBody.handle, colliderHandle: collider.handle });
        // console.log(`[Sim] Added Player ${entity.id} (Client: ${clientId}) with Body Handle ${rigidBody.handle}`);
        return entity;
    }

    addItem(x: number, y: number, z: number, itemType: string): Entity {
        const entity = this.ecsWorld.create();
        entity.add(this.ItemTag);
        entity.add(this.CollectibleTag);
        entity.add(this.Position, { x, y, z });
        // Items are non-physical for now
        // console.log(`[Sim] Added Item ${entity.id} of type ${itemType} at (${x},${y},${z})`);
        return entity;
    }

    removeEntity(entity: Entity): void {
        if (!entity || entity.isDestroyed) return; // Prevent errors

        if (entity.has(this.PhysicsBody)) {
            try {
                const phys = entity.get(this.PhysicsBody);
                if (this.physicsWorld.getCollider(phys.colliderHandle)) {
                     this.physicsWorld.removeCollider(phys.colliderHandle, false);
                }
                 if (this.physicsWorld.getRigidBody(phys.bodyHandle)) {
                     this.physicsWorld.removeRigidBody(phys.bodyHandle);
                 }
            } catch (e) {
                console.warn(`[Sim] Error removing physics for entity ${entity.id}: ${e}`);
            }
        }
        entity.destroy(); // Remove from ECS world
    }

    removePlayer(entity: Entity) {
        if(entity && entity.has(this.PlayerTag) && !entity.isDestroyed) {
           // console.log(`[Sim] Removing Player ${entity.id}`);
            this.removeEntity(entity);
        } else if (entity && !entity.has(this.PlayerTag)) {
            console.warn(`[Sim] Attempted to remove non-player entity ${entity?.id} as player.`);
        }
    }

    removeItem(entity: Entity) {
        if(entity && entity.has(this.ItemTag) && !entity.isDestroyed) {
           // console.log(`[Sim] Removing Item ${entity.id}`);
            this.removeEntity(entity);
        } else if (entity && !entity.has(this.ItemTag)) {
            console.warn(`[Sim] Attempted to remove non-item entity ${entity?.id} as item.`);
        }
    }
}
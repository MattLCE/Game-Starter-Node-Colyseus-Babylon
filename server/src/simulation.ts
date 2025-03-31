import { World, Entity, System, Component, Query } from "geotic";
import * as RAPIER from "@dimforge/rapier3d-compat"; // Physics engine

// Re-usable constants
const PHYSICS_TIMESTEP = 1 / 60; // Run physics at 60Hz

// --- Core Simulation Class ---
// This class encapsulates the ECS world and the Physics world
export class Simulation {
  public ecsWorld: World;
  public physicsWorld: RAPIER.World;
  private eventQueue: RAPIER.EventQueue; // To handle collision events later

  // --- Geotic Components ---
  // Define components using Geotic's Component class or simple objects
  // Best practice: Use classes for components that might have methods later
  // Use simple types or interfaces for pure data components

  // Basic spatial components
  Position = class extends Component {
    x = 0;
    y = 0;
    z = 0;

    static properties = {
      x: 0,
      y: 0,
      z: 0,
    };
  };

  Velocity = class extends Component {
    x = 0;
    y = 0;
    z = 0;

    static properties = {
      x: 0,
      y: 0,
      z: 0,
    };
  };

  // Link to Rapier physics body
  PhysicsBody = class extends Component {
    // Rapier's rigid body handle (identifies the body in the physics world)
    bodyHandle: number = -1;
    // Rapier's collider handle (identifies the shape attached to the body)
    colliderHandle: number = -1;

    static properties = {
      bodyHandle: -1,
      colliderHandle: -1,
    };
  };

  // --- Tag Components (Mark entities with specific roles) ---
  PlayerTag = class extends Component {};
  ItemTag = class extends Component {};
  NpcTag = class extends Component {}; // For the validation feature later
  CollectibleTag = class extends Component {}; // Marks items that can be picked up

  // --- State/Gameplay Components ---
  Inventory = class extends Component {
    itemCount: number = 0;
    // Later: items: Map<string, number> = new Map();

    static properties = {
      itemCount: 0,
    };
  };

  // Component added when an entity attempts collection
  // This is transient, processed and removed by a system
  WantsToCollect = class extends Component {
    targetItemId: number = -1; // ECS Entity ID of the item to collect
    static properties = { targetItemId: -1 };
  };

  // --- Geotic Systems ---
  // Define systems that operate on entities with specific components

  // System to apply ECS velocity/position changes TO Rapier before physics step
  PhysicsIntegrationSystem = class extends System {
    // Query for entities that have velocity and a physics body
    private query = this.query(
      (e) =>
        e.has(this.simulation.Velocity) && e.has(this.simulation.PhysicsBody)
    );

    // Note: This is a simplified integration. Real integration might involve
    // more complex force application, checking if body is dynamic etc.
    execute(deltaTime: number): void {
      this.query.get().forEach((entity) => {
        const vel = entity.get(this.simulation.Velocity);
        const phys = entity.get(this.simulation.PhysicsBody);
        const rigidBody = this.simulation.physicsWorld.getRigidBody(
          phys.bodyHandle
        );

        if (rigidBody && rigidBody.isDynamic()) {
          // Only apply to dynamic bodies
          rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
          // Note: For position changes (teleports), you'd use rigidBody.setTranslation(...)
          // but typically physics handles position updates based on velocity.
        }
      });
    }
  };

  // System to read Rapier positions/rotations back INTO ECS after physics step
  PhysicsSyncSystem = class extends System {
    // Query for entities that have position and a physics body
    private query = this.query(
      (e) =>
        e.has(this.simulation.Position) && e.has(this.simulation.PhysicsBody)
    );

    execute(deltaTime: number): void {
      this.query.get().forEach((entity) => {
        const pos = entity.get(this.simulation.Position);
        const phys = entity.get(this.simulation.PhysicsBody);
        const rigidBody = this.simulation.physicsWorld.getRigidBody(
          phys.bodyHandle
        );

        if (rigidBody) {
          const rapierPos = rigidBody.translation();
          pos.x = rapierPos.x;
          pos.y = rapierPos.y;
          pos.z = rapierPos.z;
          // TODO: Sync rotation as well if needed (using rigidBody.rotation())
        }
      });
    }
  };

  // Placeholder Movement System (Will handle input later)
  MovementSystem = class extends System {
    private query = this.query(
      (e) => e.has(this.simulation.PlayerTag) && e.has(this.simulation.Velocity)
    );

    execute(deltaTime: number): void {
      // Later: Read player input component, apply forces/set velocity
      this.query.get().forEach((entity) => {
        // Example: Apply simple gravity if not handled by Rapier directly
        // const vel = entity.get(this.simulation.Velocity);
        // vel.y -= 9.81 * deltaTime;
      });
    }
  };

  // Placeholder Collection System
  CollectionSystem = class extends System {
    // Query for entities that want to collect something AND have a position/inventory
    private collectorQuery = this.query(
      (e) =>
        e.has(this.simulation.WantsToCollect) &&
        e.has(this.simulation.Position) &&
        e.has(this.simulation.Inventory)
    );
    private collectibleQuery = this.query(
      (e) =>
        e.has(this.simulation.CollectibleTag) && e.has(this.simulation.Position)
    );

    execute(deltaTime: number): void {
      this.collectorQuery.get().forEach((collector) => {
        const collectorPos = collector.get(this.simulation.Position);
        const collectorInv = collector.get(this.simulation.Inventory);
        const request = collector.get(this.simulation.WantsToCollect);
        const targetItemId = request.targetItemId;

        const targetItem = this.simulation.ecsWorld.getEntity(targetItemId);

        // Validate target exists and is collectible
        if (targetItem && targetItem.has(this.simulation.CollectibleTag)) {
          const itemPos = targetItem.get(this.simulation.Position);
          // TODO: Implement distance check between collectorPos and itemPos
          const distance = Math.sqrt(
            Math.pow(collectorPos.x - itemPos.x, 2) +
              Math.pow(collectorPos.y - itemPos.y, 2) + // Include Y if needed
              Math.pow(collectorPos.z - itemPos.z, 2)
          );

          const COLLECTION_DISTANCE = 1.5; // Example collection radius

          if (distance < COLLECTION_DISTANCE) {
            console.log(
              `[Sim] Entity ${collector.id} collected item ${targetItemId}`
            );
            collectorInv.itemCount += 1; // Add to inventory
            this.simulation.removeItem(targetItem); // Remove item from simulation
          }
        }

        // Remove the request component regardless of success/failure this tick
        collector.remove(this.simulation.WantsToCollect);
      });
    }
  };

  // Constructor initializes worlds and registers components/systems
  constructor() {
    this.ecsWorld = new World();
    this.eventQueue = new RAPIER.EventQueue(true); // For collisions

    // Define gravity for the physics simulation
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.physicsWorld = new RAPIER.World(gravity);

    // Register Components with the ECS World
    this.ecsWorld.register(this.Position);
    this.ecsWorld.register(this.Velocity);
    this.ecsWorld.register(this.PhysicsBody);
    this.ecsWorld.register(this.PlayerTag);
    this.ecsWorld.register(this.ItemTag);
    this.ecsWorld.register(this.NpcTag);
    this.ecsWorld.register(this.CollectibleTag);
    this.ecsWorld.register(this.Inventory);
    this.ecsWorld.register(this.WantsToCollect);

    // Register Systems with the ECS World
    // Execution order can matter! Define stages or rely on Geotic's resolution.
    // Let's assume Geotic runs them in registration order for now.
    this.ecsWorld.register(this.PhysicsIntegrationSystem, { simulation: this });
    this.ecsWorld.register(this.MovementSystem, { simulation: this });
    this.ecsWorld.register(this.CollectionSystem, { simulation: this });
    // IMPORTANT: PhysicsSyncSystem needs to run AFTER physicsWorld.step()
    this.ecsWorld.register(this.PhysicsSyncSystem, { simulation: this });
  }

  // Main simulation update function, called by the Colyseus room's game loop
  update(deltaTime: number): void {
    // 1. Run ECS systems that should happen BEFORE physics
    //    (e.g., applying inputs/forces to physics bodies)
    this.ecsWorld.getSystem(this.PhysicsIntegrationSystem).execute(deltaTime);
    this.ecsWorld.getSystem(this.MovementSystem).execute(deltaTime);
    // Add other pre-physics systems here (e.g., AI decision making)

    // 2. Step the Physics World
    this.physicsWorld.step(this.eventQueue);

    // 3. Process Physics Events (e.g., collisions) - TODO later
    // this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
    //    console.log(`Collision detected between ${handle1} and ${handle2}, started: ${started}`);
    //    // Find corresponding ECS entities and handle collision logic
    // });

    // 4. Run ECS systems that should happen AFTER physics
    //    (e.g., syncing physics state back to ECS, handling collections)
    this.ecsWorld.getSystem(this.PhysicsSyncSystem).execute(deltaTime);
    this.ecsWorld.getSystem(this.CollectionSystem).execute(deltaTime);
    // Add other post-physics systems here

    // Note: Geotic's world.step(deltaTime) might run all registered systems.
    // If precise ordering between physics steps is needed, manually call
    // system.execute() in the desired order instead of world.step().
    // For now, calling individual systems gives explicit control.
  }

  // --- Entity Management Methods ---

  // Creates a player entity in ECS and a corresponding physics body
  addPlayer(clientId: string): Entity {
    const entity = this.ecsWorld.create();
    entity.add(this.PlayerTag);
    entity.add(this.Position, { x: 0, y: 1, z: 0 }); // Spawn position
    entity.add(this.Velocity);
    entity.add(this.Inventory);

    // Create Rapier physics body
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1, 0) // Initial position MUST match ECS
      .setLinvel(0, 0, 0); // Initial velocity
    const rigidBody = this.physicsWorld.createRigidBody(rigidBodyDesc);

    // Create Rapier collider (e.g., a capsule)
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.5) // Height 1, radius 0.5
      .setRestitution(0.1) // Bounciness
      .setFriction(0.5);
    const collider = this.physicsWorld.createCollider(colliderDesc, rigidBody);

    // Link ECS entity to physics body using PhysicsBody component
    entity.add(this.PhysicsBody, {
      bodyHandle: rigidBody.handle,
      colliderHandle: collider.handle,
    });

    console.log(
      `[Sim] Added Player ${entity.id} (Client: ${clientId}) with Body Handle ${rigidBody.handle}`
    );
    return entity;
  }

  // Creates an item entity in ECS and a corresponding physics body
  addItem(x: number, y: number, z: number, itemType: string): Entity {
    const entity = this.ecsWorld.create();
    entity.add(this.ItemTag);
    entity.add(this.CollectibleTag);
    entity.add(this.Position, { x, y, z });
    // Maybe add Velocity if items can be moved by physics?

    // Create Rapier physics body (e.g., static or dynamic sphere)
    // Let's make items static for now
    // const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
    // If dynamic: const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    // For simplicity, let's make items non-physical initially, only Position matters
    // If physics needed later, uncomment and create body/collider like addPlayer
    /*
    const rigidBody = this.physicsWorld.createRigidBody(rigidBodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(0.3).setRestitution(0.7);
    const collider = this.physicsWorld.createCollider(colliderDesc, rigidBody);
    entity.add(this.PhysicsBody, {
        bodyHandle: rigidBody.handle,
        colliderHandle: collider.handle
    });
    */
    console.log(
      `[Sim] Added Item ${entity.id} of type ${itemType} at (${x},${y},${z})`
    );
    return entity;
  }

  // Removes an entity from ECS and its physics body from Rapier
  removeEntity(entity: Entity): void {
    console.log(`[Sim] Removing Entity ${entity.id}`);
    if (entity.has(this.PhysicsBody)) {
      const phys = entity.get(this.PhysicsBody);
      // Important: Remove collider AND rigid body from physics world
      this.physicsWorld.removeCollider(phys.colliderHandle, true); // true = wake up bodies? check docs
      this.physicsWorld.removeRigidBody(phys.bodyHandle);
    }
    entity.destroy(); // Remove from ECS world
  }

  // Helper for specific removals if needed
  removePlayer(entity: Entity) {
    if (entity && entity.has(this.PlayerTag)) {
      this.removeEntity(entity);
    } else {
      console.warn(
        `[Sim] Attempted to remove non-player entity ${entity?.id} as player.`
      );
    }
  }

  removeItem(entity: Entity) {
    if (entity && entity.has(this.ItemTag)) {
      this.removeEntity(entity);
    } else {
      console.warn(
        `[Sim] Attempted to remove non-item entity ${entity?.id} as item.`
      );
    }
  }
}

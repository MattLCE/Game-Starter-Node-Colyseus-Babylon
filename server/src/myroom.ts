import { Room, Client, ServerError } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { Simulation, Player as SimPlayer, Item as SimItem, NpcCollector as SimNpc } from "./simulation"; // Assuming components are exported if needed directly, or use simulation methods
import type { Entity } from "geotic"; // Import Entity type from geotic

const SESSION_DURATION = 60 * 1000; // 1 minute for testing

// --- Define Colyseus State Schema ---
// (These should match or represent data derived from simulation components)

export class Position extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0; // Typically ground level + half height
  @type("number") z: number = 0;
}

export class Player extends Schema {
  // Synced from SimPlayer's Position component
  @type(Position) position = new Position();
  // Synced from SimPlayer's Inventory component
  @type("number") itemCount: number = 0;
  // Could add name, health etc. later
}

export class Item extends Schema {
  @type("string") itemType: string = "default";
  // Synced from SimItem's Position component
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
  @type("number") remainingTime: number = SESSION_DURATION;
}

// --- Define the Room Logic ---

export class MyRoom extends Room<MyRoomState> {
  private simulation!: Simulation; // Use definite assignment assertion
  private playerEntities = new Map<string, Entity>(); // Maps sessionId to ECS Entity
  private itemEntities = new Map<string, Entity>(); // Maps state key to ECS Entity
  private npcEntities = new Map<string, Entity>(); // Maps state key to ECS Entity
  private sessionInterval: NodeJS.Timeout | null = null;
  private sessionTimeout: NodeJS.Timeout | null = null;

  // --- Room Lifecycle Methods ---

  onCreate(_options: any) {
    console.log("[MyRoom] Room created!");

    // 1. Set the initial state
    this.setState(new MyRoomState());
    this.state.remainingTime = SESSION_DURATION;

    // 2. Initialize the simulation
    this.simulation = new Simulation();

    // 3. Start the simulation loop
    // We divide deltaTime by 1000 because Colyseus provides it in milliseconds,
    // but physics/ECS updates often expect seconds.
    this.setSimulationInterval((deltaTime) => this.updateSimulation(deltaTime / 1000), 1000 / 60); // Aim for 60Hz update rate

    // 4. Set up session timer logic
    this.resetSessionTimer();

    // 5. Spawn initial items (example)
    this.spawnItem("resourceA", 5, 0.5, 5);
    this.spawnItem("resourceB", -5, 0.5, -5);

    // 6. Set up message handlers
    this.onMessage("requestCollect", (client, message: { itemId: string }) => {
      try {
        const playerEntity = this.playerEntities.get(client.sessionId);
        // The state key for items might be different from the ECS entity ID!
        // We need a way to map the message.itemId (state key) to the ECS entity ID.
        // For now, assume itemEntities maps state key -> ECS Entity
        const itemEntity = this.itemEntities.get(message.itemId);

        if (playerEntity && itemEntity) {
            // Add a component to the ECS entity signalling intent
            playerEntity.add(this.simulation.WantsToCollect, { targetItemId: itemEntity.id });
            console.log(`[MyRoom] Client ${client.sessionId} wants to collect ECS item ${itemEntity.id} (State Key: ${message.itemId})`);
        } else {
            console.warn(`[MyRoom] Collection request failed: Player ${client.sessionId} or Item ${message.itemId} not found.`);
        }
      } catch (error) {
          console.error(`[MyRoom] Error processing collect request:`, error);
      }
    });

    this.onMessage("requestDeposit", (client, _message: any) => {
       try {
            const playerEntity = this.playerEntities.get(client.sessionId);
            if(playerEntity) {
                // TODO: Add WantsToDeposit component when defined in Simulation
                 console.log(`[MyRoom] Client ${client.sessionId} wants to deposit.`);
                 // playerEntity.add(this.simulation.WantsToDeposit);
                 // For now, directly modify state for simplicity until ECS system exists
                 const simInventory = playerEntity.get(this.simulation.Inventory);
                 if (simInventory && simInventory.itemCount > 0) {
                     // In future, this would be handled by a deposit system in ECS
                     console.log(`[MyRoom] Player ${playerEntity.id} deposited ${simInventory.itemCount} items (Manual Handling).`);
                     // TODO: Add logic to update persistent score (via DB call later)
                     simInventory.itemCount = 0; // Clear ECS inventory
                     // State sync below will update Colyseus state itemCount
                 }
            }
       } catch (error) {
           console.error(`[MyRoom] Error processing deposit request:`, error);
       }
    });

    // Add other message handlers (e.g., player input) here later
    console.log("[MyRoom] Initial setup complete.");
  }

  onJoin(client: Client, _options: any) {
    console.log(`[MyRoom] Client ${client.sessionId} joined!`);

    // Create player in the simulation (ECS + Physics)
    const playerEntity = this.simulation.addPlayer(client.sessionId);
    this.playerEntities.set(client.sessionId, playerEntity);

    // Create corresponding player in Colyseus state
    const playerState = new Player();
    const simPosition = playerEntity.get(this.simulation.Position); // Get initial pos from simulation
    const simInventory = playerEntity.get(this.simulation.Inventory);

    // Initialize state based on simulation
    playerState.position.x = simPosition.x;
    playerState.position.y = simPosition.y;
    playerState.position.z = simPosition.z;
    playerState.itemCount = simInventory.itemCount;

    // Add to Colyseus state map
    this.state.players.set(client.sessionId, playerState);

     // Start session timer if this is the first player
     if (this.clients.length === 1 && this.sessionTimeout === null) {
        this.resetSessionTimer(true); // Start immediately
    }
  }

  onLeave(client: Client, _consented: boolean) {
    console.log(`[MyRoom] Client ${client.sessionId} left.`);

    // Get the simulation entity for the client
    const entity = this.playerEntities.get(client.sessionId);

    // Remove player from simulation (ECS + Physics)
    if (entity) {
      this.simulation.removePlayer(entity);
      this.playerEntities.delete(client.sessionId);
    } else {
        console.warn(`[MyRoom] Could not find simulation entity for leaving client ${client.sessionId}`);
    }

    // Remove player from Colyseus state
    if (this.state.players.has(client.sessionId)) {
      this.state.players.delete(client.sessionId);
    }
  }

  onDispose() {
    console.log("[MyRoom] Room disposed.");
    // Clean up intervals
    if (this.sessionInterval) clearInterval(this.sessionInterval);
    if (this.sessionTimeout) clearTimeout(this.sessionTimeout);
    // TODO: Add simulation cleanup if needed (e.g., physicsWorld.free())
  }

  // --- Main Simulation & Sync Loop ---

  updateSimulation(deltaTime: number) {
    try {
        // 1. Update the ECS & Physics simulation
        this.simulation.update(deltaTime);

        // 2. Sync Simulation State TO Colyseus State
        this.syncStateToSchema();

        // 3. Update remaining time (do this after syncStateToSchema potentially modifies it)
        if (this.state.remainingTime > 0) {
            this.state.remainingTime = Math.max(0, this.state.remainingTime - deltaTime * 1000); // Update in ms
        }

    } catch (error) {
        console.error("[MyRoom] Simulation update error:", error);
        // Consider locking the room or disconnecting clients on critical errors
    }
  }

  // --- Helper Methods ---

  resetSessionTimer(startImmediately = false) {
    if (this.sessionInterval) clearInterval(this.sessionInterval);
    if (this.sessionTimeout) clearTimeout(this.sessionTimeout);

    this.state.remainingTime = SESSION_DURATION;
    console.log("[MyRoom] Session timer reset.");

    if (startImmediately) {
        console.log("[MyRoom] Session timer started.");
        // Set timeout for session end
        this.sessionTimeout = setTimeout(() => {
            this.endSession();
        }, SESSION_DURATION);
    } else {
        this.sessionTimeout = null; // Ensure it's null if not started
    }
  }

  endSession() {
     console.log("[MyRoom] Session Ended!");
     this.broadcast("sessionEnd"); // Notify clients
     this.state.remainingTime = 0;
     if (this.sessionInterval) clearInterval(this.sessionInterval); // Stop game loop
     if (this.sessionTimeout) clearTimeout(this.sessionTimeout);
     this.sessionTimeout = null;

     // Lock the room to prevent new joins?
     // this.lock();

     // Disconnect clients after a short delay
     setTimeout(() => {
         console.log("[MyRoom] Disconnecting clients after session end.");
         this.disconnect(); // Colyseus handles cleanup via onLeave/onDispose
     }, 5000); // 5 second delay

     // Note: Server reset logic (clearing items/NPCs in simulation) might happen
     // implicitly onDispose or could be triggered here if room persists.
  }

  spawnItem(itemType: string, x: number, y: number, z: number) {
    try {
        const itemEntity = this.simulation.addItem(x, y, z, itemType);

        // Create corresponding state object - Use ECS entity ID as the key for simplicity for now
        const itemStateKey = itemEntity.id.toString();
        const itemState = new Item();
        const simPosition = itemEntity.get(this.simulation.Position);

        itemState.itemType = itemType;
        itemState.position.x = simPosition.x;
        itemState.position.y = simPosition.y;
        itemState.position.z = simPosition.z;

        this.state.items.set(itemStateKey, itemState);
        this.itemEntities.set(itemStateKey, itemEntity); // Map state key to ECS entity

        console.log(`[MyRoom] Spawned Item ${itemStateKey} in state.`);
    } catch (error) {
        console.error(`[MyRoom] Failed to spawn item:`, error)
    }
  }

  // Copies data from ECS components to Colyseus Schema state for syncing
  syncStateToSchema() {
    // Sync Players
    this.state.players.forEach((playerState, sessionId) => {
      const entity = this.playerEntities.get(sessionId);
      if (entity) {
        const simPosition = entity.get(this.simulation.Position);
        const simInventory = entity.get(this.simulation.Inventory);

        // Update positions (only if changed significantly? check performance later)
        playerState.position.x = simPosition.x;
        playerState.position.y = simPosition.y;
        playerState.position.z = simPosition.z;

        // Update item count
        playerState.itemCount = simInventory.itemCount;

        // TODO: Sync rotation later
      }
    });

    // Sync Items (only needed if items can move or change state)
    this.state.items.forEach((itemState, itemStateKey) => {
        const entity = this.itemEntities.get(itemStateKey);
        if(entity) {
            // If items had physics/movement, sync position like players
            // If items change type/value, sync those properties
            // Currently items are static, so less need to sync frequently unless created/destroyed
        } else {
            // Item exists in Colyseus state but not ECS? Remove from Colyseus state.
            console.warn(`[Sync] Item ${itemStateKey} found in state but not ECS. Removing.`);
            this.state.items.delete(itemStateKey);
        }
    });

     // Check ECS items that might have been removed by simulation but not yet from state
     this.itemEntities.forEach((entity, itemStateKey) => {
         if (!this.state.items.has(itemStateKey) && !entity.isDestroyed) {
            // This case shouldn't happen if removal is handled correctly
            // If item removed in simulation (e.g. collection), ensure it's removed from map too
             console.warn(`[Sync] ECS Item ${entity.id} exists but not in state key map?`);
         }
         // If an item was collected/destroyed in simulation, the CollectionSystem should
         // ideally emit an event or we check here. Let's assume Simulation.removeItem handles map cleanup.
         if (entity.isDestroyed) {
             if (this.state.items.has(itemStateKey)) {
                 console.log(`[Sync] Removing destroyed item ${itemStateKey} from state.`);
                 this.state.items.delete(itemStateKey);
             }
             this.itemEntities.delete(itemStateKey); // Clean up map
         }
     });


    // Sync NPCs (similar to players)
     this.state.npcCollectors.forEach((npcState, npcStateKey) => {
         const entity = this.npcEntities.get(npcStateKey);
         if (entity) {
             const simPosition = entity.get(this.simulation.Position);
             const simInventory = entity.get(this.simulation.Inventory);
             npcState.position.x = simPosition.x;
             npcState.position.y = simPosition.y;
             npcState.position.z = simPosition.z;
             npcState.itemCount = simInventory.itemCount;
         } else {
            this.state.npcCollectors.delete(npcStateKey); // Clean up if entity missing
         }
     });
     // Clean up npcEntities map if needed (similar to items)
  }
}
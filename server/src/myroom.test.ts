// server/src/myroom.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
// Import necessary types and classes from myroom.ts
import {
  MyRoom,
  PlayerState,
  MyRoomState,
  InputPayload, // Ensure this is exported from myroom.ts
  Position,
  PlayerInput,
  Velocity, // Import Velocity if checking its components
} from "./myroom";
import { Client } from "@colyseus/core";
import RAPIER from "@dimforge/rapier3d-compat";
import { hasComponent, IWorld, createWorld } from "bitecs"; // Import IWorld for typing

// --- Mocks ---
// Mock RAPIER module
vi.mock("@dimforge/rapier3d-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof RAPIER>();

  // Create reusable mock instances
  const mockRigidBodyInstance = {
    handle: Math.floor(Math.random() * 10000), // Use integer handle
    numColliders: vi.fn(() => 1),
    // Mock collider() to return a mock handle object
    collider: vi.fn((_index: number) => ({ handle: 12345 })),
    translation: vi.fn(() => ({ x: 0, y: 0, z: 0 })), // Default position
    linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })), // Default velocity
    applyImpulse: vi.fn(),
    setLinvel: vi.fn(),
    // Add other methods if called by your room logic (e.g., setTranslation)
  };

  const mockColliderInstance = { handle: 12345 }; // Default mock collider

  const mockWorldInstance = {
    createCollider: vi.fn(),
    createRigidBody: vi.fn(() => mockRigidBodyInstance),
    getRigidBody: vi.fn((_handle) => mockRigidBodyInstance),
    // Mock getCollider to return the mock collider instance if handle matches
    getCollider: vi.fn((handle) =>
      handle === 12345 ? mockColliderInstance : null
    ),
    removeCollider: vi.fn(),
    removeRigidBody: vi.fn(),
    step: vi.fn(),
    // Add other world methods if called
  };

  // Structure matching RAPIER usage
  const mockRapierAPI = {
    ...actual, // Keep actual non-mocked parts
    init: vi.fn().mockResolvedValue(undefined), // Mock init as resolved promise
    World: vi.fn().mockImplementation(() => mockWorldInstance),
    ColliderDesc: {
      cuboid: vi.fn(() => ({
        // Mock the descriptor methods too
        setRestitution: vi.fn().mockReturnThis(),
        setFriction: vi.fn().mockReturnThis(),
        // Add other descriptor methods if used
      })),
    },
    RigidBodyDesc: {
      dynamic: vi.fn(() => ({
        setTranslation: vi.fn().mockReturnThis(),
        setLinvel: vi.fn().mockReturnThis(),
        setCcdEnabled: vi.fn().mockReturnThis(),
        // Add other descriptor methods if used
      })),
    },
    // Handle default export if used (RAPIER.World vs RAPIER.default.World)
    default: {
      init: vi.fn().mockResolvedValue(undefined),
      World: vi.fn().mockImplementation(() => mockWorldInstance),
      ColliderDesc: {
        /* ... same as above ... */
      },
      RigidBodyDesc: {
        /* ... same as above ... */
      },
    },
  };

  return mockRapierAPI;
});

describe("MyRoom Tests", () => {
  let room: MyRoom;
  let mockClient: Client;
  let mockWorldInstance: RAPIER.World; // To access mocked world methods
  let mockRigidBodyInstance: any; // To access mocked body methods/state

  beforeEach(async () => {
    vi.clearAllMocks(); // Clear mocks before each test

    // Create a basic mock client
    mockClient = {
      sessionId: "client-test-1",
      id: "client-test-1", // Often same as sessionId
      send: vi.fn(),
      leave: vi.fn(),
      // Mock other client properties/methods if your room uses them
      state: 0, // Example state if needed
      removeAllListeners: vi.fn(),
    } as unknown as Client;

    // Instantiate the room
    room = new MyRoom();

    // --- Mock Room Internals (Use carefully) ---
    // Mock methods called by the Room base class or internally if needed
    room.setState = vi.fn((state) => {
      (room as any).state = state;
    });
    room.setSimulationInterval = vi.fn((_cb, _ms) => {
      /* Store or ignore */
    });
    room.setPatchRate = vi.fn(); // Mock patch rate if called
    room.clock = {
      deltaTime: 16.66,
      elapsedTime: 0,
      tick: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      clear: vi.fn(),
    } as any;

    // --- Manually Initialize Room Properties (Simulating Constructor/onCreate internals) ---
    // These would normally be set within onCreate. We need them for tests.
    // Use a real bitecs world for component checks if possible
    (room as any).ecsWorld = createWorld() as IWorld;
    // Access the mocked RAPIER world instance created by the mock factory
    // This relies on RAPIER.World being called exactly once during room setup
    mockWorldInstance = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); // Get instance from mock
    mockRigidBodyInstance = mockWorldInstance.createRigidBody({} as any); // Get body instance
    (room as any).rapierWorld = mockWorldInstance;

    (room as any).clientEntityMap = new Map<string, number>();
    (room as any).eidToRapierBodyMap = new Map<number, RAPIER.RigidBody>();

    // --- Call onCreate to Run Room Setup Logic ---
    // This will use the mocked RAPIER, set state, define queries, etc.
    await room.onCreate({});

    // --- Post-onCreate Assertions/Checks (Optional) ---
    // Verify that onCreate correctly set up mocks or internal state if needed
    expect(RAPIER.init).toHaveBeenCalled();
    expect(RAPIER.World).toHaveBeenCalled();
    expect(room.setState).toHaveBeenCalled();
    expect((room as any).rapierWorld).toBe(mockWorldInstance); // Check if mock was assigned
    // Ensure state object exists after onCreate
    if (!(room as any).state) {
      console.warn(
        "Test Warning: Room state was not set by onCreate. Manually setting."
      );
      room.setState(new MyRoomState());
    }
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore original implementations after each test
  });

  it("should instantiate correctly via onCreate", () => {
    expect(room).toBeDefined();
    // Check properties initialized in onCreate
    expect((room as any).ecsWorld).toBeDefined();
    expect((room as any).rapierWorld).toBeDefined();
    expect((room as any).rapierWorld).toBe(mockWorldInstance); // Should be the mocked instance
    expect((room as any).clientEntityMap).toBeInstanceOf(Map);
    expect((room as any).eidToRapierBodyMap).toBeInstanceOf(Map);
    expect(room.state).toBeInstanceOf(MyRoomState); // State object should be set
    // Check if queries are defined (access might require 'as any')
    expect((room as any).playerQuery).toBeDefined();
    expect((room as any).playerQueryEnter).toBeDefined();
    expect((room as any).playerQueryExit).toBeDefined();
    // Check if simulation interval was set
    expect(room.setSimulationInterval).toHaveBeenCalled();
    // Check if message handler was registered (can't directly check internal listeners easily)
    // We test the handler's effect separately.
  });

  it("should add player components and Rapier body onJoin", () => {
    room.onJoin(mockClient, {}); // Call onJoin

    const eid = (room as any).clientEntityMap.get(mockClient.sessionId);
    expect(eid).toBeDefined(); // Entity ID should be mapped
    expect(eid).toBeTypeOf("number");

    const ecsWorld = (room as any).ecsWorld;
    // Check that ECS components were added
    expect(hasComponent(ecsWorld, Position, eid as number)).toBe(true);
    expect(hasComponent(ecsWorld, PlayerInput, eid as number)).toBe(true);
    expect(hasComponent(ecsWorld, Velocity, eid as number)).toBe(true); // Check Velocity too

    // Check that Rapier body was created and mapped
    expect((room as any).eidToRapierBodyMap.has(eid)).toBe(true);
    expect(mockWorldInstance.createRigidBody).toHaveBeenCalled();
    expect(mockWorldInstance.createCollider).toHaveBeenCalled(); // Collider should also be created

    // Check initial component values (optional)
    expect(PlayerInput.forward[eid as number]).toBe(0);
  });

  it("should sync player state from Rapier body during update", () => {
    room.onJoin(mockClient, {}); // Join player first
    const eid = (room as any).clientEntityMap.get(mockClient.sessionId);
    expect(eid).toBeDefined();
    if (eid === undefined)
      throw new Error("Test precondition failed: eid undefined");

    // --- Simulate Physics State Change ---
    // Set the return value for the mocked rigid body's translation method
    const simulatedPosition = { x: 10, y: 5, z: -2 };
    mockRigidBodyInstance.translation.mockReturnValue(simulatedPosition);
    // Ensure the mock getRigidBody returns our instance
    vi.spyOn(mockWorldInstance, "getRigidBody").mockReturnValue(
      mockRigidBodyInstance
    );
    // Ensure eidToRapierBodyMap has the correct mapping
    (room as any).eidToRapierBodyMap.set(eid, mockRigidBodyInstance);

    // --- Trigger Colyseus State Creation (might happen in update) ---
    // Run update once to process the 'playerQueryEnter' which adds the player to Colyseus state
    (room as any).update(room.clock.deltaTime / 1000);

    // Verify player state exists *before* the main sync check
    let playerState = room.state.players.get(mockClient.sessionId);
    expect(playerState).toBeDefined();
    expect(playerState).toBeInstanceOf(PlayerState);
    if (!playerState)
      throw new Error("Test precondition failed: playerState not created");

    // --- Run Update Again to Sync Position ---
    (room as any).update(room.clock.deltaTime / 1000); // Run update logic

    // --- Assert State Synchronization ---
    // Re-get state in case object reference changed (unlikely with MapSchema)
    playerState = room.state.players.get(mockClient.sessionId);
    expect(playerState).toBeDefined();
    // Check if Colyseus state matches the simulated physics position
    expect(playerState?.x).toBe(simulatedPosition.x);
    expect(playerState?.y).toBe(simulatedPosition.y);
    expect(playerState?.z).toBe(simulatedPosition.z);

    // Also check if ECS position was updated (optional, depends on update order)
    expect(Position.x[eid]).toBe(simulatedPosition.x);
    expect(Position.y[eid]).toBe(simulatedPosition.y);
    expect(Position.z[eid]).toBe(simulatedPosition.z);
  });

  it("should remove player resources and state onLeave", () => {
    room.onJoin(mockClient, {}); // Join player
    const eid = (room as any).clientEntityMap.get(mockClient.sessionId);
    expect(eid).toBeDefined();
    if (eid === undefined)
      throw new Error("Test precondition failed: eid undefined after join");

    // Run update once to ensure player state is added via enterQuery
    (room as any).update(room.clock.deltaTime / 1000);
    expect(room.state.players.has(mockClient.sessionId)).toBe(true); // Verify state exists before leave

    // Spy on component removal *before* calling onLeave
    const removeComponentSpy = vi.spyOn(require("bitecs"), "removeComponent");

    // --- Trigger Leave ---
    room.onLeave(mockClient, false);

    // --- Assert Immediate Removals (Maps, Rapier calls) ---
    expect((room as any).clientEntityMap.has(mockClient.sessionId)).toBe(false); // Client map should be cleared immediately
    // Check if Rapier removal methods were called during onLeave
    expect(mockWorldInstance.removeCollider).toHaveBeenCalled();
    expect(mockWorldInstance.removeRigidBody).toHaveBeenCalled();
    expect((room as any).eidToRapierBodyMap.has(eid)).toBe(false); // Rapier map should be cleared

    // --- Assert ECS Component Removal (Check spy calls) ---
    // Check if removeComponent was called for expected components
    expect(removeComponentSpy).toHaveBeenCalledWith(
      (room as any).ecsWorld,
      Position,
      eid
    );
    expect(removeComponentSpy).toHaveBeenCalledWith(
      (room as any).ecsWorld,
      PlayerInput,
      eid
    );
    expect(removeComponentSpy).toHaveBeenCalledWith(
      (room as any).ecsWorld,
      Velocity,
      eid
    ); // Check Velocity removal

    // --- Assert Colyseus State Removal ---
    // Check if state was removed directly in onLeave
    expect(room.state.players.has(mockClient.sessionId)).toBe(false);

    // --- Run Update to Process Exit Query (Should have no effect if already removed) ---
    (room as any).update(room.clock.deltaTime / 1000);

    // --- Final Assertions (State should remain removed) ---
    expect(room.state.players.has(mockClient.sessionId)).toBe(false);
    // Double-check ECS components are gone after update processes exitQuery
    expect(hasComponent((room as any).ecsWorld, Position, eid)).toBe(false);
    expect(hasComponent((room as any).ecsWorld, PlayerInput, eid)).toBe(false);
  });

  // ----- CORRECTED MESSAGE HANDLING TEST -----
  it("should update player input component when message handler is invoked", () => {
    room.onJoin(mockClient, {}); // Client must join first
    const eid = (room as any).clientEntityMap.get(mockClient.sessionId);
    expect(eid).toBeDefined(); // Ensure entity exists
    if (eid === undefined)
      throw new Error("Test precondition failed: eid undefined");

    // Verify initial input state
    expect(PlayerInput.forward[eid]).toBe(0);
    expect(PlayerInput.left[eid]).toBe(0);
    // ... check others if needed

    // Define the message payload
    const messagePayload: InputPayload = {
      forward: true, // Simulate pressing forward
      left: true, // Simulate pressing left
      right: false,
      backward: false,
    };

    // --- Invoke the Handler Directly ---
    // This assumes MyRoom has the public 'handleInputMessage' method
    expect(typeof (room as any).handleInputMessage).toBe("function"); // Verify method exists
    room.handleInputMessage(mockClient, messagePayload); // Call the handler

    // --- Assert Input State Changed ---
    // Check that the PlayerInput component values were updated by the handler
    expect(PlayerInput.forward[eid]).toBe(1); // Should be 1 (true)
    expect(PlayerInput.left[eid]).toBe(1); // Should be 1 (true)
    expect(PlayerInput.right[eid]).toBe(0); // Should be 0 (false)
    expect(PlayerInput.backward[eid]).toBe(0); // Should be 0 (false)
  });

  it("should apply forces based on input during update", () => {
    room.onJoin(mockClient, {}); // Join player
    const eid = (room as any).clientEntityMap.get(mockClient.sessionId);
    expect(eid).toBeDefined();
    if (eid === undefined)
      throw new Error("Test precondition failed: eid undefined");
    // Ensure body is mapped
    (room as any).eidToRapierBodyMap.set(eid, mockRigidBodyInstance);

    // --- Simulate Input State ---
    PlayerInput.forward[eid] = 1; // Set input component directly
    PlayerInput.left[eid] = 1;

    // --- Run Update ---
    (room as any).update(room.clock.deltaTime / 1000);

    // --- Assert Physics Interaction ---
    // Check if applyImpulse was called on the mock rigid body
    expect(mockRigidBodyInstance.applyImpulse).toHaveBeenCalled();
    // Check the impulse values (might need more specific mock setup)
    const expectedImpulseArg = expect.objectContaining({
      x: expect.any(Number), // Check specific values if needed and normalization is predictable
      y: 0, // Should only apply horizontal impulse
      z: expect.any(Number),
    });
    expect(mockRigidBodyInstance.applyImpulse).toHaveBeenCalledWith(
      expectedImpulseArg,
      true
    );
  });
});

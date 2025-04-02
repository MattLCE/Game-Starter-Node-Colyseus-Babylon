// server/src/myroom.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MyRoom, PlayerState, MyRoomState, InputPayload } from "./myroom"; // Import InputPayload too
import { Client } from "@colyseus/core";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  // addEntity, // unused
  hasComponent,
  // Query, // Query was unused
} from "bitecs";
// Import only existing components used in tests
import { Position, PlayerInput } from "./myroom";

// --- Mocks ---
// (Mock setup remains the same as before)
vi.mock("@dimforge/rapier3d-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof RAPIER>();
  const mockRigidBody = {
    handle: Math.random() * 1000,
    numColliders: vi.fn(() => 1),
    collider: vi.fn(() => 12345), // Return a mock collider handle
    translation: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    applyImpulse: vi.fn(),
    setLinvel: vi.fn(),
  };
  const mockCollider = { handle: 12345 }; // Mock the collider object
  const mockWorld = {
    createCollider: vi.fn(),
    createRigidBody: vi.fn(() => mockRigidBody),
    getRigidBody: vi.fn((_handle) => mockRigidBody),
    getCollider: vi.fn((handle) => (handle === 12345 ? mockCollider : null)),
    removeCollider: vi.fn(),
    removeRigidBody: vi.fn(),
    step: vi.fn(),
  };
  // Return structure matching how RAPIER might be imported/used
  return {
    ...actual, // Spread actual to keep non-mocked parts if any
    World: vi.fn().mockImplementation(() => mockWorld),
    ColliderDesc: {
      cuboid: vi.fn(() => ({
        setRestitution: vi.fn().mockReturnThis(),
        setFriction: vi.fn().mockReturnThis(),
      })),
    },
    RigidBodyDesc: {
      dynamic: vi.fn(() => ({
        setTranslation: vi.fn().mockReturnThis(),
        setLinvel: vi.fn().mockReturnThis(),
        setCcdEnabled: vi.fn().mockReturnThis(),
      })),
    },
    default: {
      // Handle default export if used like RAPIER.World
      World: vi.fn().mockImplementation(() => mockWorld),
      ColliderDesc: {
        cuboid: vi.fn(() => ({
          setRestitution: vi.fn().mockReturnThis(),
          setFriction: vi.fn().mockReturnThis(),
        })),
      },
      RigidBodyDesc: {
        dynamic: vi.fn(() => ({
          setTranslation: vi.fn().mockReturnThis(),
          setLinvel: vi.fn().mockReturnThis(),
          setCcdEnabled: vi.fn().mockReturnThis(),
        })),
      },
    },
  };
});

describe("MyRoom Tests", () => {
  let room: MyRoom;
  let mockClient: Client;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockClient = {
      sessionId: "client1",
      send: vi.fn(),
      leave: vi.fn(),
    } as unknown as Client;

    room = new MyRoom();

    // Mock internal state/methods using 'as any' carefully
    room.setState = vi.fn((state) => {
      (room as any).state = state;
    });
    room.setSimulationInterval = vi.fn((_callback, _interval) => {});
    room.clock = { deltaTime: 16.6, elapsedTime: 0, tick: vi.fn() } as any;
    (room as any).clientEntityMap = new Map<string, number>();
    (room as any).eidToRapierBodyMap = new Map<number, RAPIER.RigidBody>();

    await room.onCreate({}); // Call onCreate

    // Ensure state is initialized if mock didn't cover it
    if (!(room as any).state) {
      room.setState(new MyRoomState());
    }
  });

  it("should instantiate", () => {
    expect(room).toBeDefined();
    expect((room as any).rapierWorld).toBeDefined();
    expect((room as any).ecsWorld).toBeDefined();
    expect((room as any).eidToRapierBodyMap).toBeDefined();
    expect((room as any).clientEntityMap).toBeDefined();
  });

  it("should add a player state onJoin and sync state in update", () => {
    room.onJoin(mockClient, {});
    // const ecsWorld = (room as any).ecsWorld;
    const clientEntityMap = (room as any).clientEntityMap;
    const eid = clientEntityMap.get(mockClient.sessionId);

    // Use type guards or checks instead of ! assertion where possible
    expect(eid).toBeDefined();
    if (eid === undefined)
      throw new Error("eid should be defined after onJoin"); // Fail test explicitly if undefined

    expect(eid).toBeTypeOf("number"); // Check type

    expect(hasComponent(ecsWorld, Position, eid)).toBe(true);
    expect(hasComponent(ecsWorld, PlayerInput, eid)).toBe(true);
    expect((room as any).eidToRapierBodyMap.has(eid)).toBe(true);

    (room as any).update(1 / 60); // Run update

    expect(room.state.players.size).toBe(1);
    const playerState = room.state.players.get(mockClient.sessionId);
    expect(playerState).toBeInstanceOf(PlayerState);

    // Compare against ECS state after update
    expect(playerState?.x).toBe(Position.x[eid]);
    expect(playerState?.y).toBe(Position.y[eid]);
    expect(playerState?.z).toBe(Position.z[eid]);
  });

  it("should remove player state onLeave and call Rapier removal", () => {
    room.onJoin(mockClient, {});
    (room as any).update(1 / 60);
    expect(room.state.players.size).toBe(1);

    const clientEntityMap = (room as any).clientEntityMap;
    const eid = clientEntityMap.get(mockClient.sessionId);
    expect(eid).toBeDefined(); // Check defined first
    if (eid === undefined)
      throw new Error("eid should be defined before onLeave");

    expect((room as any).eidToRapierBodyMap.has(eid)).toBe(true);

    room.onLeave(mockClient, false); // Trigger leave

    expect((room as any).clientEntityMap.has(mockClient.sessionId)).toBe(false);
    expect((room as any).eidToRapierBodyMap.has(eid)).toBe(false);

    // const ecsWorld = (room as any).ecsWorld;
    // bitecs removes components immediately
    expect(hasComponent(ecsWorld, Position, eid)).toBe(false);
    expect(hasComponent(ecsWorld, PlayerInput, eid)).toBe(false);

    const rapierWorldMockInstance = (room as any).rapierWorld;
    // Check that the mocked functions were called
    expect(rapierWorldMockInstance.removeCollider).toHaveBeenCalled();
    expect(rapierWorldMockInstance.removeRigidBody).toHaveBeenCalled();

    (room as any).update(1 / 60); // Run update to process exit query
    expect(room.state.players.has(mockClient.sessionId)).toBe(false);
  });

  it("should update player input component on message", () => {
    room.onJoin(mockClient, {});
    (room as any).update(1 / 60);
    const eid = (room as any).clientEntityMap.get(mockClient.sessionId);
    expect(eid).toBeDefined(); // Check defined
    if (eid === undefined)
      throw new Error("eid should be defined before onMessage");

    // const ecsWorld = (room as any).ecsWorld;

    expect(PlayerInput.forward[eid]).toBe(0); // Check initial value

    // Use the imported InputPayload type implicitly
    const messagePayload: InputPayload = {
      forward: true,
      left: false,
      right: false,
      backward: false,
    };
    room.onMessage("input", mockClient, messagePayload);

    // Check updated values
    expect(PlayerInput.forward[eid]).toBe(1); // Failing assertion is here
    expect(PlayerInput.left[eid]).toBe(0);
    expect(PlayerInput.right[eid]).toBe(0);
    expect(PlayerInput.backward[eid]).toBe(0);
  });
});

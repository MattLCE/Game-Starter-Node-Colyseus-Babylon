// server/src/myroom.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MyRoom, PlayerState, MyRoomState } from './myroom'; // Import necessary types
import { Client } from '@colyseus/core'; // Import Client for mocking
import RAPIER from "@dimforge/rapier3d-compat"; // Import Rapier for type checks
// Import bitecs components and functions needed for tests
import { PlayerInput, Position, Velocity, RapierRigidBodyHandle, addEntity, hasComponent } from 'bitecs';


// Keep the mock, ensure mocked methods align with usage in MyRoom
vi.mock('@dimforge/rapier3d-compat', async (importOriginal) => {
  const actual = await importOriginal<typeof RAPIER>();
  const mockRigidBody = {
    handle: Math.random() * 1000,
    numColliders: vi.fn(() => 0),
    collider: vi.fn(() => 0), // Return a mock handle
    translation: vi.fn(() => ({x:0, y:0, z:0})),
    linvel: vi.fn(() => ({x:0, y:0, z:0})),
    applyImpulse: vi.fn(),
    setLinvel: vi.fn(),
  };
  const mockWorld = {
        createCollider: vi.fn(),
        createRigidBody: vi.fn(() => mockRigidBody),
        getRigidBody: vi.fn(() => mockRigidBody), // Return the same mock structure
        getCollider: vi.fn(() => ({ handle: 12345 })), // Mock collider retrieval
        removeCollider: vi.fn(),
        removeRigidBody: vi.fn(),
        step: vi.fn(),
      };

  return {
    ...actual,
    World: vi.fn().mockImplementation(() => mockWorld),
    ColliderDesc: { cuboid: vi.fn(() => ({ setRestitution: vi.fn().mockReturnThis(), setFriction: vi.fn().mockReturnThis() })) },
    RigidBodyDesc: { dynamic: vi.fn(() => ({ setTranslation: vi.fn().mockReturnThis(), setLinvel: vi.fn().mockReturnThis(), setCcdEnabled: vi.fn().mockReturnThis() })) },
  };
});


describe('MyRoom Tests', () => {
  let room: MyRoom;

  beforeEach(async () => {
    // Reset mocks for Rapier parts if necessary (might not be needed with vi.mock factory)
    vi.clearAllMocks();

    room = new MyRoom();
    // Mock Colyseus internals BEFORE calling onCreate
    room.setState = vi.fn((state) => { (room as any).state = state; });
    room.setSimulationInterval = vi.fn();
    room.clock = { deltaTime: 16.6, elapsedTime: 0, tick: vi.fn() } as any;

    // Call onCreate to initialize the room, ECS, Rapier world (mocked)
    await room.onCreate({});

     // Set initial state AFTER onCreate might have tried to set it (if setState wasn't mocked early enough)
     if (!(room as any).state) {
        room.setState(new MyRoomState());
     } else {
         // If onCreate set it before the mock, ensure it's the correct type
         (room as any).state = new MyRoomState();
     }
  });

  it('should instantiate', () => {
    expect(room).toBeDefined();
    expect((room as any).rapierWorld).toBeDefined();
    expect((room as any).ecsWorld).toBeDefined();
  });

  it('should add a player state onJoin and process in update', () => {
    const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn(), } as unknown as Client; // More complete mock type
    room.onJoin(mockClient, {});

    // Need access to ecsWorld for checks
    const ecsWorld = (room as any).ecsWorld;
    const clientEntityMap = (room as any).clientEntityMap;
    const eid = clientEntityMap.get('client1');

    expect(eid).toBeDefined();
    expect(hasComponent(ecsWorld, Position, eid!)).toBe(true);
    expect(hasComponent(ecsWorld, PlayerInput, eid!)).toBe(true);
    expect(hasComponent(ecsWorld, RapierRigidBodyHandle, eid!)).toBe(true);

    // Simulate the game loop's enterQuery effect
    (room as any).update(16.6 / 1000); // Run one update to process queries

    expect(room.state.players.size).toBe(1);
    const playerState = room.state.players.get('client1');
    expect(playerState).toBeInstanceOf(PlayerState);
    // Check initial position sync
    expect(playerState?.x).toBe(Position.x[eid!]);
    expect(playerState?.y).toBe(Position.y[eid!]);
    expect(playerState?.z).toBe(Position.z[eid!]);
  });

   it('should remove player state onLeave and process in update', () => {
     const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn(), } as unknown as Client;
     room.onJoin(mockClient, {});

     // Simulate the game loop's enterQuery effect
     (room as any).update(16.6 / 1000);
     expect(room.state.players.size).toBe(1); // Verify player added

     const clientEntityMap = (room as any).clientEntityMap;
     const eid = clientEntityMap.get('client1');
     expect(eid).toBeDefined();

     room.onLeave(mockClient, false);

     // Check that component removal happened in onLeave
     const ecsWorld = (room as any).ecsWorld;
     expect(hasComponent(ecsWorld, Position, eid!)).toBe(false); // Check if component was removed
     expect(hasComponent(ecsWorld, PlayerInput, eid!)).toBe(false);
     expect(hasComponent(ecsWorld, RapierRigidBodyHandle, eid!)).toBe(false);

     // Simulate the game loop's exitQuery effect
     (room as any).update(16.6 / 1000); // Run update again to process removal query

     expect(room.state.players.has('client1')).toBe(false);
     expect((room as any).clientEntityMap.has('client1')).toBe(false); // Map cleaned up in onLeave
     // Check if Rapier remove methods were called (using the mock)
     const rapierWorldMock = (room as any).rapierWorld;
     expect(rapierWorldMock.removeCollider).toHaveBeenCalled();
     expect(rapierWorldMock.removeRigidBody).toHaveBeenCalled();
   });

    it('should update player input component on message', () => {
        const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn(), } as unknown as Client;
        room.onJoin(mockClient, {});
        (room as any).update(16.6 / 1000); // Process join

        const eid = (room as any).clientEntityMap.get('client1');
        expect(eid).toBeDefined();

        const ecsWorld = (room as any).ecsWorld;
        expect(PlayerInput.forward[eid!]).toBe(0); // Check initial state

        // Pass mockClient directly, TS error should be gone if mockClient type is sufficient or casted
        room.onMessage('input', mockClient as any, { forward: true, left: false, right: false, backward: false });

        expect(PlayerInput.forward[eid!]).toBe(1); // Check updated state
        expect(PlayerInput.left[eid!]).toBe(0);
    });

    // Add more tests...
});
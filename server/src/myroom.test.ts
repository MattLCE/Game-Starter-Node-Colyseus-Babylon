// server/src/myroom.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MyRoom, PlayerState, MyRoomState } from './myroom'; // No RapierRigidBodyHandle here
import { Client } from '@colyseus/core';
import RAPIER from "@dimforge/rapier3d-compat";
import {
    addEntity,
    hasComponent,
    Query,
} from 'bitecs';
// Import only existing components
import { Position, PlayerInput, Velocity } from './myroom'; // No RapierRigidBodyHandle here

// --- Mocks remain the same ---
vi.mock('@dimforge/rapier3d-compat', async (importOriginal) => {
    const actual = await importOriginal<typeof RAPIER>();
    const mockRigidBody = {
        handle: Math.random() * 1000, // Keep mock handle for internal mock logic
        numColliders: vi.fn(() => 0),
        collider: vi.fn(() => 0),
        translation: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        applyImpulse: vi.fn(),
        setLinvel: vi.fn(),
    };
    const mockWorld = {
        createCollider: vi.fn(),
        createRigidBody: vi.fn(() => mockRigidBody),
        // Mock getRigidBody (though we don't use it with handles anymore)
        getRigidBody: vi.fn((handle) => handle === 0 ? mockRigidBody : null), // Simple mock
        getCollider: vi.fn(() => ({ handle: 12345 })),
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
    vi.clearAllMocks();
    room = new MyRoom();
    // Mock internal properties/methods needed for tests
    room.setState = vi.fn((state) => { (room as any).state = state; });
    room.setSimulationInterval = vi.fn();
    room.clock = { deltaTime: 16.6, elapsedTime: 0, tick: vi.fn() } as any;
    (room as any).eidToRapierBodyMap = new Map(); // Initialize the new map for tests
    (room as any).clientEntityMap = new Map(); // Initialize map

    // Need to await onCreate to initialize rapier/ecs world within the room
    await room.onCreate({});
    // Ensure state is set if onCreate didn't mock it completely
    if (!(room as any).state) { room.setState(new MyRoomState()); }

  });

  it('should instantiate', () => {
    expect(room).toBeDefined();
    expect((room as any).rapierWorld).toBeDefined();
    expect((room as any).ecsWorld).toBeDefined();
    expect((room as any).eidToRapierBodyMap).toBeDefined(); // Check new map
  });

  it('should add a player state onJoin and process in update', () => {
    const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn() } as unknown as Client;
    room.onJoin(mockClient, {});
    const ecsWorld = (room as any).ecsWorld;
    const clientEntityMap = (room as any).clientEntityMap;
    const eid = clientEntityMap.get('client1');

    expect(eid).toBeDefined();
    // Check for components that *should* exist
    expect(hasComponent(ecsWorld, Position, eid!)).toBe(true);
    expect(hasComponent(ecsWorld, PlayerInput, eid!)).toBe(true);
    // Check that the map has the body
    expect((room as any).eidToRapierBodyMap.has(eid!)).toBe(true);

    (room as any).update(16.6 / 1000); // Run one update cycle

    // Check Colyseus state
    expect(room.state.players.size).toBe(1);
    const playerState = room.state.players.get('client1');
    expect(playerState).toBeInstanceOf(PlayerState);
    // Position check remains valid
    expect(playerState?.x).toBe(Position.x[eid!]);
    expect(playerState?.y).toBe(Position.y[eid!]);
    expect(playerState?.z).toBe(Position.z[eid!]);
  });

   it('should remove player state onLeave and process in update', () => {
     const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn() } as unknown as Client;
     room.onJoin(mockClient, {});
     (room as any).update(16.6 / 1000); // Add state
     expect(room.state.players.size).toBe(1);

     const clientEntityMap = (room as any).clientEntityMap;
     const eid = clientEntityMap.get('client1');
     expect(eid).toBeDefined();
     expect((room as any).eidToRapierBodyMap.has(eid!)).toBe(true); // Check map before leave

     room.onLeave(mockClient, false); // Trigger leave

     // Check that maps are cleared
     expect((room as any).clientEntityMap.has('client1')).toBe(false);
     expect((room as any).eidToRapierBodyMap.has(eid!)).toBe(false); // Check map after leave

     // Check that components are marked for removal (won't be gone until *after* next update)
     const ecsWorld = (room as any).ecsWorld;
     expect(hasComponent(ecsWorld, Position, eid!)).toBe(false); // bitecs removes immediately in v1
     expect(hasComponent(ecsWorld, PlayerInput, eid!)).toBe(false); // bitecs removes immediately in v1

     // Check that Rapier removal was called
     const rapierWorldMock = (room as any).rapierWorld;
     expect(rapierWorldMock.removeCollider).toHaveBeenCalled();
     expect(rapierWorldMock.removeRigidBody).toHaveBeenCalled();

     // Run update to process exitQuery for Colyseus state removal
     (room as any).update(16.6 / 1000);
     expect(room.state.players.has('client1')).toBe(false); // Colyseus state should be gone now
   });

    it('should update player input component on message', () => {
        const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn() } as unknown as Client;
        room.onJoin(mockClient, {});
        (room as any).update(16.6 / 1000);
        const eid = (room as any).clientEntityMap.get('client1');
        expect(eid).toBeDefined();
        const ecsWorld = (room as any).ecsWorld;
        expect(PlayerInput.forward[eid!]).toBe(0);

        // Message handling remains the same
        const messagePayload: { forward: boolean, left: boolean, right: boolean, backward: boolean } = {
             forward: true, left: false, right: false, backward: false
        };
        room.onMessage('input', mockClient as any, messagePayload as any);
        expect(PlayerInput.forward[eid!]).toBe(1);
        expect(PlayerInput.left[eid!]).toBe(0);
    });

});
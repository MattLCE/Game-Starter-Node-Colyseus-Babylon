// server/src/myroom.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MyRoom, PlayerState, MyRoomState } from './myroom';
import { Client } from '@colyseus/core';
import RAPIER from "@dimforge/rapier3d-compat";
// Import bitecs functions needed
import {
    addEntity,
    hasComponent,
    Query, // Query type IS exported
    // Removed EnterQuery, ExitQuery type imports
} from 'bitecs';
// Import components defined and EXPORTED in myroom.ts
import { Position, PlayerInput, Velocity, RapierRigidBodyHandle } from './myroom';

// --- Mocks remain the same ---
vi.mock('@dimforge/rapier3d-compat', async (importOriginal) => {
    const actual = await importOriginal<typeof RAPIER>();
    const mockRigidBody = {
        handle: Math.random() * 1000,
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
        getRigidBody: vi.fn(() => mockRigidBody),
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
    room.setState = vi.fn((state) => { (room as any).state = state; });
    room.setSimulationInterval = vi.fn();
    room.clock = { deltaTime: 16.6, elapsedTime: 0, tick: vi.fn() } as any;
    await room.onCreate({});
     if (!(room as any).state) { room.setState(new MyRoomState()); }
     else { (room as any).state = new MyRoomState(); }
  });

  it('should instantiate', () => {
    expect(room).toBeDefined();
    expect((room as any).rapierWorld).toBeDefined();
    expect((room as any).ecsWorld).toBeDefined();
  });

  it('should add a player state onJoin and process in update', () => {
    const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn() } as unknown as Client;
    room.onJoin(mockClient, {});
    const ecsWorld = (room as any).ecsWorld;
    const clientEntityMap = (room as any).clientEntityMap;
    const eid = clientEntityMap.get('client1');
    expect(eid).toBeDefined();
    // Use components imported from ./myroom
    expect(hasComponent(ecsWorld, Position, eid!)).toBe(true);
    expect(hasComponent(ecsWorld, PlayerInput, eid!)).toBe(true);
    expect(hasComponent(ecsWorld, RapierRigidBodyHandle, eid!)).toBe(true);
    (room as any).update(16.6 / 1000);
    expect(room.state.players.size).toBe(1);
    const playerState = room.state.players.get('client1');
    expect(playerState).toBeInstanceOf(PlayerState);
    expect(playerState?.x).toBe(Position.x[eid!]); // Uses imported Position
    expect(playerState?.y).toBe(Position.y[eid!]);
    expect(playerState?.z).toBe(Position.z[eid!]);
  });

   it('should remove player state onLeave and process in update', () => {
     const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn() } as unknown as Client;
     room.onJoin(mockClient, {});
     (room as any).update(16.6 / 1000);
     expect(room.state.players.size).toBe(1);
     const clientEntityMap = (room as any).clientEntityMap;
     const eid = clientEntityMap.get('client1');
     expect(eid).toBeDefined();
     room.onLeave(mockClient, false);
     const ecsWorld = (room as any).ecsWorld;
     // Use components imported from ./myroom
     expect(hasComponent(ecsWorld, Position, eid!)).toBe(false);
     expect(hasComponent(ecsWorld, PlayerInput, eid!)).toBe(false);
     expect(hasComponent(ecsWorld, RapierRigidBodyHandle, eid!)).toBe(false);
     (room as any).update(16.6 / 1000);
     expect(room.state.players.has('client1')).toBe(false);
     expect((room as any).clientEntityMap.has('client1')).toBe(false);
     const rapierWorldMock = (room as any).rapierWorld;
     expect(rapierWorldMock.removeCollider).toHaveBeenCalled();
     expect(rapierWorldMock.removeRigidBody).toHaveBeenCalled();
   });

    it('should update player input component on message', () => {
        const mockClient = { sessionId: 'client1', send: vi.fn(), leave: vi.fn() } as unknown as Client;
        room.onJoin(mockClient, {});
        (room as any).update(16.6 / 1000);
        const eid = (room as any).clientEntityMap.get('client1');
        expect(eid).toBeDefined();
        const ecsWorld = (room as any).ecsWorld;
        // Use component imported from ./myroom
        expect(PlayerInput.forward[eid!]).toBe(0);
        // Define the payload with the exact type expected by the handler in myroom.ts
        const messagePayload: { forward: boolean, left: boolean, right: boolean, backward: boolean } = {
             forward: true, left: false, right: false, backward: false
        };
        // Cast the payload to 'any' to bypass strict type checking in the test's onMessage call
        room.onMessage('input', mockClient as any, messagePayload as any);
        // Use component imported from ./myroom
        expect(PlayerInput.forward[eid!]).toBe(1);
        expect(PlayerInput.left[eid!]).toBe(0);
    });

});
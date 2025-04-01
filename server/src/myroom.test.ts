// server/src/myroom.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MyRoom, PlayerState, MyRoomState } from './myroom'; // Import necessary types
import { Client } from '@colyseus/core'; // Import Client for mocking
import RAPIER from "@dimforge/rapier3d-compat"; // Import Rapier for type checks

// Mock the global RAPIER instance if necessary or specific methods
vi.mock('@dimforge/rapier3d-compat', async (importOriginal) => {
  const actual = await importOriginal<typeof RAPIER>();
  // Mock specific parts if needed, e.g., world creation or body methods
  return {
    ...actual,
    World: vi.fn().mockImplementation(() => ({
        createCollider: vi.fn(),
        createRigidBody: vi.fn(() => ({ handle: Math.random() * 1000, numColliders: () => 0, translation: () => ({x:0, y:0, z:0}), linvel: () => ({x:0, y:0, z:0}), applyImpulse: vi.fn(), setLinvel: vi.fn() })), // Mock body creation
        getRigidBody: vi.fn(() => ({ handle: Math.random() * 1000, numColliders: () => 0, translation: () => ({x:0, y:0, z:0}), linvel: () => ({x:0, y:0, z:0}), applyImpulse: vi.fn(), setLinvel: vi.fn() })), // Mock body retrieval
        removeCollider: vi.fn(),
        removeRigidBody: vi.fn(),
        step: vi.fn(),
      })),
    ColliderDesc: { cuboid: vi.fn(() => ({ setRestitution: vi.fn().mockReturnThis(), setFriction: vi.fn().mockReturnThis() })) },
    RigidBodyDesc: { dynamic: vi.fn(() => ({ setTranslation: vi.fn().mockReturnThis(), setLinvel: vi.fn().mockReturnThis(), setCcdEnabled: vi.fn().mockReturnThis() })) },
  };
});


describe('MyRoom Tests', () => {
  let room: MyRoom;

  beforeEach(async () => {
    room = new MyRoom();
    // Manually call onCreate because it's not automatically called in tests
    // We might need to provide mock options if onCreate uses them
    await room.onCreate({});
    // Mock internal Colyseus methods if needed (setState, setSimulationInterval etc.)
    room.setState = vi.fn((state) => { (room as any).state = state; }); // Mock setState
    room.setSimulationInterval = vi.fn(); // Prevent loop from actually running in tests
    room.clock = { deltaTime: 16.6, elapsedTime: 0, tick: vi.fn() } as any; // Mock clock if needed by intervals/patches

     // Need to set the state manually after mocking setState
     room.setState(new MyRoomState());
  });

  it('should instantiate', () => {
    expect(room).toBeDefined();
    expect((room as any).rapierWorld).toBeDefined(); // Check if Rapier world was created (mocked)
  });

  it('should add a player state onJoin', () => {
    const mockClient = { sessionId: 'client1' } as Client;
    room.onJoin(mockClient, {});

    // Simulate the game loop's enterQuery effect
    (room as any).update(16.6 / 1000); // Run one update to process queries

    expect(room.state.players.size).toBe(1);
    expect(room.state.players.get('client1')).toBeInstanceOf(PlayerState);
    expect((room as any).clientEntityMap.has('client1')).toBe(true);
  });

   it('should remove player state onLeave', () => {
     const mockClient = { sessionId: 'client1' } as Client;
     room.onJoin(mockClient, {});

     // Simulate the game loop's enterQuery effect
     (room as any).update(16.6 / 1000);
     expect(room.state.players.size).toBe(1); // Verify player added

     room.onLeave(mockClient, false);

     // Simulate the game loop's exitQuery effect
     (room as any).update(16.6 / 1000); // Run update again to process removal

     expect(room.state.players.has('client1')).toBe(false);
     expect((room as any).clientEntityMap.has('client1')).toBe(false);
     // Check if Rapier remove methods were called (using the mock)
     expect((room as any).rapierWorld.removeRigidBody).toHaveBeenCalled();
   });

    it('should update player input on message', () => {
        const mockClient = { sessionId: 'client1' } as Client;
        room.onJoin(mockClient, {});
        (room as any).update(16.6 / 1000); // Process join

        const eid = (room as any).clientEntityMap.get('client1');
        expect(eid).toBeDefined();

        // Directly check the component data (requires access, maybe make ecsWorld public for testing or use helper)
        // This access pattern is rough; better to test the *effect* of the input in the update loop if possible.
        const PlayerInputComp = require('bitecs').PlayerInput; // Get component definition if needed
        expect(PlayerInputComp.forward[eid]).toBe(0);

        room.onMessage('input', mockClient, { forward: true, left: false, right: false, backward: false });

        expect(PlayerInputComp.forward[eid]).toBe(1);
    });

    // Add more tests:
    // - Test input processing applies impulses (check if rapierWorld.applyImpulse mock was called)
    // - Test physics step updates player state positions
});
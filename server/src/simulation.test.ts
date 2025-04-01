// server/src/simulation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Simulation } from './simulation';
import type { Entity } from 'geotic'; // Keep type import if needed

// REMOVE these direct Geotic imports and logs:
// import { World, System as GeoticSystem, Component as GeoticComponent } from 'geotic';
// console.log(">>> Vitest: Geotic System loaded in test file:", GeoticSystem);
// console.log(">>> Vitest: Geotic Component loaded in test file:", GeoticComponent);
// console.log(">>> Vitest: Geotic World loaded in test file:", World);

describe('Simulation Logic', () => {
  let sim: Simulation;
  let playerEntity: Entity;
  let itemEntity: Entity;

  beforeEach(() => {
    sim = new Simulation();

    // Use the simulation instance's methods/properties to create/access components
    playerEntity = sim.ecsWorld.create();
    playerEntity.add(sim.PlayerTag); // Access tag via sim instance
    playerEntity.add(sim.Position, { x: 0, y: 1, z: 0 }); // Access component via sim instance
    playerEntity.add(sim.Inventory, { itemCount: 0 }); // Access component via sim instance

    itemEntity = sim.ecsWorld.create();
    itemEntity.add(sim.ItemTag); // Access tag via sim instance
    itemEntity.add(sim.CollectibleTag); // Access tag via sim instance
    itemEntity.add(sim.Position, { x: 1, y: 1, z: 0 }); // Access component via sim instance
  });

  describe('Inventory Component', () => {
    it('should initialize itemCount to 0', () => {
      // Access component via sim instance and entity
      const inv = playerEntity.get(sim.Inventory);
      expect(inv.itemCount).toBe(0);
    });
  });

  describe('Collection System', () => {
    it('should not collect if WantsToCollect component is missing', () => {
      const inventory = playerEntity.get(sim.Inventory);
      const initialCount = inventory.itemCount;

      // Access system via sim instance and execute
      sim.ecsWorld.getSystem(sim.CollectionSystem).execute(0.1);

      expect(inventory.itemCount).toBe(initialCount);
      expect(itemEntity.isDestroyed).toBe(false);
    });

    it('should collect item if WantsToCollect is present and distance is close', () => {
      const inventory = playerEntity.get(sim.Inventory);
      expect(inventory.itemCount).toBe(0);

      // Access component via sim instance
      playerEntity.add(sim.WantsToCollect, { targetItemId: itemEntity.id });

      // Access system via sim instance
      sim.ecsWorld.getSystem(sim.CollectionSystem).execute(0.1);

      expect(inventory.itemCount).toBe(1);
      expect(playerEntity.has(sim.WantsToCollect)).toBe(false); // Access component via sim instance
      expect(itemEntity.isDestroyed).toBe(true);
    });

    // ... other tests remain largely the same, just ensure components/systems
    //     are accessed via the 'sim' instance where appropriate ...

    it('should not collect item if WantsToCollect is present but distance is too far', () => {
         const inventory = playerEntity.get(sim.Inventory);
         const itemPosition = itemEntity.get(sim.Position); // Use sim.Position

         itemPosition.x = 10;
         itemPosition.z = 10;

         playerEntity.add(sim.WantsToCollect, { targetItemId: itemEntity.id }); // Use sim.WantsToCollect
         sim.ecsWorld.getSystem(sim.CollectionSystem).execute(0.1); // Use sim.CollectionSystem

         expect(inventory.itemCount).toBe(0);
         expect(playerEntity.has(sim.WantsToCollect)).toBe(false); // Use sim.WantsToCollect
         expect(itemEntity.isDestroyed).toBe(false);
     });

     it('should remove WantsToCollect even if target item doesnt exist', () => {
        const fakeItemId = 9999;
        playerEntity.add(sim.WantsToCollect, { targetItemId: fakeItemId }); // Use sim.WantsToCollect

        sim.ecsWorld.getSystem(sim.CollectionSystem).execute(0.1); // Use sim.CollectionSystem

        expect(playerEntity.has(sim.WantsToCollect)).toBe(false); // Use sim.WantsToCollect
    });
  });
});
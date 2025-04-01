// server/src/geotic.test.ts
import { describe, it, expect } from 'vitest';

// Attempt to import the specific items causing issues
import { System, Component, World, Entity } from 'geotic';

describe('Geotic Import Test', () => {
  it('should import core Geotic classes/functions', () => {
    console.log('>>> Minimal Geotic Test - System:', System);
    console.log('>>> Minimal Geotic Test - Component:', Component);
    console.log('>>> Minimal Geotic Test - World:', World);
    console.log('>>> Minimal Geotic Test - Entity:', Entity);

    // Assert that they are defined (not undefined)
    expect(System).toBeDefined();
    expect(Component).toBeDefined();
    expect(World).toBeDefined();
    expect(Entity).toBeDefined(); // Entity is often just an alias for a number or object
  });
});
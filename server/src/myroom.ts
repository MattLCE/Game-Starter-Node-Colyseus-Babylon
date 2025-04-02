// server/src/myroom.ts
import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import {
  IWorld,
  defineComponent,
  addComponent,
  removeComponent,
  defineQuery,
  enterQuery,
  exitQuery,
  hasComponent,
  Types,
  addEntity,
  Query,
  createWorld,
  removeEntity,
} from "bitecs";
import RAPIER from "@dimforge/rapier3d-compat";
import fs from "fs";
import path from "path";
import { createNoise2D, RandomFn } from "simplex-noise"; // Import RandomFn type

// -- Configuration Interface --
interface GameConfig {
  server: { port: number; tickRate: number };
  physics: {
    gravityY: number;
    playerSpeed: number;
    playerImpulseFactor: number;
  };
  worldGen: {
    seed: string | null;
    terrainWidth: number;
    terrainHeight: number;
    terrainSubdivisions: number;
    heightScale: number;
  };
  gameplay: {
    initialSpawnRadius: number;
    dropShipLeaveTime: number;
  };
}

// -- Helper: Simple Seeded PRNG (Mulberry32) --
function mulberry32(seedStr: string): RandomFn {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -- ECS Components --
export const Vector3Schema = { x: Types.f32, y: Types.f32, z: Types.f32 };
export const Position = defineComponent(Vector3Schema);
export const Velocity = defineComponent(Vector3Schema);
export const PlayerInput = defineComponent({
  left: Types.ui8,
  right: Types.ui8,
  forward: Types.ui8,
  backward: Types.ui8,
});

// -- Colyseus State --
export class PlayerState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 0;
}
export class MyRoomState extends Schema {
  @type("string") worldSeed: string = "default";
  @type("number") terrainWidth: number = 50;
  @type("number") terrainHeight: number = 50;
  @type("number") terrainSubdivisions: number = 20;
  @type("number") heightScale: number = 5;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

// -- Interfaces --
export interface InputPayload {
  left: boolean;
  right: boolean;
  forward: boolean;
  backward: boolean;
}

// -- World Generation Logic --
class WorldGenerator {
  private noise2D: ReturnType<typeof createNoise2D>;
  private heightMapData: number[] = [];
  private config: GameConfig["worldGen"];
  private points: number;
  private readonly noiseScaleFactor = 0.1;
  constructor(config: GameConfig["worldGen"], seed: string) {
    this.config = config;
    this.noise2D = createNoise2D(mulberry32(seed));
    this.points = this.config.terrainSubdivisions + 1;
    this.generateHeightMapData();
    console.log(
      `[WorldGenerator] Initialized with seed: ${seed}, Size: ${config.terrainWidth}x${config.terrainHeight}, Scale: ${config.heightScale}`
    );
  }
  private generateHeightMapData(): void {
    const { terrainWidth, terrainHeight, heightScale } = this.config;
    this.heightMapData = [];
    for (let j = 0; j < this.points; j++) {
      for (let i = 0; i < this.points; i++) {
        const x = (i / (this.points - 1)) * terrainWidth - terrainWidth / 2;
        const z = (j / (this.points - 1)) * terrainHeight - terrainHeight / 2;
        const noiseValue = this.noise2D(
          x * this.noiseScaleFactor,
          z * this.noiseScaleFactor
        );
        const h = ((noiseValue + 1) / 2) * heightScale;
        this.heightMapData.push(h);
      }
    }
    console.log(
      `[WorldGenerator] Heightmap generated (${this.heightMapData.length} values).`
    );
  }
  public getHeightAt(worldX: number, worldZ: number): number {
    if (this.heightMapData.length === 0) return 0;
    const { terrainWidth, terrainHeight } = this.config;
    const normX = (worldX + terrainWidth / 2) / terrainWidth;
    const normZ = (worldZ + terrainHeight / 2) / terrainHeight;
    const u = Math.max(0, Math.min(1, normX));
    const v = Math.max(0, Math.min(1, normZ));
    const gridI = Math.min(this.points - 1, Math.floor(u * (this.points - 1)));
    const gridJ = Math.min(this.points - 1, Math.floor(v * (this.points - 1)));
    const index = gridJ * this.points + gridI;
    return this.heightMapData[index] ?? 0;
  }
}

// -- Room Logic --
export class MyRoom extends Room<MyRoomState> {
  private config!: GameConfig;
  private ecsWorld!: IWorld;
  private rapierWorld!: RAPIER.World;
  private worldGenerator!: WorldGenerator;
  private playerQuery!: Query;
  private playerQueryEnter!: Query;
  private playerQueryExit!: Query;
  private clientEntityMap: Map<string, number> = new Map();
  private eidToRapierBodyMap: Map<number, RAPIER.RigidBody> = new Map();

  async onCreate(_options: unknown) {
    console.log("[MyRoom] onCreate() called.");
    try {
      this.loadConfiguration();
      this.setState(new MyRoomState());
      console.log("[MyRoom] Initial Colyseus State Set.");
      this.ecsWorld = createWorld();
      const playerComponents = [Position, Velocity, PlayerInput];
      this.playerQuery = defineQuery(playerComponents);
      const baseQuery = defineQuery(playerComponents);
      this.playerQueryEnter = enterQuery(baseQuery);
      this.playerQueryExit = exitQuery(baseQuery);
      console.log("[MyRoom] ECS World & Queries Initialized.");
      const seed =
        this.config.worldGen.seed ?? Math.random().toString(36).substring(7);
      this.worldGenerator = new WorldGenerator(this.config.worldGen, seed);
      this.state.worldSeed = seed;
      this.state.terrainWidth = this.config.worldGen.terrainWidth;
      this.state.terrainHeight = this.config.worldGen.terrainHeight;
      this.state.terrainSubdivisions = this.config.worldGen.terrainSubdivisions;
      this.state.heightScale = this.config.worldGen.heightScale;
      console.log("[MyRoom] World generation parameters synced to state.");
      await RAPIER.init();
      console.log("[MyRoom] Rapier WASM Initialized.");
      const gravity = { x: 0.0, y: this.config.physics.gravityY, z: 0.0 };
      this.rapierWorld = new RAPIER.World(gravity);
      console.log("[MyRoom] Rapier World Created.");
      const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
        this.state.terrainWidth / 2,
        0.1,
        this.state.terrainHeight / 2
      )
        .setTranslation(0, -0.1, 0)
        .setFriction(1.0)
        .setRestitution(0.1);
      this.rapierWorld.createCollider(groundColliderDesc);
      console.log("[MyRoom] Flat Rapier Ground Collider Created for physics.");

      // *** REGISTER THE ARROW FUNCTION VERSION ***
      this.onMessage<InputPayload>("input", this.handleInputMessage);
      console.log("[MyRoom] Message Handlers Set.");

      this.setSimulationInterval(
        (_dt) => {
          try {
            this.update();
          } catch (e) {
            console.error("[Update Loop Err]", e);
            this.clock.clear();
            this.disconnect().catch((err) =>
              console.error("Disconnect err:", err)
            );
          }
        },
        (1 / this.config.server.tickRate) * 1000
      );
      console.log("[MyRoom] Simulation Loop Started. Initialization Complete.");
    } catch (initError) {
      console.error("!!! CRITICAL onCreate ERROR !!!", initError);
      this.disconnect().catch((e) => console.error("Disconnect err:", e));
    }
  }

  private loadConfiguration(): void {
    try {
      const confPath = path.resolve(__dirname, "../../config/gameConfig.json");
      console.log(`[Config] Loading from: ${confPath}`);
      const rawConf = fs.readFileSync(confPath, "utf-8");
      this.config = JSON.parse(rawConf);
      console.log("[Config] Loaded successfully.");
    } catch (error) {
      console.error("!!! FATAL: Failed to load gameConfig.json !!!", error);
      throw new Error("Failed loading config.");
    }
  }

  // *** DEFINE AS ARROW FUNCTION PROPERTY ***
  public handleInputMessage = (client: Client, message: InputPayload): void => {
    // 'this' here will now correctly refer to the MyRoom instance
    const eid = this.clientEntityMap.get(client.sessionId);
    if (eid !== undefined && hasComponent(this.ecsWorld, PlayerInput, eid)) {
      PlayerInput.left[eid] = message.left ? 1 : 0;
      PlayerInput.right[eid] = message.right ? 1 : 0;
      PlayerInput.forward[eid] = message.forward ? 1 : 0;
      PlayerInput.backward[eid] = message.backward ? 1 : 0;
    } else {
      // console.warn(`[Input] Input from ${client.sessionId} (eid: ${eid}), entity/component not found.`);
    }
  }; // <-- Note the '=' and arrow '=>', and the semicolon ';'

  onJoin(client: Client, _options: unknown) {
    if (!this.ecsWorld || !this.rapierWorld || !this.worldGenerator) {
      console.error(`!!! ERROR onJoin ${client.sessionId}: Systems not ready!`);
      client.leave();
      return;
    }
    try {
      console.log(`[Join] ${client.sessionId} joined! Creating entity...`);
      const eid = addEntity(this.ecsWorld);
      const spawnRadius = this.config.gameplay.initialSpawnRadius;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * spawnRadius;
      const spawnX = Math.cos(angle) * radius;
      const spawnZ = Math.sin(angle) * radius;
      const spawnHeight = this.worldGenerator.getHeightAt(spawnX, spawnZ) + 1.0;
      // console.log(`[Join] Spawning ${client.sessionId} at (${spawnX.toFixed(2)}, ${spawnHeight.toFixed(2)}, ${spawnZ.toFixed(2)})`);
      addComponent(this.ecsWorld, Position, eid);
      addComponent(this.ecsWorld, Velocity, eid);
      addComponent(this.ecsWorld, PlayerInput, eid);
      Position.x[eid] = spawnX;
      Position.y[eid] = spawnHeight;
      Position.z[eid] = spawnZ;
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      Velocity.z[eid] = 0;
      PlayerInput.left[eid] = 0;
      PlayerInput.right[eid] = 0;
      PlayerInput.forward[eid] = 0;
      PlayerInput.backward[eid] = 0;
      const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(Position.x[eid], Position.y[eid], Position.z[eid])
        .setLinvel(0, 0, 0)
        .setCcdEnabled(false);
      const rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);
      const playerSize = 0.5;
      const colliderDesc = RAPIER.ColliderDesc.cuboid(
        playerSize,
        playerSize,
        playerSize
      )
        .setRestitution(0.1)
        .setFriction(0.8);
      this.rapierWorld.createCollider(colliderDesc, rigidBody);
      this.eidToRapierBodyMap.set(eid, rigidBody);
      this.clientEntityMap.set(client.sessionId, eid);
      console.log(
        `[Join] Created ECS entity ${eid} & Rapier body for ${client.sessionId}.`
      );
    } catch (joinError) {
      console.error(`!!! ERROR onJoin ${client.sessionId} !!!`, joinError);
      try {
        client.leave();
      } catch (e) {
        console.error("Err leaving client:", e);
      }
      const eid = this.clientEntityMap.get(client.sessionId);
      if (eid !== undefined) this.cleanupEntityResources(eid, client.sessionId);
    }
  }

  update(): void {
    if (!this.state || !this.ecsWorld || !this.rapierWorld || !this.playerQuery)
      return;
    // 1. Input -> Physics
    try {
      const moving = this.playerQuery(this.ecsWorld);
      for (const eid of moving) {
        const body = this.eidToRapierBodyMap.get(eid);
        if (!body) continue;
        const imp = { x: 0, y: 0, z: 0 };
        let isMoving = false;
        if (PlayerInput.forward[eid]) {
          imp.z += 1;
          isMoving = true;
        }
        if (PlayerInput.backward[eid]) {
          imp.z -= 1;
          isMoving = true;
        }
        if (PlayerInput.left[eid]) {
          imp.x -= 1;
          isMoving = true;
        }
        if (PlayerInput.right[eid]) {
          imp.x += 1;
          isMoving = true;
        }
        if (isMoving) {
          const mag = Math.sqrt(imp.x * imp.x + imp.z * imp.z);
          const speed = this.config.physics.playerSpeed;
          if (mag > 0) {
            imp.x = (imp.x / mag) * speed;
            imp.z = (imp.z / mag) * speed;
          }
          const vel = body.linvel();
          const factor = this.config.physics.playerImpulseFactor;
          const diff = {
            x: (imp.x - vel.x) * factor,
            y: 0,
            z: (imp.z - vel.z) * factor,
          };
          body.applyImpulse(diff, true);
        }
      }
    } catch (e) {
      console.error("[Update] Input error:", e);
      return;
    }
    // 2. Step Physics
    try {
      this.rapierWorld.step();
    } catch (e) {
      console.error("[Update] Rapier error:", e);
      return;
    }
    // 3. Sync State from Physics
    try {
      const players = this.playerQuery(this.ecsWorld);
      for (const eid of players) {
        const body = this.eidToRapierBodyMap.get(eid);
        if (!body) continue;
        const pos = body.translation();
        const vel = body.linvel();
        if (hasComponent(this.ecsWorld, Position, eid)) {
          Position.x[eid] = pos.x;
          Position.y[eid] = pos.y;
          Position.z[eid] = pos.z;
        }
        if (hasComponent(this.ecsWorld, Velocity, eid)) {
          Velocity.x[eid] = vel.x;
          Velocity.y[eid] = vel.y;
          Velocity.z[eid] = vel.z;
        }
        const cId = this.findClientIdByEid(eid);
        if (cId) {
          const pState = this.state.players.get(cId);
          if (pState) {
            pState.x = pos.x;
            pState.y = pos.y;
            pState.z = pos.z;
          }
        }
      }
    } catch (e) {
      console.error("[Update] Sync error:", e);
      return;
    }
    // 4. Handle Player State Add/Remove
    try {
      const entered = this.playerQueryEnter(this.ecsWorld);
      for (const eid of entered) {
        const cId = this.findClientIdByEid(eid);
        if (
          cId &&
          !this.state.players.has(cId) &&
          hasComponent(this.ecsWorld, Position, eid)
        ) {
          const pState = new PlayerState();
          pState.x = Position.x[eid] ?? 0;
          pState.y = Position.y[eid] ?? 0;
          pState.z = Position.z[eid] ?? 0;
          this.state.players.set(cId, pState);
        }
      }
      const exited = this.playerQueryExit(this.ecsWorld);
      for (const eid of exited) {
        const cId = this.findClientIdByEid(eid);
        if (cId && this.state.players.has(cId)) {
          this.state.players.delete(cId);
        }
      }
    } catch (e) {
      console.error("[Update] Enter/exit error:", e);
    }
  }

  private cleanupEntityResources(eid: number, clientId?: string): void {
    const desc = clientId ? `client ${clientId} (eid ${eid})` : `eid ${eid}`;
    /* console.log(`[Cleanup] ${desc}...`); */ try {
      const body = this.eidToRapierBodyMap.get(eid);
      if (body) {
        this.rapierWorld.removeRigidBody(body);
        this.eidToRapierBodyMap.delete(eid);
      }
      if (hasComponent(this.ecsWorld, Position, eid))
        removeComponent(this.ecsWorld, Position, eid);
      if (hasComponent(this.ecsWorld, Velocity, eid))
        removeComponent(this.ecsWorld, Velocity, eid);
      if (hasComponent(this.ecsWorld, PlayerInput, eid))
        removeComponent(this.ecsWorld, PlayerInput, eid);
      removeEntity(this.ecsWorld, eid);
    } catch (e) {
      console.error(`!!! ERROR cleanup ${desc} !!!`, e);
    }
  }
  onLeave(client: Client, _consented: boolean): void {
    const cId = client.sessionId;
    const eId = this.clientEntityMap.get(cId);
    console.log(`[Leave] ${cId} (eid: ${eId}) left.`);
    if (eId !== undefined) {
      this.clientEntityMap.delete(cId);
      this.cleanupEntityResources(eId, cId);
    }
    if (this.state?.players.has(cId)) {
      this.state.players.delete(cId);
    }
  }
  onDispose(): void {
    console.log("[Dispose] Cleaning up...");
    this.clientEntityMap.clear();
    this.eidToRapierBodyMap.clear();
    (this.ecsWorld as any) = null;
    (this.rapierWorld as any) = null;
    (this.worldGenerator as any) = null;
    (this.playerQuery as any) = null;
    (this.playerQueryEnter as any) = null;
    (this.playerQueryExit as any) = null;
    console.log("[Dispose] Complete.");
  }
  private findClientIdByEid(eid: number): string | undefined {
    for (const [cId, eId] of this.clientEntityMap.entries()) {
      if (eId === eid) return cId;
    }
    return undefined;
  }
}

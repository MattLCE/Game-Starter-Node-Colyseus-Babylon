import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";

// Define a basic Player state
export class Player extends Schema {
  // Add basic properties later if needed, like position
  // @type("number") x: number = 0;
  // @type("number") z: number = 0;
  // For now, it can be empty just to represent a connected player
}

// Define the Room's state
export class MyRoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

// Define the Room logic
export class MyRoom extends Room<MyRoomState> {

  // Called when the room is created
  onCreate(options: any) {
    console.log("[MyRoom] Room created!");

    // Set the initial state
    this.setState(new MyRoomState());

    // --- Optional: Add handlers for messages from clients later ---
    // this.onMessage("playerInput", (client, message) => {
    //   console.log(`[MyRoom] Received input from ${client.sessionId}:`, message);
    //   const player = this.state.players.get(client.sessionId);
    //   // Handle input...
    // });
  }

  // Called when a client joins the room
  onJoin(client: Client, options: any) {
    console.log(`[MyRoom] Client ${client.sessionId} joined!`);

    // Create a new Player instance for the joining client
    const player = new Player();
    // Initialize player properties if they exist in the schema

    // Add the player to the state, mapping their session ID to their player object
    this.state.players.set(client.sessionId, player);
  }

  // Called when a client leaves the room
  onLeave(client: Client, consented: boolean) {
    console.log(`[MyRoom] Client ${client.sessionId} left.`);

    // Remove the player from the state
    if (this.state.players.has(client.sessionId)) {
      this.state.players.delete(client.sessionId);
    }
  }

  // Called when the room is disposed (e.g., no clients left)
  onDispose() {
    console.log("[MyRoom] Room disposed.");
  }
}
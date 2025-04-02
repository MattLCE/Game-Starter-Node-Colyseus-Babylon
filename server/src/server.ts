import http from "http"; // Ensure http is imported
import express from "express";
import path from "path"; // Path module is needed
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

// Import your Room class
import { MyRoom } from "./myroom"; // Ensure this path is correct

const port = Number(process.env.PORT || 2567); // Use environment variable or default
const app = express();

// Create HTTP server explicitly
const server: http.Server = http.createServer(app); // Explicitly type server

const gameServer = new Server({
  transport: new WebSocketTransport({
    server, // Pass the http server here
  }),
});

app.use(express.json());

// --- Serve static client files ---
const clientBuildPath = path.join(__dirname, "../../client/dist");
console.log(`[Static] Serving client files from: ${clientBuildPath}`);
app.use(express.static(clientBuildPath));

// Define the room route - Must be defined before attaching/listening related to GameServer
gameServer
  .define("my_room", MyRoom)
  .filterBy(["name"]);

// --- Fallback for Single Page Applications ---
// Must come AFTER static serving but BEFORE error handlers
app.get("*", (req, res) => {
  if (req.path.includes(".") || req.path.startsWith("/api/")) {
      res.status(404).send("Not found");
  } else {
    res.sendFile(path.join(clientBuildPath, "index.html"));
  }
});

// --- Attach Colyseus WebSocket Transport ---
gameServer.attach({ server });

// --- Start Listening ---
// Disable the specific ESLint promise rule for this line only,
// as the standard .on('error') handles the primary server startup failure case.
// eslint-disable-next-line @typescript-eslint/no-misused-promises
server.listen(port, () => { // Use the http server's listen method
    console.log(
      `[GameServer] HTTP and WebSocket server listening on http://localhost:${port}`
    );
  }).on('error', (err) => { // Add basic error handling for the HTTP server listen
    console.error("[GameServer] Failed to start HTTP server:", err);
    process.exit(1); // Exit if the server itself fails to bind/start
  });
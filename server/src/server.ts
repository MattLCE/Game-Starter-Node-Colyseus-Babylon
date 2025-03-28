import http from 'http';
import express from 'express';
import path from 'path'; // <-- Import path module
import { Server } from '@colyseus/core'; // Removed RelayRoom as it's not used here
import { WebSocketTransport } from '@colyseus/ws-transport';

// Import your Room class
import { MyRoom } from './myroom'; // Ensure this path is correct

const port = Number(process.env.PORT || 2567); // Use environment variable or default
const app = express();

app.use(express.json());

// --- Serve static client files ---
// Define the path to the built client files (relative to the compiled server.js location in dist)
const clientBuildPath = path.join(__dirname, "../../client/dist"); // Go up from dist, up from server, down into client/dist
console.log(`[Static] Serving client files from: ${clientBuildPath}`);
// Serve the static files (HTML, CSS, JS) from the client's build directory
app.use(express.static(clientBuildPath));

// --- Game Server Setup ---
const gameServer = new Server({
  transport: new WebSocketTransport({
    // Use the existing Express app server for WebSocket handshake
    server: http.createServer(app)
  }),
});

// Define the room route
gameServer.define("my_room", MyRoom)
  // Optional: Filter rooms by name in monitor
  .filterBy(['name']);

// --- Fallback for Single Page Applications (serve index.html for any unknown GET request) ---
// This ensures that if you refresh the page on a client-side route, index.html is still served.
app.get('*', (req, res) => {
  // Check if it looks like a file request first
  if (req.path.includes('.')) {
    res.status(404).send('Not found'); // Or handle specific file types if needed
  } else {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  }
});

// --- Start Listening ---
// Use the gameServer's listen method which now correctly uses the underlying HTTP server created above
gameServer.listen(port);
console.log(`[GameServer] Listening on http://localhost:${port} (and ws://localhost:${port})`);
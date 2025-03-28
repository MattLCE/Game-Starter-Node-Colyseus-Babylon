import { defineConfig } from "vite";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  // Define the root of the client project for Vite
  root: path.resolve(__dirname, "client"),
  // Define the server options (for Vite's dev server)
  server: {
    port: 8080, // Port for the Vite dev server (different from Colyseus port)
    // Optional: Proxy Colyseus WebSocket connections during development
    // proxy: {
    //   '/colyseus': { // If your Colyseus Client connects to /colyseus
    //     target: 'ws://localhost:2567', // Your Colyseus server address
    //     ws: true,
    //   },
    // }
  },
  // Define build options
  build: {
    // Output directory relative to the 'root' option
    outDir: path.resolve(__dirname, "dist/client"),
    // Empty the output directory before building
    emptyOutDir: true,
    // Optional: Generate source maps for debugging production builds
    sourcemap: true,
  },
  // Optional: Define aliases if needed
  // resolve: {
  //   alias: {
  //     '@': path.resolve(__dirname, 'client/src'),
  //   },
  // },
});

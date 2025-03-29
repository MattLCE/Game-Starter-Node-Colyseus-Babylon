# Contributing to Bountyfull Game

This document outlines the processes and guidelines for developing, maintaining, and debugging the Bountyfull game project. Following these guidelines helps ensure code quality, stability, and maintainability, especially when leveraging AI assistance.

## Core Principles

*   **Consistency:** Follow established patterns, formatting, and naming conventions.
*   **Verification:** Test thoroughly (automated and manual) before merging changes.
*   **Communication (Self-Documentation):** Write clear commit messages, code comments, and update design documents.
*   **Modularity:** Keep code organized into logical modules/systems (e.g., using ECS).
*   **Authoritative Server:** Remember the server holds the truth for gameplay state.

## Version Control (Git)

*   **Main Branch:** The `main` branch should always represent a stable, working state (even if features are incomplete).
*   **Feature/Bugfix Branches:** ALL changes must be made on separate branches created from `main`.
    *   Naming: Use prefixes like `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/` followed by a short descriptive name (e.g., `feat/player-movement-sync`, `fix/collection-bug`).
    *   Command: `git checkout -b feat/my-feature-name main`
*   **Commits:** Make small, atomic commits with clear, descriptive messages following the [Conventional Commits](https://www.conventionalcommits.org/) format (e.g., `feat: Add basic player state to schema`, `fix: Correct deposit logic calculation`).
*   **Merging:** Merge feature branches back into `main` only after verification (tests passing, manual checks). Use `--no-ff` (no fast-forward) merges if possible to preserve branch history, though simple merges are fine for solo dev.
    *   `git checkout main`
    *   `git pull origin main` (Ensure main is up-to-date)
    *   `git merge --no-ff feat/my-feature-name`
    *   `git push origin main`
*   **Deleting Branches:** Delete feature branches after successful merging: `git branch -d feat/my-feature-name`.

## Change Process (SOP)

Follow these steps for **every** feature addition or bug fix:

1.  **Define & Plan:**
    *   Clearly define the task/goal (in `TASKS.md` or GitHub Issue).
    *   Think about the impact: Which components are affected (client, server, shared)? What state changes? Any new dependencies?
    *   Consult/Update `ARCHITECTURE.md` or `DESIGN.md` if the change involves core mechanics or structure.
    *   *(AI Assist: "Help me plan the implementation for feature X. What server/client components are likely involved based on our architecture?")*
2.  **Create Branch:** `git checkout -b type/branch-name main`
3.  **Write Test(s) (TDD - Especially for Server Logic):**
    *   Using Vitest (`*.test.ts`), write tests for any new or modified *pure logic* (functions, ECS systems if testable in isolation).
    *   Run `npm test` or `npm run test:watch` to ensure the new tests fail correctly (RED).
    *   *(AI Assist: "Write Vitest unit tests for a function `calculateDamage(weapon, target)` with these requirements...")*
4.  **Implement Code:**
    *   Write the necessary TypeScript code in client/server/shared directories.
    *   Focus on making the tests pass (GREEN).
    *   Leverage AI for specific snippets or functions *after* tests are written.
    *   *(AI Assist: "Implement the function `calculateDamage` in `combat.ts` to make the following Vitest tests pass: [paste tests]")*
    *   *(AI Assist: "Show me the Babylon.js code to create a particle effect for an explosion at position X.")*
    *   *(AI Assist: "Give me the Colyseus schema definition for an Item with properties ID, type, x, y, z.")*
5.  **Verify:**
    *   **Automated Tests:** Run `npm test`. All tests must pass.
    *   **Manual Test:** Run the game (`Replit Run ▶`). Test the feature thoroughly in the Webview (and potentially other browsers/devices). Check server and browser console logs for errors or unexpected behavior.
6.  **Lint & Format:**
    *   Run `npm run format` to ensure consistent code style.
    *   Run `npm run lint` to catch potential errors. Fix any reported issues.
7.  **Commit:** `git add .` then `git commit -m "type: Clear description of change"`. Commit frequently.
8.  **Refactor (Optional but Recommended):**
    *   Clean up the code (rename variables, extract functions, improve comments) *without changing functionality*.
    *   Run `npm test` again to ensure refactoring didn't break anything.
    *   Commit refactoring: `git commit -m "refactor: Improve readability of combat system"`
9.  **Review:** Perform a self-review of the changes on the branch (`git diff main...HEAD`). Does it make sense? Did you miss anything?
10. **Merge:** Merge the branch back into `main`.
11. **Delete Branch.**

## Recurring Housekeeping

*   **Dependency Updates (Monthly Recommended):**
    1.  Check for outdated packages: `npm outdated` (run in root, client, server).
    2.  Update cautiously, one major dependency or logical group at a time (e.g., update all `@colyseus/*` packages together). Use `npm update <package-name>` or edit `package.json` and run `npm install`.
    3.  **CRITICAL: Run `npm test`** after each significant update.
    4.  Manually test core functionality after updates.
    5.  Commit updates: `chore: Update Colyseus dependencies to vX.Y.Z`.
    *   *(AI Assist: Not directly helpful for running updates, but can help research breaking changes: "What are the major breaking changes between Colyseus v0.14 and v0.15?")*
*   **Review TODOs/FIXMEs (Weekly/Bi-Weekly):** Search the codebase for `// TODO:` or `// FIXME:` comments and prioritize addressing them.
*   **Review Open Tasks/Issues (Weekly):** Check your `TASKS.md` or issue tracker.

## Troubleshooting & Debugging

1.  **Check Consoles:** Always check **both** the Replit Server Console and the Browser Developer Console (F12) first. Errors are often logged clearly.
2.  **Reproduce Reliably:** Can you make the bug happen consistently? What are the exact steps?
3.  **Isolate the Problem:**
    *   Use `console.log` / `console.debug` / `logOnScreen` strategically to trace execution flow and variable values on both client and server.
    *   Comment out sections of code to see if the bug disappears.
    *   Use the Babylon.js Inspector to check the state of the 3D scene on the client.
    *   Use the Browser DevTools Network tab (filter by WS) to inspect messages being sent/received via Colyseus.
    *   Use Git history (`git log`, `git diff`) to see what changed recently that might have introduced the bug.
4.  **Check State:** Log the relevant Colyseus state on the server (`this.state`) and the client (`room.state`) before and after the suspected problematic operation. Is the state what you expect?
5.  **Unit Test:** If the bug seems related to specific logic, write a new Vitest unit test that specifically reproduces the failing condition. This helps isolate and fix the bug and prevents it from recurring.
6.  *(AI Assist: "I'm getting this error [paste error] when performing action X. Here is the relevant code snippet [paste code]. Can you help identify potential causes?")*
7.  *(AI Assist: "Explain what this error message means in the context of Colyseus/Babylon.js: [paste error]")*

## Benchmarking & Performance

*   **(Early Stage):** Focus on clean code and avoiding obvious bottlenecks.
*   **(Later Stage):**
    *   **Client:** Use Browser DevTools Performance tab and Babylon.js Inspector (`scene.getEngine().getFps()`) to monitor frame rate. Identify expensive rendering or script operations.
    *   **Server:** Use `console.time()` / `console.timeEnd()` around critical sections of the game loop tick (physics, AI, state updates) to measure duration. Add logging for tick time variance. Colyseus Monitor provides basic memory/CPU info.
    *   **Network:** Use Browser DevTools Network tab to monitor the size and frequency of WebSocket messages. Check Colyseus Monitor for room/client counts.
    *   *(AI Assist: "Suggest ways to optimize this Babylon.js scene rendering loop.")*
    *   *(AI Assist: "How can I optimize the Colyseus state schema to reduce bandwidth for player updates?")*

## Reporting

*   **(Early Stage):** Primarily console logs and manual observation.
*   **(Later Stage / Production):**
    *   **Error Reporting:** Integrate Sentry (or similar) for automatic client/server error capturing.
    *   **Analytics:** Integrate GameAnalytics (or similar) or build custom logging for key player events (session start/end, items collected/deposited, features used) to understand player behavior and game balance. Send data from server (more reliable) or client.

By establishing and following these processes, you create a much more stable and manageable development environment, even when working solo or with AI assistance.
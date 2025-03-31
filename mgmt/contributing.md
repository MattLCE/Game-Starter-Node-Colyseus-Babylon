# Contributing to the Game

This document outlines the processes and guidelines for developing, maintaining, and debugging the game project. Following these guidelines helps ensure code quality, stability, and maintainability, especially when leveraging AI assistance.

## Core Principles

- **Consistency:** Follow established patterns, formatting, and naming conventions.
- **Verification:** Test thoroughly (automated and manual) before merging changes.
- **Communication (Self-Documentation):** Write clear commit messages, code comments, and update design documents.
- **Modularity:** Keep code organized into logical modules/systems (e.g., using ECS).
- **Authoritative Server:** Remember the server holds the truth for gameplay state.

## Version Control (Git)

- **Main Branch:** The `main` branch should always represent a stable, working state (even if features are incomplete).
- **Feature/Bugfix Branches:** ALL changes must be made on separate branches created from `main`.
  - Naming: Use prefixes like `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/` followed by a short descriptive name (e.g., `feat/player-movement-sync`, `fix/collection-bug`).
  - Command: `git checkout -b feat/my-feature-name main`
- **Commits:** Make small, atomic commits with clear, descriptive messages following the [Conventional Commits](https://www.conventionalcommits.org/) format (e.g., `feat: Add basic player state to schema`, `fix: Correct deposit logic calculation`).
- **Merging:** Merge feature branches back into `main` only after verification (tests passing, manual checks). Use `--no-ff` (no fast-forward) merges if possible to preserve branch history, though simple merges are fine for solo dev.
  - `git checkout main`
  - `git pull origin main` (Ensure main is up-to-date)
  - `git merge --no-ff feat/my-feature-name`
  - `git push origin main`
- **Deleting Branches:** Delete feature branches after successful merging: `git branch -d feat/my-feature-name`.

## Change Management

### Core Files

*   **`roadmap.md`:** Tracks the lifecycle of ideas from inception to planned implementation.
*   **`project-template.md`:** The template defining the Standard Operating Procedure (SOP) for implementing any change (feature, bugfix, refactor). Copied and renamed for each new piece of work.

### Idea Lifecycle (`roadmap.md`)

1.  **Inbox:** Raw, unstructured ideas, notes, links, bug reports. Anything goes here initially. This makes it easy to capture anything relevant; very low friction.
2.  **Imagined:** Ideas from the Inbox are fleshed out here. Includes more detail, potential approaches, sketches, links to specific requirements. This is where "spikey cow" becomes "Spikey Cow - Concept: Aggressive fauna, ECS components proposal, potential interactions...".
3.  **Planned:** A prioritized list of *goals* ready for implementation. These usually reference a detailed description in the "Imagined" section. Examples: "Implement Spikey Cow ECS based on plan X", "Fix player desync bug Y", "Refactor physics integration".
4.  **Working:** A list of active projects with status. Each entry links to the specific project document.

### Starting and Executing a Project (The Workflow)

1.  **Identify Goal:** Select a prioritized goal from `roadmap.md#Planned`.
2.  **Check Active Work:** Review `roadmap.md#Working`. Are there any active projects (`[>]`) that might conflict (modify the same core files/systems)?
3.  **Create Project Document:**
    *   Copy `project-template.md`, naming it descriptively with an incrementing number (e.g., `004-item-collection.md`). The incrementing number shows the relative order of projects started, which is useful for deconfliction and historical understanding.
    *   Add a link to this new document in `roadmap.md#Working` with status `[>] Active`.
4.  **Execute Project Plan (Follow `project-template.md` steps):**
    *   **Define & Plan:** Thoroughly complete this section in your new project document. **Crucially:** Identify the specific files and systems likely to be modified. Check `roadmap.md#Working` *again* for direct conflicts with other active projects targeting the same files.
    *   **Conflict Found?** If a conflict exists, change your project status in `roadmap.md#Working` to `[/] Blocked` and add a note linking to the blocking project. Halt work on this project until the blocker is resolved (merged).
    *   **No Conflict?** Proceed through the template steps (Branch, Test, Implement, Verify, Lint/Format, Commit, Refactor, Review, Merge, Delete Branch). Use the status markers within your project document:
        *   `[_]` = To Do
        *   `[>]` = Active / In Progress
        *   `[V]` = Done
        *   `[X]` = Canceled / Won't Do
        *   `[/]` = Blocked (add reason)
    *   Use the integrated AI prompts strategically at each stage.
5.  **Complete Project:**
    *   Once the branch is merged and deleted, update the status in `roadmap.md#Working` to `[V] Done`.
    *   Move the completed project document to mgmt/archive.

### Updating the `project-template.md`

The process template itself should be stable during active development.
1.  Ensure NO projects are listed as `[>] Active` or `[/] Blocked` in `roadmap.md#Working`. All work must be `[V] Done` or `[X]` Canceled.
2.  Create a new branch specifically for updating the template (e.g., `chore/update-project-template-v2`).
3.  Modify `project-template.md` as needed.
4.  Update this `CONTRIBUTING.md` file if the process changes significantly.
5.  Commit, review, and merge the changes. Add a version comment inside the template file itself.

### AI Assistance

AI (like ChatGPT, Copilot, Replit Ghostwriter) is encouraged at specific points outlined in the `project-template.md`. Key uses:
*   Planning/brainstorming implementation details.
*   Generating pseudocode first.
*   Writing unit tests based on requirements.
*   Implementing functions to pass existing tests.
*   Generating boilerplate code (e.g., Babylon setup, Colyseus schema definitions).
*   Explaining errors or concepts.
*   Suggesting refactoring improvements.
*   **Caution:** Do not ask the AI to perform large, complex implementation steps without breaking them down first. Use AI as a tool within the defined process, not as a replacement for understanding and verification.

## Recurring Housekeeping

- **Dependency Updates (Monthly Recommended):**
  1.  Check for outdated packages: `npm outdated` (run in root, client, server).
  2.  Update cautiously, one major dependency or logical group at a time (e.g., update all `@colyseus/*` packages together). Use `npm update <package-name>` or edit `package.json` and run `npm install`.
  3.  **CRITICAL: Run `npm test`** after each significant update.
  4.  Manually test core functionality after updates.
  5.  Commit updates: `chore: Update Colyseus dependencies to vX.Y.Z`.
  - _(AI Assist: Not directly helpful for running updates, but can help research breaking changes: "What are the major breaking changes between Colyseus v0.14 and v0.15?")_
- **Review TODOs/FIXMEs (Weekly/Bi-Weekly):** Search the codebase for `// TODO:` or `// FIXME:` comments and prioritize addressing them.
- **Review Open Tasks/Issues (Weekly):** Check your `TASKS.md` or issue tracker.

## Troubleshooting & Debugging

1.  **Check Consoles:** Always check **both** the Replit Server Console and the Browser Developer Console (F12) first. Errors are often logged clearly.
2.  **Reproduce Reliably:** Can you make the bug happen consistently? What are the exact steps?
3.  **Isolate the Problem:**
    - Use `console.log` / `console.debug` / `logOnScreen` strategically to trace execution flow and variable values on both client and server.
    - Comment out sections of code to see if the bug disappears.
    - Use the Babylon.js Inspector to check the state of the 3D scene on the client.
    - Use the Browser DevTools Network tab (filter by WS) to inspect messages being sent/received via Colyseus.
    - Use Git history (`git log`, `git diff`) to see what changed recently that might have introduced the bug.
4.  **Check State:** Log the relevant Colyseus state on the server (`this.state`) and the client (`room.state`) before and after the suspected problematic operation. Is the state what you expect?
5.  **Unit Test:** If the bug seems related to specific logic, write a new Vitest unit test that specifically reproduces the failing condition. This helps isolate and fix the bug and prevents it from recurring.
6.  _(AI Assist: "I'm getting this error [paste error] when performing action X. Here is the relevant code snippet [paste code]. Can you help identify potential causes?")_
7.  _(AI Assist: "Explain what this error message means in the context of Colyseus/Babylon.js: [paste error]")_

## Benchmarking & Performance

- **(Early Stage):** Focus on clean code and avoiding obvious bottlenecks.
- **(Later Stage):**
  - **Client:** Use Browser DevTools Performance tab and Babylon.js Inspector (`scene.getEngine().getFps()`) to monitor frame rate. Identify expensive rendering or script operations.
  - **Server:** Use `console.time()` / `console.timeEnd()` around critical sections of the game loop tick (physics, AI, state updates) to measure duration. Add logging for tick time variance. Colyseus Monitor provides basic memory/CPU info.
  - **Network:** Use Browser DevTools Network tab to monitor the size and frequency of WebSocket messages. Check Colyseus Monitor for room/client counts.
  - _(AI Assist: "Suggest ways to optimize this Babylon.js scene rendering loop.")_
  - _(AI Assist: "How can I optimize the Colyseus state schema to reduce bandwidth for player updates?")_

## Reporting

- **(Early Stage):** Primarily console logs and manual observation.
- **(Later Stage / Production):**
  - **Error Reporting:** Integrate Sentry (or similar) for automatic client/server error capturing.
  - **Analytics:** Integrate GameAnalytics (or similar) or build custom logging for key player events (session start/end, items collected/deposited, features used) to understand player behavior and game balance. Send data from server (more reliable) or client.

By establishing and following these processes, you create a much more stable and manageable development environment, even when working solo or with AI assistance.

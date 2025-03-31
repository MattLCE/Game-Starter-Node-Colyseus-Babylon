# Project: [Incrementing Number] - [Short Descriptive Name]

**Goal:** [Link to Planned Goal in roadmap.md, describe objective]

**Status Markers:**
*   `[_]` = To Do
*   `[>]` = Active / In Progress
*   `[V]` = Done
*   `[X]` = Canceled / Won't Do
*   `[/]` = Blocked (add reason)

---

[_] **Define & Plan:**
    *   Goal Details: [Describe the task/goal clearly]
    *   Affected Components: [List files/systems: Client?, Server?, Shared?, Specific files?]
    *   State Changes: [Describe expected changes to Colyseus Schema / ECS Components / Client State]
    *   Dependencies: [Any new npm packages? Relies on other features?]
    *   Design Doc Updates: [Link any needed changes to ARCHITECTURE.md, DESIGN-*.md]
    *   **Conflict Check:** [List specific files being modified]. Checked `roadmap.md#Working` on [Date]. Conflicts found? [Yes/No]. If Yes, list blocking project(s) and change status in roadmap to `[/] Blocked`.
    *   Implementation Plan (Pseudocode):
        ```pseudocode
        // Outline the steps
        ```
    *   *(AI Assist Prompt: "Help me plan the implementation for [Goal Details]. Identify affected files/components based on `ARCHITECTURE.md`. Write the core logic changes in pseudocode first.")*

[_] **Create Branch:**
    *   Branch Name: `type/branch-name`
    *   Command: `git checkout -b type/branch-name main`

[_] **Write Test(s) (TDD - Especially for Server Logic):**
    *   Identify Pure Logic: [List functions/systems suitable for unit testing]
    *   Test Plan (Pseudocode):
        ```pseudocode
        // Describe test cases for function X
        // Describe test cases for system Y
        ```
    *   *(AI Assist Prompt: "Based on this pseudocode plan [paste plan], identify functions/logic needing unit tests. Write Vitest test cases (Arrange, Act, Assert) in pseudocode for function X.")*
    *   Write Tests: Create/modify `*.test.ts` file(s).
    *   *(AI Assist Prompt: "Write the Vitest code for these pseudocode tests [paste tests] for function X in file Y.")*
    *   Verify Failure: Run `npm test` or `npm run test:watch`. Ensure new tests fail (RED).

[_] **Implement Code:**
    *   Implement necessary TypeScript code in client/server/shared.
    *   Focus on making tests pass (GREEN).
    *   Commit frequently within this step if implementation is large.
    *   *(AI Assist Prompt: "Implement function X in file Y to make these Vitest tests pass: [paste tests]")*
    *   *(AI Assist Prompt: "Show me the Babylon.js code for task Z...")*
    *   *(AI Assist Prompt: "Give me the Colyseus schema definition for component W...")*

[_] **Verify:**
    *   **Automated Tests:** Run `npm test`. Status: [Pass/Fail]
    *   **Manual Test Plan:** [List steps to test manually]
    *   Manual Test Execution: Run game. Follow test plan. Result: [Pass/Fail]. Notes: [Observations, console errors]

[_] **Lint & Format:**
    *   Run `npm run format`. Result: [OK/Files Changed]
    *   Run `npm run lint`. Result: [OK/Errors Found]. Fixed? [Yes/No]

[_] **Commit:**
    *   Stage changes: `git add .`
    *   Commit: `git commit -m "type: Clear description of completed feature/fix"`

[_] **Refactor (Optional but Recommended):**
    *   Review code for clarity, efficiency, potential improvements.
    *   Refactor changes made.
    *   Run `npm test` again. Status: [Pass/Fail]
    *   Commit refactoring: `git commit -m "refactor: Description of cleanup"`

[_] **Review:**
    *   Perform self-review: `git diff main...HEAD`. Checklist: [Code Style? Logic Correct? Comments Clear? Tests Sufficient? Docs Updated?]

[_] **Merge:**
    *   `git checkout main`
    *   `git pull origin main`
    *   `git merge --no-ff type/branch-name`
    *   `git push origin main`
    *   Update `roadmap.md#Working` status to `[V] Done`.

[_] **Delete Branch:**
    *   `git branch -d type/branch-name`
    *   `git push origin --delete type/branch-name` (Optional: remove remote branch)
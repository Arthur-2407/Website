# Resume Instructions for Future AI Sessions

This project uses an automated progress-tracking and checkpoint system to allow future AI sessions to resume work seamlessly.

## How to Resume Execution

If execution stops unexpectedly or a new session is started, follow these instructions:

1. **Check System Progress**:
   - Read the global progress state from `.ai-progress/state.json`.
   - Read the currently active task from `.ai-progress/current_task.json`.
   - Read the list of completed tasks from `.ai-progress/completed_tasks.json`.
   - Read the list of pending tasks from `.ai-progress/pending_tasks.json`.

2. **Locate the Unfinished Task**:
   - Start from the task specified in `current_task.json`. If it is empty or null, check `pending_tasks.json` for the first unfinished task.
   - If all tasks are completed, verify the final state.

3. **Check the Last Active Snapshot**:
   - Find the folder under `.state-snapshots/` corresponding to the timestamp in `state.json` (e.g. `190000/`).
   - Read `execution_state.md` to see the developer notes from the previous turn.
   - Check `rollback_map.json` to see which files were modified in the previous step in case a rollback is needed.

4. **Continue Execution**:
   - Proceed with the implementation plan from the first unfinished step.

# DeGravity Studio engineering rules

- Keep renderer capabilities behind the validated preload contract.
- Keep API keys in Electron main or the native engine; never in Vite variables or localStorage.
- Show a plan and diffs before applying agent edits. Never silently expand an approved plan.
- Preserve stale-write checks and rollback conflict checks when changing file tools.
- Keep sandbox verification isolated from the live workspace and network.
- Test meaningful boundary and lifecycle behavior; document unsupported integrations honestly.

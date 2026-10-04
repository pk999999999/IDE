# DeGravity Studio

A desktop agentic IDE built with Electron, React 18, TypeScript, Monaco and a Rust/Tokio sidecar named `antigravity-engine`. The renderer communicates with a narrowly scoped Electron preload API; Electron owns a private, newline-delimited JSON pipe to the engine.

This repository is an implemented **local, bring-your-own-key desktop foundation**. It is not a claim of audited production readiness or a hosted multi-tenant SaaS service. Authentication, subscriptions, cloud workspace execution, organization policies and an update service need separate product requirements and infrastructure. See [verification and release gates](docs/VERIFICATION.md) before distributing it.

## Repository structure

```text
degravity-studio/
├── src/                         React renderer
│   ├── components/
│   │   ├── Editor.tsx           Monaco, tabs, splits, inline prompt
│   │   ├── AgentSidebar.tsx     Streaming plans, approval, verification
│   │   ├── TerminalPanel.tsx    xterm.js + native PTY streaming
│   │   ├── DiffViewer.tsx       Monaco diffs, accept/reject/rollback
│   │   ├── FileTree.tsx         Hierarchy and file operations
│   │   ├── WorkspacePanels.tsx  Git, search, settings, MCP, preview
│   │   └── ui/button.tsx        Shadcn-style component conventions
│   ├── lib/                    Typed RPC, LSP adapter, helpers
│   ├── shared/protocol.ts       IPC validation and shared contracts
│   ├── store.ts                Zustand workspace/session state
│   ├── App.tsx                 Resizable IDE layout
│   └── main.tsx                Local Monaco worker configuration
├── electron/
│   ├── main.ts                 Window security, keys, native menus
│   ├── preload.ts              Context-isolated allowlisted bridge
│   └── engine.ts               Sidecar lifecycle, request correlation
├── crates/engine/src/
│   ├── main.rs                 Bounded concurrent RPC dispatch
│   ├── protocol.rs             Frames, events, filtered child environment
│   ├── workspace.rs            Confined paths and atomic file writes
│   ├── terminal.rs             portable-pty session manager
│   ├── context.rs              Tree-sitter summaries and local vectors
│   ├── providers.rs            OpenAI / Anthropic / Gemini / Llama SSE adapters
│   ├── agent.rs                Plans, preconditions, diffs, rollback
│   ├── process.rs              Git and Docker verification runner
│   └── peer.rs                 MCP stdio and LSP Content-Length peers
├── scripts/                    Build, development and smoke tests
├── tests/                      TypeScript boundary/transport tests
├── resources/bin/              Compiled Rust executable (generated)
├── build/                      macOS entitlements
├── docs/                       Architecture, limitations, verification
├── .github/workflows/build.yml Native OS packaging matrix
├── Cargo.toml / Cargo.lock
├── package.json / package-lock.json
├── electron-builder.json
├── tsconfig.json
└── tailwind.config.js
```

## Run locally

Prerequisites:

- Node.js 22+ and npm.
- Current stable Rust/Cargo and a native C/C++ toolchain. Windows: Visual Studio Build Tools with Desktop development with C++, using the default MSVC Rust toolchain. macOS: Xcode command-line tools. Linux: a C compiler and normal desktop Electron dependencies.
- Git for source control. Docker is optional and needed only for agent verification.
- Your own provider API key and a model ID your account can access.

From this repository directory:

```sh
npm ci
npm run build:engine
npm run dev
```

`build:engine` compiles the native sidecar and copies it to `resources/bin/`. Development launches Vite on `127.0.0.1:5173`, builds the main/preload scripts and opens Electron. If the port is occupied, stop the other server first. The UI-only Vite command is `npm run dev:ui`; native features require Electron.

Open a trusted project folder. Set a provider and model in Settings. Save a key through the OS-backed credential store, then reopen the folder to start a fresh engine with those credentials. A workspace reopen discards session history and closes terminals, so save work first.

For development you can instead copy `.env.example` to `.env` and fill in `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `LLAMA_API_KEY`. Electron main loads this file; Vite never receives these values. Do not prefix secrets with `VITE_`. Packaged builds use the credential store or environment variables.

The **Meta Llama API (legacy)** option uses Meta's older OpenAI-compatible `api.llama.com` endpoint and a Llama API key. Select it in Settings and use a model ID enabled for that key. [Meta's current Model API](https://dev.meta.ai/docs/authentication) uses a different endpoint and key format; its keys are not interchangeable with legacy Llama API keys. The legacy integration has not been verified against a live account.

## Agent workflow

1. Save your edited files and submit a task in the agent panel. The selected provider receives the task, workspace rules, AST summaries and up to eight relevant source files. Local indexing itself does not use an API.
2. Streaming output becomes a validated plan with tasks, file/line annotations, complete proposed contents and verification commands. Planning writes nothing to the project.
3. Approve the plan, then inspect Monaco diffs. Accept all changes or individual files; reject pending changes independently. The engine checks the exact original contents before each batch, rejecting stale plans.
4. Apply writes through temporary files followed by replacement. If a batch write fails, the engine attempts rollback and reports any rollback failures. This is not a crash-safe, multi-file database transaction.
5. Run the displayed verification commands after approval. They run in a network-disabled Docker container against a temporary text snapshot. No container path points to the live workspace, and no provider secrets are inherited.
6. Failed verification can generate one revised plan from the logs. The revised plan needs fresh approval. Successful or failed runs produce a walkthrough of file states and captured test output.

Rollback restores the saved original only if the file still equals the agent's applied content. It refuses to overwrite intervening edits. History is session-local; commit or otherwise back up valuable work before closing the app.

### Verification sandbox

Prepare an appropriate image before invoking verification:

```sh
docker pull node:22-bookworm-slim
```

The default image does **not** include your project dependencies. For real builds, prepare a project-specific image containing the necessary toolchain/dependencies and set `DEGRAVITY_SANDBOX_IMAGE`. Verification uses `--pull=never`, `--network=none`, dropped capabilities, no new privileges, resource limits, a read-only container root and a writable temporary workspace copy. Native terminals and approved MCP/LSP executables run as your normal user and are not Docker-sandboxed.

Snapshots include nonignored UTF-8 text files up to 1 MiB each, bounded at 64 MiB overall. Binary fixtures, ignored dependencies and secrets are omitted. Commands requiring those inputs must use a suitable prebuilt image or be run manually. Docker Desktop path sharing must allow the OS temporary directory.

### Workspace rules and integrations

- Put project guidance in `.agents/rules/*.md`. Guidance is read as project context and does not confer tool permissions.
- Settings accepts an installed LSP executable and a JSON argument array, for example `typescript-language-server` and `["--stdio"]`. One server per workspace currently supplies active-document synchronization, completion, hover and diagnostics. A VS Code extension host is not included.
- The MCP panel accepts an installed stdio server executable and a JSON argument array. It implements the initialization lifecycle for negotiated revisions `2024-11-05`, `2025-03-26`, and `2025-06-18`, tool discovery and explicitly approved tool calls. Newer MCP transports, remote OAuth, resources/prompts, multiple simultaneous servers and autonomous model-driven MCP calls are not implemented.
- Preview accepts HTTP URLs on `localhost`, `127.0.0.1`, or `::1`. Guests have isolated sessions, sandboxing, no Node integration, no preload, denied permissions and blocked external top-level navigation/popups. Never use it as a general-purpose browser.

## Build, test and package

```sh
npm run typecheck
npm test
npm run test:engine
npm run build
npm run test:smoke
npm run test:ui
npm run package
```

`test:smoke` uses a disposable workspace to exercise the real sidecar, optimistic saves, path protection, ignore rules and a native PTY. `test:ui` uses a hidden Electron window to load the production renderer/preload. Set `DEGRAVITY_SMOKE_CAPTURE=1` to refresh `docs/screenshots/studio.png` with a visible-window capture.

Packaging outputs go to `release/`:

| Platform | Artifacts | CI architecture |
| --- | --- | --- |
| macOS | DMG and ZIP containing `.app` | ARM64 and x64, separate native jobs |
| Windows | NSIS `.exe` | x64 |
| Linux | AppImage and DEB | x64 |

Each CI runner compiles its own Rust binary and bundles it outside ASAR via `extraResources`. Native runners handle platform-specific compilation and signing requirements.

Pull requests and main-branch builds package unsigned test artifacts. Version tags (`v*`) require signing credentials for Windows/macOS and enable notarization for macOS. Configure `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `MAC_CSC_LINK`, and `MAC_CSC_KEY_PASSWORD` in GitHub secrets; a single certificate file cannot sign both platforms. macOS additionally requires `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Configure approval protection on the `release` environment before enabling tagged releases; ordinary builds use the `build` environment. No artifact is automatically published to a public release or update feed.

## Practical limits

- One trusted workspace, one rendered terminal, up to eight engine PTYs, one LSP and one MCP connection at a time.
- Context uses 256-dimensional hashed lexical vectors, not neural embeddings. Tree-sitter extracts declaration summaries for TypeScript/TSX, Rust and Python; other text files receive a short text summary.
- The index is rebuilt on demand; it is not a persisted ANN database. Watch notifications refresh open files and the file list with debouncing.
- Text editing supports UTF-8 files up to 1 MiB; large/binary files are deliberately rejected.
- Approval and rollback state, model selection, tabs and layout are not yet persisted across application restarts. OS-encrypted API keys are persisted.
- Secrets are excluded by common filename patterns, not a comprehensive data-loss-prevention classifier. Review what is in a workspace before submitting provider requests.
- No team auth, billing, cloud synchronization, extension marketplace, crash reporting, auto-update backend or production telemetry is configured.

For implementation boundaries and remaining release work, read [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [VERIFICATION.md](docs/VERIFICATION.md).

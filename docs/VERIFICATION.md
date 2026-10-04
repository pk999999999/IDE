# Verification and release gates

Generated and checked on Windows. This file distinguishes implemented code from verified behavior.

| Check | Result |
| --- | --- |
| TypeScript strict typecheck | Passed |
| Vite production renderer bundle | Passed; Monaco makes the initial bundle large |
| Electron main and sandboxed preload compilation | Passed |
| Vitest IPC / transport / URI / Git parsing tests | 15 passed |
| Rust dependency resolution and Cargo.lock | Passed |
| Rust native compilation and unit tests | Passed on Windows: 3 unit tests and optimized engine build |
| Real sidecar / native PTY smoke | Passed on Windows: IPC, files, gitignore, PTY I/O and workspace cwd |
| Hidden Electron UI smoke | Passed with the real Rust sidecar, Monaco, preload and file dialog |
| Live OpenAI / Anthropic / Gemini requests | Not run; no credentials supplied |
| Docker verification and repair cycle | Not run; Docker/image not available in this session |
| Installed LSP / MCP end-to-end tests | Not run; external servers not configured |
| macOS / Windows / Linux installers | CI configuration provided; not built or signed here |
| Production npm dependency audit | Passed: zero reported vulnerabilities |

## Meaningful tests supplied

- IPC rejects unknown/prototype method names, extra arguments, oversized PTY writes and unsafe LSP command methods.
- File saves must supply a precondition; paths and changes are validated again in Rust.
- Preview URL validation accepts loopback HTTP and rejects credentials, lookalike hosts and non-HTTP schemes.
- Private-pipe and SSE decoders handle fragmented UTF-8. Corrupt frames are rejected.
- Git porcelain parsing handles embedded spaces and rename source records.
- Rust tests exercise atomic file replacement, traversal denial, symlink escapes on Unix, plan approval, stale originals and rollback conflict detection.
- Native smoke script uses a temporary workspace and shell session to test real filesystem and PTY operations.
- Hidden Electron smoke loads the compiled UI with the production preload and captures a screenshot.

## Required before release

1. Run the native CI matrix on all supported architectures; inspect installer contents and engine execution on clean machines.
2. Exercise provider success, cancellation, API error, truncation and quota cases with supported model IDs. Provider defaults are editable examples, not a guarantee of account access.
3. Exercise Docker image preparation, timeout/cancellation cleanup and failed-verification repair on each host OS.
4. Test supported MCP and LSP servers, reconnects, process exits and large diagnostic/tool results.
5. Add crash-safe edit journals and session persistence before promising recovery across application/process failure.
6. Test hostile/concurrent filesystem changes; strengthen path operations if untrusted workspaces are in scope.
7. Configure per-platform signing certificates, notarization and protected release environments. Validate signatures on both the app and sidecar.
8. Run dependency vulnerability scanning, license inventory and secret scanning in CI. The generated app has not undergone an independent security audit.
9. Configure product icons, update hosting, accessibility validation, telemetry consent and SaaS control-plane requirements before public distribution.

The committed source and lockfiles are the deliverable. Temporary local compilers and node_modules are not source dependencies to copy into version control.

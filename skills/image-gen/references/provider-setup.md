# Provider setup

The probe only establishes whether commands are present and, where supported, a limited authentication status. It cannot establish whether the user's account can generate images. Do not infer that Agy is logged in merely because it is installed, and do not treat an unknown status as authenticated.

- **Neither command found:** tell the user that neither `codex` nor `agy` is available on the execution environment's PATH. Ask which they want to set up. Link to the official [Codex CLI setup](https://developers.openai.com/codex/cli/) or [Antigravity CLI setup](https://antigravity.google/docs/cli/install/). Do not install either without permission.
- **Selected command missing:** explain which executable is missing; do not silently use the other one. The user can install it or explicitly select the other provider.
- **Codex authentication unknown or status probe failed:** explain that `loginError: probe_failed` is not proof of a logout; suggest the user run `codex login status` themselves. If they need to sign in, let them complete `codex login` themselves. Do not request or reveal credentials or browser codes. A successful login-status check does not guarantee image access; probe again after the user confirms setup.
- **Agy authentication unknown or failed:** ask the user to open `agy` and finish its own sign-in/setup, then confirm it is ready. There is no universally assumed non-interactive login-status command in this skill.
- **Node.js unavailable or too old:** tell the user Node.js 20 or newer is required for the bundled script. Ask before installation or upgrades.
- **Windows CLI installed only as a `.cmd` or `.bat` shim:** the probe deliberately finds only directly executable `.exe` or `.com` programs on Windows; it does not run shell shims. Explain the limitation rather than claiming the CLI is missing everywhere. A directly executable supported binary is needed in the execution environment.
- **CLI is available only on the user's machine, but the agent runs remotely:** explain that the CLI must be available in the same environment where the script runs; do not claim a local executable is available remotely.

Before any generation, make clear when relevant that provider use may transmit the prompt and reference images to remote services and use the user's account quota or incur charges. Never ask the user to paste tokens or keys into chat.

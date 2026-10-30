# Troubleshooting

- **No Node.js, no supported CLI, or CLI not on PATH:** consult [provider setup](provider-setup.md). Do not install anything without permission.
- **Authentication error or unknown authentication status:** ask the user to sign in with the selected provider using its own UI or CLI. Do not read credential stores or ask the user to paste secrets. Then retry only after the user confirms.
- **Codex `loginError: probe_failed`:** the status check failed; its login state is unknown. Explain this without claiming the user is logged out. They can check `codex login status` themselves or select another provider.
- **Account, model, or image generation unavailable:** installation or authentication alone does not grant image-generation entitlement. The script may report only `Provider process failed.` or `Provider reported failure.`, without provider-specific details; report the actual message and do not infer a specific limitation. Ask before trying another provider or a different paid API.
- **Permission or sandbox denial:** report only the detail actually available; the script may suppress the provider's diagnostic and return a generic error. Do not enable dangerous bypasses, change global settings, or widen access automatically. The user may need to approve or configure the provider in its own interface.
- **Timeout or aborted run:** report the actual error and ask before retrying. The script reports `Provider timed out.` for its own timeout; other failures may produce a generic message. A long-running operation may have consumed account quota.
- **No valid new output image, unrecognized output, or missing path:** report the failure. An attached input image, an old file, or an unverified path is not a generated result. Signature checks do not guarantee that an image can be decoded.
- **Host cannot run scripts, access the relevant local CLI, or access local files:** explain the concrete environment limitation. Do not assume that every agent has a terminal or a shared filesystem.

Never silently try another provider, script, paid API, or SVG/text substitute when generation fails. Ask the user before any fallback.

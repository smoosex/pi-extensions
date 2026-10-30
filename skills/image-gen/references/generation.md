# Generation workflow

Resolve the skill root from the location of `SKILL.md`. Do not assume that the agent's current working directory is the skill directory. The script is `scripts/image-gen.mjs` under that root; it does not require the Pi plugin, npm dependencies, or a local image decoder.

Run `node <absolute-script-path> probe` before choosing. Follow the choice and authentication rules in `SKILL.md`. A user-selected provider is authoritative; if the user explicitly delegates the decision, explain which candidate you chose. Presence of a CLI is not proof it is logged in or has image-generation access.

To generate, run the script with `generate --provider codex` or `generate --provider agy`; pass the prompt as UTF-8 on standard input. Repeat `--image <local-path>` for user-provided reference images. Each must be a readable, non-empty regular PNG, JPEG, or WebP file no larger than 50 MiB (50 × 1024 × 1024 bytes). The script checks the file signature and basic structure but does not decode the image, so it cannot guarantee the image can be opened. Use `--model <name>` only when the user explicitly requests a provider-specific model. Pass paths as individual arguments, and deliver arbitrary user text via standard input rather than interpolating it into a shell command.

Illustrative invocation for a fixed, non-sensitive example, from any working directory:

```sh
printf '%s' 'A lighthouse in a winter storm' | node /absolute/path/to/image-gen/scripts/image-gen.mjs generate --provider codex
```

Use a shell appropriate to the user's environment, or a process tool that accepts arguments and stdin directly. Preserve spaces and non-ASCII characters in paths and prompts. Do not print credentials. The selected CLI may send the prompt and reference images to its provider and may incur account charges. Agy receives its prompt as a command-line argument, which may be visible to other local users through process inspection; do not use it for sensitive prompts without making that risk clear.

The script returns JSON containing the provider and generated local file path on success. In the final response, include a Markdown image pointing to that actual path and also show the path separately as text, for example:

```markdown
![Generated image](</absolute/path/to/image.png>)

Path: `/absolute/path/to/image.png`
```

Use the real returned path, correctly escaping it for Markdown. Local image rendering depends on the host; do not claim the image was displayed or written to a user-requested destination without checking. If the host cannot render local image paths, the separate path remains available. For multiple images, generate each request separately, and do not assume concurrent executions are supported safely by the host. Respect the user's chosen provider throughout.

The bundled script does not automatically bypass approvals or sandboxes, request credentials, install dependencies, or retry with another provider. If normal CLI permissions or the host cannot complete the request, report that limitation and ask the user how to proceed; never secretly enable unsafe bypass flags.

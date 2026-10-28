# pi-notify

Pi extension that sends a native terminal notification when the agent finishes and waits for input.

## Install

```bash
pi install npm:@smoose/pi-notify
```

## Configuration

- `PI_NOTIFY_TITLE`: notification title template, default `π - {project}`
- `PI_NOTIFY_BODY`: notification body template, default `{message}`
- `PI_NOTIFY_MESSAGE_SOURCE`: `user` or `assistant`, default `assistant`
- `PI_NOTIFY_MESSAGE_MAX`: max message characters before ellipsis, default `80`, max `500`
- `PI_NOTIFY_SOUND_CMD`: optional shell command run after notification

Kitty uses OSC 99 with `o=always`. Ghostty uses OSC 777 (`notify`), detected via `TERM_PROGRAM`, `TERM`, or `GHOSTTY_RESOURCES_DIR`. Other terminals fall back to macOS AppleScript notifications via `osascript`. Inside tmux, the active tmux client is checked so stale `KITTY_WINDOW_ID` values do not force Kitty mode.

When running inside tmux, enable passthrough:

```tmux
set -g allow-passthrough all
```

Template variables:

- `{project}`: current directory name
- `{cwd}`: current working directory
- `{model}`: active model as `provider/id`
- `{model_short}`: active model id only
- `{message}`: selected current-turn message based on `PI_NOTIFY_MESSAGE_SOURCE`
- `{user_message}`: current-turn user message, truncated
- `{assistant_message}`: latest current-turn assistant text, truncated
- `{duration}`: agent run duration, such as `4.2s`
- `{duration_ms}`: agent run duration in milliseconds

Example:

```bash
PI_NOTIFY_TITLE="π - {project}" PI_NOTIFY_BODY="{message}" pi
```

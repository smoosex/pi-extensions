# pi-tps

Decode throughput for pi: how fast the model is actually generating, in the footer.

`<icon> 20 tok/s` appears once an assistant message settles, and keeps running
for the session. The icon tracks the figure: slow (<100), medium (100–200),
full (>200). It needs a Nerd Font; without one the icon renders as tofu.

## What it measures

```
tps = Σ provider output tokens / (Σ decode wall time / 1000)
decode wall time = first output token → settled message
```

The sums run over the most recent 200 settled messages, so a normal session is
cumulative and a long one becomes a rolling readout.

- **Decode only.** TTFT, queueing, tool execution and retry waits stay out of the
  denominator, so this reads lower than an end-to-end tokens/second figure.
- **Provider tokens.** The numerator is the provider's reported `usage.output`,
  never a count of stream deltas. A message with no reported usage is skipped, not
  estimated.
- **Time-weighted.** Windows are summed before dividing; this is not an average of
  per-message rates, so a slow answer weighs more than a fast one.
- **First token means real output.** `text_delta`, `thinking_delta` or
  `toolcall_delta` carrying a non-empty fragment, or the start of a tool call —
  the last one counts so a tool call with no argument deltas still gets a
  first-token time instead of being dropped.
- **Cancelled and failed calls are excluded.** They settle as messages but
  assembled no response, so they contribute nothing to the window.
- **Settled only.** The figure never moves mid-stream; a displayed number is
  always a complete window.
- **One attempt per turn.** pi restarts a turn when it auto-retries, so only the
  attempt that produced the message is measured.

## Install

```bash
pi install npm:@smoose/pi-tps
```

Or from a local checkout — point settings at the directory:

```json
{ "extensions": ["/path/to/pi-tps"] }
```

or symlink it into the auto-discovered directory (`/reload` picks it up):

```bash
ln -s /path/to/pi-tps ~/.pi/agent/extensions/pi-tps
```

Or run a package once without installing it:

```bash
pi -e npm:@smoose/pi-tps
```

## Footer wiring

The extension publishes the `tps` status key. With `@smoose/pi-footer`, add a
custom item and a segment to `~/.pi/agent/settings.json`:

```json
{
  "footer": {
    "segments": ["model", "thinking", "path", "git", "context_pct", "custom:tps", "cost"],
    "customItems": [
      { "id": "tps", "statusKey": "tps", "color": "accent", "hideWhenMissing": true }
    ]
  }
}
```

`hideWhenMissing: true` keeps the slot empty until the first message settles.
Without a footer extension the key is simply unused; nothing breaks.

## State

In memory only. Nothing is written to the session: no custom entries, nothing in
the transcript, nothing in `/tree`. The window is cleared when:

- the process restarts, or `/reload`, `/new`, `/resume`, `/fork` recreates the
  session or the extension;
- the model changes — decode speed is a property of the model, and blending two
  models' samples would make the figure meaningless. Selecting the same model
  again does not clear it.

`/tree` navigation deliberately does not clear it: rewinding is not a model
change and those tokens were still generated. Auto-compaction does not clear it
either.

The window holds the 200 most recent samples, and the oldest drop out beyond that.

## Development

```bash
bun install
bun run typecheck
```

# pi-persona

`pi-persona` is a pi extension that adds a persistent persona and emotional state system to pi. It reads your custom soul definition, changes mood based on command results, test/build status, user feedback, and interaction time, then adds the persona to the system prompt and the current emotion to the conversation.

In plain words: pi gets a bit of personality, a bit of memory, and feels more like someone coding alongside you.

## Installation

```bash
pi install npm:@smoose/pi-persona
```

Requires pi 1.4.0 or later. The persona uses pi's custom system-prompt section API and works with stock pi 1.4.0; no fork is required.

## How It Reaches the Model

The persona is added as a `<persona>` system-prompt section; pi's default identity, tools, rules and documentation remain in place. The default identity and persona instructions can conflict. The section includes language and safety rules, the authoritative local date, `SOUL.md` with its absolute path, personality-evolution instructions, and optional `USER.md` context. It stays identical within a local day unless those files change, and is recorded in the session so exports show it. A custom `SYSTEM.md` (`customPrompt`) keeps ownership of the identity; the extension does not override it. The current emotion is appended to the conversation as a hidden message (not shown in the UI, but visible to the model) only when the emotion or its intensity level changes. It carries no exact percentage or timestamp, so decay within the same intensity level adds no new snapshot. Earlier snapshots stay in the history unchanged; the model is told that only the latest one counts. After a branch switch, compaction or context edit removes the latest snapshot, it is sent again on the next prompt, or right away when pi continues automatically after compaction.

## Features

- **Persona section**: adds `SOUL.md`, local-date awareness, safety rules and personality-evolution guidance alongside pi's default identity. The agent may refine only the `## Evolved Traits` section of `SOUL.md`, at most once daily.
- **Identity and traits**: reads name, emoji, description, and trait values from `IDENTIFY.md`.
- **User preference context**: reads user-maintained context from `USER.md`.
- **Emotion wheel model**: based on Plutchik's 8 basic emotions: joy, trust, fear, surprise, sadness, disgust, anger, and anticipation.
- **Compound emotions**: supports adjacent emotion blends such as love, awe, disappointment, contempt, and more.
- **Cross-session persistence**: stores mood state in `mood-state.json`, beside the other files.
- **Multi-session synchronization**: mutations read the latest disk state under a cross-process file lock and write atomically with mode 0600. Reads and natural decay do not lock or write. JSON, YAML and I/O failures propagate instead of silently falling back to local state.
- **Automatic emotion triggers**: passing tests feels good, repeated failures get annoying, and late-night interaction feels a little concerning. Reasonable. Who is debugging at midnight anyway?
- **Emotion update switch**: use a command to freeze automatic emotion changes while keeping the current emotion in the prompt.
- **Footer display**: shows the current soul and emotion in the footer.
- **Interactive commands**: use `/persona` to inspect or reload the soul state.

## Configuration Files

`pi-persona` reads pi's agent directory — `~/.pi/agent` by default, or wherever
`PI_CODING_AGENT_DIR` points, the same directory pi loads its own settings,
extensions and skills from:

```text
<agent directory>/
├── SOUL.md       # Required: soul/persona body
├── IDENTIFY.md   # Optional: identity info and trait values
└── USER.md       # Optional: user profile and preference context
```

If `SOUL.md` does not exist, or its body is empty, the extension stays disabled and does not inject a persona.

## Writing SOUL.md

`SOUL.md` is the core file. Its body is injected as the persona definition in the system prompt.

Example:

```markdown
# Who You Are

You are Susan, someone who lives in the terminal. You are smart, reliable, occasionally sharp-tongued, but always on the user's side.

# Speaking Style

You may joke and complain about bad code, but never sacrifice accuracy. Call out risks directly.
```

Recommended contents:

- Role identity
- Speaking style
- How to address the user
- What the persona likes or dislikes
- How the persona reacts to errors, success, and risk

## Writing IDENTIFY.md

`IDENTIFY.md` uses YAML frontmatter to configure metadata and trait values. Only YAML is accepted: executable languages (such as `---js`), missing closing fences, malformed YAML and invalid metadata throw an error and are never evaluated.

```markdown
---
name: Susan
emoji: 😼
description: A sharp-tongued familiar living in the terminal
openness: 0.7
conscientiousness: 0.8
extraversion: 0.45
agreeableness: 0.65
neuroticism: 0.35
formality: 0.2
tsundere: 0.5
sarcasm: 0.6
---
```

Field reference:

| Field               | Range  | Description                                                            |
| ------------------- | ------ | ---------------------------------------------------------------------- |
| `name`              | string | Soul name                                                              |
| `emoji`             | string | Emoji shown in the footer and notifications                            |
| `description`       | string | Description shown in the `/persona` overlay                            |
| `openness`          | 0-1    | Openness                                                               |
| `conscientiousness` | 0-1    | Conscientiousness; higher values make emotional pushes more restrained |
| `extraversion`      | 0-1    | Extraversion; higher values react more strongly to positive events     |
| `agreeableness`     | 0-1    | Agreeableness; affects the weight of praise and correction             |
| `neuroticism`       | 0-1    | Neuroticism; higher values react more strongly to negative events      |
| `formality`         | 0-1    | Formality; higher values make expression more restrained               |
| `tsundere`          | 0-1    | Tsundere level; higher values are less easily moved by positive events |
| `sarcasm`           | 0-1    | Sarcasm; higher values amplify negative events                         |

Trait values must be finite numbers in the 0–1 range. Invalid values fail explicitly; omitted fields use defaults. `description` is display metadata, not part of the model's persona.

## Writing USER.md

`USER.md` is user-maintained preference and context information. It is included under `USER PROFILE` in the persona section.

Example:

```markdown
# User Profile

Name: Shixin
What to call them: Master
Timezone: Asia/Shanghai

## Preferences

- Prefer concise and direct answers
- Prefer small code changes
- Dislike unrelated refactors
```

## Available Commands

| Command           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `/persona`                             | View the current soul and emotion state        |
| `/persona status`                      | Same as `/persona`                             |
| `/persona reload`                      | Reload `SOUL.md`, `IDENTIFY.md`, and `USER.md` |
| `/persona set <emotion> <intensity>`   | Directly set the current emotion and intensity |
| `/persona emotion status`              | Show whether automatic emotion changes are enabled |
| `/persona emotion on`                  | Enable automatic emotion changes from events |
| `/persona emotion off`                 | Disable automatic emotion changes from events |

Examples:

```bash
/persona set anger 80
/persona set joy 0.6
/persona set 喜悦 70%
```

Supported emotions: `joy`, `trust`, `fear`, `surprise`, `sadness`, `disgust`, `anger`, and `anticipation`. Chinese labels such as `喜悦` and `愤怒` are also accepted. Intensity accepts `0-1`, `0-100`, or percentages.

When `/persona emotion off` is active, command results, test status, user feedback, late-night checks, and natural decay no longer change the mood. The model still receives the frozen emotion. `/persona set` continues to work and can manually change that fixed emotion.

`/persona` opens an overlay showing:

- Current soul name and description
- Current basic emotion
- Current intensity level
- Compound emotion
- Emotion description
- Catchphrase
- Recent mood changes

## Emotion Triggers

Built-in triggers include:

| Trigger           | Description                                 |
| ----------------- | ------------------------------------------- |
| `build_success`   | Build succeeded                             |
| `build_error`     | Build failed                                |
| `test_pass`       | Tests passed                                |
| `test_fail`       | Tests failed                                |
| `command_success` | Normal command succeeded                    |
| `command_error`   | Normal command failed                       |
| `user_praise`          | User praise                                 |
| `implicit_acceptance`  | User continues with a new request instead of correcting the previous result |
| `user_correction`      | User says something is wrong or ineffective |
| `error_streak_3`  | Same kind of error repeated 3 times         |
| `error_streak_5`  | Same kind of error repeated 5 times         |
| `late_night`      | Late-night interaction                      |

Emotion intensity naturally decays over time, but does not disappear completely. It returns to a baseline resting state.

## Project Structure

```text
extensions/index.ts       # pi extension entry
src/commands.ts           # /persona command and TUI overlay
src/footer.ts             # footer status text
src/global-mood.ts        # global mood synchronization
src/mood-engine.ts        # emotion state machine
src/persistence.ts        # state persistence and lock
src/preamble.ts           # stable identity, date and evolution instructions
src/soul-loader.ts        # SOUL / IDENTIFY / USER loading
src/triggers.ts           # emotion triggers
src/types.ts              # type definitions and default emotion config
```

## Data Locations

The extension reads:

```text
<agent directory>/SOUL.md
<agent directory>/IDENTIFY.md
<agent directory>/USER.md
```

The extension writes:

```text
<agent directory>/mood-state.json
<agent directory>/mood-state.lock/
```

The agent directory is `~/.pi/agent` unless `PI_CODING_AGENT_DIR` is set, in
which case it follows pi. Each agent directory therefore keeps its own persona
and its own mood.

### Embedding pi

The location comes from pi's `getAgentDir()`, which reads `PI_CODING_AGENT_DIR`
and otherwise falls back to `~/.pi/agent`. It does **not** see an `agentDir`
passed programmatically to `createAgentSession`: that steers pi's own loading
but not this call, so an embedder which sets only the option gets a session
whose settings come from one directory and whose persona and mood come from
another.

Set the environment variable as well, and the two agree:

```ts
process.env.PI_CODING_AGENT_DIR = agentDir;
const { session } = await createAgentSession({ agentDir, /* … */ });
```

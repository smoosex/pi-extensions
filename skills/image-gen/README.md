# Image generation skill

A standalone [Agent Skills](https://agentskills.io/specification) skill that delegates image generation to a locally available Codex or Antigravity (`agy`) CLI. It does not require the Pi extension or any npm package in this repository.

## Requirements

- A skills-compatible agent that can run local processes and access files in the execution environment.
- Node.js 20 or newer.
- At least one supported CLI, authenticated and permitted to generate images. Prompts and reference images may be sent to the selected provider; usage or charges may apply.

## Install

Copy the `image-gen` directory into a skill directory recognized by your agent, for example `~/.agents/skills/image-gen` where supported. Consult your agent's documentation for its discovery locations. Having a skills-compatible agent does not guarantee it can execute local scripts or access a CLI in a remote environment.

Reload or restart the agent if necessary, then ask it to create an image. It checks provider availability and asks which provider to use when more than one is a candidate.

## Distribution

This directory is separate from `packages/` and is not included in the existing npm package publish files. To distribute the skill independently, package `SKILL.md`, `references/`, and `scripts/image-gen.mjs` together. Do not include credentials, generated images, `node_modules`, or `.git`. CLI availability, login, and provider-side image access must be tested in each target environment.

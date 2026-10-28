# pi-themes

A theme pack for [pi](https://github.com/earendil-works/pi), with file-based switching for paired light/dark theme families.

## Installation

```bash
pi install npm:@smoose/pi-themes
```

This package currently includes Everforest, Tundra, Rosé Pine, Tokyo Night, OneDark, Gruvbox, and Bearded Arc. Paired theme families can follow the `<family>-light` / `<family>-dark` naming convention; standalone themes can be selected by concrete theme name in the control file.

## Included themes

### Everforest

- `everforest-dark`
- `everforest-light`

### Tundra

Extracted from [`sam4llis/nvim-tundra`](https://github.com/sam4llis/nvim-tundra)'s arctic palette and stylesheet:

- `tundra-dark`

### Rosé Pine

Extracted from the official [Rosé Pine palette](https://rosepinetheme.com/palette/ingredients/):

- `rosepine-dark`
- `rosepine-light`

### Tokyo Night

Extracted from [`tiagovla/tokyonight.nvim`](https://github.com/tiagovla/tokyonight.nvim)'s palette:

- `tokyonight-dark`

### OneDark

Extracted from [`navarasu/onedark.nvim`](https://github.com/navarasu/onedark.nvim)'s palette styles:

- `onedark-dark`
- `onedark-light`

### Gruvbox

Extracted from [`morhetz/gruvbox`](https://github.com/morhetz/gruvbox)'s medium-contrast palette:

- `gruvbox-dark`
- `gruvbox-light`

### Bearded Arc

Extracted from [`BeardedBear/bearded-theme`](https://github.com/BeardedBear/bearded-theme)'s Arc variation:

- `bearded-arc-dark`

## How switching works

The running pi extension watches a small control file. When the file changes, the extension reads it and calls `ctx.ui.setTheme(...)` inside pi.

The extension also sets a footer/status key named `pi-themes`, which can be consumed or styled together with other footer plugins.

Default control file:

```text
~/.pi/agent/pi-theme.json
```

Override it with:

```bash
PI_THEME_CONTROL_FILE=/path/to/pi-theme.json
```

## Control file format

Select a paired theme family and appearance:

```json
{
  "family": "everforest",
  "appearance": "dark"
}
```

This switches to:

```text
everforest-dark
```

Set a concrete theme directly:

```json
{
  "theme": "tundra-dark"
}
```

External tools can write this file however they like, for example:

```bash
mkdir -p ~/.pi/agent
printf '{"family":"everforest","appearance":"dark"}\n' > ~/.pi/agent/pi-theme.json
printf '{"theme":"tundra-dark"}\n' > ~/.pi/agent/pi-theme.json
```

## Pi command

Inside pi, theme-family control is also available through:

```text
/theme everforest        # defaults to everforest-dark
/theme everforest light
/theme rosepine light
/theme tundra            # defaults to tundra-dark
```

The command format is:

```text
/theme <family> [dark|light]
```

If `dark` or `light` is omitted, `dark` is used. The command only requires the target concrete theme to exist, so dark-only families like `tundra-dark` are supported.

## Environment

```bash
PI_THEME=everforest
PI_THEME_CONTROL_FILE=~/.pi/agent/pi-theme.json
```

`PI_THEME` sets the default family used when the `/theme` command omits a family-specific context. File-based switching itself is driven by the control file.

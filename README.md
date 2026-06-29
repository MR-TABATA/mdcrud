# mdcrud

A minimal, fast Markdown viewer built with Tauri + TypeScript.

## Features

- Open and render Markdown files (`.md`, `.markdown`, `.txt`)
- Create a new document (`⌘N`) and save it anywhere via a save dialog; an untitled doc's first `#` heading is offered as the file name
- Delete the current file to the system Trash (`⌘⌫` or the trash button), with a confirmation — recoverable from the Trash if it was a mistake
- Edit with a split editor + live preview (`⌘E` to toggle), save with `⌘S` or "Save As…" (`⌘⇧S`) to write a copy elsewhere; drag the divider to resize the panes
- Formatting toolbar above the editor: bold (`⌘B`), italic (`⌘I`), heading, list, quote, link, and more — each toggles/inserts the Markdown syntax around the selection (undoable with `⌘Z`)
- Customise the toolbar in Settings (`⌘,`): turn any of the 14 Markdown actions (strikethrough, ordered/checklist, code block, image, table, horizontal rule, …) on or off; the choice is remembered
- Japanese / English UI: follows your OS language by default and can be switched in Settings; the native menu (File / Edit / View) is localized too
- Keep multiple documents open in a sidebar (BBEdit-style): click to switch, close with the circled × (`⌘W`), toggle the sidebar with `⌘1`; the open set is restored on next launch
- Open files by double-clicking or "Open With" (registered as a handler for those extensions), the button, `⌘O` / `Ctrl+O`, or by dragging a file onto the window
- Auto-reloads when the open file changes on disk (scroll position preserved)
- Recent files list on the start screen for quick reopening
- Renders tables, code blocks, quotes, and local images (relative paths resolve against the file)
- Syntax-highlights fenced code blocks with [highlight.js](https://highlightjs.org/) (lazy-loaded common bundle; tuned to the dark theme)
- Renders [Mermaid](https://mermaid.js.org/) diagrams in ```` ```mermaid ```` code blocks (lazy-loaded; falls back to source on syntax errors)
- Links stay in the app: external links open in your browser, in-document anchors scroll
- HTML output sanitized with DOMPurify and locked down with a strict CSP (safe to open untrusted files)
- Reload the current file (`⌘R` / `Ctrl+R`)

## Install

Download a build for your platform from the [Releases](https://github.com/MR-TABATA/mdcrud/releases) page.

The binaries are ad-hoc signed but **not notarized with an Apple Developer ID yet**, so your OS may warn you on first launch. To run anyway:

- **macOS** — first try right-clicking (or Control-clicking) the app and choosing **Open**, then confirm.

  If instead you see **""mdcrud.app" is damaged and can't be opened. You should move it to the Trash"**, the app isn't actually damaged — macOS is blocking the downloaded, un-notarized app. Click **Cancel** (not "Move to Trash"), then remove the download quarantine flag in Terminal and open it normally:

  ```bash
  xattr -dr com.apple.quarantine /Applications/mdcrud.app
  ```

- **Windows** — on the SmartScreen prompt, click **More info → Run anyway**.

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

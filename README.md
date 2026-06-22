# mdcrud

A minimal, fast Markdown viewer built with Tauri + TypeScript.

## Features

- Open and render Markdown files (`.md`, `.markdown`, `.txt`)
- Open files by double-clicking or "Open With" (registered as a handler for those extensions), the button, or `⌘O` / `Ctrl+O`
- HTML output sanitized with DOMPurify (safe to open untrusted files)
- Reload the current file (`⌘R` / `Ctrl+R`)

## Install

Download a build for your platform from the [Releases](https://github.com/MR-TABATA/mdcrud/releases) page.

The binaries are **not code-signed yet**, so your OS may warn you on first launch. To run anyway:

- **macOS** — the first time, right-click (or Control-click) the app and choose **Open**, then confirm. After that it launches normally. If macOS still blocks it, run:

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

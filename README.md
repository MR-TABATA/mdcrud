# mdcrud

A minimal, fast Markdown viewer built with Tauri + TypeScript.

## Features

- Open and render Markdown files (`.md`, `.markdown`, `.txt`)
- HTML output sanitized with DOMPurify (safe to open untrusted files)
- Reload the current file (`⌘R` / `Ctrl+R`)
- Open files via button or `⌘O` / `Ctrl+O`

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

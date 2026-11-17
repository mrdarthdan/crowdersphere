# App icons

`icon.svg` is the source for every icon here. It's a vector drawing, so it stays sharp at any size; edit it rather than the PNG/ICO/ICNS files.

To regenerate the other files after changing it (from the repository root):

```
npx @tauri-apps/cli icon src-tauri/icons/icon.svg
```

and copy `src-tauri/icons/icon.ico` to `ui/favicon.ico` (the editor's sidebar logo).

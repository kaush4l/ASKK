# ASKK

ASKK is a client-side Dioxus 0.7 multi-agent workspace compiled to WebAssembly. It stores workspace state in browser IndexedDB and uses OpenAI-compatible browser fetch calls for model requests.

## Development

Serve the app locally:

```sh
dx serve --web
```

Clean and build the GitHub Pages artifact:

```sh
cargo clean
dx build --release --web --base-path /ASKK/ --locked
```

The generated static site is written to:

```text
target/dx/askk/release/web/public/
```

## Publish to GitHub Pages

Push source to `main`, then publish the contents of `target/dx/askk/release/web/public/` to the root of the `gh-pages` branch with a `.nojekyll` file.

The repository Pages source should be configured to deploy from branch `gh-pages`, folder `/(root)`.

Published URL:

```text
https://kaush4l.github.io/ASKK/
```

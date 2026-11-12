# Development

Your new jumpstart project includes basic organization with an organized `assets` folder and a `components` folder.
If you chose to develop with the router feature, you will also have a `views` folder.

```
project/
├─ assets/ # Any assets that are used by the app should be placed here
├─ src/
│  ├─ main.rs # The entrypoint for the app. It also defines the routes for the app.
│  ├─ components/
│  │  ├─ mod.rs # Defines the components module
│  │  ├─ hero.rs # The Hero component for use in the home page
│  │  ├─ echo.rs # The echo component uses server functions to communicate with the server
│  ├─ views/ # The views each route will render in the app.
│  │  ├─ mod.rs # Defines the module for the views route and re-exports the components for each route
│  │  ├─ blog.rs # The component that will render at the /blog/:id route
│  │  ├─ home.rs # The component that will render at the / route
├─ Cargo.toml # The Cargo.toml file defines the dependencies and feature flags for your project
```

### Serving Your App

To run the whole app (the host that runs the engines, and its window), built as released:

```bash
./scripts/run.sh
```

To leave it running in the background instead, and ask or end it later
([docs/service.md](docs/service.md)):

```bash
./scripts/run.sh start     # also: status, restart, stop
```

To use it as lines in a terminal instead of pages (the same engines, the same home):

```bash
./target/run/askk terminal
```

With a service running for the same home the terminal talks to it; with none, it runs the
engines itself. Add `--to http://127.0.0.1:8090` to name the service to talk to, or a
question after `terminal` to ask once and leave. What is decided where:
[docs/decisions.md](docs/decisions.md).

To check a change before keeping it (tests, every build, then the built app is started and asked):

```bash
./scripts/check.sh
```

While developing, with rebuild on save:

```bash
dx serve --platform web
```

To run for a different platform, use the `--platform platform` flag. E.g.
```bash
dx serve --platform desktop
```


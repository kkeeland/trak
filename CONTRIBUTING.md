# Contributing to trak

Thanks for your interest in contributing! trak is built to be simple, fast, and AI-native.

## Development Setup

```bash
git clone https://github.com/kkeeland/trak.git
cd trak
npm install
npm run build
npm link          # Makes `trak` available globally
```

### Dev Workflow

```bash
npm run dev       # Watch mode — auto-rebuilds on changes
```

### Testing Changes

```bash
mkdir /tmp/trak-test && cd /tmp/trak-test
trak init
trak create "Test task" --project test -p 2
trak board
```

## Project Structure

```
src/
  cli.ts           # Command definitions (Commander.js)
  db.ts            # SQLite schema, queries, heat calculation
  utils.ts         # Colors, formatting helpers
  commands/        # One file per command
    create.ts
    board.ts
    ready.ts
    ...
```

## Guidelines

- **Keep it fast** — no network calls, no async where sync works
- **Keep it simple** — every feature should be justifiable
- **CLI-first** — output should be readable by both humans and agents
- **SQLite only** — no external databases, no cloud services

## Submitting a PR

1. Fork the repo
2. Create a branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Build and test (`npm run build && trak --help`)
5. Commit with a clear message
6. Open a PR

## Reporting Bugs

Use the [GitHub issue tracker](https://github.com/kkeeland/trak/issues). Include:
- What you expected
- What happened
- `trak --version` output
- Steps to reproduce

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

# Test Strategy

## Default validation

```bash
pnpm test
pnpm check
pnpm build
```

`pnpm test` is deliberately **offline and deterministic**. It uses no production database, Redis service, browser session, email service, or external provider. It covers the supported campaign-training safety policy, scheduling calculations, training context rendering, routing registration, and utility logic.

## Explicit external checks

```bash
pnpm test:integration
```

This command is **opt-in**. It requires a non-production test environment with the required credentials and may contact configured Supabase, Redis, Resend, DataForSEO, or SinByte services. Do not run it against production infrastructure.

## Legacy broad suite

```bash
pnpm test:legacy
```

This preserves the repository's pre-existing all-files test discovery for investigation while older tests are incrementally migrated. It may mix unit checks with database-dependent procedures and network probes, so it is not a release gate and should not be used by default.

## Adding tests

- Add deterministic unit/module-boundary tests to the default configuration.
- Add a test requiring credentials, a database, a queue, email delivery, browser automation, or a third-party API only to an explicit integration configuration.
- Mock boundaries in deterministic tests; never use production data to make a test pass.
- Keep `pnpm check` and `pnpm build` green before merging or deploying.

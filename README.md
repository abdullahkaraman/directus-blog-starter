# Directus Blog Starter

A production-oriented blog foundation built with Next.js 15, React 19, TypeScript, Tailwind CSS, and the Directus SDK.

## Features

- Dynamic pages and blog posts backed by Directus.
- Published-only public search.
- Draft preview protected by a dedicated secret.
- Opt-in Directus visual editing on authenticated preview routes.
- Dynamic forms and reusable content blocks.
- Optional authenticated writing and publishing editor.
- Sitemap generation, responsive navigation, and theme support.
- Generated TypeScript types for the Directus schema.
- Optional Telegram → Codex → Directus content-operations companion with project-owned profiles.

This repository contains only reusable defaults. Personal content, private editorial instructions, migration scripts,
source connectors, and site-specific SEO tooling belong in the application built on top of it.

## Requirements

- Node.js 22 or newer.
- pnpm 10 or newer.
- A Directus 12 project and a local admin token for the initial schema setup.

## Setup

Install dependencies and create the local environment file:

```bash
pnpm install
cp .env.example .env
```

Configure the environment:

```env
NEXT_PUBLIC_DIRECTUS_URL=http://localhost:8055
DIRECTUS_SERVER_TOKEN=replace_with_a_least_privilege_runtime_token
DRAFT_PREVIEW_SECRET=replace_with_a_long_random_preview_secret
DIRECTUS_ADMIN_TOKEN=replace_with_a_local_type_generation_token
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENABLE_PUBLIC_WRITE=false
NEXT_PUBLIC_ENABLE_VISUAL_EDITING=false
WRITE_ACCESS_USERNAME=writer
WRITE_ACCESS_PASSWORD=replace_with_at_least_16_random_characters
```

`DIRECTUS_SERVER_TOKEN` is server-only and must never be exposed to browser code. Grant it only the permissions the
runtime needs. `DIRECTUS_ADMIN_TOKEN` is used only by local schema and type-generation commands and should not be
configured in the deployed application.

`DRAFT_PREVIEW_SECRET` must be different from every Directus token. Configure the Directus preview URL to send this
value as the `token` query parameter:

```text
https://your-site.example/api/draft?slug={{slug}}&token=YOUR_PREVIEW_SECRET
```

If the preview secret is missing, draft preview remains disabled.

Visual editing is disabled by default. Set `NEXT_PUBLIC_ENABLE_VISUAL_EDITING=true` only when Directus is configured to
open an authenticated `/preview/*` route. The visual-editing browser package is dynamically loaded on preview routes;
public content routes do not load it. Generic Directus pages can use:

```text
https://your-site.example/preview{{permalink}}?token=YOUR_PREVIEW_SECRET
```

## Directus Schema Setup

The starter includes a sanitized Directus schema snapshot at `directus/snapshot.json`. It contains the collections,
fields, and relations required by the application, but no content records, credentials, roles, permissions, or personal
AI configuration.

First inspect the changes against your Directus project:

    pnpm directus:setup

This command is a dry run and never changes Directus. Use it with a new, dedicated Directus project for the starter.
Apply the reported diff explicitly:

    pnpm directus:setup:apply

If the target already has unrelated collections or fields, the diff can contain deletions. `directus:setup:apply`
refuses such a diff by default. Only after reviewing a backup of a project that you own should you explicitly use
`pnpm directus:setup -- --apply --allow-destructive`.

Both commands read `NEXT_PUBLIC_DIRECTUS_URL` and `DIRECTUS_ADMIN_TOKEN` from `.env`. Use the admin token only on your
local machine, remove it after setup if it is no longer needed, and never add it to a deployment.

After intentionally changing the schema, an administrator can refresh the committed snapshot:

    pnpm directus:schema:pull

The pull command applies the same sanitization rules before writing the file. Review the resulting diff before
committing it. The snapshot provisions structure only; configure public/runtime permissions and add initial singleton
content in Directus separately.

## Optional Writing Editor

The starter includes a protected `/write` editor. It is disabled by default and returns `404` until explicitly enabled:

```env
ENABLE_PUBLIC_WRITE=true
WRITE_ACCESS_USERNAME=writer
WRITE_ACCESS_PASSWORD=replace_with_at_least_16_random_characters
```

The password must contain at least 16 characters. When enabled, middleware requires HTTP Basic authentication and the
publishing server action verifies the same credentials again before creating a Directus post. The runtime Directus token
must have `posts.create` permission for publishing to succeed.

Keep the editor disabled when it is not needed. Do not use a Directus token or preview secret as the write password.
Enable it only on an HTTPS deployment because HTTP Basic credentials are sent with each authenticated request.

## Development

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Optional Content Operations

The `automation/` directory is a separately deployed, disabled-by-default companion. It accepts authorized Telegram
commands through n8n, runs Codex in an isolated read-only environment, validates structured output, and writes a
Directus draft. Publishing always requires an explicit owner command.

Each fork owns its content profile in `automation/worker/templates/`. `profile.json` configures publication identity,
language, validation thresholds, taxonomy, Directus collection and field mapping, and public/preview paths. The files
beside it define project-specific prompts and schemas. A restaurant discovery project should replace the article
profile with its own evidence connectors and review schema instead of teaching the default article worker to scrape.

This companion does not start with the Next.js application and is not required for normal starter use. See
[`automation/README.md`](automation/README.md) for deployment, least-privilege permissions, Telegram commands,
operations, and backup guidance.

## Commands

```bash
pnpm dev
pnpm build
pnpm check:public-bundle
pnpm content-ops:test
pnpm content-ops:audit
pnpm start
pnpm test
pnpm generate:types
pnpm directus:setup
pnpm directus:setup:apply
pnpm directus:schema:pull
pnpm lint
pnpm format
```

Run `pnpm generate:types` after changing the Directus schema. The command reads `NEXT_PUBLIC_DIRECTUS_URL` and
`DIRECTUS_ADMIN_TOKEN` from `.env`. Run `pnpm directus:setup` before applying schema changes so the diff can be reviewed
first.

## Security Defaults

- Public search explicitly filters pages and posts to `status = published`.
- Draft preview uses a dedicated secret instead of the Directus runtime token.
- Directus SDK, preview authentication, sanitization, and form mutation modules are protected by server-only boundaries.
- Form submissions reload the active form fields on the server instead of trusting field identifiers supplied by the browser.
- Sensitive environment files, build output, and dependencies are ignored by Git.
- Common secret and CMS probe paths are rejected by middleware.
- The optional publishing route is disabled by default, protected by Basic Auth, and re-authorized in its server action.
- Schema setup is dry-run by default, rejects deletions without an explicit acknowledgement, and strips private AI and
  credential-management fields from pulled snapshots.

## Project Structure

```text
src/app        Next.js routes and API handlers
src/components Shared UI, layout, form, and content-block components
src/lib        Directus access and application utilities
src/styles     Global styles
directus       Sanitized, versioned Directus schema snapshot
scripts        Local schema and type-generation utilities
src/types      Generated Directus schema types
tests          Focused security and query tests
public         Static assets
automation     Optional profile-driven content operations companion
```

## License

MIT

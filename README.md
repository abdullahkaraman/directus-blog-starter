# Directus Blog Starter

A production-oriented blog foundation built with Next.js 15, React 19, TypeScript, Tailwind CSS, and the Directus SDK.

## Features

- Dynamic pages and blog posts backed by Directus.
- Published-only public search.
- Draft preview protected by a dedicated secret.
- Directus visual editing support.
- Dynamic forms and reusable content blocks.
- Optional authenticated writing and publishing editor.
- Sitemap generation, responsive navigation, and theme support.
- Generated TypeScript types for the Directus schema.

This repository contains only the reusable starter. Personal content, migration scripts, editorial automation, and
site-specific SEO tooling belong in the application built on top of it.

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

## Commands

```bash
pnpm dev
pnpm build
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
```

## License

MIT

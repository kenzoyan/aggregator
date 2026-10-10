# Project Agent Instructions

## Repository scope

Keep the GitHub repository focused on application source code, tests, `README.md`, this file, dependency manifests, and required build or deployment configuration.

Product discussions, research notes, architecture journals, raw screenshots, personal portfolio data, imports, exports, local databases, credentials, and working logs stay local and untracked unless the owner explicitly requests otherwise.

## Development workflow

1. Implement and test changes locally.
2. Show or summarize the tested result for the owner.
3. Commit and push only after the owner asks to publish the milestone or confirms the result.
4. Stage explicit paths; never upload unrelated local files.

## Real model API tests

- Run relevant backend API evaluations for Agent, prompt, tool or multimodal changes; do not use browser automation for this.
- Owner authorizes up to 12 API requests and US$0.10 estimated cost per verification run without another confirmation. Include main-model requests, research requests and retries.
- Report scenario count, user turns, actual API requests and estimated cost. Pause and ask before exceeding the gate or using a model whose price is unknown. Do not reset the gate to bypass a limit.
- Use synthetic images and disposable databases. Never confirm imports or mutate the owner's portfolio for tests.
- Keep generated evaluation reports local and ignored. Costs are estimates from API usage, not invoices.

## Security

- Never commit API keys, passwords, MFA data, cookies, session tokens, or real financial records.
- Trading 212 access must remain read-only and be supplied through ignored local environment configuration.
- Screenshot imports must require user confirmation before changing portfolio state.
- Raw user screenshots and generated portfolio databases must never be used as repository fixtures. Use synthetic or fully redacted fixtures only.

## Product boundaries

This is a private, single-user investment monitoring application. It aggregates investment holdings and performance in EUR; it does not place trades or provide investment advice.

## UI scope

The current product target is desktop web. Do not proactively design, implement, or request acceptance for mobile layouts unless the owner asks for mobile support.

## Communication with the owner

- Use ASD-STE100-inspired clarity for explanations, without claiming strict compliance with the English standard. Prefer short sentences, one idea at a time, common words, active voice, and consistent terms.
- Lead with the answer or result. Explain necessary technical terms in plain language when first used, and add a small concrete example when it helps.
- Match the owner's language. Keep exact code identifiers, commands, numbers, and material caveats; clarity must not change the facts.
- Accept the owner's input in natural language. Do not require the owner to follow a writing standard.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

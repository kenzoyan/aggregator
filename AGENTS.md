# Project Agent Instructions

## Repository scope

Keep the GitHub repository focused on application source code, tests, `README.md`, this file, dependency manifests, and required build or deployment configuration.

Product discussions, research notes, architecture journals, raw screenshots, personal portfolio data, imports, exports, local databases, credentials, and working logs stay local and untracked unless the owner explicitly requests otherwise.

## Development workflow

1. Implement and test changes locally.
2. Show or summarize the tested result for the owner.
3. Commit and push only after the owner asks to publish the milestone or confirms the result.
4. Stage explicit paths; never upload unrelated local files.

## Security

- Never commit API keys, passwords, MFA data, cookies, session tokens, or real financial records.
- Trading 212 access must remain read-only and be supplied through ignored local environment configuration.
- Screenshot imports must require user confirmation before changing portfolio state.
- Raw user screenshots and generated portfolio databases must never be used as repository fixtures. Use synthetic or fully redacted fixtures only.

## Product boundaries

This is a private, single-user investment monitoring application. It aggregates investment holdings and performance in EUR; it does not place trades or provide investment advice.

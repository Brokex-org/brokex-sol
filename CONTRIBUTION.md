# Contributing

## Getting Started

Clone the repository and set up your local environment:

```bash
git clone <repo-link>
cd brokex-solana
```

Install dependencies:

```bash
yarn install
```

Fill in the required values in `.env`.

---

## Branch Strategy

| Branch         | Purpose                                      |
| -------------- | -------------------------------------------- |
| `main`         | Production — audited and reviewed code only  |
| `next-release` | Development — all PRs target this branch     |

---

## Workflow

**1. Switch to the development branch**

```bash
git checkout next-release
git pull origin next-release  # always pull latest before branching
```

**2. Create your feature branch**

```bash
git checkout -b feat/your-feature-name
```

**3. Make your changes, then push**

```bash
git add .
git commit -m "feat: describe what you did"
git push origin feat/your-feature-name
```

**4. Open a Pull Request**

- Base branch must be **`next-release`** — never target `main` directly
- Write a clear PR description explaining what changed and why
- Reference the related GitHub issue (e.g. `#4`)

**5. Review & Merge**

- At least **one approval** is required before merging
- Only reviewed and approved code gets merged into `next-release`
- Merges from `next-release` → `main` are done by the team lead only

---

## Ground Rules

- **Always branch off `next-release`**, never off `main`
- **One feature per branch** — keeps PRs focused and easier to review
- **Never force push** to `next-release` or `main`
- Make sure `anchor build` passes locally before opening a PR
- Keep commit messages descriptive and consistent with the convention above

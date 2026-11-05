# Maintaining the custom credential login

This fork adds **username or email + password** login (with user management) on top of
[`rmyndharis/OpenWA`](https://github.com/rmyndharis/OpenWA). Upstream has no `users` table, no
`POST /api/auth/login`, and no dashboard credential form. Upstream therefore cannot "keep" this
feature for us: every upstream update has to be merged around it.

This document is the procedure for doing that. The short version: **never take upstream's auth or
login files wholesale**, resolve the conflicts listed below, and run the two regression tests before
you push.

## What is custom

| Area                | Files                                                                                          | What must survive                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Public login route  | `src/modules/auth/auth-login.controller.ts`                                                    | `@Public() @Post('login')` on `@Controller('auth')`                                                                   |
| User management     | `src/modules/auth/users.controller.ts`                                                         | `GET/POST/PUT/DELETE /auth/users`, unscoped ADMIN only                                                                |
| Wiring              | `src/modules/auth/auth.module.ts`                                                              | `User` in `TypeOrmModule.forFeature([ApiKey, User], 'main')`, both controllers mounted                                |
| Service             | `src/modules/auth/auth.service.ts`                                                             | `login()`, `createUser()`, `findAllUsers()`, `findUser()`, `updateUser()`, `deleteUser()`, `ensureDefaultAdminUser()` |
| Passwords           | `src/modules/auth/password-hash.ts`                                                            | scrypt hash/verify (`scrypt$<salt>$<key>`)                                                                            |
| Data                | `src/modules/auth/entities/user.entity.ts`, `src/modules/auth/entities/api-key.entity.ts`      | `users` entity, `api_keys.userId`                                                                                     |
| Migration           | `src/database/migrations-main/1792000000000-CreateUsersAndApiKeyOwner.ts`                      | `users` table + `api_keys.userId` + indexes                                                                           |
| API-key integration | `src/modules/auth/auth.controller.ts`                                                          | login-issued keys hidden with `.filter(k => !k.userId)`                                                               |
| Audit               | `src/modules/audit/entities/audit-log.entity.ts`                                               | `USER_LOGIN`, `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`                                                          |
| Public-route spec   | `src/config/swagger.config.ts`, `src/config/swagger.config.spec.ts`                            | `/api/auth/login` in `PUBLIC_PATHS` and its drift guard                                                               |
| Dashboard           | `dashboard/src/pages/Login.tsx`, `dashboard/src/i18n/locales/*.json`                           | credential form, `/auth/login` fetch, `usernameOrEmail` / `password` labels                                           |
| Config              | `.env.example`, `docker-compose.yml`, `docker-compose.dev.yml`, `src/config/env-precedence.ts` | `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `USER_SESSION_TTL_DAYS`                                            |
| Contract            | `openapi.json`                                                                                 | `/api/auth/login`, `/api/auth/users`, `/api/auth/users/{id}`                                                          |
| Docs                | `README.md`, `docs/04-security-design.md`                                                      | first-boot sign-in and the credential design                                                                          |
| Tests               | `src/modules/auth/custom-login-merge-guard.spec.ts`, `test/custom-login.e2e-spec.ts`           | structural guard + real HTTP login proof                                                                              |

The guard spec pins the list above. If a merge removes one of these markers, it fails with the file
and marker that vanished, so a half-resolved conflict cannot reach `main` unnoticed.

## Non-negotiable rules

- Do **not** run `git reset --hard upstream/main`.
- Do **not** run `git checkout upstream/main -- .` or `git checkout --theirs .`.
- Do **not** run `git merge -X theirs upstream/main`; that silently discards the custom side.
- Do **not** delete or rename the custom migration. It has already run on deployed databases.
- Do **not** "clean up" the optional `@InjectRepository(User, 'main')` parameter in `AuthService`.
  It is optional only so upstream's API-key unit tests can construct the service; the module always
  supplies it at runtime.
- Keep the custom commits as a contiguous series on top of `upstream/main`. Do not squash them into
  upstream commits; that makes the next conflict impossible to identify.

## One-time setup

```bash
git remote add upstream https://github.com/rmyndharis/OpenWA.git   # if it is missing
git fetch upstream --prune
```

Keep a moving tag of the last known-good custom head, and a backup branch before every update:

```bash
git tag -f custom-login-good main
git switch -c backup/custom-login-$(date +%Y%m%d) main
```

`git rerere` is worth enabling if you resolve these conflicts repeatedly:

```bash
git config rerere.enabled true
```

## Update procedure (merge)

Merge is preferred over rebase: the merge commit records how a conflict was resolved, and the next
update can reuse that decision. Use a dedicated branch so a bad resolution never lands on `main`.

```bash
git switch main
git status                                  # must be clean
git fetch upstream --prune
git switch -c update/upstream-$(date +%Y%m%d) main
git merge --no-ff upstream/main
```

Resolve the conflicts with the table below. Then run the gates:

```bash
# The structural merge guard: fails if any custom surface disappeared.
npx jest src/modules/auth/custom-login-merge-guard.spec.ts --runInBand

# The behavioural proof through the real HTTP stack.
npx jest --config test/jest-e2e.json test/custom-login.e2e-spec.ts --runInBand

# The API-key/auth suites that the custom service changes touch.
npx jest src/modules/auth --runInBand

# The dashboard credential form.
(cd dashboard && npm run test:unit)

# Type/build gates.
npm run build
(cd dashboard && npm run typecheck)
```

Regenerate the published contract if upstream changed any route, DTO or decorator:

```bash
npm run openapi:export
npm run openapi:check
```

Finally, boot once and sign in through the real UI or with curl:

```bash
curl -s -X POST http://localhost:2785/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin","password":"<the password from the first-boot log>"}'
```

A `200` with `apiKey` proves routing, the users table, the scrypt check and key minting in one call.
Then merge the update branch, re-tag, and push:

```bash
git switch main
git merge --no-ff update/upstream-$(date +%Y%m%d)
git tag -f custom-login-good main
git push origin main --tags
```

## Conflict resolution by file

### `src/modules/auth/auth.module.ts`

Take upstream's module changes, then re-add:

- `import { User } from './entities/user.entity';`
- `import { AuthLoginController } from './auth-login.controller';`
- `import { UsersController } from './users.controller';`
- `TypeOrmModule.forFeature([ApiKey, User], 'main')`
- `AuthLoginController` and `UsersController` in `controllers`.

### `src/modules/auth/auth.service.ts`

This is the conflict that matters most. Upstream keeps changing the API-key half of this service.
Keep the custom user half, and re-apply upstream's API-key changes around it:

- Keep the optional `userRepository` constructor parameter and its `@InjectRepository(User, 'main')`
  decorator. If upstream adds a constructor parameter, keep the order that Nest resolves and leave
  the optional user repository last.
- Keep `login()`, `createUser()`, `findAllUsers()`, `findUser()`, `updateUser()`, `deleteUser()`,
  `ensureDefaultAdminUser()`, and the `ensureDefaultAdminUser()` call inside `onModuleInit()`.
- Keep the `revokeUserLoginKeys()` behavior on password/role/status changes and account deletion.
- Re-apply upstream's changes to `createApiKey()`, `validateApiKey()`, the guard/index wiring and the
  bootstrap-key banner. Do not copy the whole custom file over upstream's: you would revert those.
- Keep the `hashPassword()` / `verifyPassword()` calls; upstream's service does not import them.

### `src/modules/auth/auth.controller.ts`

Keep `.filter(k => !k.userId)` in `findAll()`. Without it, login-issued session keys leak into API-key
management and an operator can manage or revoke a session as if it were a credential.

### `src/modules/auth/entities/api-key.entity.ts`

Keep the nullable `userId` column and its index. The migration and `revokeUserLoginKeys()` depend on it.

### `src/modules/audit/entities/audit-log.entity.ts`

Keep `USER_LOGIN`, `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`. The controllers write these rows;
removing the enum values breaks the audit writes at runtime.

### `src/database/migrations-main/1792000000000-CreateUsersAndApiKeyOwner.ts`

Keep the file, its class name and its timestamp. Do not renumber it: deployed databases already
record that migration as run. If upstream adds a migration before it, the ordering is still fine as
long as the custom migration's `up()` remains idempotent (it is).

### `src/config/swagger.config.ts` and `src/config/swagger.config.spec.ts`

Keep `'/api/auth/login'` in `PUBLIC_PATHS` and in the drift guard's expected list, plus the
`auth-login.controller.ts` entry in `EXPECTED_PUBLIC_CONTROLLERS`. If upstream adds new public
routes, keep both sides in sync.

### Dashboard

- `dashboard/src/pages/Login.tsx`: keep the identifier/password fields and the
  `POST ${API_BASE_URL}/auth/login` call. If upstream changes the API-key login UI, keep both paths:
  an API key must still work, and a credential response must still mint a key.
- `dashboard/src/i18n/locales/*.json`: keep the `login.usernameOrEmail`,
  `login.usernameOrEmailPlaceholder`, `login.usernameOrEmailRequired`, `login.password`,
  `login.passwordPlaceholder`, `login.passwordRequired` and `login.invalidCredentials` keys in every
  locale. The guard checks all locale files.
- `dashboard/src/utils/authLifecycle.ts` and `dashboard/src/App.test.ts`: keep the credential
  response handling. A non-key response must not be stored as an API key.

### Config and compose

Keep the four knobs in `.env.example`, `docker-compose.yml`, `docker-compose.dev.yml` and
`src/config/env-precedence.ts`:

- `ADMIN_USERNAME` (default `admin`)
- `ADMIN_EMAIL` (default `admin@openwa.local`)
- `ADMIN_PASSWORD` (generated and printed once when unset)
- `USER_SESSION_TTL_DAYS` (default `30`; `0` disables expiry)

They are read only while the `users` table is empty, so changing them later does not reset an
existing account.

### `openapi.json`

Do not hand-merge this 1 MB generated file. Resolve it by regenerating after the code merge:

```bash
npm run openapi:export
```

If `npm run openapi:check` reports a diff, the code and the committed spec disagree; fix the code or
commit the regenerated spec, do not edit around it.

## What the guard does not cover

The guard is a structural tripwire, not a substitute for review. It cannot prove that a merged
`auth.service.ts` still behaves correctly, which is why the e2e suite is part of the procedure. It
also cannot protect itself from a `git reset --hard` or a `checkout --theirs`; that is why those
commands are banned above.

If upstream ever adds its own credential login, do not keep two implementations. Compare the two,
adopt upstream's data model if it is compatible, and port the custom migration and dashboard flow to
it in a dedicated branch. The guard then has to be updated deliberately, not deleted.

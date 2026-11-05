// Regression guard for this fork's username/email + password login.
//
// Upstream (rmyndharis/OpenWA) has no `users` table, no `POST /api/auth/login`, and no dashboard
// credential form. A merge or rebase that takes upstream's auth files wholesale deletes the whole
// feature without breaking a single behavioural test: the API-key login still works, so the suite
// stays green while the dashboard is locked out.
//
// This spec pins every file the feature needs. It is deliberately a structural check rather than
// another service test: the failure mode is a merge that removes or rewires the surface, and the
// error names the file and marker that vanished. `MAINTAINING-CUSTOM-LOGIN.md` describes the
// conflict-resolution procedure that goes with it.
import 'reflect-metadata';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AuthLoginController } from './auth-login.controller';
import { UsersController } from './users.controller';
import { PUBLIC_KEY, UNSCOPED_KEY } from './decorators/auth.decorators';

type Marker = string | RegExp;

interface Surface {
  /** Path relative to the repository root. */
  file: string;
  markers: Marker[];
  /** Why the file matters, appended to a failure so the resolver knows what to keep. */
  why: string;
}

export const CUSTOM_LOGIN_SURFACES: Surface[] = [
  {
    file: 'src/modules/auth/auth-login.controller.ts',
    why: 'the public credential login route',
    markers: [
      "@Controller('auth')",
      "@Post('login')",
      '@Public()',
      'LoginDto',
      'this.authService.login(dto.identifier.trim(), dto.password)',
    ],
  },
  {
    file: 'src/modules/auth/users.controller.ts',
    why: 'user management for the credential accounts',
    markers: [
      "@Controller('auth/users')",
      '@RequireUnscopedKey()',
      '@RequireRole(ApiKeyRole.ADMIN)',
      'async create(',
      'async findAll(',
      'async findOne(',
      'async update(',
      'async delete(',
      'this.authService.createUser(dto)',
    ],
  },
  {
    file: 'src/modules/auth/auth.module.ts',
    why: 'the login and user controllers must be mounted, with the User repository',
    markers: [
      "import { User } from './entities/user.entity';",
      "import { AuthLoginController } from './auth-login.controller';",
      "import { UsersController } from './users.controller';",
      "TypeOrmModule.forFeature([ApiKey, User], 'main')",
      /controllers:\s*\[[^\]]*AuthLoginController[^\]]*\]/,
      /controllers:\s*\[[^\]]*UsersController[^\]]*\]/,
    ],
  },
  {
    file: 'src/modules/auth/auth.service.ts',
    why: 'the credential exchange and user lifecycle behind the routes',
    markers: [
      'private readonly userRepository?: Repository<User>',
      'async login(identifier: string, password: string)',
      'async createUser(dto: CreateUserDto)',
      'async findAllUsers()',
      'async findUser(id: string)',
      'async updateUser(id: string, dto: UpdateUserDto)',
      'async deleteUser(id: string)',
      'private async ensureDefaultAdminUser(',
      'hashPassword(',
      'verifyPassword(',
    ],
  },
  {
    file: 'src/modules/auth/password-hash.ts',
    why: 'passwords are stored as one-way scrypt hashes',
    markers: [
      'scrypt',
      'timingSafeEqual',
      'export async function hashPassword',
      'export async function verifyPassword',
    ],
  },
  {
    file: 'src/modules/auth/entities/user.entity.ts',
    why: 'the users table mapping',
    markers: ["@Entity('users')", 'passwordHash', 'username', 'email'],
  },
  {
    file: 'src/modules/auth/entities/api-key.entity.ts',
    why: 'a login-issued key is tied to its account so it can be revoked with the account',
    markers: ['userId'],
  },
  {
    file: 'src/modules/auth/auth.controller.ts',
    why: 'login-issued session keys must stay out of API-key management',
    markers: ['.filter(k => !k.userId)'],
  },
  {
    file: 'src/modules/audit/entities/audit-log.entity.ts',
    why: 'credential logins and user changes are auditable',
    markers: ['USER_LOGIN', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED'],
  },
  {
    file: 'src/database/migrations-main/1792000000000-CreateUsersAndApiKeyOwner.ts',
    why: 'the migration that adds users and api_keys.userId',
    markers: [
      'export class CreateUsersAndApiKeyOwner',
      'CREATE TABLE IF NOT EXISTS "users"',
      'ADD COLUMN "userId"',
      'DROP TABLE IF EXISTS "users"',
    ],
  },
  {
    file: 'src/config/env-precedence.ts',
    why: 'the first-boot admin credentials and session lifetime are documented env keys',
    markers: ["'ADMIN_USERNAME'", "'ADMIN_EMAIL'", "'ADMIN_PASSWORD'", "'USER_SESSION_TTL_DAYS'"],
  },
  {
    file: 'src/config/swagger.config.ts',
    why: 'the public login route must stay out of the global API-key requirement in the spec',
    markers: ["'/api/auth/login'"],
  },
  {
    file: 'src/config/swagger.config.spec.ts',
    why: 'the public-route drift guard must keep expecting the login controller and route',
    markers: ["'/api/auth/login'", "'src/modules/auth/auth-login.controller.ts'"],
  },
  {
    file: 'src/database/main-connection.spec.ts',
    why: 'the main schema must keep the api_keys.userId index',
    markers: ["['keyHash', 'userId']"],
  },
  {
    file: 'dashboard/src/pages/Login.tsx',
    why: 'the dashboard must keep offering a credential form, not only an API key',
    markers: [
      '/auth/login',
      'identifier',
      "type={showPassword ? 'text' : 'password'}",
      'autoComplete="current-password"',
      'login.passwordRequired',
    ],
  },
  {
    file: '.env.example',
    why: 'operators need the first-boot account and session knobs',
    markers: ['ADMIN_USERNAME=', 'ADMIN_EMAIL=', 'ADMIN_PASSWORD=', 'USER_SESSION_TTL_DAYS='],
  },
  {
    file: 'docker-compose.yml',
    why: 'the container must pass the credential knobs through',
    markers: [
      'ADMIN_USERNAME=${ADMIN_USERNAME:-}',
      'ADMIN_EMAIL=${ADMIN_EMAIL:-}',
      'ADMIN_PASSWORD=${ADMIN_PASSWORD:-}',
      'USER_SESSION_TTL_DAYS=${USER_SESSION_TTL_DAYS:-}',
    ],
  },
  {
    file: 'docker-compose.dev.yml',
    why: 'the dev container must pass the credential knobs through too',
    markers: [
      'ADMIN_USERNAME=${ADMIN_USERNAME:-}',
      'ADMIN_EMAIL=${ADMIN_EMAIL:-}',
      'ADMIN_PASSWORD=${ADMIN_PASSWORD:-}',
      'USER_SESSION_TTL_DAYS=${USER_SESSION_TTL_DAYS:-}',
    ],
  },
  {
    file: 'openapi.json',
    why: 'the published contract must keep the login and user routes',
    markers: ['"/api/auth/login"', '"/api/auth/users"', '"/api/auth/users/{id}"'],
  },
  {
    file: 'docs/04-security-design.md',
    why: 'the security design must keep describing the credential login',
    markers: ['### Dashboard Login', 'POST /api/auth/login', 'auth/users', 'USER_SESSION_TTL_DAYS'],
  },
  {
    file: 'README.md',
    why: 'operators must be told to sign in with the first-boot account',
    markers: ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'Sign in'],
  },
];

function hasMarker(source: string, marker: Marker): boolean {
  return typeof marker === 'string' ? source.includes(marker) : marker.test(source);
}

/**
 * Return one line per surface that lost a marker. `read` is injectable so the guard's own failure
 * path can be tested without touching the checkout.
 */
export function missingCustomLoginMarkers(surfaces: Surface[], read: (file: string) => string): string[] {
  return surfaces.flatMap(({ file, markers, why }) => {
    let source: string;
    try {
      source = read(file);
    } catch {
      return [`${file}: file is missing (${why})`];
    }
    return markers
      .filter(marker => !hasMarker(source, marker))
      .map(marker => `${file}: missing ${String(marker)} (${why})`);
  });
}

describe('custom username/email + password login survives upstream merges', () => {
  const root = join(__dirname, '..', '..', '..');
  const read = (file: string): string => readFileSync(join(root, file), 'utf8');

  it('the guard can actually fail when a marker disappears', () => {
    const surfaces: Surface[] = [{ file: 'kept.ts', markers: ['kept', 'lost'], why: 'the self-test surface' }];
    const missing = missingCustomLoginMarkers(surfaces, file => (file === 'kept.ts' ? 'kept' : ''));
    expect(missing).toEqual(['kept.ts: missing lost (the self-test surface)']);
  });

  it('the guard reports a deleted file rather than throwing', () => {
    const surfaces: Surface[] = [{ file: 'gone.ts', markers: ['anything'], why: 'the self-test surface' }];
    expect(
      missingCustomLoginMarkers(surfaces, () => {
        throw new Error('ENOENT');
      }),
    ).toEqual(['gone.ts: file is missing (the self-test surface)']);
  });

  it('keeps every custom login surface in place', () => {
    expect(missingCustomLoginMarkers(CUSTOM_LOGIN_SURFACES, read)).toEqual([]);
  });

  it('keeps the credential labels in every dashboard locale', () => {
    const localesDir = join(root, 'dashboard', 'src', 'i18n', 'locales');
    const markers = ['"usernameOrEmail"', '"usernameOrEmailPlaceholder"', '"passwordRequired"', '"invalidCredentials"'];
    const missing = readdirSync(localesDir)
      .filter(file => file.endsWith('.json'))
      .flatMap(file => {
        const source = readFileSync(join(localesDir, file), 'utf8');
        return markers.filter(marker => !source.includes(marker)).map(marker => `${file}: missing ${marker}`);
      });
    expect(missing).toEqual([]);
  });

  it('keeps POST /auth/login public and POST /auth/users unscoped-admin-only at runtime', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AuthLoginController)).toBe('auth');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading route metadata, not invoking
    const login = AuthLoginController.prototype.login;
    expect(Reflect.getMetadata(PATH_METADATA, login)).toBe('login');
    expect(Reflect.getMetadata(METHOD_METADATA, login)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PUBLIC_KEY, login)).toBe(true);

    expect(Reflect.getMetadata(PATH_METADATA, UsersController)).toBe('auth/users');
    expect(Reflect.getMetadata(UNSCOPED_KEY, UsersController)).toBe(true);
  });
});

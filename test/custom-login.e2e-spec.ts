import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { applyGlobalValidation } from './../src/config/app-validation';
import { AuthService } from './../src/modules/auth/auth.service';
import { ApiKeyRole } from './../src/modules/auth/entities/api-key.entity';

/**
 * End-to-end proof of this fork's username/email + password login through the real HTTP stack:
 * routing, the public-route fence, DTO validation, the users table, the scrypt check and the
 * minted session key. The merge guard in
 * `src/modules/auth/custom-login-merge-guard.spec.ts` pins the files; this suite proves the files
 * still work together, which is the failure a merge that only half-resolves a conflict produces.
 */
describe('Custom credential login (e2e)', () => {
  const username = 'merge-guard-user';
  const email = 'merge-guard@openwa.local';
  const password = 'correct horse battery staple';
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    applyGlobalValidation(app);
    await app.init();

    await app.get(AuthService).createUser({
      username,
      email,
      password,
      role: ApiKeyRole.OPERATOR,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exchanges a username and password for a usable API key', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: username, password })
      .expect(200);

    const body = login.body as { apiKey?: string; role?: string; scoped?: boolean };
    expect(typeof body.apiKey).toBe('string');
    expect(body.role).toBe(ApiKeyRole.OPERATOR);
    expect(body.scoped).toBe(false);

    const validated = await request(app.getHttpServer())
      .post('/api/auth/validate')
      .set('X-API-Key', body.apiKey as string)
      .expect(200);
    expect(validated.body).toMatchObject({ valid: true, role: ApiKeyRole.OPERATOR });
  });

  it('accepts the email, case-insensitively, as the identifier', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: email.toUpperCase(), password })
      .expect(200);
  });

  it('refuses a wrong password with the same 401 as an unknown account', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: username, password: 'not the right password' })
      .expect(401);
    expect(wrongPassword.body).toMatchObject({ message: 'Invalid username or password' });

    const unknownAccount = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'no-such-account', password })
      .expect(401);
    expect(unknownAccount.body).toMatchObject({ message: 'Invalid username or password' });
  });
});

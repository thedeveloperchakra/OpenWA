import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import type { User } from './entities/user.entity';
import { hashPassword, verifyPassword } from './password-hash';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  username: 'admin',
  email: 'admin@openwa.local',
  passwordHash: '',
  role: ApiKeyRole.ADMIN,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('AuthService user login', () => {
  const usageTracker = { forget: jest.fn() };
  const keyIndex = { refreshSoon: jest.fn() };
  const moduleRef = { get: jest.fn().mockReturnValue(null) };
  let users: jest.Mocked<Partial<Repository<User>>>;
  let keys: jest.Mocked<Partial<Repository<ApiKey>>>;
  let service: AuthService;

  beforeEach(() => {
    usageTracker.forget.mockClear();
    keyIndex.refreshSoon.mockClear();
    users = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      find: jest.fn(),
    };
    const execute = jest.fn();
    execute.mockResolvedValue({});
    const builder = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute,
    };
    keys = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
    };
    (keys.create as jest.Mock).mockImplementation((value: ApiKey): ApiKey => value);
    (keys.save as jest.Mock).mockImplementation((value: ApiKey): Promise<ApiKey> =>
      Promise.resolve({ ...value, id: 'k1' }),
    );
    service = new AuthService(
      keys as unknown as Repository<ApiKey>,
      usageTracker as never,
      moduleRef as never,
      keyIndex as never,
      users as unknown as Repository<User>,
    );
  });

  it('exchanges a case-insensitive username for an account-owned, expiring key', async () => {
    (users.findOne as jest.Mock).mockResolvedValue(user({ passwordHash: await hashPassword('correct horse') }));

    const result = await service.login('  ADMIN ', 'correct horse');

    expect(users.findOne).toHaveBeenCalledWith({ where: [{ username: 'admin' }, { email: 'admin' }] });
    const updateCalls = (users.update as unknown as { mock: { calls: Array<[unknown, { lastLoginAt: Date }]> } }).mock
      .calls;
    expect(updateCalls[0][1].lastLoginAt).toBeInstanceOf(Date);
    expect(result.rawKey).toMatch(/^owa_k1_[a-f0-9]{64}$/);
    expect(result.apiKey.userId).toBe('u1');
    expect(result.apiKey.role).toBe(ApiKeyRole.ADMIN);
    expect(result.apiKey.expiresAt).toBeInstanceOf(Date);
    expect(keyIndex.refreshSoon).toHaveBeenCalled();
  });

  it('answers the same 401 for an unknown account and a wrong password', async () => {
    (users.findOne as jest.Mock).mockResolvedValue(null);
    await expect(service.login('missing', 'secret')).rejects.toThrow('Invalid username or password');

    (users.findOne as jest.Mock).mockResolvedValue(user({ passwordHash: await hashPassword('right') }));
    await expect(service.login('admin', 'wrong')).rejects.toThrow(UnauthorizedException);
  });

  it('refuses an inactive account even with the right password', async () => {
    (users.findOne as jest.Mock).mockResolvedValue(
      user({ passwordHash: await hashPassword('secret'), isActive: false }),
    );
    await expect(service.login('admin', 'secret')).rejects.toThrow('Account is disabled');
  });

  it('normalizes and hashes a new account, refusing a duplicate username or email', async () => {
    (users.findOne as jest.Mock).mockResolvedValue(null);
    (users.create as jest.Mock).mockImplementation(value => value as User);
    (users.save as jest.Mock).mockImplementation((value: User): Promise<User> =>
      Promise.resolve({ ...value, id: 'u2' }),
    );

    const created = await service.createUser({
      username: ' Jane ',
      email: ' JANE@Example.com ',
      password: 'correct horse battery staple',
    });

    expect(created.username).toBe('jane');
    expect(created.email).toBe('jane@example.com');
    expect(await verifyPassword('correct horse battery staple', created.passwordHash)).toBe(true);

    (users.findOne as jest.Mock).mockResolvedValue(user({ username: 'jane' }));
    await expect(
      service.createUser({ username: 'jane', email: 'other@example.com', password: 'correct horse' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to delete the last active admin account', async () => {
    const admin = user();
    (users.findOne as jest.Mock).mockResolvedValue(admin);
    (users.count as jest.Mock).mockResolvedValue(1);

    await expect(service.deleteUser(admin.id)).rejects.toThrow('Cannot delete the last active admin user');
    expect(users.delete).not.toHaveBeenCalled();
  });

  it("revokes an account's login keys when its password changes", async () => {
    (users.findOne as jest.Mock).mockResolvedValueOnce(user()).mockResolvedValueOnce(user({ username: 'renamed' }));
    (keys.find as jest.Mock).mockResolvedValue([{ id: 'k1' } as ApiKey]);

    await service.updateUser('u1', { password: 'a new correct horse' });

    const updateCalls = (users.update as unknown as { mock: { calls: Array<[unknown, { passwordHash: string }]> } })
      .mock.calls;
    expect(updateCalls[0][1].passwordHash).toMatch(/^scrypt\$/);
    expect(keys.delete).toHaveBeenCalledWith({ userId: 'u1' });
    expect(usageTracker.forget).toHaveBeenCalledWith('k1');
  });
});

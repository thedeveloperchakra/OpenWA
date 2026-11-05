import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds named login accounts (`users`) and links a login-issued API key to the account that owns it
 * (`api_keys.userId`). API keys created through the key-management API keep a NULL userId, so they
 * stay visible and manageable exactly as before; keys minted by `POST /auth/login` are tied to a
 * user and can be reaped when that user is disabled or deleted.
 *
 * Runs on the **main** connection (always SQLite). Idempotent: the table and index use IF NOT
 * EXISTS, and the column is probed before the ALTER, so a file previously built by synchronize is
 * adopted safely.
 */
export class CreateUsersAndApiKeyOwner1792000000000 implements MigrationInterface {
  name = 'CreateUsersAndApiKeyOwner1792000000000';

  private async hasColumn(queryRunner: QueryRunner, table: string, name: string): Promise<boolean> {
    if (queryRunner.connection.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = '${name}'`,
      )) as unknown[];
      return rows.length > 0;
    }
    const rows = (await queryRunner.query(`PRAGMA table_info("${table}")`)) as Array<{ name: string }>;
    return rows.some(r => r.name === name);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "users" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"username" varchar(50) NOT NULL, ` +
        `"email" varchar(255) NOT NULL, ` +
        `"passwordHash" varchar(255) NOT NULL, ` +
        `"role" varchar(20) NOT NULL DEFAULT ('operator'), ` +
        `"isActive" boolean NOT NULL DEFAULT (1), ` +
        `"lastLoginAt" datetime, ` +
        `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
        `"updatedAt" datetime NOT NULL DEFAULT (datetime('now'))` +
        `)`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_fe0bb3f6520ee0469504521e71" ON "users" ("username")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email")`);

    if (!(await this.hasColumn(queryRunner, 'api_keys', 'userId'))) {
      await queryRunner.query(`ALTER TABLE "api_keys" ADD COLUMN "userId" varchar(36) NULL`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_6c2e267ae764a9413b863a2934" ON "api_keys" ("userId")`);
    // TypeORM's generated names are used so a file built by synchronize holds the same index under
    // the same name, and the schema-drift gate sees no rename to emit.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_api_keys_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_username"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_6c2e267ae764a9413b863a2934"`);
    if (await this.hasColumn(queryRunner, 'api_keys', 'userId')) {
      await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "userId"`);
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_97672ac88f789774dd47f7c8be"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fe0bb3f6520ee0469504521e71"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}

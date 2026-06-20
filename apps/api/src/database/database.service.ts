import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

// owns the single pg connection pool. query() + withTransaction()
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const connectionString = this.config.get<string>('DATABASE_URL');
    this.pool = new Pool({
      connectionString,
      // enough for load tests, under pg default max_connections (100)
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    this.pool.on('error', (err) => {
      // background client error (network blip) - log, don't crash
      this.logger.error(`Unexpected idle client error: ${err.message}`);
    });

    this.logger.log('Postgres pool initialized');
  }

  async onModuleDestroy() {
    await this.pool?.end();
    this.logger.log('Postgres pool closed');
  }

  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const result = await this.pool.query(text, params);
    return result.rows as T[];
  }

  // run fn in one txn. throws -> rollback. used for atomic debit+credit
  async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      // always return the connection to the pool
      client.release();
    }
  }
}

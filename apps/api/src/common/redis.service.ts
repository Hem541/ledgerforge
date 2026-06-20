import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// owns the redis connection. idempotency fast path + response cache
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      maxRetriesPerRequest: 3,
    });
    this.client.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
    this.client.on('connect', () => this.logger.log('Redis connected'));
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  // atomic claim. true = first to set (proceed), false = already exists (dup)
  // SET NX is atomic; GET-then-SET would race two concurrent requests
  async claimIdempotencyKey(
    key: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    // NX = set only if absent, EX = ttl
    const result = await this.client.set(
      `idem:${key}`,
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  // store response body so a dup gets served the same response
  async storeIdempotentResponse(
    key: string,
    response: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(
      `idemresp:${key}`,
      JSON.stringify(response),
      'EX',
      ttlSeconds,
    );
  }

  async getIdempotentResponse<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.client.get(`idemresp:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  // release a claim so the client can retry safely after a failure
  async releaseIdempotencyKey(key: string): Promise<void> {
    await this.client.del(`idem:${key}`);
  }

  getClient(): Redis {
    return this.client;
  }
}

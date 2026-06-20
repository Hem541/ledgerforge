import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../common/redis.service';

// GET /health - liveness + pg/redis status. used by docker healthcheck / LB
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const result: Record<string, string> = {
      status: 'ok',
      db: 'unknown',
      redis: 'unknown',
    };

    try {
      await this.db.query('SELECT 1');
      result.db = 'up';
    } catch {
      result.db = 'down';
      result.status = 'degraded';
    }

    try {
      await this.redis.getClient().ping();
      result.redis = 'up';
    } catch {
      result.redis = 'down';
      result.status = 'degraded';
    }

    return result;
  }
}

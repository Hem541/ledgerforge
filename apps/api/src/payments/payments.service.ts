import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../common/redis.service';
import { LedgerService } from '../ledger/ledger.service';
import { WebhookService } from '../webhooks/webhook.service';
import { CreatePaymentDto, PaymentResponse } from './dto';

// payment submission orchestrator
// redis claim -> atomic pg write (txn + ledger + audit) -> cache response -> webhook
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly idempotencyTtl: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerService,
    private readonly webhooks: WebhookService,
    private readonly config: ConfigService,
  ) {
    this.idempotencyTtl = this.config.get<number>(
      'IDEMPOTENCY_TTL_SECONDS',
      86_400,
    );
  }

  async createPayment(
    idempotencyKey: string,
    dto: CreatePaymentDto,
  ): Promise<PaymentResponse> {
    this.validate(idempotencyKey, dto);

    const currency = dto.currency ?? 'USD';

    // redis fast path
    const claimed = await this.redis.claimIdempotencyKey(
      idempotencyKey,
      this.idempotencyTtl,
    );

    if (!claimed) {
      // dup. serve original if finished, else 409
      const cached = await this.redis.getIdempotentResponse<PaymentResponse>(
        idempotencyKey,
      );
      if (cached) {
        this.logger.log(
          `Idempotent replay for key ${idempotencyKey} -> txn ${cached.id}`,
        );
        return { ...cached, idempotent_replay: true };
      }
      // original still in flight, no cached response yet
      throw new ConflictException(
        'A request with this Idempotency-Key is already being processed',
      );
    }

    // atomic write
    let response: PaymentResponse;
    try {
      response = await this.db.withTransaction(async (client) => {
        // txn row. UNIQUE(idempotency_key) is the db safety net
        const { rows } = await client.query(
          `INSERT INTO transactions (idempotency_key, amount, currency, status, metadata)
           VALUES ($1, $2, $3, 'pending', $4)
           RETURNING id`,
          [idempotencyKey, dto.amount, currency, dto.metadata ?? {}],
        );
        const txnId: string = rows[0].id;

        // double-entry posting
        const lines = this.ledger.buildPaymentPosting(dto.amount);
        await this.ledger.postEntries(client, txnId, lines, currency);

        await client.query(
          `UPDATE transactions SET status = 'completed', updated_at = now()
           WHERE id = $1`,
          [txnId],
        );

        // audit row
        await client.query(
          `INSERT INTO audit_log (entity_type, entity_id, action, detail)
           VALUES ('transaction', $1, 'created', $2)`,
          [txnId, JSON.stringify({ amount: dto.amount, currency })],
        );

        return {
          id: txnId,
          status: 'completed',
          amount: dto.amount,
          currency,
        };
      });
    } catch (err: any) {
      // failed -> release claim so client can retry
      await this.redis.releaseIdempotencyKey(idempotencyKey);

      // 23505 = unique_violation: dup raced past redis, treat as conflict not 500
      if (err?.code === '23505') {
        throw new ConflictException(
          'Duplicate payment: this Idempotency-Key was already used',
        );
      }
      this.logger.error(`Payment processing failed: ${err.message}`);
      throw err;
    }

    // cache for future dups
    await this.redis.storeIdempotentResponse(
      idempotencyKey,
      response,
      this.idempotencyTtl,
    );

    // webhook after commit + cache. failure here must not roll back the payment
    try {
      await this.webhooks.createEvent(response.id, 'payment.succeeded', {
        amount: response.amount,
        currency: response.currency,
      });
    } catch (err: any) {
      this.logger.warn(
        `Payment ${response.id} succeeded but webhook enqueue failed: ${err.message}`,
      );
    }

    this.logger.log(
      `Payment ${response.id} completed (${response.amount} ${response.currency})`,
    );
    return response;
  }

  // single txn lookup for GET / dashboard
  async getPayment(id: string): Promise<PaymentResponse | null> {
    const rows = await this.db.query<{
      id: string;
      status: string;
      amount: string;
      currency: string;
    }>(
      `SELECT id, status, amount, currency FROM transactions WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      status: r.status,
      amount: Number(r.amount),
      currency: r.currency,
    };
  }

  // recent txns for dashboard
  async listPayments(limit = 50): Promise<PaymentResponse[]> {
    const rows = await this.db.query<{
      id: string;
      status: string;
      amount: string;
      currency: string;
    }>(
      `SELECT id, status, amount, currency
         FROM transactions
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      amount: Number(r.amount),
      currency: r.currency,
    }));
  }

  private validate(idempotencyKey: string, dto: CreatePaymentDto): void {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (
      dto.amount === undefined ||
      !Number.isInteger(dto.amount) ||
      dto.amount <= 0
    ) {
      throw new BadRequestException(
        'amount must be a positive integer (cents)',
      );
    }
    if (dto.currency && !/^[A-Z]{3}$/.test(dto.currency)) {
      throw new BadRequestException('currency must be a 3-letter ISO code');
    }
  }
}

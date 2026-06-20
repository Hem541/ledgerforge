import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../common/redis.service';
import { LedgerService } from '../ledger/ledger.service';
import { WebhookService } from '../webhooks/webhook.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const claimIdempotencyKey = jest.fn();
  const getIdempotentResponse = jest.fn();
  const storeIdempotentResponse = jest.fn();
  const releaseIdempotencyKey = jest.fn();
  const withTransaction = jest.fn();
  const query = jest.fn();
  const createEvent = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    // Webhook enqueue defaults to succeeding; tests don't assert on it.
    createEvent.mockResolvedValue('wh-1');

    const dbMock = { withTransaction, query };
    const redisMock = {
      claimIdempotencyKey,
      getIdempotentResponse,
      storeIdempotentResponse,
      releaseIdempotencyKey,
    };
    const webhookMock = { createEvent };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        LedgerService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: RedisService, useValue: redisMock },
        { provide: WebhookService, useValue: webhookMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d: any) => d },
        },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('processes a first-time payment and caches the response', async () => {
    claimIdempotencyKey.mockResolvedValue(true);
    withTransaction.mockResolvedValue({
      id: 'txn-1',
      status: 'completed',
      amount: 5000,
      currency: 'USD',
    });

    const res = await service.createPayment('key-1', { amount: 5000 });

    expect(res.id).toBe('txn-1');
    expect(res.status).toBe('completed');
    expect(storeIdempotentResponse).toHaveBeenCalledWith(
      'key-1',
      expect.objectContaining({ id: 'txn-1' }),
      expect.any(Number),
    );
    // A completed payment should enqueue a webhook.
    expect(createEvent).toHaveBeenCalledWith(
      'txn-1',
      'payment.succeeded',
      expect.objectContaining({ amount: 5000 }),
    );
  });

  it('replays the cached response for a duplicate request', async () => {
    claimIdempotencyKey.mockResolvedValue(false);
    getIdempotentResponse.mockResolvedValue({
      id: 'txn-1',
      status: 'completed',
      amount: 5000,
      currency: 'USD',
    });

    const res = await service.createPayment('key-1', { amount: 5000 });

    expect(res.id).toBe('txn-1');
    expect(res.idempotent_replay).toBe(true);
    expect(withTransaction).not.toHaveBeenCalled();
    // No new webhook on a replay.
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('returns 409 when the original request is still in flight', async () => {
    claimIdempotencyKey.mockResolvedValue(false);
    getIdempotentResponse.mockResolvedValue(null);

    await expect(
      service.createPayment('key-1', { amount: 5000 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('maps a DB unique-violation (race past Redis) to 409 and releases the key', async () => {
    claimIdempotencyKey.mockResolvedValue(true);
    const uniqueViolation: any = new Error('duplicate key');
    uniqueViolation.code = '23505';
    withTransaction.mockRejectedValue(uniqueViolation);

    await expect(
      service.createPayment('key-1', { amount: 5000 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(releaseIdempotencyKey).toHaveBeenCalledWith('key-1');
  });

  it('rejects a non-positive amount before any side effect', async () => {
    await expect(
      service.createPayment('key-1', { amount: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(claimIdempotencyKey).not.toHaveBeenCalled();
  });

  it('rejects a missing idempotency key', async () => {
    await expect(
      service.createPayment('', { amount: 5000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

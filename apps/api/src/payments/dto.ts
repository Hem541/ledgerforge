// POST /payments request body. validated by hand in the service
export interface CreatePaymentDto {
  amount: number; // cents, positive int
  currency?: string; // iso code, defaults USD
  metadata?: Record<string, unknown>;
}

export interface PaymentResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
  idempotent_replay?: boolean; // true if served from idempotency cache
}

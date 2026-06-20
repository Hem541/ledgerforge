import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  NotFoundException,
  HttpCode,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, PaymentResponse } from './dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // 201 new txn, or original response on dup (idempotent_replay), or 409
  @Post()
  @HttpCode(201)
  async create(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: CreatePaymentDto,
  ): Promise<PaymentResponse> {
    return this.payments.createPayment(idempotencyKey, body);
  }

  // declared before ':id' so 'payments' isn't captured as an id
  @Get()
  async list(): Promise<PaymentResponse[]> {
    return this.payments.listPayments();
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<PaymentResponse> {
    const payment = await this.payments.getPayment(id);
    if (!payment) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return payment;
  }
}

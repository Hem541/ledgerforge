import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Strip unknown properties from request bodies app-wide.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Allow the Next.js dashboard (different port) to call the API in dev.
  app.enableCors({ origin: true });

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`LedgerForge API listening on :${port}`);
}
bootstrap();

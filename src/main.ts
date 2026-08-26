import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as cors from 'cors';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Phase 7: POD signature/photo travel as base64 text inside a JSON body
  // (src/delivery/dto/capture-pod.dto.ts caps each field at ~2MB decoded) - well past
  // Express's ~100kb default JSON limit, so it's raised here via Nest v11's body-parser
  // override API rather than reaching for a separate multipart/upload pipeline.
  app.useBodyParser('json', { limit: '6mb' });

  // Security
  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'], // 5173: React dev server (Vite), added alongside the frontend build
    credentials: true,
  }));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle("Jacky's Service Portal API")
    .setDescription('Field-Service-First Service Management System API')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT-auth',
    )
    .addTag('auth', 'Authentication & Authorization')
    .addTag('master-data', 'Master Data Management')
    .addTag('appointments', 'Appointment Scheduling')
    .addTag('technician', 'Technician Mobile API')
    .addTag('job-cards', 'Job Card Management')
    .addTag('estimates', 'Estimate Management')
    .addTag('workshop', 'Workshop Operations')
    .addTag('inventory', 'Inventory & Spare Parts')
    .addTag('delivery', 'Delivery & Logistics')
    .addTag('finance', 'Finance & Invoicing')
    .addTag('amc', 'AMC Management')
    .addTag('dismantling', 'Dismantling & Component Recovery')
    .addTag('notifications', 'Notifications')
    .addTag('reports', 'Reports & Dashboards')
    .addTag('customer-portal', 'Customer Portal')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Application running on: http://localhost:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap();
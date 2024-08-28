import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 获取端口号，默认使用 3000
  const port = process.env.SERVER_PORT || 3000;
  await app.listen(port);
}
bootstrap();

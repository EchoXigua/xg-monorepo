import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import * as cors from 'cors';
import { ValidationPipe } from '@nestjs/common';

import { ErrorHandle } from './common/errorHandle';
import { ResCommon } from './common/resCommon';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 获取端口号，默认使用 3000
  const port = process.env.SERVER_PORT || 3000;

  app.use(cors());
  //全局错误处理
  app.useGlobalFilters(new ErrorHandle());
  //全局拦截器处理
  app.useGlobalInterceptors(new ResCommon());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, //过滤掉多余的参数
      // forbidNonWhitelisted: true, //不允许传多余的参数
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  await app.listen(port);
}
bootstrap();

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';

let envFilePath = ['.env'];
export const IS_DEV = process.env.RUNNING_ENV !== 'prod';

envFilePath.unshift(`.env.${process.env.RUNNING_ENV}`);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      //提供env的路径
      envFilePath,
    }),
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

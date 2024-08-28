import { Injectable, NestInterceptor, CallHandler } from '@nestjs/common';
import { map } from 'rxjs/operators';

@Injectable()
export class ResCommon implements NestInterceptor {
  intercept(context: any, next: CallHandler) {
    return next.handle().pipe(
      map((item) => {
        return {
          result: item,
          status: 200,
          message: '响应成功',
          success: true,
        };
      }),
    );
  }
}

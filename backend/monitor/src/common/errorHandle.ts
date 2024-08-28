import { ExceptionFilter, HttpException, ArgumentsHost } from '@nestjs/common';

import { Request, Response } from 'express';

export class ErrorHandle implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const status = (exception.getStatus && exception.getStatus()) || 500;
    const errMsg =
      (exception.getResponse &&
      (exception.getResponse() as { message: string[] }).message.length > 0
        ? (exception.getResponse() as { message: string[] }).message
        : exception.message) || exception.message;
    res.status(200).json({
      success: false,
      time: new Date().getTime(),
      message: errMsg,
      code: status,
      path: req.url,
    });
  }
}

import { Type } from 'class-transformer';
import { IsOptional, IsPositive } from 'class-validator';

export class PaginationQueryDto {
  //将类型转化为number，网络传输中parmas query 都将作为字符串传输
  //这里可以自动转为我们想要的类型
  @IsOptional()
  @IsPositive() //值为正数
  @Type(() => Number)
  pageSize: number;

  //我们这样手动添加转换类型有些麻烦，可以通过全局的管道来帮我们进行类型转换
  //transformOptions: 中的 enableImplicitConversion true
  //这样我们就可以不再使用 Type装饰器先显示指定类型

  // @IsOptional()
  // @IsPositive()
  // @Type(() => Number)
  // offset: number;

  @IsOptional()
  @IsPositive()
  @Type(() => Number)
  current: number;
}

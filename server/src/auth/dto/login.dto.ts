import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin', description: '用户名' })
  @IsString()
  @MinLength(1)
  username!: string;

  @ApiProperty({ example: 'oceanus123', description: '密码' })
  @IsString()
  @MinLength(1)
  password!: string;
}

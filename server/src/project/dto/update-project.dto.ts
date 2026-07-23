import { IsString, IsOptional, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProjectDto {
  @ApiProperty({ example: '新项目名称', description: '项目名称', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiProperty({ example: '更新后的备注', description: '备注', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

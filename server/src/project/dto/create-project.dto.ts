import { IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: '新产品需求讨论', description: '项目名称' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'Q3 核心功能需求分析', description: '备注（可选）', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

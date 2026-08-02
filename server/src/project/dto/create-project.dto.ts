import { IsString, MinLength, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: '项目 A', description: '项目名称' })
  @IsString()
  @MinLength(1)
  displayName!: string;

  @ApiProperty({ example: 'project-a', description: '英文标识（小写字母/数字/-/_）' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, { message: 'projectName 仅允许小写字母、数字、-、_' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  projectName!: string;

  @ApiProperty({ example: 'Q3 核心功能需求分析', description: '备注（可选）', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

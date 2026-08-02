import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

describe('CreateProjectDto', () => {
  it('projectName 大写/混合大小写输入归一为小写', () => {
    const dto = plainToInstance(CreateProjectDto, {
      displayName: '项目',
      projectName: 'Project-A',
      description: '描述',
    });

    expect(dto.projectName).toBe('project-a');
  });

  it('合法 projectName 校验通过', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      displayName: '项目',
      projectName: 'project-a',
      description: '描述',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('非法 projectName（含非小写字符）校验失败', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      displayName: '项目',
      projectName: '项目名称',
      description: '描述',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'projectName')).toBe(true);
  });
});

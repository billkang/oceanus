import 'reflect-metadata';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

describe('ProjectController', () => {
  let controller: ProjectController;
  let projectService: ProjectService;

  /** 模拟 JwtAuthGuard 挂载的 req.user */
  const req = (username: string) => ({ user: { id: 1, username } }) as never;

  const mockProjectService = {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        { provide: ProjectService, useValue: mockProjectService },
        { provide: JwtService, useValue: { verify: vi.fn() } },
      ],
    }).compile();

    controller = module.get<ProjectController>(ProjectController);
    projectService = module.get<ProjectService>(ProjectService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /projects', () => {
    it('按当前用户过滤成员项目', async () => {
      mockProjectService.list.mockResolvedValue([]);

      const result = await controller.list(req('admin'));

      expect(result).toEqual([]);
      expect(projectService.list).toHaveBeenCalledWith('admin');
    });
  });

  describe('POST /projects', () => {
    it('创建项目并传当前用户为 owner', async () => {
      const dto: CreateProjectDto = { displayName: '新项目', projectName: 'project-a', description: '描述' };
      const expected = { id: 3, displayName: '新项目', projectName: 'project-a', sessionCount: 0 };
      mockProjectService.create.mockResolvedValue(expected);

      const result = await controller.create(dto, req('admin'));

      expect(result).toEqual(expected);
      expect(projectService.create).toHaveBeenCalledWith(dto, 'admin');
    });
  });

  describe('GET /projects/:projectName', () => {
    it('按 projectName 返回项目详情', async () => {
      const expected = { id: 1, projectName: 'project-a', displayName: '项目A', sessionCount: 3 };
      mockProjectService.getById.mockResolvedValue(expected);

      const result = await controller.getById('project-a', req('admin'));

      expect(result).toEqual(expected);
      expect(projectService.getById).toHaveBeenCalledWith('project-a', 'admin');
    });
  });

  describe('PATCH /projects/:projectName', () => {
    it('按 projectName 编辑（owner-only）', async () => {
      const dto: UpdateProjectDto = { displayName: '新名称' };
      const expected = { id: 1, projectName: 'project-a', displayName: '新名称', sessionCount: 3 };
      mockProjectService.update.mockResolvedValue(expected);

      const result = await controller.update('project-a', dto, req('admin'));

      expect(result).toEqual(expected);
      expect(projectService.update).toHaveBeenCalledWith('project-a', 'admin', dto);
    });
  });

  describe('DELETE /projects/:projectName', () => {
    it('按 projectName 删除并返回 success', async () => {
      mockProjectService.delete.mockResolvedValue(undefined);

      const result = await controller.delete('project-a', req('admin'));

      expect(result).toEqual({ success: true });
      expect(projectService.delete).toHaveBeenCalledWith('project-a', 'admin');
    });
  });

  describe('装饰器元数据（regression: import type 会擦除 design:paramtypes）', () => {
    /**
     * 回归测试：DTO 必须用 value import 引入，否则 emitDecoratorMetadata
     * 无法把真实类写入 design:paramtypes，@Body() 的 metatype 退化为 Function，
     * ValidationPipe(whitelist+forbidNonWhitelisted) 会把所有字段判为
     * "property X should not exist"（见 Task 10 的 400 bug）。
     */
    it('create 的第一个参数元数据必须是 CreateProjectDto', () => {
      const types = Reflect.getMetadata('design:paramtypes', ProjectController.prototype, 'create');
      expect(types).toBeDefined();
      expect(types[0]).toBe(CreateProjectDto);
    });

    it('update 的第二个参数元数据必须是 UpdateProjectDto', () => {
      const types = Reflect.getMetadata('design:paramtypes', ProjectController.prototype, 'update');
      expect(types).toBeDefined();
      expect(types[1]).toBe(UpdateProjectDto);
    });
  });
});

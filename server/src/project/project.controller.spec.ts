import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

describe('ProjectController', () => {
  let controller: ProjectController;
  let projectService: ProjectService;

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
    it('应返回项目列表', async () => {
      const expected = [
        { id: 1, uuid: 'u1', name: '项目A', sessionCount: 3 },
        { id: 2, uuid: 'u2', name: '项目B', sessionCount: 0 },
      ];
      mockProjectService.list.mockResolvedValue(expected);

      const result = await controller.list();

      expect(result).toEqual(expected);
      expect(projectService.list).toHaveBeenCalled();
    });
  });

  describe('POST /projects', () => {
    it('应创建项目', async () => {
      const dto: CreateProjectDto = { name: '新项目', description: '描述' };
      const expected = { id: 3, uuid: 'u3', name: '新项目', sessionCount: 0 };
      mockProjectService.create.mockResolvedValue(expected);

      const result = await controller.create(dto);

      expect(result).toEqual(expected);
      expect(projectService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('GET /projects/:id', () => {
    it('应返回项目详情', async () => {
      const expected = { id: 1, uuid: 'u1', name: '项目A', sessionCount: 3 };
      mockProjectService.getById.mockResolvedValue(expected);

      const result = await controller.getById(1);

      expect(result).toEqual(expected);
      expect(projectService.getById).toHaveBeenCalledWith(1);
    });
  });

  describe('PATCH /projects/:id', () => {
    it('应更新项目', async () => {
      const dto: UpdateProjectDto = { name: '新名称' };
      const expected = { id: 1, uuid: 'u1', name: '新名称', sessionCount: 3 };
      mockProjectService.update.mockResolvedValue(expected);

      const result = await controller.update(1, dto);

      expect(result).toEqual(expected);
      expect(projectService.update).toHaveBeenCalledWith(1, dto);
    });
  });

  describe('DELETE /projects/:id', () => {
    it('应删除项目', async () => {
      mockProjectService.delete.mockResolvedValue(undefined);

      const result = await controller.delete(1);

      expect(result).toBeUndefined();
      expect(projectService.delete).toHaveBeenCalledWith(1);
    });
  });
});

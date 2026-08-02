import { ChangeDetectionStrategy, Component, inject, signal, type OnInit } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { Button } from 'primeng/button';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Skeleton } from 'primeng/skeleton';
import { NotificationService } from '../notifications/notification.service';
import { formatRelativeTime } from '../utils/date';
import type { Project } from './project.service';
import { ProjectService } from './project.service';

@Component({
  selector: 'app-project-list',
  imports: [Button, Dialog, InputText, Skeleton, ConfirmDialog, FormField],
  standalone: true,
  templateUrl: './project-list.component.html',
  providers: [ConfirmationService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectListComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly notificationService = inject(NotificationService);
  readonly projects = signal<(Project & { sessionCount: number })[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly showCreateDialog = signal(false);
  readonly createModel = signal({ displayName: '', projectName: '', description: '' });
  readonly createForm = form(this.createModel);
  readonly creating = signal(false);
  readonly createError = signal('');
  readonly showEditDialog = signal(false);
  readonly editTarget = signal<Project | null>(null);
  readonly editModel = signal({ displayName: '', description: '' });
  readonly editForm = form(this.editModel);
  readonly saving = signal(false);
  readonly editError = signal('');

  protected readonly formatRelativeTime = formatRelativeTime;

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.loading.set(true);
    this.error.set('');

    this.projectService.list().subscribe({
      next: (data) => {
        this.projects.set(data as (Project & { sessionCount: number })[]);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('加载项目列表失败，请稍后重试');
        this.loading.set(false);
      },
    });
  }

  openCreateDialog(): void {
    this.showCreateDialog.set(true);
    this.createModel.set({ displayName: '', projectName: '', description: '' });
    this.createError.set('');
  }

  closeCreateDialog(): void {
    this.showCreateDialog.set(false);
  }

  createProject(): void {
    const { displayName, projectName, description } = this.createModel();
    if (!displayName.trim()) {
      this.createError.set('请输入项目名称');
      return;
    }
    if (!projectName.trim() || !/^[a-z0-9][a-z0-9_-]*$/.test(projectName.trim())) {
      this.createError.set('projectName 仅允许小写字母、数字、-、_');
      return;
    }
    if (this.creating()) return;

    this.creating.set(true);
    this.projectService
      .create({
        displayName: displayName.trim(),
        projectName: projectName.trim(),
        description: description.trim() || undefined,
      })
      .subscribe({
        next: (project) => {
          this.creating.set(false);
          this.showCreateDialog.set(false);
          this.router.navigateByUrl(`/workspace/${project.projectName}`);
        },
        error: () => {
          this.creating.set(false);
          this.createError.set('创建项目失败，请重试');
        },
      });
  }

  deleteProject(projectName: string, event: Event): void {
    event.stopPropagation();
    const project = this.projects().find(p => p.projectName === projectName);
    this.confirmationService.confirm({
      message: `确定要删除项目「${project?.displayName}」吗？
删除后将同时移除该项目下的所有会话和文件，此操作不可撤销。`,
      header: '删除项目',
      acceptLabel: '确认删除',
      rejectLabel: '取消',
      acceptIcon: 'pi pi-exclamation-triangle',
      rejectButtonStyleClass: 'btn-secondary !rounded-xl !px-4',
      acceptButtonStyleClass:
        '!rounded-xl !px-4 !bg-gradient-to-r !from-red-500 !to-rose-500 '
        + '!border-0 hover:!from-red-400 hover:!to-rose-400 !shadow-lg !shadow-red-500/20',
      accept: () => {
        this.projectService.delete(projectName).subscribe({
          next: () => {
            this.projects.update(list => list.filter(p => p.projectName !== projectName));
            this.notificationService.success('项目已删除');
          },
          error: () => {
            this.notificationService.error('删除失败', '删除项目时出现错误，请稍后重试');
          },
        });
      },
    });
  }

  editProject(project: Project, event: Event): void {
    event.stopPropagation();
    this.editTarget.set(project);
    this.editModel.set({ displayName: project.displayName, description: project.description || '' });
    this.editError.set('');
    this.showEditDialog.set(true);
  }

  closeEditDialog(): void {
    this.showEditDialog.set(false);
    this.editTarget.set(null);
  }

  saveEditProject(): void {
    const target = this.editTarget();
    if (!target) return;
    const { displayName, description } = this.editModel();
    if (!displayName.trim()) {
      this.editError.set('请输入项目名称');
      return;
    }
    if (this.saving()) return;

    this.saving.set(true);
    this.projectService
      .update(target.projectName, { displayName: displayName.trim(), description: description.trim() || undefined })
      .subscribe({
        next: () => {
          this.projects.update(list => list.map(p => p.id === target.id
            ? { ...p, displayName: displayName.trim(), description: description.trim() || '' }
            : p),
          );
          this.saving.set(false);
          this.closeEditDialog();
          this.notificationService.success('项目已更新');
        },
        error: () => {
          this.saving.set(false);
          this.notificationService.error('更新失败', '更新项目时出现错误，请稍后重试');
        },
      });
  }

  enterProject(projectName: string): void {
    this.router.navigateByUrl(`/workspace/${projectName}`);
  }
}

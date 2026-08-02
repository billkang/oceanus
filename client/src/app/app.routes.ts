import type { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./main-layout/main-layout.component').then(m => m.MainLayoutComponent),
    children: [
      {
        path: 'projects',
        loadComponent: () => import('./project/project-list.component').then(m => m.ProjectListComponent),
      },
      {
        path: 'agents',
        loadComponent: () => import('./agent/agent-marketplace.component').then(m => m.AgentMarketplaceComponent),
      },
      {
        path: 'agents/:id',
        loadComponent: () => import('./agent/agent-detail.component').then(m => m.AgentDetailComponent),
      },
      {
        path: 'skills',
        loadComponent: () => import('./skill/skill-marketplace.component').then(m => m.SkillMarketplaceComponent),
      },
      {
        path: 'skills/:id',
        loadComponent: () => import('./skill/skill-detail.component').then(m => m.SkillDetailComponent),
      },
    ],
  },
  {
    path: 'workspace/:projectName',
    canActivate: [authGuard],
    loadComponent: () => import('./workspace/workspace.component').then(m => m.WorkspaceComponent),
  },
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full',
  },
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found.component').then(m => m.NotFoundComponent),
  },
];

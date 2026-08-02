import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('admin123', 10);

  // 测试账号：displayName 必填
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { displayName: '管理员', active: true },
    create: {
      username: 'admin',
      password,
      displayName: '管理员',
      active: true,
    },
  });

  // 示例项目：projectName 必填 + 自动 owner member
  // projectName 非唯一键（app 层保证唯一），用 findFirst + create 保持幂等；
  // 排除软删记录，避免复用同名软删项目后与「软删可复用同名」的 app 语义冲突
  let project = await prisma.project.findFirst({ where: { projectName: 'project-a', deletedAt: null } });
  project =
    project ??
    (await prisma.project.create({
      data: {
        projectName: 'project-a',
        displayName: '项目 A',
        description: '示例项目',
      },
    }));

  await prisma.projectMember.upsert({
    where: { projectId_username: { projectId: project.id, username: admin.username } },
    update: { role: 'owner' },
    create: { projectId: project.id, username: admin.username, role: 'owner' },
  });

  console.log(`Seed done: ${admin.username} (${admin.displayName}), project ${project.projectName}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

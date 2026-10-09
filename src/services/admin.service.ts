import { Prisma, type UserRole } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import { toPublicUser } from "./auth.service";

type ListUsersInput = { search?: string; page: number; pageSize: number };

type UpdateUserInput = {
  name?: string;
  username?: string;
  role?: UserRole;
  emailVerified?: boolean;
  birthDate?: Date | null;
};

export async function listUsers({ search, page, pageSize }: ListUsersInput) {
  const where: Prisma.UserWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { username: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count({ where }),
  ]);

  return { users: users.map(toPublicUser), total, page, pageSize };
}

export async function updateUser(id: string, adminId: string, data: UpdateUserInput) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError("Usuário não encontrado", 404);
  }

  // Evita que o site fique sem ninguém para administrar por engano
  if (id === adminId && data.role === "USER") {
    throw new AppError("Você não pode remover a sua própria função de administrador", 400);
  }

  if (data.username && data.username !== user.username) {
    const taken = await prisma.user.findUnique({ where: { username: data.username } });
    if (taken) {
      throw new AppError("Este @username já está em uso", 409);
    }
  }

  const { emailVerified, ...fields } = data;
  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...fields,
      // Só mexe na data se o estado realmente mudar (para não trocar a data de quem já confirmou)
      ...(emailVerified === true && !user.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
      ...(emailVerified === false ? { emailVerifiedAt: null } : {}),
    },
  });

  return toPublicUser(updated);
}

export async function deleteUser(id: string, adminId: string) {
  if (id === adminId) {
    throw new AppError("Você não pode remover a sua própria conta por aqui", 400);
  }

  try {
    await prisma.user.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") throw new AppError("Usuário não encontrado", 404);
    }
    throw error;
  }
}

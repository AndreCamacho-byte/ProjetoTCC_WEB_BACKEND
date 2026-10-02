import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError";
import { prisma } from "../lib/prisma";
import { toPublicUser } from "./auth.service";

type ProfileInput = { name?: string; username?: string };

// Configurações da própria conta (o que a pessoa logada pode mudar em si mesma)

export async function updateProfile(userId: string, data: ProfileInput) {
  if (data.username) {
    const taken = await prisma.user.findUnique({ where: { username: data.username } });
    if (taken && taken.id !== userId) {
      throw new AppError("Este @username já está em uso", 409);
    }
  }

  return toPublicUser(await prisma.user.update({ where: { id: userId }, data }));
}

// A data de nascimento só pode ser informada uma vez (depois, só um administrador altera).
// Se desse para trocar à vontade, a regra de idade mínima não valeria nada.
export async function setBirthDate(userId: string, birthDate: Date) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.birthDate) {
    throw new AppError("A data de nascimento já foi informada e não pode ser alterada", 409);
  }

  return toPublicUser(await prisma.user.update({ where: { id: userId }, data: { birthDate } }));
}

export async function setAvatar(userId: string, image: Buffer) {
  // O "?v=" muda a cada troca de foto, então o navegador pode guardar a imagem em cache sem mostrar a antiga
  const avatarUrl = `/api/users/${userId}/avatar?v=${Date.now()}`;
  const data = new Uint8Array(image); // formato que o Prisma aceita para colunas de bytes

  const [, user] = await prisma.$transaction([
    prisma.userAvatar.upsert({ where: { userId }, create: { userId, data }, update: { data } }),
    prisma.user.update({ where: { id: userId }, data: { avatarUrl } }),
  ]);

  return toPublicUser(user);
}

export async function removeAvatar(userId: string) {
  const [, user] = await prisma.$transaction([
    prisma.userAvatar.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } }),
  ]);

  return toPublicUser(user);
}

export async function getAvatar(userId: string) {
  const avatar = await prisma.userAvatar.findUnique({ where: { userId } });
  if (!avatar) {
    throw new AppError("Foto não encontrada", 404);
  }
  return Buffer.from(avatar.data);
}

// Excluir a conta pede a senha de novo, para ninguém apagar a conta de outra pessoa
// só por encontrar o computador ou o celular dela logado
export async function deleteAccount(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("Senha incorreta", 401, "WRONG_PASSWORD");
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    // Pedidos do marketplace não são apagados junto com a conta
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new AppError("Sua conta tem pedidos registrados e não pode ser excluída por aqui", 409);
    }
    throw error;
  }
}

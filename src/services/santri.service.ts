import { PrismaClient } from "@prisma/client";
import type { SantriPayload, SantriQuery, SantriUpdatePayload } from "../validations/santri.validation";

const prisma = new PrismaClient();

export class SantriService {
  async createSantri(payload: SantriPayload) {
    const duplicate = await prisma.santri.findUnique({ where: { nis: payload.nis } });
    if (duplicate) {
      throw new Error("NIS sudah terdaftar");
    }

    return prisma.santri.create({
      data: {
        userId: payload.userId,
        nis: payload.nis,
        namaLengkap: payload.namaLengkap,
        kamarId: payload.kamarId ?? null,
        tanggalLahir: payload.tanggalLahir,
        alamat: payload.alamat,
        statusAktif: payload.statusAktif ?? true
      }
    });
  }

  async getSantriList(query: SantriQuery) {
    const skip = (query.page - 1) * query.pageSize;
    const where = query.search
      ? {
          OR: [
            { namaLengkap: { contains: query.search, mode: "insensitive" as const } },
            { nis: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.santri.findMany({
        where,
        include: { kamar: true, user: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: query.pageSize
      }),
      prisma.santri.count({ where })
    ]);

    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async getSantriById(id: string) {
    return prisma.santri.findUnique({
      where: { id },
      include: { kamar: true, user: true }
    });
  }

  async updateSantri(id: string, payload: SantriUpdatePayload) {
    if (payload.nis) {
      const duplicate = await prisma.santri.findFirst({
        where: {
          nis: payload.nis,
          NOT: { id }
        }
      });
      if (duplicate) {
        throw new Error("NIS sudah terpakai oleh santri lain");
      }
    }

    return prisma.santri.update({
      where: { id },
      data: {
        ...payload,
        kamarId: payload.kamarId ?? undefined
      }
    });
  }

  async deactivateSantri(id: string) {
    return prisma.santri.update({
      where: { id },
      data: { statusAktif: false }
    });
  }
}

export const santriService = new SantriService();

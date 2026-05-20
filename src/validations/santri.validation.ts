import { z } from "zod";

const dateFromAny = z.preprocess((value) => {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed;
  }
  return value;
}, z.date({ required_error: "tanggalLahir wajib diisi" }));

export const santriPayloadSchema = z.object({
  userId: z.string().uuid("userId harus UUID valid"),
  nis: z.string().min(1, "NIS wajib diisi").max(32, "NIS terlalu panjang"),
  namaLengkap: z.string().min(3, "namaLengkap wajib diisi").max(150, "namaLengkap terlalu panjang"),
  kamarId: z.string().uuid("kamarId harus UUID valid").optional().nullable(),
  tanggalLahir: dateFromAny,
  alamat: z.string().min(5, "alamat wajib diisi").max(255, "alamat terlalu panjang"),
  statusAktif: z.boolean().optional()
});

export const santriUpdateSchema = santriPayloadSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: "Payload update tidak boleh kosong"
});

export const santriQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional()
});

export type SantriPayload = z.infer<typeof santriPayloadSchema>;
export type SantriUpdatePayload = z.infer<typeof santriUpdateSchema>;
export type SantriQuery = z.infer<typeof santriQuerySchema>;

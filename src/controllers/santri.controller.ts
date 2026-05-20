import type { Request, Response } from "express";
import { z } from "zod";
import { santriService } from "../services/santri.service";
import { santriPayloadSchema, santriQuerySchema, santriUpdateSchema } from "../validations/santri.validation";

const paramSchema = z.object({ id: z.string().uuid("id harus UUID valid") });

const handleError = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ ok: false, message: "Validasi gagal", errors: error.flatten() });
  }
  if (error instanceof Error && error.message.includes("NIS")) {
    return res.status(409).json({ ok: false, message: error.message });
  }
  return res.status(500).json({ ok: false, message: "Terjadi kesalahan server" });
};

export const santriController = {
  async createSantri(req: Request, res: Response) {
    try {
      const payload = santriPayloadSchema.parse(req.body);
      const data = await santriService.createSantri(payload);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  },

  async getSantriList(req: Request, res: Response) {
    try {
      const query = santriQuerySchema.parse(req.query);
      const data = await santriService.getSantriList(query);
      return res.status(200).json({ ok: true, ...data });
    } catch (error) {
      return handleError(res, error);
    }
  },

  async getSantriById(req: Request, res: Response) {
    try {
      const { id } = paramSchema.parse(req.params);
      const data = await santriService.getSantriById(id);
      if (!data) {
        return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });
      }
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  },

  async updateSantri(req: Request, res: Response) {
    try {
      const { id } = paramSchema.parse(req.params);
      const payload = santriUpdateSchema.parse(req.body);
      const data = await santriService.updateSantri(id, payload);
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  },

  async deactivateSantri(req: Request, res: Response) {
    try {
      const { id } = paramSchema.parse(req.params);
      const data = await santriService.deactivateSantri(id);
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  }
};

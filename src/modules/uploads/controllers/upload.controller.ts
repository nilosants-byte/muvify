import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../shared/errors/app-error";
import {
  InvalidFileContentError,
  UnsupportedMediaTypeError,
  UploadFolder,
  uploadMediaFromBuffer,
  uploadPrivateMediaFromBuffer
} from "../../../shared/services/storage.service";

export class UploadController {
  async uploadMedia(req: Request, res: Response) {
    const file = req.file;
    if (!file) {
      throw new AppError("Nenhum arquivo enviado.", StatusCodes.BAD_REQUEST);
    }
    const { folder } = req.body as { folder: UploadFolder };

    try {
      // Raio-X Muvify, Frente 1 (Autorização/IDOR), Lote 1: documento de
      // CREF é documento de identidade — nunca deve ir pro bucket público.
      // Grava privado e devolve a chave de armazenamento (não uma URL) no
      // mesmo campo "url" por compatibilidade — quem consome sabe que, pra
      // essa pasta, o valor é opaco e precisa ser assinado na exibição
      // (ver provider.service.ts::mapCredentialsPayload).
      if (folder === "cref-documents") {
        const result = await uploadPrivateMediaFromBuffer(file.buffer, file.mimetype, folder);
        return res.status(StatusCodes.CREATED).json({
          url: result.key,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes
        });
      }
      const result = await uploadMediaFromBuffer(file.buffer, file.mimetype, folder);
      return res.status(StatusCodes.CREATED).json(result);
    } catch (error) {
      if (error instanceof UnsupportedMediaTypeError || error instanceof InvalidFileContentError) {
        throw new AppError(error.message, StatusCodes.BAD_REQUEST);
      }
      throw error;
    }
  }
}

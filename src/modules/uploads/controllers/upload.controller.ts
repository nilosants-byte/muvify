import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../shared/errors/app-error";
import {
  InvalidFileContentError,
  UnsupportedMediaTypeError,
  UploadFolder,
  uploadMediaFromBuffer
} from "../../../shared/services/storage.service";

export class UploadController {
  async uploadMedia(req: Request, res: Response) {
    const file = req.file;
    if (!file) {
      throw new AppError("Nenhum arquivo enviado.", StatusCodes.BAD_REQUEST);
    }
    const { folder } = req.body as { folder: UploadFolder };

    try {
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

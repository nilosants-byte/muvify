import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ManualBlockService } from "../services/manual-block.service";

const manualBlockService = new ManualBlockService();

export class ManualBlockController {
  async list(request: Request, response: Response) {
    const blocks = await manualBlockService.list(request.user!.id);
    return response.json(blocks);
  }

  async create(request: Request, response: Response) {
    const block = await manualBlockService.create(request.user!.id, request.body);
    return response.status(StatusCodes.CREATED).json(block);
  }

  async delete(request: Request, response: Response) {
    await manualBlockService.delete(request.user!.id, request.params.blockId);
    return response.status(StatusCodes.NO_CONTENT).send();
  }
}

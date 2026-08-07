import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ExerciseService } from "../services/exercise.service";

const exerciseService = new ExerciseService();

export class ExerciseController {
  async list(req: Request, res: Response) {
    const userId = req.user!.id;
    const { category, q, prebuilt } = req.query as Record<string, string | undefined>;

    if (prebuilt === "true") {
      const exercises = await exerciseService.listPrebuilt(category, q);
      return res.json(exercises);
    }

    const exercises = await exerciseService.list({
      userId,
      category,
      q,
      includePrebuilt: true
    });
    return res.json(exercises);
  }

  async listMine(req: Request, res: Response) {
    const userId = req.user!.id;
    const { category, q } = req.query as Record<string, string | undefined>;
    const exercises = await exerciseService.listMine(userId, category, q);
    return res.json(exercises);
  }

  async listPrebuilt(req: Request, res: Response) {
    const { category, q } = req.query as Record<string, string | undefined>;
    const exercises = await exerciseService.listPrebuilt(category, q);
    return res.json(exercises);
  }

  async create(req: Request, res: Response) {
    const userId = req.user!.id;
    const {
      name,
      category,
      description,
      defaultRepetitionsSets,
      defaultRestLabel,
      mediaUrl,
      mediaType
    } = req.body;
    const exercise = await exerciseService.create({
      providerId: userId,
      name,
      category,
      description,
      defaultRepetitionsSets,
      defaultRestLabel,
      mediaUrl,
      mediaType
    });
    return res.status(StatusCodes.CREATED).json(exercise);
  }

  async update(req: Request, res: Response) {
    const userId = req.user!.id;
    const { exerciseId } = req.params;
    const {
      name,
      category,
      description,
      defaultRepetitionsSets,
      defaultRestLabel,
      mediaUrl,
      mediaType
    } = req.body;
    const exercise = await exerciseService.update(exerciseId, userId, {
      name,
      category,
      description,
      defaultRepetitionsSets,
      defaultRestLabel,
      mediaUrl,
      mediaType
    });
    return res.json(exercise);
  }

  async delete(req: Request, res: Response) {
    const userId = req.user!.id;
    const { exerciseId } = req.params;
    await exerciseService.delete(exerciseId, userId);
    return res.status(StatusCodes.NO_CONTENT).send();
  }
}

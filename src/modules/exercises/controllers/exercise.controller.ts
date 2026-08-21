import { Request, Response } from "express";
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

  async listPrebuilt(req: Request, res: Response) {
    const { category, q } = req.query as Record<string, string | undefined>;
    const exercises = await exerciseService.listPrebuilt(category, q);
    return res.json(exercises);
  }
}

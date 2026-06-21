import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { getAllAchievements } from "../services/achievement.service";
import { getUserGamificationProfile } from "../services/xp.service";
import { updateTrainingDaysConfig } from "../services/streak.service";

export async function getMyProfile(req: Request, res: Response) {
  const userId = req.user!.id;
  const profile = await getUserGamificationProfile(userId);
  res.json(profile);
}

export async function getAchievements(req: Request, res: Response) {
  const userId = req.user!.id;
  const achievements = await getAllAchievements(userId);
  res.json(achievements);
}

export async function setTrainingDays(req: Request, res: Response) {
  const userId = req.user!.id;
  const { trainingDaysPerWeek } = req.body as { trainingDaysPerWeek: number };
  await updateTrainingDaysConfig(userId, trainingDaysPerWeek);
  res.status(StatusCodes.NO_CONTENT).send();
}

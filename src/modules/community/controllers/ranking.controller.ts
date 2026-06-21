import { Request, Response } from "express";
import { RankingPeriodType } from "@prisma/client";
import { getRanking } from "../services/ranking.service";

export async function ranking(req: Request, res: Response) {
  const rawPage = Number(req.query.page);
  const rawLimit = Number(req.query.limit);
  const period = (req.query.period as RankingPeriodType | undefined) ?? "WEEKLY";

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.floor(rawLimit), 50) : 20;

  const result = await getRanking(req.user!.id, period, page, limit);
  res.json(result);
}

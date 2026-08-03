import { Request, Response } from "express";
import { RankingPeriodType } from "@prisma/client";
import { getGeneralRanking, getRanking } from "../services/ranking.service";

function parsePagination(req: Request) {
  const rawPage = Number(req.query.page);
  const rawLimit = Number(req.query.limit);
  const period = (req.query.period as RankingPeriodType | undefined) ?? "WEEKLY";

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.floor(rawLimit), 50) : 20;
  return { page, limit, period };
}

export async function ranking(req: Request, res: Response) {
  const { page, limit, period } = parsePagination(req);
  const result = await getRanking(req.user!.id, period, page, limit);
  res.json(result);
}

// Épico de Frentes, Frente 8, Lote 16: ranking geral (todos os usuários,
// sem filtro de seguidores mútuos) - até então só existia o "de amigos".
export async function generalRanking(req: Request, res: Response) {
  const { page, limit, period } = parsePagination(req);
  const result = await getGeneralRanking(req.user!.id, period, page, limit);
  res.json(result);
}

import { Request, Response } from "express";
import { DebtService } from "../services/debt.service";

const debtService = new DebtService();

export class DebtController {
  async listMyDebts(request: Request, response: Response) {
    const debts = await debtService.listMyDebts(request.user!.id);
    return response.json(debts);
  }

  async listProviderDebts(request: Request, response: Response) {
    const debts = await debtService.listProviderDebts(request.user!.id);
    return response.json(debts);
  }

  async payDebt(request: Request, response: Response) {
    const debt = await debtService.payDebt(request.user!.id, request.params.debtId);
    return response.json(debt);
  }
}

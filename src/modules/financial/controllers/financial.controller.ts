import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FinancialService } from "../services/financial.service";

const service = new FinancialService();

export class FinancialController {
  async dashboard(req: Request, res: Response) {
    const data = await service.getDashboard(req.user!.id, req.query.month as string | undefined);
    return res.json(data);
  }

  async payouts(req: Request, res: Response) {
    const data = await service.getPayouts(req.user!.id, req.query.month as string | undefined);
    return res.json(data);
  }

  async exportTransactionsCsv(req: Request, res: Response) {
    const csv = await service.exportTransactionsCsv(req.user!.id);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="transacoes-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  }

  // Students
  async listStudents(req: Request, res: Response) {
    const data = await service.listStudents(req.user!.id);
    return res.json(data);
  }
  async createStudent(req: Request, res: Response) {
    const data = await service.createStudent(req.user!.id, req.body);
    return res.status(StatusCodes.CREATED).json(data);
  }
  async updateStudent(req: Request, res: Response) {
    const data = await service.updateStudent(req.user!.id, req.params.id, req.body);
    return res.json(data);
  }
  async deleteStudent(req: Request, res: Response) {
    await service.deleteStudent(req.user!.id, req.params.id);
    return res.status(StatusCodes.NO_CONTENT).send();
  }

  // Incomes
  async listIncomes(req: Request, res: Response) {
    const data = await service.listIncomes(req.user!.id, req.query.month as string | undefined);
    return res.json(data);
  }
  async createIncome(req: Request, res: Response) {
    const data = await service.createIncome(req.user!.id, req.body);
    return res.status(StatusCodes.CREATED).json(data);
  }
  async updateIncome(req: Request, res: Response) {
    const data = await service.updateIncome(req.user!.id, req.params.id, req.body);
    return res.json(data);
  }

  async deleteIncome(req: Request, res: Response) {
    await service.deleteIncome(req.user!.id, req.params.id, req.query.beforeMonth as string | undefined);
    return res.status(StatusCodes.NO_CONTENT).send();
  }

  // Expenses
  async listExpenses(req: Request, res: Response) {
    const data = await service.listExpenses(req.user!.id, req.query.month as string | undefined);
    return res.json(data);
  }
  async createExpense(req: Request, res: Response) {
    const data = await service.createExpense(req.user!.id, req.body);
    return res.status(StatusCodes.CREATED).json(data);
  }
  async updateExpense(req: Request, res: Response) {
    const data = await service.updateExpense(req.user!.id, req.params.id, req.body);
    return res.json(data);
  }

  async deleteExpense(req: Request, res: Response) {
    await service.deleteExpense(req.user!.id, req.params.id, req.query.beforeMonth as string | undefined);
    return res.status(StatusCodes.NO_CONTENT).send();
  }

  // Goals
  async getGoal(req: Request, res: Response) {
    const data = await service.getGoal(req.user!.id, req.query.month as string | undefined);
    return res.json(data ?? null);
  }
  async upsertGoal(req: Request, res: Response) {
    const data = await service.upsertGoal(req.user!.id, req.body);
    return res.json(data);
  }

  // App clients (agendamentos completados, agrupados por cliente)
  async listAppClients(req: Request, res: Response) {
    const data = await service.listAppClients(req.user!.id, req.query.month as string | undefined);
    return res.json(data);
  }

  // Reports
  async report(req: Request, res: Response) {
    const rawMonths = req.query.months ? parseInt(req.query.months as string, 10) : 6;
    const months = Number.isNaN(rawMonths) || rawMonths < 1 ? 6 : rawMonths;
    const data = await service.getReport(req.user!.id, Math.min(months, 12));
    return res.json(data);
  }
}

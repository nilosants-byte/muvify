import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { FinancialController } from "../controllers/financial.controller";
import {
  createExpenseSchema,
  createIncomeSchema,
  createStudentSchema,
  dashboardQuerySchema,
  expenseIdSchema,
  incomeIdSchema,
  listByMonthSchema,
  studentIdSchema,
  updateExpenseSchema,
  updateIncomeSchema,
  updateStudentSchema,
  upsertGoalSchema
} from "../validators/financial.validator";

const ctrl = new FinancialController();
export const financialRoutes = Router();

const auth = [ensureAuthenticated, ensureRole(UserRole.PROVIDER)];

financialRoutes.get("/dashboard",    ...auth, validate(dashboardQuerySchema), ctrl.dashboard);
financialRoutes.get("/report",       ...auth, validate(dashboardQuerySchema), ctrl.report);
financialRoutes.get("/app-clients",  ...auth, validate(listByMonthSchema),   ctrl.listAppClients);
financialRoutes.get("/payouts",      ...auth, validate(listByMonthSchema), ctrl.payouts);
financialRoutes.get("/transactions/export", ...auth, ctrl.exportTransactionsCsv);

financialRoutes.get("/students", ...auth, validate(listByMonthSchema), ctrl.listStudents);
financialRoutes.post("/students", ...auth, validate(createStudentSchema), ctrl.createStudent);
financialRoutes.patch("/students/:id", ...auth, validate(updateStudentSchema), ctrl.updateStudent);
financialRoutes.delete("/students/:id", ...auth, validate(studentIdSchema), ctrl.deleteStudent);

financialRoutes.get("/incomes", ...auth, validate(listByMonthSchema), ctrl.listIncomes);
financialRoutes.post("/incomes", ...auth, validate(createIncomeSchema), ctrl.createIncome);
financialRoutes.patch("/incomes/:id", ...auth, validate(updateIncomeSchema), ctrl.updateIncome);
financialRoutes.delete("/incomes/:id", ...auth, validate(incomeIdSchema), ctrl.deleteIncome);

financialRoutes.get("/expenses", ...auth, validate(listByMonthSchema), ctrl.listExpenses);
financialRoutes.post("/expenses", ...auth, validate(createExpenseSchema), ctrl.createExpense);
financialRoutes.patch("/expenses/:id", ...auth, validate(updateExpenseSchema), ctrl.updateExpense);
financialRoutes.delete("/expenses/:id", ...auth, validate(expenseIdSchema), ctrl.deleteExpense);

financialRoutes.get("/goals", ...auth, validate(dashboardQuerySchema), ctrl.getGoal);
financialRoutes.put("/goals", ...auth, validate(upsertGoalSchema), ctrl.upsertGoal);

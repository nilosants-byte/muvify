import { UserRole } from "@prisma/client";
import { Router } from "express";
import { ensureAuthenticated } from "../../../middlewares/auth.middleware";
import { uploadRateLimiter } from "../../../middlewares/rate-limit.middleware";
import { ensureRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { FinancialController } from "../controllers/financial.controller";
import {
  classSessionIdSchema,
  createClassSessionSchema,
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
financialRoutes.get("/payouts",      ...auth, ctrl.payouts);

financialRoutes.get("/students", ...auth, ctrl.listStudents);
financialRoutes.post("/students", ...auth, uploadRateLimiter, validate(createStudentSchema), ctrl.createStudent);
financialRoutes.patch("/students/:id", ...auth, uploadRateLimiter, validate(updateStudentSchema), ctrl.updateStudent);
financialRoutes.delete("/students/:id", ...auth, uploadRateLimiter, validate(studentIdSchema), ctrl.deleteStudent);

financialRoutes.get("/incomes", ...auth, validate(listByMonthSchema), ctrl.listIncomes);
financialRoutes.post("/incomes", ...auth, uploadRateLimiter, validate(createIncomeSchema), ctrl.createIncome);
financialRoutes.patch("/incomes/:id", ...auth, uploadRateLimiter, validate(updateIncomeSchema), ctrl.updateIncome);
financialRoutes.delete("/incomes/:id", ...auth, uploadRateLimiter, validate(incomeIdSchema), ctrl.deleteIncome);

financialRoutes.get("/expenses", ...auth, validate(listByMonthSchema), ctrl.listExpenses);
financialRoutes.post("/expenses", ...auth, uploadRateLimiter, validate(createExpenseSchema), ctrl.createExpense);
financialRoutes.patch("/expenses/:id", ...auth, uploadRateLimiter, validate(updateExpenseSchema), ctrl.updateExpense);
financialRoutes.delete("/expenses/:id", ...auth, uploadRateLimiter, validate(expenseIdSchema), ctrl.deleteExpense);

financialRoutes.get("/goals", ...auth, validate(dashboardQuerySchema), ctrl.getGoal);
financialRoutes.put("/goals", ...auth, uploadRateLimiter, validate(upsertGoalSchema), ctrl.upsertGoal);

financialRoutes.get("/sessions", ...auth, validate(listByMonthSchema), ctrl.listClassSessions);
financialRoutes.post("/sessions", ...auth, uploadRateLimiter, validate(createClassSessionSchema), ctrl.createClassSession);
financialRoutes.delete("/sessions/:id", ...auth, uploadRateLimiter, validate(classSessionIdSchema), ctrl.deleteClassSession);

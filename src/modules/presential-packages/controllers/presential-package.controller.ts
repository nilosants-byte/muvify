import { ConsultancyPaymentMethod } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { PresentialPackageService } from "../services/presential-package.service";

const presentialPackageService = new PresentialPackageService();

export class PresentialPackageController {
  async purchase(request: Request, response: Response) {
    const result = await presentialPackageService.purchasePackage(request.user!.id, {
      offerId: request.body.offerId,
      categoryId: request.body.categoryId,
      paymentMethod: request.body.paymentMethod as ConsultancyPaymentMethod,
      weeklySchedule: request.body.weeklySchedule
    });
    return response.status(StatusCodes.CREATED).json(result);
  }

  async purchaseCombo(request: Request, response: Response) {
    const result = await presentialPackageService.purchaseCombo(request.user!.id, {
      offerId: request.body.offerId,
      categoryId: request.body.categoryId,
      paymentMethod: request.body.paymentMethod as ConsultancyPaymentMethod,
      weeklySchedule: request.body.weeklySchedule
    });
    return response.status(StatusCodes.CREATED).json(result);
  }

  async cancel(request: Request, response: Response) {
    const result = await presentialPackageService.cancelPackage(
      request.user!.id,
      request.params.packageId
    );
    return response.json(result);
  }

  async listMine(request: Request, response: Response) {
    const packages = await presentialPackageService.listMyPackages(request.user!.id);
    return response.json(packages);
  }

  async listAsProvider(request: Request, response: Response) {
    const packages = await presentialPackageService.listProviderPackages(request.user!.id);
    return response.json(packages);
  }

  async getById(request: Request, response: Response) {
    const pkg = await presentialPackageService.getPackageById(
      request.user!.id,
      request.params.packageId
    );
    return response.json(pkg);
  }
}

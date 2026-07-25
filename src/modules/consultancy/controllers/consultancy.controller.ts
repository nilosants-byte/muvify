import { ConsultancyPaymentMethod, ServiceOfferKind } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ConsultancyService } from "../services/consultancy.service";

const consultancyService = new ConsultancyService();

export class ConsultancyController {
  async promotions(_request: Request, response: Response) {
    const promotions = await consultancyService.listPromotions();
    return response.json(promotions);
  }

  async providerCatalog(request: Request, response: Response) {
    const catalog = await consultancyService.getProviderCatalog(request.params.providerId);
    return response.json(catalog);
  }

  async upsertOnlineSetting(request: Request, response: Response) {
    const setting = await consultancyService.upsertOnlineSetting(request.user!.id, {
      enabled: request.body.enabled
    });
    return response.json(setting);
  }

  async getOnlineSetting(request: Request, response: Response) {
    const setting = await consultancyService.getOnlineSetting(request.user!.id);
    return response.json(setting);
  }

  async listProviderOffers(request: Request, response: Response) {
    const offers = await consultancyService.listProviderOffersByUser(request.user!.id);
    return response.json(offers);
  }

  async createProviderOffer(request: Request, response: Response) {
    const offer = await consultancyService.createProviderOffer(request.user!.id, {
      kind: request.body.kind as ServiceOfferKind,
      title: request.body.title,
      billingCycle: request.body.billingCycle,
      daysPerWeek: request.body.daysPerWeek,
      comboPresentialDaysPerWeek: request.body.comboPresentialDaysPerWeek,
      comboOnlineDaysPerWeek: request.body.comboOnlineDaysPerWeek,
      priceCents: request.body.priceCents,
      isPromotion: request.body.isPromotion,
      promotionPriceCents: request.body.promotionPriceCents,
      promotionEndsAt: request.body.promotionEndsAt,
      promotionLabel: request.body.promotionLabel,
      acceptsPix: request.body.acceptsPix,
      acceptsDebitCard: request.body.acceptsDebitCard,
      acceptsCreditCard: request.body.acceptsCreditCard,
      maxCreditInstallments: request.body.maxCreditInstallments,
      isActive: request.body.isActive
    });

    return response.status(StatusCodes.CREATED).json(offer);
  }

  async updateProviderOffer(request: Request, response: Response) {
    const offer = await consultancyService.updateProviderOffer(
      request.user!.id,
      request.params.offerId,
      {
        kind: request.body.kind,
        title: request.body.title,
        billingCycle: request.body.billingCycle,
        daysPerWeek: request.body.daysPerWeek,
        comboPresentialDaysPerWeek: request.body.comboPresentialDaysPerWeek,
        comboOnlineDaysPerWeek: request.body.comboOnlineDaysPerWeek,
        priceCents: request.body.priceCents,
        isPromotion: request.body.isPromotion,
        promotionPriceCents: request.body.promotionPriceCents,
        promotionEndsAt: request.body.promotionEndsAt,
        promotionLabel: request.body.promotionLabel,
        acceptsPix: request.body.acceptsPix,
        acceptsDebitCard: request.body.acceptsDebitCard,
        acceptsCreditCard: request.body.acceptsCreditCard,
        maxCreditInstallments: request.body.maxCreditInstallments,
        isActive: request.body.isActive
      }
    );

    return response.json(offer);
  }

  async deleteProviderOffer(request: Request, response: Response) {
    await consultancyService.deleteProviderOffer(request.user!.id, request.params.offerId);
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async createTrainingPlan(request: Request, response: Response) {
    const plan = await consultancyService.createTrainingPlan(request.user!.id, {
      title: request.body.title,
      description: request.body.description,
      isPrebuilt: request.body.isPrebuilt,
      exercises: request.body.exercises
    });

    return response.status(StatusCodes.CREATED).json(plan);
  }

  async updateTrainingPlan(request: Request, response: Response) {
    const plan = await consultancyService.updateTrainingPlan(
      request.user!.id,
      request.params.planId,
      {
        title: request.body.title,
        description: request.body.description,
        isActive: request.body.isActive,
        exercises: request.body.exercises,
        validUntil: request.body.validUntil
      }
    );

    return response.json(plan);
  }

  async deleteTrainingPlan(request: Request, response: Response) {
    await consultancyService.deleteTrainingPlan(request.user!.id, request.params.planId);
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async listProviderPlans(request: Request, response: Response) {
    const plans = await consultancyService.listProviderPlansByUser(request.user!.id);
    return response.json(plans);
  }

  async createRequest(request: Request, response: Response) {
    const created = await consultancyService.createConsultancyRequest(request.user!.id, {
      providerId: request.body.providerId,
      trainingNeedText: request.body.trainingNeedText,
      limitationText: request.body.limitationText,
      extraInfoText: request.body.extraInfoText
    });

    return response.status(StatusCodes.CREATED).json(created);
  }

  async listMyRequests(request: Request, response: Response) {
    const requests = await consultancyService.listClientRequests(request.user!.id);
    return response.json(requests);
  }

  async listMyArchivedRequests(request: Request, response: Response) {
    const requests = await consultancyService.listClientArchivedRequests(
      request.user!.id,
      request.query.status as "ALL" | "REFUSED" | "EXPIRED_REFUNDED" | "ARCHIVED" | undefined
    );
    return response.json(requests);
  }

  async listProviderRequests(request: Request, response: Response) {
    const requests = await consultancyService.listProviderRequests(request.user!.id);
    return response.json(requests);
  }

  async listProviderArchivedRequests(request: Request, response: Response) {
    const requests = await consultancyService.listProviderArchivedRequests(
      request.user!.id,
      request.query.status as "ALL" | "REFUSED" | "EXPIRED_REFUNDED" | "ARCHIVED" | undefined
    );
    return response.json(requests);
  }

  async respondRequest(request: Request, response: Response) {
    const updated = await consultancyService.respondToRequest(request.user!.id, request.params.requestId, {
      providerResponseText: request.body.providerResponseText,
      quotedOfferId: request.body.quotedOfferId
    });
    return response.json(updated);
  }

  async decideRequest(request: Request, response: Response) {
    const result = await consultancyService.decideRequest(request.user!.id, request.params.requestId, {
      decision: request.body.decision,
      paymentMethod: request.body.paymentMethod as ConsultancyPaymentMethod | undefined,
      installments: request.body.installments
    });
    return response.json(result);
  }

  async deliverContract(request: Request, response: Response) {
    const delivered = await consultancyService.deliverContract(
      request.user!.id,
      request.params.contractId,
      {
        title: request.body.title,
        description: request.body.description,
        exercises: request.body.exercises,
        validUntil: request.body.validUntil
      }
    );
    return response.json(delivered);
  }

  async cancelContract(request: Request, response: Response) {
    const cancelled = await consultancyService.cancelContract(request.user!.id, request.params.contractId);
    return response.json(cancelled);
  }

  async myTraining(request: Request, response: Response) {
    const data = await consultancyService.getMyTraining(request.user!.id);
    return response.json(data);
  }

  async completeTrainingPlan(request: Request, response: Response) {
    const completion = await consultancyService.completeTrainingPlan(
      request.user!.id,
      request.params.trainingPlanId,
      request.body.notes
    );
    return response.status(StatusCodes.CREATED).json(completion);
  }

  async myTrainingCompletions(request: Request, response: Response) {
    const data = await consultancyService.listMyTrainingCompletions(request.user!.id);
    return response.json(data);
  }
}

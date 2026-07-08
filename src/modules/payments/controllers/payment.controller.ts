import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { PaymentService } from "../services/payment.service";

const paymentService = new PaymentService();

export class PaymentController {
  async customerStatus(request: Request, response: Response) {
    const status = await paymentService.getCustomerPaymentStatus(request.user!.id);
    return response.json(status);
  }

  async createCustomerSetupIntent(request: Request, response: Response) {
    const payload = await paymentService.createCustomerSetupIntent(request.user!.id);
    return response.status(StatusCodes.CREATED).json(payload);
  }

  async confirmCustomerSetupIntent(request: Request, response: Response) {
    await paymentService.confirmCustomerSetupIntent(
      request.user!.id,
      request.body.setupIntentId,
      {
        cardToken: request.body.cardToken,
        nickname: request.body.nickname,
        makeDefault: request.body.makeDefault
      }
    );
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async listCustomerCards(request: Request, response: Response) {
    const cards = await paymentService.listCustomerCards(request.user!.id);
    return response.json(cards);
  }

  async updateCustomerCardNickname(request: Request, response: Response) {
    const cards = await paymentService.updateCustomerCardNickname(
      request.user!.id,
      request.params.cardId,
      request.body.nickname
    );
    return response.json(cards);
  }

  async setCustomerCardDefault(request: Request, response: Response) {
    const cards = await paymentService.setDefaultCustomerCard(
      request.user!.id,
      request.params.cardId
    );
    return response.json(cards);
  }

  async removeCustomerCard(request: Request, response: Response) {
    const cards = await paymentService.removeCustomerCard(
      request.user!.id,
      request.params.cardId
    );
    return response.json(cards);
  }

  async setupCustomer(request: Request, response: Response) {
    await paymentService.setupCustomerPaymentMethod(
      request.user!.id,
      request.body.paymentMethodId
    );
    return response.status(StatusCodes.NO_CONTENT).send();
  }

  async createProviderOnboardingLink(request: Request, response: Response) {
    const result = await paymentService.createProviderOnboardingLink(
      request.user!.id,
      request.body.returnUrl,
      request.body.refreshUrl
    );
    return response.status(StatusCodes.CREATED).json(result);
  }

  async providerStatus(request: Request, response: Response) {
    const status = await paymentService.getProviderConnectStatus(request.user!.id);
    return response.json(status);
  }

  async showBookingPayment(request: Request, response: Response) {
    const payment = await paymentService.getPaymentForBooking(
      request.params.bookingId,
      request.user!.id
    );
    return response.json(payment);
  }

  async createBookingPixCharge(request: Request, response: Response) {
    const charge = await paymentService.createPixChargeForBooking(
      request.params.bookingId,
      request.user!.id
    );
    return response.status(StatusCodes.CREATED).json(charge);
  }

  async selectBookingPaymentMethod(request: Request, response: Response) {
    const payment = await paymentService.selectBookingPaymentMethod(
      request.user!.id,
      request.params.bookingId,
      {
        method: request.body.method,
        customerCardId: request.body.customerCardId
      }
    );
    return response.json(payment);
  }

  async webhook(request: Request, response: Response) {
    await paymentService.processWebhookEvent(
      request.headers["x-signature"],
      request.body as Buffer,
      request.query as Record<string, string | string[] | undefined>,
      request.headers["x-request-id"]
    );
    return response.status(StatusCodes.NO_CONTENT).send();
  }
}

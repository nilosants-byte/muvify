import { StatusCodes } from "http-status-codes";
import { ProviderServiceMode } from "@prisma/client";
import { AppError } from "../errors/app-error";

// Frente 5 (segunda camada), Lote 2: providerServiceOffer.offerServiceMode
// deixa o profissional restringir uma oferta específica a "só local fixo"
// ou "só a domicílio" (Épico Liberdade de Ofertas), mas essa regra só era
// validada na criação/edição da oferta — nunca checada nos três pontos
// onde o cliente de fato agenda/compra (agendamento avulso, pacote
// presencial, combo), permitindo contratar em modalidade incompatível com
// a que o profissional configurou pra aquela oferta específica.
export function assertOfferAllowsServiceLocation(
  offer: { offerServiceMode: ProviderServiceMode | null },
  isFixedLocation: boolean
) {
  if (!offer.offerServiceMode || offer.offerServiceMode === ProviderServiceMode.BOTH) return;

  if (offer.offerServiceMode === ProviderServiceMode.HOME_VISIT_ONLY && isFixedLocation) {
    throw new AppError(
      "Esta oferta só é atendida a domicílio — informe o endereço do atendimento.",
      StatusCodes.BAD_REQUEST
    );
  }

  if (offer.offerServiceMode === ProviderServiceMode.PRESENTIAL_ONLY && !isFixedLocation) {
    throw new AppError(
      "Esta oferta só é atendida no local de atendimento do profissional, não a domicílio.",
      StatusCodes.BAD_REQUEST
    );
  }
}

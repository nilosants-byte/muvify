import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/app-error";

// Épico de Frentes, Frente 6 (Ofertas do profissional), Lote 3: cada oferta
// pode desabilitar Pix/débito/crédito individualmente (acceptsPix/
// acceptsDebitCard/acceptsCreditCard), mas só consultoria avulsa e pacote
// presencial simples checavam isso — compra de COMBO e booking avulso
// vinculado a uma oferta ignoravam essa configuração por completo.
export function assertOfferAcceptsPaymentMethod(
  offer: { acceptsPix: boolean; acceptsDebitCard: boolean; acceptsCreditCard: boolean },
  method: "PIX" | "DEBIT_CARD" | "CREDIT_CARD" | "CARD",
  itemLabel: string
) {
  if (method === "PIX" && !offer.acceptsPix) {
    throw new AppError(`Este profissional não aceita Pix para ${itemLabel}.`, StatusCodes.BAD_REQUEST);
  }
  if (method === "DEBIT_CARD" && !offer.acceptsDebitCard) {
    throw new AppError(`Este profissional não aceita cartão de débito para ${itemLabel}.`, StatusCodes.BAD_REQUEST);
  }
  if (method === "CREDIT_CARD" && !offer.acceptsCreditCard) {
    throw new AppError(`Este profissional não aceita cartão de crédito para ${itemLabel}.`, StatusCodes.BAD_REQUEST);
  }
}

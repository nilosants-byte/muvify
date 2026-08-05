import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../config/env";
import { AppError } from "../errors/app-error";
type TokenPayload = {
  sub: string;
  role: UserRole;
  // Tela "Meus aparelhos conectados": liga o access token à sessão (Session)
  // que o originou, pra dar pra marcar "este aparelho" na lista - opcional
  // pra não quebrar tokens já emitidos antes desse campo existir (expiram
  // sozinhos em pouco tempo, ACCESS_TOKEN_EXPIRES_IN é curto).
  sessionId?: string;
  iat?: number;
  exp?: number;
};
export function signToken(userId: string, role: UserRole, sessionId?: string) {
  const options: jwt.SignOptions = {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  };
  return jwt.sign({ role, sessionId }, env.JWT_SECRET, options);
}
export function verifyToken(token: string) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as TokenPayload;
  } catch (error) {
    throw new AppError("Token invalido.", StatusCodes.UNAUTHORIZED);
  }
}

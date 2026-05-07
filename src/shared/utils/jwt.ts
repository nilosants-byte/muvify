import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../config/env";
import { AppError } from "../errors/app-error";
type TokenPayload = {
  sub: string;
  role: UserRole;
  iat?: number;
  exp?: number;
};
export function signToken(userId: string, role: UserRole) {
  const options: jwt.SignOptions = {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"]
  };
  return jwt.sign({ role }, env.JWT_SECRET, options);
}
export function verifyToken(token: string) {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch (error) {
    throw new AppError("Token invalido.", StatusCodes.UNAUTHORIZED);
  }
}

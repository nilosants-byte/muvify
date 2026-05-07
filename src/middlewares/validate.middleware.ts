import { NextFunction, Request, Response } from "express";
import { AnyZodObject } from "zod";
export function validate(schema: AnyZodObject) {
  return (request: Request, _response: Response, next: NextFunction) => {
    schema.parse({
      body: request.body,
      params: request.params,
      query: request.query
    });
    next();
  };
}

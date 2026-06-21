import { NextFunction, Request, Response } from "express";
import { AnyZodObject } from "zod";
export function validate(schema: AnyZodObject) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const parsed = schema.parse({
      body: request.body,
      params: request.params,
      query: request.query
    });
    if (parsed.body !== undefined) request.body = parsed.body;
    if (parsed.params !== undefined) Object.assign(request.params, parsed.params);
    if (parsed.query !== undefined) Object.assign(request.query, parsed.query);
    next();
  };
}

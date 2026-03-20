import { nanoid } from "nanoid";

export function newId(): string {
  return nanoid(8);
}

export type D1 = D1Database;

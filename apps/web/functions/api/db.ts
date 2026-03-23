import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nanoid = customAlphabet(alphabet, 8);
const nanoid12 = customAlphabet(alphabet, 12);

export function newId(): string {
  return nanoid();
}

export function newLongId(): string {
  return nanoid12();
}

export type D1 = D1Database;

export function parseJsonFields<T>(row: T, fields: (keyof T)[]): T {
  for (const f of fields) {
    if (typeof row[f] === "string") row[f] = JSON.parse(row[f] as string);
  }
  return row;
}

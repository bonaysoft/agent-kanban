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

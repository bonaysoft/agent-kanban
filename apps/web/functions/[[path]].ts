import { handle } from "hono/cloudflare-pages";
import { api } from "./api/routes";

export const onRequest = handle(api);

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  banned?: boolean;
  banReason?: string;
  banExpires?: string | null;
  createdAt: string;
  image?: string;
}

export type DialogKind = "role" | "ban" | "delete";

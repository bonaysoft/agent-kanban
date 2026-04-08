import { getCredentials } from "../config.js";
import { ApiClient } from "./base.js";

export class MachineClient extends ApiClient {
  private apiKey: string;

  constructor() {
    const { apiUrl, apiKey } = getCredentials();
    super(apiUrl);
    this.apiKey = apiKey;
  }

  protected async authorize(): Promise<string> {
    return `Bearer ${this.apiKey}`;
  }
}

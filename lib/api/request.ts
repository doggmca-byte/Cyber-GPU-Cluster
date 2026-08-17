import { ApiError } from "./errors";

/** Безпечний парсинг JSON-тіла запиту — невалідний JSON стає керованою 400-помилкою. */
export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "invalid JSON body");
  }
}

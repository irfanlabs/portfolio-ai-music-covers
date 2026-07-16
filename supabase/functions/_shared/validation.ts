import { HttpError } from "./http.ts";

export function stringField(
  input: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
): string {
  const value = input[name];
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_input", `${name} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(400, "invalid_input", `${name} must be ${min}-${max} characters`);
  }
  return trimmed;
}

export function uuidField(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new HttpError(400, "invalid_input", `${name} must be a UUID`);
  }
  return value;
}

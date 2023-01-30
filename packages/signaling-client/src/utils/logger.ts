export interface Logger {
  debug(message: string): void;
  error(message: string, error: Error): void;
}

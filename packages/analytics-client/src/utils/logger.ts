export interface Logger {
  debug(message: string, ...optionalParams: any[]): void;
  warn(message: string, ...optionalParams: any[]): void;
  error(message: string, error: Error): void;
}

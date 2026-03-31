import winston from "winston";

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const prettyFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const stackStr = stack ? `\n${stack}` : "";
  return `${timestamp} [${level}]: ${message}${metaStr}${stackStr}`;
});

const isProduction = process.env["NODE_ENV"] === "production";

export const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",
  defaultMeta: { service: "openclaw" },
  transports: [
    new winston.transports.Console({
      format: isProduction
        ? combine(timestamp(), errors({ stack: true }), json())
        : combine(
            colorize(),
            timestamp({ format: "HH:mm:ss.SSS" }),
            errors({ stack: true }),
            prettyFormat
          ),
    }),
  ],
});

export function createChildLogger(context: Record<string, string>) {
  return logger.child(context);
}

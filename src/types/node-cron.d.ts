declare module "node-cron" {
  interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
  }

  interface ScheduledTask {
    start(): void;
    stop(): void;
  }

  function schedule(
    expression: string,
    func: () => void | Promise<void>,
    options?: ScheduleOptions,
  ): ScheduledTask;

  function validate(expression: string): boolean;

  export { schedule, validate, ScheduledTask, ScheduleOptions };
  export default { schedule, validate };
}

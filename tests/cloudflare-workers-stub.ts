export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  protected readonly ctx: ExecutionContext & { props: Props };
  protected readonly env: Env;

  constructor(ctx: ExecutionContext & { props: Props }, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

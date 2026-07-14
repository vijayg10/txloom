export interface Command {
  name: string;
  description: string;
  run(args: string[]): Promise<void>;
}

/** Flat command registry — `txloom <command> [subcommand] ...args`. Commands map
 * 1:1 onto REST endpoints, same as the MCP tools (contracts/api.md § Contract
 * invariants: "CLI maps 1:1 onto these endpoints"). */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  list(): Command[] {
    return [...this.commands.values()];
  }
}

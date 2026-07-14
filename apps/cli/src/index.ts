#!/usr/bin/env node
import { CommandRegistry } from "./registry.js";
import { validateCommand } from "./commands/validate.js";
import { runCommand } from "./commands/run.js";
import { exportCommand } from "./commands/export.js";
import {
  runPauseCommand,
  runResumeCommand,
  runCancelCommand,
  runRegenerateCommand,
  runStatusCommand,
} from "./commands/run-control.js";
import {
  streamStartCommand,
  streamPauseCommand,
  streamResumeCommand,
  streamStopCommand,
  streamSetRateCommand,
} from "./commands/stream.js";
import { truthFilterCommand, truthActorStoryCommand } from "./commands/truth.js";
import { sinksListCommand, sinksAddCommand, sinksTestCommand } from "./commands/sinks.js";

const registry = new CommandRegistry();
registry.register(validateCommand);
registry.register(runCommand);
registry.register(exportCommand);
registry.register(runPauseCommand);
registry.register(runResumeCommand);
registry.register(runCancelCommand);
registry.register(runRegenerateCommand);
registry.register(runStatusCommand);
registry.register(streamStartCommand);
registry.register(streamPauseCommand);
registry.register(streamResumeCommand);
registry.register(streamStopCommand);
registry.register(streamSetRateCommand);
registry.register(truthFilterCommand);
registry.register(truthActorStoryCommand);
registry.register(sinksListCommand);
registry.register(sinksAddCommand);
registry.register(sinksTestCommand);

async function main() {
  const [, , commandName, ...args] = process.argv;

  if (!commandName) {
    console.log("Usage: txloom <command> [...args]\n\nAvailable commands:");
    for (const command of registry.list()) {
      console.log(`  ${command.name.padEnd(20)} ${command.description}`);
    }
    process.exit(registry.list().length === 0 ? 0 : 1);
  }

  const command = registry.get(commandName);
  if (!command) {
    console.error(
      `Unknown command "${commandName}". Run "txloom" with no arguments to list commands.`,
    );
    process.exit(1);
  }

  await command.run(args);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

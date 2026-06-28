#!/usr/bin/env bun
import { Command } from "commander";
import { sessionStartAction } from "./hooks/session-start.js";
import { stopAction } from "./hooks/stop.js";
import { queryAction } from "./commands/query.js";

const program = new Command();

program
  .name("2bd")
  .description("Developer tooling CLI for structured context management");

const hooks = program
  .command("hooks")
  .description("Claude Code hook integrations");

hooks
  .command("session-start")
  .description("Assemble .2b/ context and output hook-compatible JSON")
  .action(sessionStartAction);

hooks
  .command("stop")
  .description("Capture session turns to daily JSONL log")
  .action(stopAction);

program
  .command("query")
  .description("Query the vault using MOC-guided retrieval and get a cited summary")
  .argument("<question>", "Natural-language question to ask about the vault")
  .option("--file-back <path>", "Write result as a vault note to the specified path instead of stdout")
  .action(queryAction);

program.parse();

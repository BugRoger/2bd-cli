#!/usr/bin/env bun
import { Command } from "commander";
import { sessionStartAction } from "./hooks/session-start.js";

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

program.parse();

#!/usr/bin/env node
import { stdin } from "node:process";
import { runDepositCli } from "./deposit-factus-pay-credential.js";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const exitCode = await runDepositCli(process.env, stdin, write);
process.exit(exitCode);
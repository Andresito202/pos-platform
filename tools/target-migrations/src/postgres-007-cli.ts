import { applyPostgres007 } from "./postgres-007-runner.js";

const adminUrl = process.env.POSTGRES_ADMIN_URL ?? process.env.POSTGRES_TEST_URL;
const expectedDatabase = process.env.POSTGRES_EXPECTED_DATABASE ?? "pos_platform";
const repositoryCommit = process.env.REPOSITORY_COMMIT ?? process.env.GITHUB_SHA;
if (!adminUrl) throw new Error("POSTGRES_ADMIN_URL or POSTGRES_TEST_URL is required");
if (!repositoryCommit) throw new Error("REPOSITORY_COMMIT or GITHUB_SHA is required");

process.stdout.write(JSON.stringify(await applyPostgres007({ adminUrl, expectedDatabase, repositoryCommit })) + "\n");
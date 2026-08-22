import {
  applyRoleReadiness,
  checkRoleReadiness,
  revertRoleReadiness,
  type RoleReadinessConfig,
} from "./postgres-003-role-readiness.js";

const operation=process.argv[2];
const config:RoleReadinessConfig={
  provisioningUrl:process.env.POSTGRES_ROLE_READINESS_PROVISIONING_URL??"",
  verificationUrl:process.env.POSTGRES_ROLE_READINESS_VERIFICATION_URL??"",
  environmentId:process.env.POSTGRES_ROLE_READINESS_ENVIRONMENT_ID??"",
  expectedDatabase:process.env.POSTGRES_ROLE_READINESS_EXPECTED_DATABASE??"",
  repositoryCommit:process.env.ROLE_READINESS_REPOSITORY_COMMIT??"",
  ...(process.env.ROLE_READINESS_OPERATOR_OR_JOB_ID?{operatorOrJobId:process.env.ROLE_READINESS_OPERATOR_OR_JOB_ID}:{}),
  ...(process.env.ROLE_READINESS_RECEIPT_OUTPUT_PATH?{receiptOutputPath:process.env.ROLE_READINESS_RECEIPT_OUTPUT_PATH}:{}),
};

const result=operation==="check"
  ? await checkRoleReadiness(config)
  : operation==="apply"
    ? await applyRoleReadiness(config)
    : operation==="revert"
      ? await revertRoleReadiness(config,process.env.ROLE_READINESS_RECEIPT_PATH)
      : {operation:"CLI",result:"FAIL",state:null,failure_code:"OPERATION_REQUIRED",operation_id:null,receipt_path:null,receipt_sha256:null};

process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
process.exitCode=result.result==="FAIL"?1:result.result==="APPLIED_WITHOUT_DURABLE_RECEIPT"?3:0;

#!/bin/sh
set -eu

DB=physical_model_poc
USER=physical_poc_test_executor
TENANT=01890f5a-0000-7000-8000-000000000001

run_psql() {
  psql -X -v ON_ERROR_STOP=1 -U "$USER" -d "$DB" "$@"
}

run_psql > /tmp/r3-sale-a.out 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
UPDATE poc.sales SET status='COMPLETED',version=version+1 WHERE id='01890f5a-0000-7000-8000-000000001001' AND version=1;
SELECT pg_sleep(2);
COMMIT;
SQL
sale_a=$!
sleep 0.3
run_psql > /tmp/r3-sale-b.out 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
UPDATE poc.sales SET status='COMPLETED',version=version+1 WHERE id='01890f5a-0000-7000-8000-000000001001' AND version=1;
COMMIT;
SQL
sale_b=$!
wait "$sale_a"
wait "$sale_b"

run_psql > /tmp/r3-inventory-a.out 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
SELECT poc.record_inventory('01890f5a-0000-7000-8000-000000007101','01890f5a-0000-7000-8000-000000007102','01890f5a-0000-7000-8000-000000007103','01890f5a-0000-7000-8000-000000007104','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','01890f5a-0000-7000-8000-000000000501',NULL,'01890f5a-0000-7000-8000-000000000701','RECEIPT_IN','IN','1.000000',NULL,'concurrent-inventory-a',repeat('1',64),40,NULL);
SELECT pg_sleep(1);
COMMIT;
SQL
inventory_a=$!
sleep 0.2
run_psql > /tmp/r3-inventory-b.out 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
SELECT poc.record_inventory('01890f5a-0000-7000-8000-000000007111','01890f5a-0000-7000-8000-000000007112','01890f5a-0000-7000-8000-000000007113','01890f5a-0000-7000-8000-000000007114','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','01890f5a-0000-7000-8000-000000000501',NULL,'01890f5a-0000-7000-8000-000000000701','RECEIPT_IN','IN','1.000000',NULL,'concurrent-inventory-b',repeat('2',64),41,NULL);
COMMIT;
SQL
inventory_b=$!
wait "$inventory_a"
wait "$inventory_b"

run_psql > /tmp/r3-payment-a.out 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
SELECT poc.confirm_payment('01890f5a-0000-7000-8000-000000001105','01890f5a-0000-7000-8000-000000007201','01890f5a-0000-7000-8000-000000007202','01890f5a-0000-7000-8000-000000007203','01890f5a-0000-7000-8000-000000007204','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','QR_NETWORK','neutral-concurrent-ref',repeat('3',64),42,1,NULL);
SELECT pg_sleep(1);
COMMIT;
SQL
payment_a=$!
sleep 0.2
run_psql > /tmp/r3-payment-b.out 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
SELECT poc.confirm_payment('01890f5a-0000-7000-8000-000000001105','01890f5a-0000-7000-8000-000000007211','01890f5a-0000-7000-8000-000000007212','01890f5a-0000-7000-8000-000000007213','01890f5a-0000-7000-8000-000000007214','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','QR_NETWORK','neutral-concurrent-ref',repeat('3',64),43,1,NULL);
COMMIT;
SQL
payment_b=$!
wait "$payment_a"
wait "$payment_b"

run_psql > /tmp/r3-config-a.out 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
SELECT poc.publish_price('01890f5a-0000-7000-8000-000000007301','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000501',2,'1100.000000',10,'2027-01-01T00:00:00Z','2027-12-31T00:00:00Z',repeat('4',64),1);
SELECT pg_sleep(1);
COMMIT;
SQL
config_a=$!
sleep 0.2
set +e
run_psql > /tmp/r3-config-b.out 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
SELECT poc.publish_price('01890f5a-0000-7000-8000-000000007302','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000501',2,'1200.000000',10,'2027-01-01T00:00:00Z','2027-12-31T00:00:00Z',repeat('5',64),1);
COMMIT;
SQL
config_b=$!
wait "$config_a"
config_a_rc=$?
wait "$config_b"
config_b_rc=$?
set -e

printf '%s\n' '--- sale session A ---'; cat /tmp/r3-sale-a.out
printf '%s\n' '--- sale session B ---'; cat /tmp/r3-sale-b.out
printf '%s\n' '--- inventory sessions ---'; cat /tmp/r3-inventory-a.out /tmp/r3-inventory-b.out
printf '%s\n' '--- payment sessions ---'; cat /tmp/r3-payment-a.out /tmp/r3-payment-b.out
printf '%s\n' '--- configuration sessions ---'; cat /tmp/r3-config-a.out /tmp/r3-config-b.out
printf 'CONFIG_SESSION_A_EXIT=%s\n' "$config_a_rc"
printf 'CONFIG_SESSION_B_EXPECTED_CONFLICT_EXIT=%s\n' "$config_b_rc"
test "$config_a_rc" -eq 0
test "$config_b_rc" -ne 0
printf '%s\n' 'POSTGRES_CONCURRENCY_HARNESS=PASS'

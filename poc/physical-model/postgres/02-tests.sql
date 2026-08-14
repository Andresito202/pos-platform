\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id = '01890f5a-0000-7000-8000-000000000001';

SELECT poc.test_assert('pg_version_16', current_setting('server_version_num')::integer BETWEEN 160000 AND 169999, version());
SELECT poc.test_assert('uuid_v7_canonical', poc.is_uuid_v7('01890f5a-0000-7000-8000-000000000001'), 'same identity serialized as canonical uuid');
SELECT poc.test_assert('uuid_roundtrip', '01890f5a-0000-7000-8000-000000000001'::uuid::text='01890f5a-0000-7000-8000-000000000001', 'uuid -> text');
SELECT poc.test_expect_error('uuid_v4_rejected', $$INSERT INTO poc.sales(id,tenant_id,company_id,branch_id,origin_device_id,status,business_date,currency_code,payable_amount,pricing_snapshot,tax_snapshot,idempotency_key,request_checksum,version,created_at) VALUES('550e8400-e29b-41d4-a716-446655440000','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','DRAFT','2026-08-14','COP',0,'{}','{}','v4',repeat('0',64),1,now())$$,ARRAY['23514']);
SELECT poc.test_expect_error('uuid_invalid_rejected', $$SELECT 'not-a-uuid'::uuid$$,ARRAY['22P02']);

SELECT poc.test_assert('money_zero', poc.decimal_6('0.000000')=0, 'scale 6');
SELECT poc.test_assert('money_positive', poc.decimal_6('1250.500000')=1250.5, 'scale 6');
SELECT poc.test_assert('money_large_valid', poc.decimal_6('9999999999999.999999')=9999999999999.999999, 'precision 19');
SELECT poc.test_assert('money_no_drift', poc.decimal_6('0.100000')+poc.decimal_6('0.200000')=poc.decimal_6('0.300000'), 'decimal addition');
SELECT poc.test_assert('money_roundtrip', poc.decimal_6('1250.500000')::text='1250.500000', 'numeric -> canonical text');
SELECT poc.test_expect_error('money_excess_scale', $$SELECT poc.decimal_6('1.0000001')$$,ARRAY['22023']);
SELECT poc.test_expect_error('money_nan', $$SELECT poc.decimal_6('NaN')$$,ARRAY['22023']);
SELECT poc.test_expect_error('money_infinity', $$SELECT poc.decimal_6('Infinity')$$,ARRAY['22023']);
SELECT poc.test_expect_error('money_ambiguous', $$SELECT poc.decimal_6('01.000000')$$,ARRAY['22023']);
SELECT poc.test_expect_error('money_exponent', $$SELECT poc.decimal_6('1e3')$$,ARRAY['22023']);
SELECT poc.test_expect_error('money_over_precision', $$SELECT poc.decimal_6('10000000000000.000000')$$,ARRAY['22023']);
SELECT poc.test_assert('rate_scale_10', poc.decimal_10('0.1900000000')::text='0.1900000000', 'rate canonical');
SELECT poc.test_assert('factor_large_valid', poc.decimal_10('999999999.9999999999')=999999999.9999999999, 'precision 19');
SELECT poc.test_expect_error('rate_excess_scale', $$SELECT poc.decimal_10('0.19000000001')$$,ARRAY['22023']);
SELECT poc.test_assert('norm_scale_2_boundary', poc.decimal_2('1025.00')=1025.00, 'explicit authorized normalization');
SELECT poc.test_expect_error('norm_scale_2_excess', $$SELECT poc.decimal_2('1025.001')$$,ARRAY['22023']);
INSERT INTO poc.test_limit_contract VALUES (1,'FINITE',0.000000),(2,'UNLIMITED',NULL),(3,'NOT_APPLICABLE',NULL);
SELECT poc.test_assert('limit_contract_valid',(SELECT count(*) FROM poc.test_limit_contract)=3,'three canonical forms');
SELECT poc.test_expect_error('limit_finite_requires_value', $$INSERT INTO poc.test_limit_contract VALUES(4,'FINITE',NULL)$$,ARRAY['23514']);
SELECT poc.test_expect_error('limit_unlimited_rejects_value', $$INSERT INTO poc.test_limit_contract VALUES(5,'UNLIMITED',1.000000)$$,ARRAY['23514']);
SELECT poc.test_expect_error('limit_not_applicable_rejects_value', $$INSERT INTO poc.test_limit_contract VALUES(6,'NOT_APPLICABLE',0.000000)$$,ARRAY['23514']);

SELECT poc.test_assert('quantity_unit', poc.decimal_6('1.000000')=1, 'count represented in common schema');
SELECT poc.test_assert('quantity_weight', poc.decimal_6('1.275000')=1.275, 'mass represented in common schema');
SELECT poc.test_assert('quantity_volume', poc.decimal_6('0.750000')=0.75, 'volume represented in common schema');
SELECT poc.test_expect_error('quantity_zero_rejected', $$INSERT INTO poc.sale_items VALUES('01890f5a-0000-7000-8000-000000009001','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000001001',99,'01890f5a-0000-7000-8000-000000000501',NULL,'01890f5a-0000-7000-8000-000000000401',0,1,0,1)$$,ARRAY['23514']);
SELECT poc.test_expect_error('status_invalid_rejected', $$UPDATE poc.sales SET status='PAID' WHERE id='01890f5a-0000-7000-8000-000000001001'$$,ARRAY['23514']);

SELECT poc.test_assert('rls_sale_select_isolated',(SELECT count(*) FROM poc.sales WHERE tenant_id='01890f5a-0000-7000-8000-000000000002')=0,'Tenant B invisible');
SELECT poc.test_assert('rls_inventory_select_isolated',(SELECT count(*) FROM poc.inventory_movements WHERE tenant_id='01890f5a-0000-7000-8000-000000000002')=0,'Tenant B invisible');
SELECT poc.test_assert('rls_payment_select_isolated',(SELECT count(*) FROM poc.payments WHERE tenant_id='01890f5a-0000-7000-8000-000000000002')=0,'Tenant B invisible');
SELECT poc.test_assert('rls_audit_select_isolated',(SELECT count(*) FROM poc.audit_events WHERE tenant_id='01890f5a-0000-7000-8000-000000000002')=0,'Tenant B invisible');
SELECT poc.test_assert('rls_sync_select_isolated',(SELECT count(*) FROM poc.sync_operations WHERE tenant_id='01890f5a-0000-7000-8000-000000000002')=0,'Tenant B invisible');
SELECT poc.test_expect_error('rls_insert_cross_tenant', $$INSERT INTO poc.sync_operations VALUES('01890f5a-0000-7000-8000-000000009002','01890f5a-0000-7000-8000-000000000002','01890f5a-0000-7000-8000-000000000102','01890f5a-0000-7000-8000-000000000202','01890f5a-0000-7000-8000-000000000302',99,'SALE','01890f5a-0000-7000-8000-000000001003','cross',repeat('0',64),'READY_TO_SYNC',now())$$,ARRAY['42501']);
WITH changed AS (UPDATE poc.sales SET version=version+1 WHERE tenant_id='01890f5a-0000-7000-8000-000000000002' RETURNING 1)
SELECT poc.test_assert('rls_update_cross_tenant',(SELECT count(*) FROM changed)=0,'Tenant B cannot be updated');
SELECT poc.test_expect_error('rls_delete_cross_tenant', $$DELETE FROM poc.sales WHERE tenant_id='01890f5a-0000-7000-8000-000000000002'$$,ARRAY['42501']);

SELECT poc.test_expect_error('fk_sale_branch_cross_tenant', $$INSERT INTO poc.sales VALUES('01890f5a-0000-7000-8000-000000009003','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000202','01890f5a-0000-7000-8000-000000000301','DRAFT','2026-08-14','COP',0,'{}','{}','cross-branch',repeat('0',64),1,now())$$,ARRAY['23503']);
SELECT poc.test_expect_error('fk_inventory_product_cross_tenant', $$INSERT INTO poc.inventory_movements VALUES('01890f5a-0000-7000-8000-000000009004','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000506',NULL,'RECEIPT_IN','IN',1,NULL,'01890f5a-0000-7000-8000-000000001304',now())$$,ARRAY['23503']);
SELECT poc.test_expect_error('fk_payment_sale_cross_tenant', $$INSERT INTO poc.payment_groups VALUES('01890f5a-0000-7000-8000-000000009005','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000001003','COP',1)$$,ARRAY['23503']);
SELECT poc.test_expect_error('fk_sync_device_cross_tenant', $$INSERT INTO poc.sync_operations VALUES('01890f5a-0000-7000-8000-000000009006','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000302',99,'SALE','01890f5a-0000-7000-8000-000000001001','cross-device',repeat('0',64),'READY_TO_SYNC',now())$$,ARRAY['23503']);

COMMIT;

BEGIN;
SET LOCAL ROLE physical_poc_app;
SELECT poc.test_assert('rls_missing_tenant_fail_closed',(SELECT count(*) FROM poc.sales)=0,'no SET LOCAL');
COMMIT;
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='invalid-tenant';
SELECT poc.test_assert('rls_invalid_tenant_fail_closed',(SELECT count(*) FROM poc.sales)=0,'invalid context');
COMMIT;
BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
SELECT poc.test_assert('pool_context_restored',(SELECT count(*) FROM poc.sales)>0,'new transaction explicitly sets context');
COMMIT;

BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
DO $atomic$
BEGIN
  BEGIN
    PERFORM poc.complete_sale(
      '01890f5a-0000-7000-8000-000000002101','01890f5a-0000-7000-8000-000000002102','01890f5a-0000-7000-8000-000000002103','01890f5a-0000-7000-8000-000000002104','01890f5a-0000-7000-8000-000000002105',
      '01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','01890f5a-0000-7000-8000-000000000501',NULL,'01890f5a-0000-7000-8000-000000000401','1.000000','1000.000000','0.1900000000','failed-sale',repeat('6',64),10,'AUDIT');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM poc.test_assert('sales_failure_rollback',NOT EXISTS(SELECT 1 FROM poc.sales WHERE id='01890f5a-0000-7000-8000-000000002101'),'no partial sale/item/audit/operation/outbox');
  PERFORM poc.test_assert('sales_failure_no_operation',NOT EXISTS(SELECT 1 FROM poc.sync_operations WHERE id='01890f5a-0000-7000-8000-000000002103'),'operation rolled back');
  PERFORM poc.test_assert('sales_failure_no_outbox',NOT EXISTS(SELECT 1 FROM poc.outbox_entries WHERE id='01890f5a-0000-7000-8000-000000002104'),'outbox rolled back');
END
$atomic$;

SELECT poc.complete_sale(
  '01890f5a-0000-7000-8000-000000002201','01890f5a-0000-7000-8000-000000002202','01890f5a-0000-7000-8000-000000002203','01890f5a-0000-7000-8000-000000002204','01890f5a-0000-7000-8000-000000002205',
  '01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','01890f5a-0000-7000-8000-000000000502',NULL,'01890f5a-0000-7000-8000-000000000402','1.275000','12000.000000','0.1900000000','weighted-sale',repeat('7',64),1,NULL);
SELECT poc.test_assert('sales_atomic_success',(SELECT count(*) FROM poc.sale_items WHERE sale_id='01890f5a-0000-7000-8000-000000002201')=1 AND EXISTS(SELECT 1 FROM poc.outbox_entries WHERE operation_id='01890f5a-0000-7000-8000-000000002203'),'all facts committed');
SELECT poc.test_assert('weighted_same_sale_schema',(SELECT quantity=1.275000 FROM poc.sale_items WHERE sale_id='01890f5a-0000-7000-8000-000000002201'),'no vertical schema');
SELECT poc.test_assert('outbox_one_to_one',(SELECT count(*) FROM poc.outbox_entries WHERE operation_id='01890f5a-0000-7000-8000-000000002203')=1,'unique operation');
SELECT poc.test_expect_error('sale_idempotency_duplicate', $$SELECT poc.complete_sale('01890f5a-0000-7000-8000-000000002301','01890f5a-0000-7000-8000-000000002302','01890f5a-0000-7000-8000-000000002303','01890f5a-0000-7000-8000-000000002304','01890f5a-0000-7000-8000-000000002305','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','01890f5a-0000-7000-8000-000000000501',NULL,'01890f5a-0000-7000-8000-000000000401','1.000000','1000.000000','0.1900000000','weighted-sale',repeat('7',64),2,NULL)$$,ARRAY['23505']);

DO $inventory$
BEGIN
  BEGIN
    PERFORM poc.record_inventory(
      '01890f5a-0000-7000-8000-000000003101','01890f5a-0000-7000-8000-000000003102','01890f5a-0000-7000-8000-000000003103','01890f5a-0000-7000-8000-000000003104',
      '01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','01890f5a-0000-7000-8000-000000000503','01890f5a-0000-7000-8000-000000000801','01890f5a-0000-7000-8000-000000000701','WASTE','OUT','1.000000','DAMAGED','failed-inventory',repeat('8',64),20,'OUTBOX');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM poc.test_assert('inventory_failure_rollback',NOT EXISTS(SELECT 1 FROM poc.inventory_movements WHERE id='01890f5a-0000-7000-8000-000000003101'),'movement rolled back');
  PERFORM poc.test_assert('inventory_projection_rollback',(SELECT on_hand_quantity FROM poc.stock_balances WHERE product_id='01890f5a-0000-7000-8000-000000000503')=10.000000,'balance unchanged');
END
$inventory$;

SELECT poc.record_inventory(
  '01890f5a-0000-7000-8000-000000003201','01890f5a-0000-7000-8000-000000003202','01890f5a-0000-7000-8000-000000003203','01890f5a-0000-7000-8000-000000003204',
  '01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','01890f5a-0000-7000-8000-000000000503','01890f5a-0000-7000-8000-000000000801','01890f5a-0000-7000-8000-000000000701','WASTE','OUT','1.250000','SPOILAGE','waste-ok',repeat('9',64),2,NULL);
SELECT poc.test_assert('waste_history_reason',EXISTS(SELECT 1 FROM poc.inventory_movements WHERE id='01890f5a-0000-7000-8000-000000003201' AND movement_type='WASTE' AND reason_code='SPOILAGE'),'typed movement');
SELECT poc.test_assert('waste_projection',(SELECT on_hand_quantity FROM poc.stock_balances WHERE product_id='01890f5a-0000-7000-8000-000000000503')=8.750000,'projection affected');
SELECT poc.test_expect_error('waste_reason_required', $$INSERT INTO poc.inventory_movements VALUES('01890f5a-0000-7000-8000-000000003205','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000503','01890f5a-0000-7000-8000-000000000801','WASTE','OUT',1,NULL,'01890f5a-0000-7000-8000-000000003202',now())$$,ARRAY['23514']);
SELECT poc.test_expect_error('ledger_update_blocked', $$UPDATE poc.inventory_movements SET quantity=99 WHERE id='01890f5a-0000-7000-8000-000000003201'$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('ledger_delete_blocked', $$DELETE FROM poc.inventory_movements WHERE id='01890f5a-0000-7000-8000-000000003201'$$,ARRAY['42501','55000']);

DO $payment$
BEGIN
  BEGIN
    PERFORM poc.confirm_payment(
      '01890f5a-0000-7000-8000-000000001102','01890f5a-0000-7000-8000-000000004101','01890f5a-0000-7000-8000-000000004102','01890f5a-0000-7000-8000-000000004103','01890f5a-0000-7000-8000-000000004104',
      '01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','CARD_NETWORK','neutral-ref-fail',repeat('a',64),30,1,'AUDIT');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM poc.test_assert('payment_failure_rollback',(SELECT status='PENDING' AND version=1 FROM poc.payments WHERE id='01890f5a-0000-7000-8000-000000001102'),'state unchanged');
  PERFORM poc.test_assert('payment_failure_no_attempt',NOT EXISTS(SELECT 1 FROM poc.payment_attempts WHERE id='01890f5a-0000-7000-8000-000000004101'),'attempt rolled back');
END
$payment$;

SELECT poc.test_assert('payment_confirmed',poc.confirm_payment(
  '01890f5a-0000-7000-8000-000000001102','01890f5a-0000-7000-8000-000000004201','01890f5a-0000-7000-8000-000000004202','01890f5a-0000-7000-8000-000000004203','01890f5a-0000-7000-8000-000000004204',
  '01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','CARD_NETWORK','neutral-ref-ok',repeat('a',64),3,1,NULL),'one transition');
SELECT poc.test_assert('payment_duplicate_callback_no_effect',NOT poc.confirm_payment(
  '01890f5a-0000-7000-8000-000000001102','01890f5a-0000-7000-8000-000000004301','01890f5a-0000-7000-8000-000000004302','01890f5a-0000-7000-8000-000000004303','01890f5a-0000-7000-8000-000000004304',
  '01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000201','01890f5a-0000-7000-8000-000000000301','CARD_NETWORK','neutral-ref-ok',repeat('a',64),4,1,NULL),'terminal result not reapplied');
SELECT poc.test_assert('payment_single_effect',(SELECT count(*) FROM poc.payment_attempts WHERE payment_id='01890f5a-0000-7000-8000-000000001102')=1,'one attempt effect');
SELECT poc.test_expect_error('payment_external_reference_unique', $$INSERT INTO poc.payment_attempts VALUES('01890f5a-0000-7000-8000-000000004305','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000001102',2,'CONFIRMED','CARD_NETWORK','neutral-ref-ok',repeat('a',64),now())$$,ARRAY['23505']);

SELECT poc.test_assert('inbox_first_result',poc.receive_operation('01890f5a-0000-7000-8000-000000005101','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000002203',repeat('7',64),'ACCEPTED',repeat('e',64))='ACCEPTED','durable before ACK');
SELECT poc.test_assert('inbox_duplicate_prior_result',poc.receive_operation('01890f5a-0000-7000-8000-000000005102','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000002203',repeat('7',64),'IGNORED',repeat('f',64))='ACCEPTED','duplicate returns prior');
SELECT poc.test_assert('inbox_duplicate_single_row',(SELECT count(*) FROM poc.inbox_entries WHERE operation_id='01890f5a-0000-7000-8000-000000002203')=1,'no duplicate');
SELECT poc.test_expect_error('replay_checksum_mismatch', $$SELECT poc.receive_operation('01890f5a-0000-7000-8000-000000005103','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000002203',repeat('0',64),'ACCEPTED',repeat('e',64))$$,ARRAY['23505']);
SELECT poc.test_assert('checkpoint_advances_after_durable',poc.advance_checkpoint('01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000301','commercial',1,'01890f5a-0000-7000-8000-000000002203',1),'sequence 1');
SELECT poc.test_assert('checkpoint_expected_version',NOT poc.advance_checkpoint('01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000301','commercial',2,'01890f5a-0000-7000-8000-000000002203',1),'stale version rejected');
SELECT poc.test_expect_error('checkpoint_requires_inbox', $$SELECT poc.advance_checkpoint('01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000301','other-stream',1,'01890f5a-0000-7000-8000-000000004202',1)$$,ARRAY['23503']);
UPDATE poc.outbox_entries SET attempt_count=attempt_count+1,state='RETRY_SCHEDULED' WHERE operation_id='01890f5a-0000-7000-8000-000000002203';
SELECT poc.test_assert('outbox_retry_same_intent',(SELECT attempt_count FROM poc.outbox_entries WHERE operation_id='01890f5a-0000-7000-8000-000000002203')=1,'retry metadata only');

SELECT poc.test_expect_error('pricing_overlap_conflict', $$SELECT poc.publish_price('01890f5a-0000-7000-8000-000000006101','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000501',2,'1100.000000',10,'2026-06-01T00:00:00Z','2026-10-01T00:00:00Z',repeat('f',64),1)$$,ARRAY['23P01']);
SELECT poc.test_expect_error('pricing_expected_version_conflict', $$SELECT poc.publish_price('01890f5a-0000-7000-8000-000000006102','01890f5a-0000-7000-8000-000000000001','01890f5a-0000-7000-8000-000000000101','01890f5a-0000-7000-8000-000000000501',3,'1100.000000',20,'2027-01-01T00:00:00Z','2027-12-01T00:00:00Z',repeat('f',64),0)$$,ARRAY['40001']);

SELECT poc.test_expect_error('audit_update_blocked', $$UPDATE poc.audit_events SET result='REJECTED' WHERE id='01890f5a-0000-7000-8000-000000002205'$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('audit_delete_blocked', $$DELETE FROM poc.audit_events WHERE id='01890f5a-0000-7000-8000-000000002205'$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('audit_truncate_blocked', $$TRUNCATE poc.audit_events$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('sale_delete_blocked', $$DELETE FROM poc.sales WHERE id='01890f5a-0000-7000-8000-000000002201'$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('payment_delete_blocked', $$DELETE FROM poc.payments WHERE id='01890f5a-0000-7000-8000-000000001102'$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('sync_delete_blocked', $$DELETE FROM poc.sync_operations WHERE id='01890f5a-0000-7000-8000-000000002203'$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('outbox_delete_blocked', $$DELETE FROM poc.outbox_entries WHERE operation_id='01890f5a-0000-7000-8000-000000002203'$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('inbox_delete_blocked', $$DELETE FROM poc.inbox_entries WHERE operation_id='01890f5a-0000-7000-8000-000000002203'$$,ARRAY['42501','55000']);
SELECT poc.test_expect_error('tenant_delete_restricted', $$DELETE FROM poc.companies WHERE id='01890f5a-0000-7000-8000-000000000101'$$,ARRAY['23503']);

SELECT poc.test_assert('lot_optional',(SELECT count(*) FROM poc.products WHERE lot_controlled=false)>0,'product without lots');
SELECT poc.test_assert('lot_with_expiration',EXISTS(SELECT 1 FROM poc.inventory_lots WHERE expiration_date='2027-08-01'),'valid expiration');
SELECT poc.test_assert('lot_expiration_nullable',EXISTS(SELECT 1 FROM poc.inventory_lots WHERE expiration_date IS NULL),'nullable when applicable');
SELECT poc.test_assert('lot_has_no_quantity_column',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='poc' AND table_name='inventory_lots' AND column_name LIKE '%quantity%'),'quantity derives from ledger');
SELECT poc.test_assert('multi_business_same_schema',(SELECT count(DISTINCT dimension) FROM poc.units_of_measure)>=4 AND (SELECT count(*) FROM poc.products WHERE tenant_id='01890f5a-0000-7000-8000-000000000001')>=5,'store/weight/lot/dimensional/perishable');
SELECT poc.test_assert('capability_no_bypass_column',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='poc' AND table_name IN ('products','sales','payments') AND column_name ILIKE '%capability%'),'no invented feature code or bypass');
SELECT poc.test_assert('provider_neutral_columns',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='poc' AND column_name ~* '(^|_)(bold|wompi|mercado_pago|factus|siigo|pan|cvv)($|_)'),'neutral physical core');
SELECT poc.test_assert('indexes_structural',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='poc' AND indexname='sales_branch_date_idx') AND EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='poc' AND indexname='outbox_pending_idx'),'critical lookup indexes');
COMMIT;

\pset format unaligned
\pset tuples_only on
SELECT 'POSTGRES_TEST_COUNT='||count(*) FROM poc.test_results;
SELECT 'POSTGRES_TEST_FAILURES='||count(*) FROM poc.test_results WHERE NOT passed;
SELECT 'POSTGRES_TESTS_FAILED='||COALESCE(string_agg(name,','),'none') FROM poc.test_results WHERE NOT passed;

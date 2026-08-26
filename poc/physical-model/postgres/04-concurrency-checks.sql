\set ON_ERROR_STOP on

SELECT poc.test_assert('concurrency_sale_one_winner',(SELECT status='COMPLETED' AND version=2 FROM poc.sales WHERE id='01890f5a-0000-7000-8000-000000001001'),'optimistic version; no last-write-wins');
SELECT poc.test_assert('concurrency_inventory_two_facts',(SELECT count(*) FROM poc.inventory_movements WHERE id IN ('01890f5a-0000-7000-8000-000000007101','01890f5a-0000-7000-8000-000000007111'))=2,'both valid ledger facts retained');
SELECT poc.test_assert('concurrency_inventory_projection',(SELECT on_hand_quantity=2.000000 AND version=3 FROM poc.stock_balances WHERE tenant_id='01890f5a-0000-7000-8000-000000000001' AND product_id='01890f5a-0000-7000-8000-000000000501'),'serialized projection update');
SELECT poc.test_assert('concurrency_payment_one_effect',(SELECT status='CONFIRMED' AND version=2 FROM poc.payments WHERE id='01890f5a-0000-7000-8000-000000001105') AND (SELECT count(*) FROM poc.payment_attempts WHERE payment_id='01890f5a-0000-7000-8000-000000001105')=1,'one terminal effect');
SELECT poc.test_assert('concurrency_configuration_one_version',(SELECT count(*) FROM poc.pricing_versions WHERE tenant_id='01890f5a-0000-7000-8000-000000000001' AND product_id='01890f5a-0000-7000-8000-000000000501' AND version_number=2)=1,'expected version/priority conflict');

\pset format unaligned
\pset tuples_only on
SELECT 'POSTGRES_CONCURRENCY_TEST_COUNT='||count(*) FROM poc.test_results WHERE name LIKE 'concurrency_%';
SELECT 'POSTGRES_CONCURRENCY_FAILURES='||count(*) FROM poc.test_results WHERE name LIKE 'concurrency_%' AND NOT passed;

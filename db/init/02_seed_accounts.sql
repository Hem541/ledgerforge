-- seed: system accounts
-- runs after 01_schema.sql. fixed uuids so app code can reference w/o lookup.
-- incoming payment of $X: debit cash +X (asset), credit revenue -X. nets to zero

INSERT INTO accounts (id, name, type, currency) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Cash',             'asset',     'USD'),
    ('00000000-0000-0000-0000-000000000002', 'Payment Revenue',  'revenue',   'USD'),
    ('00000000-0000-0000-0000-000000000003', 'Customer Clearing','liability', 'USD'),
    ('00000000-0000-0000-0000-000000000004', 'Processing Fees',  'expense',   'USD')
ON CONFLICT (id) DO NOTHING;

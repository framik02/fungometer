ALTER TABLE orders ADD COLUMN checkout_closed INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX orders_pending ON orders(user_id, plan, mode) WHERE paid_at IS NULL AND revoked=0 AND checkout_closed=0;

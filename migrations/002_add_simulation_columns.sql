-- migrations/002_add_simulation_columns.sql
-- Shadow Accounting and Fee simulation tracking variables

ALTER TABLE virtual_trades
ADD COLUMN IF NOT EXISTS total_fee_paid DECIMAL(6, 4),
ADD COLUMN IF NOT EXISTS kelly_sim_volume_usdc DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS kelly_entry_price DECIMAL(6, 4),
ADD COLUMN IF NOT EXISTS kelly_sim_pnl_usdc DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS stop_loss_price DECIMAL(6, 4);

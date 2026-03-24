-- migrations/001_init.sql
-- Idempotent migration: creates the virtual_trades table and indexes.
-- Run once against your PostgreSQL database before starting the bot.

CREATE TABLE IF NOT EXISTS virtual_trades (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id           VARCHAR(255)  UNIQUE NOT NULL,
    market_url        TEXT          NOT NULL,
    category          VARCHAR(100),
    side              VARCHAR(10)   CHECK (side IN ('YES', 'NO')),

    -- Signal from D&B API (populated after webhook arrives)
    debunk_verdict    DECIMAL(6,4),
    edge              DECIMAL(6,4),
    kelly_fraction    DECIMAL(6,4),
    confidence        VARCHAR(20)   CHECK (confidence IN ('normal', 'low')),
    prior_n           INTEGER,
    confidence_mult   DECIMAL(4,3)  CHECK (confidence_mult BETWEEN 0.200 AND 1.000),

    -- Execution (populated after webhook + CLOB simulation)
    entry_price       DECIMAL(6,4),
    entry_volume_usdc DECIMAL(10,2),
    target_price      DECIMAL(6,4),
    stop_loss_price   DECIMAL(6,4),
    total_fee_paid    DECIMAL(6,4),

    -- Kelly simulation metrics
    kelly_sim_volume_usdc DECIMAL(10,2),
    kelly_entry_price     DECIMAL(6,4),
    kelly_sim_pnl_usdc    DECIMAL(10,2),

    -- Status and result
    status            VARCHAR(20)   DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','OPEN','CLOSED_EDGE','CLOSED_TIMEOUT','ERROR')),
    error_reason      TEXT,
    exit_price        DECIMAL(6,4),
    pnl_usdc          DECIMAL(10,2),

    entry_time        TIMESTAMPTZ,
    exit_time         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   DEFAULT NOW()
);

-- Indexes for hot query paths
CREATE INDEX IF NOT EXISTS idx_status     ON virtual_trades(status);
CREATE INDEX IF NOT EXISTS idx_task_id    ON virtual_trades(task_id);
CREATE INDEX IF NOT EXISTS idx_entry_time ON virtual_trades(entry_time DESC);

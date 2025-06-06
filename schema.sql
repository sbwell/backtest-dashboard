CREATE TABLE IF NOT EXISTS backtests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    strategy TEXT NOT NULL,
    run_name TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    win_rate REAL,
    profit REAL,
    trade_count INTEGER,
    settings_json TEXT,
    user_id TEXT
);

CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backtest_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    entry_time TEXT NOT NULL,
    exit_time TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    pnl REAL,
    duration_bars INTEGER,
    side TEXT,
    tags TEXT,
    notes TEXT,
    FOREIGN KEY(backtest_id) REFERENCES backtests(id) ON DELETE CASCADE
);

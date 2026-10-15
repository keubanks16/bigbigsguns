-- Already applied to the "bigbigsguns" D1 database.
CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, auth_hash TEXT NOT NULL, auth_salt TEXT NOT NULL, created INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, device TEXT);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(username);
CREATE TABLE IF NOT EXISTS guns (username TEXT NOT NULL, id TEXT NOT NULL, updated INTEGER NOT NULL, size INTEGER NOT NULL, PRIMARY KEY (username, id));
